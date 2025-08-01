import { 
  ConsumptionRecord, 
  RateLimitCheckResult,
  RateLimitMetrics,
  Logger,
  AdjustmentFailureStrategy,
  StateSnapshot,
  MemoryMetrics
} from './types/index.js';
import { RateLimitError } from './errors.js';
import { TokenBucket } from './token-bucket.js';
import { AsyncLock } from './utils/async-lock.js';
import { createOptimalClock } from './utils/clock.js';
import { validateAndNormalizeConfig } from './utils/validation.js';
import { ThrottleStorage, InMemoryStorage } from './storage/index.js';

/**
 * Enhanced configuration for LLMThrottle with clear storage options
 */
export interface LLMThrottleConfig {
  /** Requests per minute limit */
  rpm: number;
  /** Tokens per minute limit */
  tpm: number;
  /** Optional burst capacity for RPM (defaults to rpm) */
  burstRPM?: number;
  /** Optional burst capacity for TPM (defaults to tpm) */
  burstTPM?: number;
  /** Optional custom clock function for testing */
  clock?: () => number;
  /** Optional custom logger (defaults to console) */
  logger?: Logger;
  /** Strategy when adjustConsumption fails to consume additional tokens */
  adjustmentFailureStrategy?: AdjustmentFailureStrategy;
  /** Maximum number of consumption records to keep in memory */
  maxHistoryRecords?: number;
  /** Maximum history retention time in milliseconds (defaults to 60000) */
  historyRetentionMs?: number;
  /** Enable monotonic clock (auto-detected by default) */
  monotonicClock?: boolean;
  /** Custom validation rules */
  validationRules?: any[]; // ValidationRule[] - avoiding circular dependency
  /** Number of records to use for efficiency calculation (defaults to 50) */
  efficiencyWindowSize?: number;
  /** Storage implementation for persistence */
  storage?: ThrottleStorage<any>;
}

/**
 * LLM Throttle - Rate limiter with dual constraints (RPM + TPM) and optional persistence
 */
export class LLMThrottle<TMetadata = Record<string, unknown>> {
  private rpmBucket: TokenBucket;
  private tpmBucket: TokenBucket;
  private consumptionHistory: ConsumptionRecord<TMetadata>[] = [];
  private clock: () => number;
  private logger: Logger;
  // private _config: LLMThrottleConfig; // Kept for future use
  private lock = new AsyncLock();
  private compensationDebt = 0;
  private historyRetentionMs: number;
  private maxHistoryRecords: number;
  private efficiencyWindowSize: number;
  private adjustmentFailureStrategy: AdjustmentFailureStrategy;
  private storage: ThrottleStorage<TMetadata>;
  private storageEnabled: boolean;
  private initialized: boolean = false;

  /**
   * Create a new LLMThrottle instance
   * @param config Configuration including optional storage implementation
   */
  constructor(config: LLMThrottleConfig) {
    // Convert to DualRateLimitConfig for validation
    const legacyConfig = {
      ...config,
      storage: config.storage ? { 
        enabled: true, 
        implementation: config.storage 
      } : undefined
    };

    // Validate and normalize config
    const tempLogger = config.logger || console;
    const validatedConfig = validateAndNormalizeConfig(legacyConfig, config.validationRules, tempLogger);
    this.logger = validatedConfig.logger || console;
    this.historyRetentionMs = validatedConfig.historyRetentionMs || 60000;
    this.maxHistoryRecords = validatedConfig.maxHistoryRecords || 10000;
    this.efficiencyWindowSize = validatedConfig.efficiencyWindowSize || 50;
    this.adjustmentFailureStrategy = validatedConfig.adjustmentFailureStrategy || 'warn';
    
    // Set up storage - cleaner interface
    this.storageEnabled = !!config.storage;
    this.storage = config.storage || new InMemoryStorage<TMetadata>();
    
    // Set up clock (monotonic by default unless explicitly disabled)
    if (validatedConfig.clock) {
      this.clock = validatedConfig.clock;
    } else {
      this.clock = createOptimalClock(validatedConfig.monotonicClock !== false);
    }
    
    this.rpmBucket = new TokenBucket({
      capacity: validatedConfig.burstRPM || validatedConfig.rpm,
      refillRate: validatedConfig.rpm / 60, // per second
      initialTokens: validatedConfig.burstRPM || validatedConfig.rpm,
      clock: this.clock,
      storageKey: 'rpm'
    }, this.storageEnabled ? this.storage : undefined);

    this.tpmBucket = new TokenBucket({
      capacity: validatedConfig.burstTPM || validatedConfig.tpm,
      refillRate: validatedConfig.tpm / 60,
      initialTokens: validatedConfig.burstTPM || validatedConfig.tpm,
      clock: this.clock,
      storageKey: 'tpm'
    }, this.storageEnabled ? this.storage : undefined);
  }

