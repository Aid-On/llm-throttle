import { ThrottleStorage } from './types.js';
import { ConsumptionRecord, TokenBucketState } from '../types/index.js';

/**
 * In-memory storage implementation (default)
 */
export class InMemoryStorage<TMetadata = Record<string, unknown>> implements ThrottleStorage<TMetadata> {
  private tokenBucketStates: Map<string, TokenBucketState> = new Map();
  private consumptionHistory: ConsumptionRecord<TMetadata>[] = [];
  private compensationDebt: number = 0;

  async saveTokenBucketState(key: string, state: TokenBucketState): Promise<void> {
    this.tokenBucketStates.set(key, { ...state });
  }

  async loadTokenBucketState(key: string): Promise<TokenBucketState | null> {
    const state = this.tokenBucketStates.get(key);
    return state ? { ...state } : null;
  }

  async saveConsumptionHistory(records: ConsumptionRecord<TMetadata>[]): Promise<void> {
    this.consumptionHistory = [...records];
  }

  async loadConsumptionHistory(limit?: number): Promise<ConsumptionRecord<TMetadata>[]> {
    if (limit && limit > 0) {
      return this.consumptionHistory.slice(-limit);
    }
    return [...this.consumptionHistory];
  }

  async addConsumptionRecord(record: ConsumptionRecord<TMetadata>): Promise<void> {
    this.consumptionHistory.push({ ...record });
  }

  async cleanupConsumptionHistory(olderThan: number): Promise<number> {
    const originalLength = this.consumptionHistory.length;
    this.consumptionHistory = this.consumptionHistory.filter(
      record => record.timestamp > olderThan
    );
    return originalLength - this.consumptionHistory.length;
  }

  async saveCompensationDebt(debt: number): Promise<void> {
    this.compensationDebt = debt;
  }

  async loadCompensationDebt(): Promise<number> {
    return this.compensationDebt;
  }

  async clear(): Promise<void> {
    this.tokenBucketStates.clear();
    this.consumptionHistory = [];
    this.compensationDebt = 0;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}