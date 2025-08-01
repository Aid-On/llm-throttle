/**
 * Concurrency and race condition tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LLMThrottle } from '../index.js';

describe('LLMThrottle Concurrency', () => {
  let limiter: LLMThrottle;
  
  beforeEach(() => {
    limiter = new LLMThrottle({
      rpm: 60,
      tpm: 1000,
      burstRPM: 120,
      burstTPM: 2000
    });
  });

  it('should handle concurrent consume calls correctly', async () => {
    const promises = [];
    const results: boolean[] = [];
    
    // Create 10 concurrent requests using async version
    for (let i = 0; i < 10; i++) {
      promises.push(
        limiter.consumeAsync(`request-${i}`, 50).then(result => {
          results.push(result);
        })
      );
    }
    
    await Promise.all(promises);
    
    // All should succeed within burst limits
    expect(results.filter(r => r).length).toBe(10);
    
    const metrics = limiter.getMetrics();
    expect(metrics.rpm.used).toBeCloseTo(10, 0);
    expect(metrics.tpm.used).toBeCloseTo(500, 0);
  });

  it('should handle concurrent adjustConsumption calls safely', async () => {
    // First consume some requests using async version
    const consumePromises = [];
    for (let i = 0; i < 5; i++) {
      consumePromises.push(limiter.consumeAsync(`request-${i}`, 100));
    }
    await Promise.all(consumePromises);
    
    // Then adjust them concurrently using async version
    const adjustPromises = [];
    for (let i = 0; i < 5; i++) {
      adjustPromises.push(limiter.adjustConsumptionAsync(`request-${i}`, 150));
    }
    
    await Promise.all(adjustPromises);
    
    const metrics = limiter.getMetrics();
    expect(metrics.tpm.used).toBeCloseTo(750, 0); // 5 * 150
  });

  it('should handle mixed concurrent operations', async () => {
    const operations: Promise<any>[] = [];
    
    // Mix consume and adjust operations
    for (let i = 0; i < 20; i++) {
      if (i < 10) {
        operations.push(limiter.consumeAsync(`request-${i}`, 50));
      } else {
        operations.push(limiter.adjustConsumptionAsync(`request-${i - 10}`, 75));
      }
    }
    
    const results = await Promise.all(operations);
    
    // First 10 should be consume results (boolean)
    const consumeResults = results.slice(0, 10) as boolean[];
    expect(consumeResults.filter(r => r).length).toBe(10);
    
    // Last 10 should be adjust results (void)
    const adjustResults = results.slice(10);
    expect(adjustResults.every(r => r === undefined)).toBe(true);
  });

  it('should maintain consistency under high concurrency', async () => {
    const operations: Promise<any>[] = [];
    let consumeCount = 0;
    
    // Create 100 concurrent operations
    for (let i = 0; i < 100; i++) {
      if (i % 3 === 0) {
        operations.push(
          limiter.consumeAsync(`request-${consumeCount++}`, 10).then(success => ({ type: 'consume', success }))
        );
      } else if (i % 3 === 1 && consumeCount > 0) {
        const requestId = `request-${Math.floor(Math.random() * consumeCount)}`;
        operations.push(
          limiter.adjustConsumptionAsync(requestId, 15).then(() => ({ type: 'adjust' })).catch(() => ({ type: 'adjust', error: true }))
        );
      } else {
        operations.push(
          Promise.resolve(limiter.getMetrics()).then(metrics => ({ type: 'metrics', metrics }))
        );
      }
    }
    
    const results = await Promise.all(operations);
    
    // Verify no exceptions were thrown and state is consistent
    expect(results.length).toBe(100);
    expect(limiter.validateState()).toBe(true);
    
    const finalMetrics = limiter.getMetrics();
    expect(finalMetrics.rpm.used).toBeGreaterThanOrEqual(0);
    expect(finalMetrics.tpm.used).toBeGreaterThanOrEqual(0);
  });

  it('should handle burst consumption correctly under concurrency', async () => {
    // Consume up to burst limit concurrently using async version
    const promises = [];
    for (let i = 0; i < 120; i++) { // At burst RPM limit
      promises.push(limiter.consumeAsync(`burst-${i}`, 16)); // 120 * 16 = 1920 < 2000 burst TPM
    }
    
    const results = await Promise.all(promises);
    const successCount = results.filter(r => r).length;
    
    // All should succeed within burst limits
    expect(successCount).toBe(120);
    
    const metrics = limiter.getMetrics();
    expect(metrics.rpm.used).toBeCloseTo(120, 0);
    expect(metrics.tpm.used).toBeCloseTo(1920, 0);
  });

  it('should handle compensation strategy under concurrency', async () => {
    const compensatingLimiter = new LLMThrottle({
      rpm: 10,
      tpm: 100,
      adjustmentFailureStrategy: 'compensate'
    });
    
    // Consume all available tokens using async version
    await compensatingLimiter.consumeAsync('request-1', 100);
    
    // Try to adjust beyond available tokens concurrently using async version
    const adjustPromises = [];
    for (let i = 0; i < 5; i++) {
      adjustPromises.push(
        compensatingLimiter.adjustConsumptionAsync('request-1', 120 + i * 10)
          .catch(() => ({ error: true }))
      );
    }
    
    await Promise.all(adjustPromises);
    
    const metrics = compensatingLimiter.getMetrics();
    expect(metrics.compensation.totalDebt).toBeGreaterThan(0);
  });
});

describe('LLMThrottle Stress Tests', () => {
  it('should handle sustained high load', async () => {
    const limiter = new LLMThrottle({
      rpm: 1000,
      tpm: 10000,
      burstRPM: 2000,
      burstTPM: 20000,
      maxHistoryRecords: 5000
    });
    
    const batchSize = 50;
    const batches = 20;
    
    for (let batch = 0; batch < batches; batch++) {
      const promises = [];
      for (let i = 0; i < batchSize; i++) {
        const requestId = `batch-${batch}-request-${i}`;
        promises.push(limiter.consume(requestId, 10));
      }
      
      await Promise.all(promises);
      
      // Periodically check state consistency
      if (batch % 5 === 0) {
        expect(limiter.validateState()).toBe(true);
      }
    }
    
    const metrics = limiter.getMetrics();
    expect(metrics.consumptionHistory.count).toBeLessThanOrEqual(5000);
    expect(limiter.validateState()).toBe(true);
  });

  it('should maintain performance under memory pressure', async () => {
    const limiter = new LLMThrottle({
      rpm: 100,
      tpm: 1000,
      maxHistoryRecords: 100,
      historyRetentionMs: 1000
    });
    
    // Generate many requests to trigger memory management
    for (let i = 0; i < 500; i++) {
      await limiter.consume(`memory-test-${i}`, 5);
      
      if (i % 100 === 0) {
        const metrics = limiter.getMetrics();
        expect(metrics.memory.historyRecords).toBeLessThanOrEqual(100);
      }
    }
    
    const finalMetrics = limiter.getMetrics();
    expect(finalMetrics.memory.historyRecords).toBeLessThanOrEqual(100);
    expect(limiter.validateState()).toBe(true);
  });
});