  /**
   * Initialize from storage if available
   * Call this after creating the instance to restore persisted state
   */
  async initialize(): Promise<void> {
    if (this.initialized || !this.storageEnabled) {
      return;
    }

    try {
      // Initialize token buckets from storage
      await Promise.all([
        this.rpmBucket.initializeFromStorage(),
        this.tpmBucket.initializeFromStorage()
      ]);

      // Load compensation debt
      const storedDebt = await this.storage.loadCompensationDebt();
      if (storedDebt >= 0) {
        this.compensationDebt = storedDebt;
      }

      // Load consumption history
      const history = await this.storage.loadConsumptionHistory(this.maxHistoryRecords);
      if (history.length > 0) {
        this.consumptionHistory = history;
        this.cleanupHistory(); // Ensure loaded history is within retention limits
      }

      this.logger.info('Throttle state initialized from storage');
    } catch (error) {
      this.logger.warn(`Failed to initialize from storage: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.initialized = true;
    }
  }

  canProcess(estimatedTokens: number): RateLimitCheckResult {
    if (estimatedTokens < 0) {
      throw new Error('Estimated tokens cannot be negative');
    }

    if (!this.rpmBucket.hasTokens(1)) {
      return {
        allowed: false,
        reason: 'rpm_limit',
        availableIn: this.rpmBucket.timeUntilNextToken(),
        availableTokens: {
          rpm: this.rpmBucket.available,
          tpm: this.tpmBucket.available
        }
      };
    }

    if (!this.tpmBucket.hasTokens(estimatedTokens)) {
      return {
        allowed: false,
        reason: 'tpm_limit',
        availableIn: this.tpmBucket.timeUntilTokens(estimatedTokens),
        availableTokens: {
          rpm: this.rpmBucket.available,
          tpm: this.tpmBucket.available
        }
      };
    }

    return { 
      allowed: true,
      availableTokens: {
        rpm: this.rpmBucket.available,
        tpm: this.tpmBucket.available
      }
    };
  }

  // Synchronous version (backward compatibility)
  consume(requestId: string, estimatedTokens: number, metadata?: TMetadata): boolean {
    if (!requestId || requestId.trim() === '') {
      throw new Error('Request ID cannot be empty');
    }
    
    // For sync version, apply compensation but don't use async lock
    const totalTokensNeeded = estimatedTokens + this.compensationDebt;
    
    const check = this.canProcess(totalTokensNeeded);
    if (!check.allowed) {
      return false;
    }

    this.rpmBucket.consume(1);
    this.tpmBucket.consume(totalTokensNeeded);
    
    // Reset compensation debt after successful consumption
    const appliedCompensation = this.compensationDebt;
    this.compensationDebt = 0;

    const record: ConsumptionRecord<TMetadata> = {
      timestamp: this.clock(),
      tokens: estimatedTokens,
      requestId,
      metadata,
      estimatedTokens,
      compensationDebt: appliedCompensation
    };
    
    this.consumptionHistory.push(record);
    
    // Persist to storage if enabled
    if (this.storageEnabled) {
      this.storage.addConsumptionRecord(record).catch(() => {
        // Ignore storage errors
      });
    }

    this.cleanupHistory();
    return true;
  }

  // Async version for concurrent scenarios
  async consumeAsync(requestId: string, estimatedTokens: number, metadata?: TMetadata): Promise<boolean> {
    if (!requestId || requestId.trim() === '') {
      throw new Error('Request ID cannot be empty');
    }
    
    return await this.lock.withLock(async () => {
      // Apply any pending compensation
      const totalTokensNeeded = estimatedTokens + this.compensationDebt;
      
      const check = this.canProcess(totalTokensNeeded);
      if (!check.allowed) {
        return false;
      }

      this.rpmBucket.consume(1);
      this.tpmBucket.consume(totalTokensNeeded);
      
      // Reset compensation debt after successful consumption
      const appliedCompensation = this.compensationDebt;
      this.compensationDebt = 0;

      const record: ConsumptionRecord<TMetadata> = {
        timestamp: this.clock(),
        tokens: estimatedTokens,
        requestId,
        metadata,
        estimatedTokens,
        compensationDebt: appliedCompensation
      };
      
      this.consumptionHistory.push(record);
      
      // Persist to storage if enabled
      if (this.storageEnabled) {
        this.storage.addConsumptionRecord(record).catch(() => {
          // Ignore storage errors
        });
      }

      this.cleanupHistory();
      return true;
    });
  }

  // Synchronous version (backward compatibility)
  consumeOrThrow(requestId: string, estimatedTokens: number, metadata?: TMetadata): void {
    const consumed = this.consume(requestId, estimatedTokens, metadata);
    if (!consumed) {
      const check = this.canProcess(estimatedTokens + this.compensationDebt);
      throw new RateLimitError(
        `Rate limit exceeded: ${check.reason}`,
        check.reason!,
        check.availableIn!
      );
    }
  }

  async consumeOrThrowAsync(requestId: string, estimatedTokens: number, metadata?: TMetadata): Promise<void> {
    const consumed = await this.consumeAsync(requestId, estimatedTokens, metadata);
    if (!consumed) {
      const check = this.canProcess(estimatedTokens + this.compensationDebt);
      throw new RateLimitError(
        `Rate limit exceeded: ${check.reason}`,
        check.reason!,
        check.availableIn!
      );
    }
  }

  // Synchronous version (backward compatibility)
  adjustConsumption(requestId: string, actualTokens: number): void {
    if (actualTokens < 0) {
      throw new Error('Actual tokens cannot be negative');
    }

    const record = this.consumptionHistory.find(
      item => item.requestId === requestId
    );

    if (!record) {
      throw new Error(`Request ID '${requestId}' not found in consumption history`);
    }

    const difference = actualTokens - record.tokens;
    
    if (difference > 0) {
      // Need to consume additional tokens
      const consumed = this.tpmBucket.consume(difference);
      if (!consumed) {
        this.handleAdjustmentFailureSync(requestId, difference);
      }
    } else if (difference < 0) {
      // Refund excess tokens
      this.tpmBucket.refund(-difference);
    }
    
    record.tokens = actualTokens;
    record.actualTokens = actualTokens;
  }

  async adjustConsumptionAsync(requestId: string, actualTokens: number): Promise<void> {
    if (actualTokens < 0) {
      throw new Error('Actual tokens cannot be negative');
    }

    return await this.lock.withLock(async () => {
      const record = this.consumptionHistory.find(
        item => item.requestId === requestId
      );

      if (!record) {
        throw new Error(`Request ID '${requestId}' not found in consumption history`);
      }

      const difference = actualTokens - record.tokens;
      
      if (difference > 0) {
        // Need to consume additional tokens
        const consumed = this.tpmBucket.consume(difference);
        if (!consumed) {
          await this.handleAdjustmentFailure(requestId, difference);
        }
      } else if (difference < 0) {
        // Refund excess tokens
        this.tpmBucket.refund(-difference);
      }
      
      record.tokens = actualTokens;
      record.actualTokens = actualTokens;
    });
  }

  private handleAdjustmentFailureSync(requestId: string, additionalTokens: number): void {
    const message = `Failed to consume additional ${additionalTokens} tokens for request ${requestId}`;
    
    switch (this.adjustmentFailureStrategy) {
      case 'strict':
        throw new RateLimitError(
          message,
          'tpm_limit',
          this.tpmBucket.timeUntilTokens(additionalTokens)
        );
      
      case 'warn':
        this.logger.warn(message);
        break;
      
      case 'compensate':
        this.compensationDebt += additionalTokens;
        this.logger.info(`Adding ${additionalTokens} tokens to compensation debt. Total debt: ${this.compensationDebt}`);
        this.persistCompensationDebt();
        break;
    }
  }

  private async handleAdjustmentFailure(requestId: string, additionalTokens: number): Promise<void> {
    const message = `Failed to consume additional ${additionalTokens} tokens for request ${requestId}`;
    
    switch (this.adjustmentFailureStrategy) {
      case 'strict':
        throw new RateLimitError(
          message,
          'tpm_limit',
          this.tpmBucket.timeUntilTokens(additionalTokens)
        );
      
      case 'warn':
        this.logger.warn(message);
        break;
      
      case 'compensate':
        this.compensationDebt += additionalTokens;
        this.logger.info(`Adding ${additionalTokens} tokens to compensation debt. Total debt: ${this.compensationDebt}`);
        this.persistCompensationDebt();
        break;
    }
  }

  getMetrics(): RateLimitMetrics {
    this.cleanupHistory();
    
    const rpmUsed = this.rpmBucket.capacity - this.rpmBucket.available;
    const tpmUsed = this.tpmBucket.capacity - this.tpmBucket.available;

    const historyStats = this.getHistoryStatistics();
    const memoryStats = this.getMemoryMetrics();

    return {
      rpm: {
        used: rpmUsed,
        available: this.rpmBucket.available,
        limit: this.rpmBucket.capacity,
        percentage: (rpmUsed / this.rpmBucket.capacity) * 100
      },
      tpm: {
        used: tpmUsed,
        available: this.tpmBucket.available,
        limit: this.tpmBucket.capacity,
        percentage: (tpmUsed / this.tpmBucket.capacity) * 100
      },
      efficiency: this.calculateEfficiency(),
      consumptionHistory: historyStats,
      memory: memoryStats,
      compensation: {
        totalDebt: this.compensationDebt,
        pendingCompensation: this.compensationDebt
      }
    };
  }

  getConsumptionHistory(): ConsumptionRecord<TMetadata>[] {
    this.cleanupHistory();
    return [...this.consumptionHistory];
  }

  // Synchronous version (backward compatibility)
  reset(): void {
    this.rpmBucket.reset();
    this.tpmBucket.reset();
    this.consumptionHistory = [];
    this.compensationDebt = 0;
    
    if (this.storageEnabled) {
      this.storage.clear().catch(() => {
        // Ignore storage errors
      });
    }
  }

  async resetAsync(): Promise<void> {
    return await this.lock.withLock(async () => {
      this.rpmBucket.reset();
      this.tpmBucket.reset();
      this.consumptionHistory = [];
      this.compensationDebt = 0;
      
      if (this.storageEnabled) {
        await this.storage.clear();
      }
    });
  }

  setHistoryRetention(ms: number): void {
    if (ms <= 0) {
      throw new Error('History retention must be positive');
    }
    this.historyRetentionMs = ms;
  }

  setMaxHistoryRecords(count: number): void {
    if (count <= 0) {
      throw new Error('Max history records must be positive');
    }
    this.maxHistoryRecords = count;
    this.cleanupHistory();
  }

  private cleanupHistory(): void {
    const cutoff = this.clock() - this.historyRetentionMs;
    
    // Remove old records
    this.consumptionHistory = this.consumptionHistory.filter(
      item => item.timestamp > cutoff
    );
    
    // Cleanup in storage if enabled
    if (this.storageEnabled) {
      this.storage.cleanupConsumptionHistory(cutoff).catch(() => {
        // Ignore storage errors
      });
    }
    
    // Enforce max records limit
    if (this.consumptionHistory.length > this.maxHistoryRecords) {
      const excess = this.consumptionHistory.length - this.maxHistoryRecords;
      this.consumptionHistory.splice(0, excess);
      
      if (excess > 10) { // Lower threshold for testing
        this.logger.warn(`Removed ${excess} old consumption records to stay within memory limit`);
      }
    }
  }

  private getHistoryStatistics(): RateLimitMetrics['consumptionHistory'] {
    if (this.consumptionHistory.length === 0) {
      return {
        count: 0,
        averageTokensPerRequest: 0,
        totalTokens: 0,
        estimationAccuracy: 1.0
      };
    }

    const totalTokens = this.consumptionHistory.reduce(
      (sum, record) => sum + record.tokens, 
      0
    );
    
    // Calculate estimation accuracy from records with both estimated and actual values
    const recordsWithActual = this.consumptionHistory.filter(
      record => record.estimatedTokens !== undefined && record.actualTokens !== undefined
    );
    
    let estimationAccuracy = 1.0;
    if (recordsWithActual.length > 0) {
      const accuracySum = recordsWithActual.reduce((sum, record) => {
        const estimated = record.estimatedTokens!;
        const actual = record.actualTokens!;
        if (estimated === 0) return sum + 1;
        return sum + Math.min(estimated, actual) / Math.max(estimated, actual);
      }, 0);
      estimationAccuracy = accuracySum / recordsWithActual.length;
    }

    return {
      count: this.consumptionHistory.length,
      averageTokensPerRequest: totalTokens / this.consumptionHistory.length,
      totalTokens,
      estimationAccuracy
    };
  }
  
  private getMemoryMetrics(): MemoryMetrics {
    const recordSize = 200; // Rough estimate per record in bytes
    return {
      historyRecords: this.consumptionHistory.length,
      estimatedMemoryUsage: this.consumptionHistory.length * recordSize,
      maxHistoryRecords: this.maxHistoryRecords
    };
  }

  private calculateEfficiency(): number {
    const recentHistory = this.consumptionHistory.slice(-this.efficiencyWindowSize);
    
    if (recentHistory.length === 0) return 1.0;
    
    // Only calculate efficiency for records that have both estimated and actual values
    const recordsWithActual = recentHistory.filter(
      record => record.estimatedTokens !== undefined && record.actualTokens !== undefined
    );
    
    if (recordsWithActual.length === 0) {
      // If no actual values are available, return default efficiency
      return 0.85;
    }
    
    let totalAccuracy = 0;
    for (const record of recordsWithActual) {
      const estimated = record.estimatedTokens!;
      const actual = record.actualTokens!;
      
      if (estimated === 0 && actual === 0) {
        totalAccuracy += 1.0;
      } else if (estimated === 0 || actual === 0) {
        totalAccuracy += 0.0;
      } else {
        // Calculate accuracy as min/max ratio (perfect = 1.0)
        totalAccuracy += Math.min(estimated, actual) / Math.max(estimated, actual);
      }
    }
    
    return totalAccuracy / recordsWithActual.length;
  }
  
  /**
   * Validates internal state consistency
   */
  validateState(): boolean {
    try {
      // Check bucket consistency
      if (!this.rpmBucket.validateConsistency() || !this.tpmBucket.validateConsistency()) {
        return false;
      }
      
      // Check compensation debt is not negative
      if (this.compensationDebt < 0) {
        return false;
      }
      
      // Check history is within bounds
      if (this.consumptionHistory.length > this.maxHistoryRecords * 1.1) { // Allow 10% overage
        return false;
      }
      
      // Check timestamps are reasonable
      const now = this.clock();
      const oldestAllowed = now - this.historyRetentionMs * 2; // Allow 2x retention for cleanup lag
      
      for (const record of this.consumptionHistory) {
        if (record.timestamp < oldestAllowed || record.timestamp > now + 1000) {
          return false;
        }
        if (record.tokens < 0) {
          return false;
        }
      }
      
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * Creates a state snapshot for backup/restore
   */
  createSnapshot(): StateSnapshot {
    return {
      timestamp: this.clock(),
      rpmBucketState: this.rpmBucket.getState(),
      tpmBucketState: this.tpmBucket.getState(),
      historyCount: this.consumptionHistory.length,
      compensationDebt: this.compensationDebt
    };
  }
  
  /**
   * Restores state from a snapshot
   */
  async restoreFromSnapshot(snapshot: StateSnapshot): Promise<void> {
    return await this.lock.withLock(async () => {
      try {
        this.rpmBucket.restoreState(snapshot.rpmBucketState);
        this.tpmBucket.restoreState(snapshot.tpmBucketState);
        this.compensationDebt = snapshot.compensationDebt;
        
        // Clear history as we can't restore individual records reliably
        this.consumptionHistory = [];
        
        this.logger.info(`State restored from snapshot (timestamp: ${snapshot.timestamp})`);
      } catch (error) {
        this.logger.error(`Failed to restore from snapshot: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    });
  }
  
