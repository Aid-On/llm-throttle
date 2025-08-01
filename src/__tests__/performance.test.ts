/**
 * Performance and long-running tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LLMThrottle } from '../index.js';

describe('LLMThrottle Performance', () => {
  it('should handle high-frequency operations efficiently', async () => {
    const limiter = new LLMThrottle({
      rpm: 10000,
      tpm: 100000,
      burstRPM: 20000,
      burstTPM: 200000,
      maxHistoryRecords: 1000
    });
    
    const startTime = Date.now();
    const operationsCount = 1000;
    
    // Perform many operations rapidly
    const promises = [];
    for (let i = 0; i < operationsCount; i++) {
      promises.push(limiter.consume(`perf-test-${i}`, 50));
    }
    
    const results = await Promise.all(promises);
    const endTime = Date.now();
    
    const duration = endTime - startTime;
    const opsPerSecond = (operationsCount / duration) * 1000;
    
    // Should handle at least 100 ops/second
    expect(opsPerSecond).toBeGreaterThan(100);
    expect(results.filter(r => r).length).toBe(operationsCount);
    
    console.log(`Performance: ${opsPerSecond.toFixed(0)} ops/sec`);
  });

  it('should maintain consistent performance over time', async () => {
    const limiter = new LLMThrottle({
      rpm: 1000,
      tpm: 10000,
      maxHistoryRecords: 500,
      historyRetentionMs: 5000
    });
    
    const durations: number[] = [];
    const batchSize = 100;
    const batches = 10;
    
    for (let batch = 0; batch < batches; batch++) {
      const batchStart = Date.now();
      
      const promises = [];
      for (let i = 0; i < batchSize; i++) {
        promises.push(limiter.consume(`batch-${batch}-${i}`, 10));
      }
      
      await Promise.all(promises);
      
      const batchDuration = Date.now() - batchStart;
      durations.push(batchDuration);
      
      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    // Performance should remain consistent (no significant degradation)
    const avgEarly = (durations[0] + durations[1]) / 2;
    const avgLate = (durations[durations.length - 2] + durations[durations.length - 1]) / 2;
    
    // Handle edge case where early processing is extremely fast (0ms)
    const threshold = Math.max(avgEarly * 1.5, 5); // At least 5ms threshold
    
    // Later batches shouldn't be significantly slower
    expect(avgLate).toBeLessThan(threshold);
    
    console.log(`Performance consistency: early=${avgEarly}ms, late=${avgLate}ms`);
  });

  it('should handle memory efficiently with large datasets', async () => {
    const limiter = new LLMThrottle({
      rpm: 5000,
      tpm: 50000,
      maxHistoryRecords: 1000,
      historyRetentionMs: 2000
    });
    
    // Generate a large number of requests
    const totalRequests = 5000;
    const batchSize = 100;
    
    for (let i = 0; i < totalRequests; i += batchSize) {
      const batch = Math.min(batchSize, totalRequests - i);
      const promises = [];
      
      for (let j = 0; j < batch; j++) {
        promises.push(limiter.consume(`mem-test-${i + j}`, 10));
      }
      
      await Promise.all(promises);
      
      // Check memory usage periodically
      if (i % 1000 === 0) {
        const metrics = limiter.getMetrics();
        expect(metrics.memory.historyRecords).toBeLessThanOrEqual(1000);
        expect(metrics.memory.estimatedMemoryUsage).toBeLessThan(1024 * 1024); // Less than 1MB
      }
    }
    
    const finalMetrics = limiter.getMetrics();
    expect(finalMetrics.memory.historyRecords).toBeLessThanOrEqual(1000);
    expect(limiter.validateState()).toBe(true);
  });

  it('should handle sustained load simulation', async () => {
    const limiter = new LLMThrottle({
      rpm: 100,
      tpm: 1000,
      burstRPM: 200,
      burstTPM: 2000,
      historyRetentionMs: 1000
    });
    
    const simulationDuration = 2000; // 2 seconds
    const requestInterval = 50; // Every 50ms
    const startTime = Date.now();
    
    let requestCount = 0;
    let successCount = 0;
    
    const simulate = async (): Promise<void> => {
      while (Date.now() - startTime < simulationDuration) {
        const success = await limiter.consume(`sustained-${requestCount++}`, 10);
        if (success) successCount++;
        
        await new Promise(resolve => setTimeout(resolve, requestInterval));
      }
    };
    
    await simulate();
    
    const metrics = limiter.getMetrics();
    
    // Should have processed requests within rate limits
    expect(successCount).toBeGreaterThan(0);
    expect(metrics.rpm.percentage).toBeLessThanOrEqual(100);
    expect(metrics.tpm.percentage).toBeLessThanOrEqual(100);
    expect(limiter.validateState()).toBe(true);
    
    console.log(`Sustained load: ${requestCount} requests, ${successCount} successful (${(successCount/requestCount*100).toFixed(1)}%)`);
  });

  it('should handle time-based stress test', async () => {
    // Simulate system time changes and high load
    let currentTime = Date.now();
    const customClock = () => currentTime;
    
    const limiter = new LLMThrottle({
      rpm: 60,
      tpm: 600,
      clock: customClock,
      historyRetentionMs: 5000
    });
    
    // Normal operations
    for (let i = 0; i < 30; i++) {
      await limiter.consume(`time-test-${i}`, 10);
      currentTime += 100; // Advance time by 100ms
    }
    
    // Simulate time jump (system clock adjustment)
    currentTime += 10000; // Jump forward 10 seconds
    
    // Should still work correctly after time jump
    const success = await limiter.consume('after-jump', 10);
    expect(success).toBe(true);
    
    // History should be cleaned up after time jump
    const metrics = limiter.getMetrics();
    expect(metrics.consumptionHistory.count).toBeLessThan(30);
    expect(limiter.validateState()).toBe(true);
  });

  it('should benchmark adjustment operations', async () => {
    const limiter = new LLMThrottle({
      rpm: 1000,
      tpm: 10000,
      adjustmentFailureStrategy: 'compensate'
    });
    
    // Pre-populate with consume operations
    const prePopulateCount = 500;
    for (let i = 0; i < prePopulateCount; i++) {
      await limiter.consume(`pre-${i}`, 10);
    }
    
    // Benchmark adjustment operations
    const adjustmentCount = 100;
    const startTime = Date.now();
    
    const adjustPromises = [];
    for (let i = 0; i < adjustmentCount; i++) {
      const requestId = `pre-${i % prePopulateCount}`;
      adjustPromises.push(limiter.adjustConsumption(requestId, 15));
    }
    
    await Promise.all(adjustPromises);
    
    const duration = Date.now() - startTime;
    const adjustmentsPerSecond = (adjustmentCount / duration) * 1000;
    
    // Should handle at least 50 adjustments per second
    expect(adjustmentsPerSecond).toBeGreaterThan(50);
    expect(limiter.validateState()).toBe(true);
    
    console.log(`Adjustment performance: ${adjustmentsPerSecond.toFixed(0)} adjustments/sec`);
  });
});