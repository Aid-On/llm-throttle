export interface Logger {
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

export type AdjustmentFailureStrategy = 'strict' | 'warn' | 'compensate';

export interface ValidationRule<T = unknown> {
  name: string;
  validate: (value: T) => boolean | string;
  level: 'error' | 'warn';
}

export interface DualRateLimitConfig {
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
  validationRules?: ValidationRule[];
  /** Number of records to use for efficiency calculation (defaults to 50) */
  efficiencyWindowSize?: number;
  /** Storage configuration for persistence */
  storage?: {
    enabled?: boolean;
    implementation?: unknown; // Will be ThrottleStorage, but avoiding circular dependency
  };
}

export interface ConsumptionRecord<TMetadata = Record<string, unknown>> {
  timestamp: number;
  tokens: number;
  requestId: string;
  /** Optional metadata about the request */
  metadata?: TMetadata;
  /** Estimated tokens from initial consumption */
  estimatedTokens?: number;
  /** Actual tokens set via adjustConsumption */
  actualTokens?: number;
  /** Compensation debt for future requests */
  compensationDebt?: number;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  reason?: 'rpm_limit' | 'tpm_limit';
  availableIn?: number;
  /** Current available tokens */
  availableTokens?: {
    rpm: number;
    tpm: number;
  };
}

export interface MemoryMetrics {
  historyRecords: number;
  estimatedMemoryUsage: number;
  maxHistoryRecords?: number;
}

export interface StateSnapshot {
  timestamp: number;
  rpmBucketState: {
    available: number;
    capacity: number;
    lastRefill: number;
  };
  tpmBucketState: {
    available: number;
    capacity: number;
    lastRefill: number;
  };
  historyCount: number;
  compensationDebt: number;
}

export interface RateLimitMetrics {
  rpm: {
    used: number;
    available: number;
    limit: number;
    percentage: number;
  };
  tpm: {
    used: number;
    available: number;
    limit: number;
    percentage: number;
  };
  efficiency: number;
  consumptionHistory: {
    count: number;
    averageTokensPerRequest: number;
    totalTokens: number;
    estimationAccuracy?: number;
  };
  memory: MemoryMetrics;
  compensation: {
    totalDebt: number;
    pendingCompensation: number;
  };
}

export interface TokenBucketState {
  available: number;
  capacity: number;
  lastRefill: number;
}

export interface TokenBucketConfig {
  capacity: number;
  refillRate: number;
  initialTokens?: number;
  clock?: () => number;
  storageKey?: string;
}

export interface LLMThrottle<TMetadata = Record<string, unknown>> {
  consume(requestId: string, estimatedTokens: number, metadata?: TMetadata): Promise<boolean>;
  canProcess(estimatedTokens: number): RateLimitCheckResult;
  adjustConsumption(requestId: string, actualTokens: number): Promise<void>;
  getMetrics(): RateLimitMetrics;
  validateState(): boolean;
  createSnapshot(): StateSnapshot;
  restoreFromSnapshot(snapshot: StateSnapshot): void;
  reset(): void;
}