  /**
   * Attempts to repair inconsistent state
   */
  async repairState(): Promise<boolean> {
    return await this.lock.withLock(async () => {
      let repaired = false;
      
      // Reset negative compensation debt
      if (this.compensationDebt < 0) {
        this.logger.warn(`Repairing negative compensation debt: ${this.compensationDebt}`);
        this.compensationDebt = 0;
        this.persistCompensationDebt();
        repaired = true;
      }
      
      // Clean up invalid history records
      const originalLength = this.consumptionHistory.length;
      const now = this.clock();
      const oldestAllowed = now - this.historyRetentionMs * 2;
      
      this.consumptionHistory = this.consumptionHistory.filter(record => {
        return record.timestamp >= oldestAllowed && 
               record.timestamp <= now + 1000 && 
               record.tokens >= 0;
      });
      
      if (this.consumptionHistory.length !== originalLength) {
        this.logger.warn(`Removed ${originalLength - this.consumptionHistory.length} invalid history records`);
        repaired = true;
      }
      
      // Force cleanup if over limits
      if (this.consumptionHistory.length > this.maxHistoryRecords) {
        const excess = this.consumptionHistory.length - this.maxHistoryRecords;
        this.consumptionHistory.splice(0, excess);
        this.logger.warn(`Removed ${excess} excess history records`);
        repaired = true;
      }
      
      return repaired;
    });
  }

