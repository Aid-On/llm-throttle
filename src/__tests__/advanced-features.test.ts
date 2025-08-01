/**
 * Tests for advanced features like error recovery, state management, and logging
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LLMThrottle } from '../index.js';
import type { Logger, StateSnapshot } from '../types/index.js';

describe('LLMThrottle Advanced Features', () => {
  let mockLogger: Logger;
  let limiter: LLMThrottle;
  
  beforeEach(() => {
    mockLogger = {
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn()
    };
    
    limiter = new LLMThrottle({
      rpm: 60,
      tpm: 1000,
      logger: mockLogger,
      adjustmentFailureStrategy: 'warn'
    });
  });

  describe('State Management', () => {
    it('should create and restore snapshots correctly', async () => {
      // Consume some resources
      await limiter.consume('test-1', 100);
      await limiter.consume('test-2', 200);
      
      const snapshot = limiter.createSnapshot();
      expect(snapshot).toHaveProperty('timestamp');
      expect(snapshot).toHaveProperty('rpmBucketState');
      expect(snapshot).toHaveProperty('tpmBucketState');
      expect(snapshot.historyCount).toBe(2);
      
      // Consume more resources
      await limiter.consume('test-3', 300);
      
      // Restore from snapshot
      await limiter.restoreFromSnapshot(snapshot);
      
      const metrics = limiter.getMetrics();
      expect(metrics.consumptionHistory.count).toBe(0); // History is cleared on restore
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('State restored'));
    });

    it('should validate state consistency', async () => {
      await limiter.consume('test-1', 100);
      expect(limiter.validateState()).toBe(true);
      
      // State should remain valid after operations
      await limiter.adjustConsumption('test-1', 150);
      expect(limiter.validateState()).toBe(true);
    });

    it('should repair corrupted state', async () => {
      // Simulate some consumption
      await limiter.consume('test-1', 100);
      
      // Force some corruption via private property access
      (limiter as any).compensationDebt = -50; // Invalid negative debt
      
      expect(limiter.validateState()).toBe(false);
      
      const repaired = await limiter.repairState();
      expect(repaired).toBe(true);
      expect(limiter.validateState()).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('negative compensation debt'));
    });
  });

  describe('Adjustment Failure Strategies', () => {
    it('should handle strict strategy by throwing errors', async () => {
      const strictLimiter = new LLMThrottle({
        rpm: 10,
        tpm: 100,
        adjustmentFailureStrategy: 'strict'
      });
      
      await strictLimiter.consumeAsync('test-1', 100); // Use all TPM
      
      await expect(
        strictLimiter.adjustConsumptionAsync('test-1', 150)
      ).rejects.toThrow('Failed to consume additional');
    });

    it('should handle warn strategy by logging warnings', async () => {
      const warnLimiter = new LLMThrottle({
        rpm: 10,
        tpm: 100,
        logger: mockLogger,
        adjustmentFailureStrategy: 'warn'
      });
      
      await warnLimiter.consumeAsync('test-1', 100);
      await warnLimiter.adjustConsumptionAsync('test-1', 150);
      
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to consume additional 50 tokens')
      );
    });

    it('should handle compensate strategy by tracking debt', async () => {
      const compensateLimiter = new LLMThrottle({
        rpm: 10,
        tpm: 100,
        logger: mockLogger,
        adjustmentFailureStrategy: 'compensate'
      });
      
      await compensateLimiter.consumeAsync('test-1', 100);
      await compensateLimiter.adjustConsumptionAsync('test-1', 150);
      
      const metrics = compensateLimiter.getMetrics();
      expect(metrics.compensation.totalDebt).toBe(50);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Adding 50 tokens to compensation debt')
      );
      
      // Next consume should fail due to debt
      const canConsume = await compensateLimiter.consumeAsync('test-2', 50);
      expect(canConsume).toBe(false);
    });
  });

  describe('Memory Management', () => {
    it('should enforce max history records limit', async () => {
      const memoryLimiter = new LLMThrottle({
        rpm: 1000,
        tpm: 10000,
        maxHistoryRecords: 10,
        logger: mockLogger
      });
      
      // First, populate many records in the history manually to simulate bulk cleanup
      const manyRecords = Array.from({ length: 50 }, (_, i) => ({
        timestamp: Date.now(),
        tokens: 10,
        requestId: `bulk-${i}`,
        estimatedTokens: 10
      }));
      (memoryLimiter as any).consumptionHistory = manyRecords;
      
      // Now trigger cleanup by calling getMetrics
      const metrics = memoryLimiter.getMetrics();
      expect(metrics.memory.historyRecords).toBeLessThanOrEqual(10);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Removed')
      );
    });

    it('should provide memory usage metrics', async () => {
      await limiter.consume('test-1', 100);
      await limiter.consume('test-2', 200);
      
      const metrics = limiter.getMetrics();
      expect(metrics.memory.historyRecords).toBe(2);
      expect(metrics.memory.estimatedMemoryUsage).toBeGreaterThan(0);
      expect(metrics.memory.maxHistoryRecords).toBeDefined();
    });

    it('should handle history retention correctly', () => {
      const now = Date.now();
      const retentionMs = 1000;
      
      const retentionLimiter = new LLMThrottle({
        rpm: 100,
        tpm: 1000,
        historyRetentionMs: retentionMs,
        clock: () => now
      });
      
      // Add some records
      (retentionLimiter as any).consumptionHistory = [
        { timestamp: now - 2000, requestId: 'old', tokens: 10 },
        { timestamp: now - 500, requestId: 'recent', tokens: 20 },
        { timestamp: now, requestId: 'current', tokens: 30 }
      ];
      
      const metrics = retentionLimiter.getMetrics();
      expect(metrics.consumptionHistory.count).toBe(2); // Old record should be cleaned up
    });
  });

  describe('Efficiency Calculation', () => {
    it('should calculate efficiency based on estimation accuracy', async () => {
      await limiter.consume('test-1', 100);
      await limiter.adjustConsumption('test-1', 90); // 90% accurate
      
      await limiter.consume('test-2', 200);
      await limiter.adjustConsumption('test-2', 180); // 90% accurate
      
      const metrics = limiter.getMetrics();
      expect(metrics.efficiency).toBeCloseTo(0.9, 1);
      expect(metrics.consumptionHistory.estimationAccuracy).toBeCloseTo(0.9, 1);
    });

    it('should handle perfect estimation', async () => {
      await limiter.consume('test-1', 100);
      await limiter.adjustConsumption('test-1', 100); // Perfect accuracy
      
      const metrics = limiter.getMetrics();
      expect(metrics.efficiency).toBe(1.0);
    });

    it('should provide default efficiency when no actual values available', async () => {
      await limiter.consume('test-1', 100);
      // No adjustConsumption call
      
      const metrics = limiter.getMetrics();
      expect(metrics.efficiency).toBe(0.85); // Default fallback
    });
  });

  describe('Generic Metadata Support', () => {
    interface CustomMetadata {
      userId: string;
      requestType: 'chat' | 'completion';
      model: string;
    }
    
    it('should support typed metadata', async () => {
      const typedLimiter = new LLMThrottle<CustomMetadata>({
        rpm: 60,
        tpm: 1000
      });
      
      const metadata: CustomMetadata = {
        userId: 'user123',
        requestType: 'chat',
        model: 'gpt-4'
      };
      
      await typedLimiter.consume('test-1', 100, metadata);
      
      const history = typedLimiter.getConsumptionHistory();
      expect(history[0].metadata).toEqual(metadata);
      expect(history[0].metadata?.userId).toBe('user123');
      expect(history[0].metadata?.requestType).toBe('chat');
    });
  });

  describe('Clock and Timing', () => {
    it('should use monotonic clock when available', () => {
      // This test verifies the clock is working, but specific implementation
      // depends on environment, so we just verify it's functional
      const clockLimiter = new LLMThrottle({
        rpm: 60,
        tpm: 1000,
        monotonicClock: true
      });
      
      const snapshot1 = clockLimiter.createSnapshot();
      const snapshot2 = clockLimiter.createSnapshot();
      
      expect(snapshot2.timestamp).toBeGreaterThanOrEqual(snapshot1.timestamp);
    });

    it('should respect custom clock function', async () => {
      let time = 1000;
      const customClock = () => time;
      
      const clockLimiter = new LLMThrottle({
        rpm: 60,
        tpm: 1000,
        clock: customClock
      });
      
      await clockLimiter.consume('test-1', 100);
      
      const history = clockLimiter.getConsumptionHistory();
      expect(history[0].timestamp).toBe(1000);
      
      time = 2000;
      await clockLimiter.consume('test-2', 100);
      
      const updatedHistory = clockLimiter.getConsumptionHistory();
      expect(updatedHistory[1].timestamp).toBe(2000);
    });
  });
});