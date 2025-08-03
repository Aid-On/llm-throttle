import { TokenBucketConfig, TokenBucketState } from './types/index.js';
import { InvalidConfigError } from './errors.js';
import { ThrottleStorage } from './storage/index.js';

export class TokenBucket {
  private _capacity: number;
  private _available: number;
  private _refillRate: number;
  private _lastRefill: number;
  private _clock: () => number;
  private _storage?: ThrottleStorage<unknown>;
  private _storageKey?: string;
  private _initialized: boolean = false;

  constructor(config: TokenBucketConfig, storage?: ThrottleStorage<unknown>) {
    this.validateConfig(config);
    
    this._capacity = config.capacity;
    this._available = config.initialTokens ?? config.capacity;
    this._refillRate = config.refillRate;
    this._clock = config.clock ?? (() => Date.now());
    this._lastRefill = this._clock();
    this._storage = storage;
    this._storageKey = config.storageKey;
  }

  private validateConfig(config: TokenBucketConfig): void {
    if (config.capacity <= 0) {
      throw new InvalidConfigError('Capacity must be greater than 0');
    }
    if (config.refillRate <= 0) {
      throw new InvalidConfigError('Refill rate must be greater than 0');
    }
    if (config.initialTokens !== undefined && config.initialTokens < 0) {
      throw new InvalidConfigError('Initial tokens cannot be negative');
    }
    if (config.initialTokens !== undefined && config.initialTokens > config.capacity) {
      throw new InvalidConfigError('Initial tokens cannot exceed capacity');
    }
  }

  get capacity(): number {
    return this._capacity;
  }

  get available(): number {
    this.refill();
    return this._available;
  }

  get refillRate(): number {
    return this._refillRate;
  }

  private refill(): void {
    const now = this._clock();
    const timePassed = (now - this._lastRefill) / 1000; // seconds
    
    if (timePassed <= 0) return;
    
    const tokensToAdd = timePassed * this._refillRate;
    this._available = Math.min(
      this._capacity,
      this._available + tokensToAdd
    );
    this._lastRefill = now;
  }

  hasTokens(count: number): boolean {
    if (count < 0) return false;
    this.refill();
    return this._available >= count;
  }

  consume(count: number): boolean {
    if (count < 0) {
      throw new Error('Cannot consume negative tokens');
    }
    
    this.refill();
    if (this._available >= count) {
      this._available -= count;
      this.persistState();
      return true;
    }
    return false;
  }

  refund(count: number): void {
    if (count < 0) {
      throw new Error('Cannot refund negative tokens');
    }
    
    this._available = Math.min(this._capacity, this._available + count);
    this.persistState();
  }

  timeUntilNextToken(): number {
    this.refill();
    if (this._available >= 1) return 0;
    return Math.ceil((1 - this._available) / this._refillRate * 1000); // ms
  }

  timeUntilTokens(count: number): number {
    if (count <= 0) return 0;
    
    this.refill();
    if (this._available >= count) return 0;
    
    const needed = count - this._available;
    return Math.ceil(needed / this._refillRate * 1000); // ms
  }

  reset(): void {
    this._available = this._capacity;
    this._lastRefill = this._clock();
    this.persistState();
  }

  /**
   * Get current internal state for snapshots
   */
  getState(): TokenBucketState {
    this.refill();
    return {
      available: this._available,
      capacity: this._capacity,
      lastRefill: this._lastRefill
    };
  }

  /**
   * Restore state from snapshot
   */
  restoreState(state: TokenBucketState): void {
    if (state.available < 0 || state.available > state.capacity) {
      throw new Error('Invalid state: available tokens out of range');
    }
    if (state.capacity !== this._capacity) {
      throw new Error('Invalid state: capacity mismatch');
    }
    
    this._available = state.available;
    this._lastRefill = state.lastRefill;
  }

  /**
   * Validate internal consistency
   */
  validateConsistency(): boolean {
    this.refill();
    return this._available >= 0 && 
           this._available <= this._capacity && 
           this._capacity > 0 && 
           this._refillRate > 0;
  }

  /**
   * Initialize from storage if available
   */
  async initializeFromStorage(): Promise<void> {
    if (!this._storage || !this._storageKey || this._initialized) {
      return;
    }

    try {
      const storedState = await this._storage.loadTokenBucketState(this._storageKey);
      if (storedState && storedState.capacity === this._capacity) {
        // Only restore if capacity matches (configuration hasn't changed)
        this._available = storedState.available;
        this._lastRefill = storedState.lastRefill;
      }
    } catch (error) {
      // Ignore storage errors during initialization
    } finally {
      this._initialized = true;
    }
  }

  /**
   * Persist current state to storage
   */
  private persistState(): void {
    if (!this._storage || !this._storageKey) {
      return;
    }

    // Fire and forget - don't block on storage operations
    const state = this.getState();
    this._storage.saveTokenBucketState(this._storageKey, state).catch(() => {
      // Ignore storage errors
    });
  }
}