  /**
   * Persist compensation debt to storage
   */
  private persistCompensationDebt(): void {
    if (!this.storageEnabled) {
      return;
    }

    this.storage.saveCompensationDebt(this.compensationDebt).catch(() => {
      // Ignore storage errors
    });
  }
}

// Factory functions for common use cases
export function createLLMThrottle<TMetadata = Record<string, unknown>>(
  config: LLMThrottleConfig
): LLMThrottle<TMetadata> {
  return new LLMThrottle<TMetadata>(config);
}

export function createLLMThrottleWithStorage<TMetadata = Record<string, unknown>>(
  config: Omit<LLMThrottleConfig, 'storage'>,
  storage: ThrottleStorage<TMetadata>
): LLMThrottle<TMetadata> {
  return new LLMThrottle<TMetadata>({
    ...config,
    storage
  });
}

// Re-export everything else
export { TokenBucket } from './token-bucket.js';
export { RateLimitError, InvalidConfigError } from './errors.js';
export { AsyncLock } from './utils/async-lock.js';
export { createOptimalClock, createMonotonicClock, createStandardClock, getClockInfo } from './utils/clock.js';
export { validateConfig, validateAndNormalizeConfig, defaultValidationRules } from './utils/validation.js';
export { estimateTokens, isFuzztokAvailable, robustEstimateTokens } from './utils/fuzztok-integration.js';
export { InMemoryStorage } from './storage/index.js';
export type { ThrottleStorage, StorageConfig } from './storage/index.js';

export type { 
  DualRateLimitConfig, 
  ConsumptionRecord, 
  RateLimitCheckResult,
  RateLimitMetrics,
  TokenBucketConfig,
  TokenBucketState,
  Logger,
  AdjustmentFailureStrategy,
  ValidationRule,
  StateSnapshot,
  MemoryMetrics
} from './types/index.js';