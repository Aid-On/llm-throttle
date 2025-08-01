import { ConsumptionRecord, TokenBucketState } from '../types/index.js';

/**
 * Storage interface for persisting throttle state
 */
export interface ThrottleStorage<TMetadata = Record<string, unknown>> {
  /**
   * Save token bucket state
   */
  saveTokenBucketState(key: string, state: TokenBucketState): Promise<void>;
  
  /**
   * Load token bucket state
   */
  loadTokenBucketState(key: string): Promise<TokenBucketState | null>;
  
  /**
   * Save consumption history
   */
  saveConsumptionHistory(records: ConsumptionRecord<TMetadata>[]): Promise<void>;
  
  /**
   * Load consumption history
   */
  loadConsumptionHistory(limit?: number): Promise<ConsumptionRecord<TMetadata>[]>;
  
  /**
   * Add a single consumption record
   */
  addConsumptionRecord(record: ConsumptionRecord<TMetadata>): Promise<void>;
  
  /**
   * Remove old consumption records
   */
  cleanupConsumptionHistory(olderThan: number): Promise<number>;
  
  /**
   * Save compensation debt
   */
  saveCompensationDebt(debt: number): Promise<void>;
  
  /**
   * Load compensation debt
   */
  loadCompensationDebt(): Promise<number>;
  
  /**
   * Clear all stored data
   */
  clear(): Promise<void>;
  
  /**
   * Check if storage is available and working
   */
  isAvailable(): Promise<boolean>;
}

/**
 * Storage configuration
 */
export interface StorageConfig {
  /**
   * Enable or disable persistence
   */
  enabled?: boolean;
  
  /**
   * Custom storage implementation
   */
  storage?: ThrottleStorage;
}