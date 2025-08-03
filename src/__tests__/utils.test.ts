/**
 * Utility modules tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AsyncLock } from '../utils/async-lock.js';
import { createOptimalClock, createMonotonicClock, createStandardClock, getClockInfo } from '../utils/clock.js';
import { isFuzztokAvailable, robustEstimateTokens, simpleFallbackEstimate } from '../utils/fuzztok-integration.js';

describe('AsyncLock', () => {
  let lock: AsyncLock;
  
  beforeEach(() => {
    lock = new AsyncLock();
  });

  it('should acquire and release lock correctly', async () => {
    expect(lock.isLocked()).toBe(false);
    
    await lock.acquire();
    expect(lock.isLocked()).toBe(true);
    
    lock.release();
    expect(lock.isLocked()).toBe(false);
  });

  it('should queue multiple acquisitions', async () => {
    let acquired1 = false;
    let acquired2 = false;
    
    // First acquisition should succeed immediately
    const promise1 = lock.acquire().then(() => { acquired1 = true; });
    await promise1;
    expect(acquired1).toBe(true);
    expect(lock.getQueueLength()).toBe(0);
    
    // Second acquisition should be queued
    const promise2 = lock.acquire().then(() => { acquired2 = true; });
    expect(lock.getQueueLength()).toBe(1);
    expect(acquired2).toBe(false);
    
    // Release should allow second acquisition
    lock.release();
    await promise2;
    expect(acquired2).toBe(true);
    expect(lock.getQueueLength()).toBe(0);
  });

  it('should execute function with lock', async () => {
    let executionCount = 0;
    
    const promises = [
      lock.withLock(async () => {
        executionCount++;
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'result1';
      }),
      lock.withLock(async () => {
        executionCount++;
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'result2';
      })
    ];
    
    const results = await Promise.all(promises);
    expect(results).toEqual(['result1', 'result2']);
    expect(executionCount).toBe(2);
    expect(lock.isLocked()).toBe(false);
  });

  it('should handle errors in withLock', async () => {
    await expect(
      lock.withLock(async () => {
        throw new Error('Test error');
      })
    ).rejects.toThrow('Test error');
    
    expect(lock.isLocked()).toBe(false);
  });

  it('should clear all pending operations', async () => {
    await lock.acquire();
    
    const promises = [
      lock.acquire().catch(err => err.message),
      lock.acquire().catch(err => err.message),
      lock.acquire().catch(err => err.message)
    ];
    
    expect(lock.getQueueLength()).toBe(3);
    
    lock.clear();
    
    const results = await Promise.all(promises);
    expect(results.every(result => result === 'AsyncLock cleared')).toBe(true);
    expect(lock.isLocked()).toBe(false);
    expect(lock.getQueueLength()).toBe(0);
  });

  it('should throw when releasing unlocked lock', () => {
    expect(() => lock.release()).toThrow('Cannot release a lock that is not acquired');
  });
});

describe('Clock Utilities', () => {
  it('should create different types of clocks', () => {
    const standardClock = createStandardClock();
    const optimalClock = createOptimalClock();
    const monotonicClock = createMonotonicClock();
    
    expect(typeof standardClock).toBe('function');
    expect(typeof optimalClock).toBe('function');
    expect(typeof monotonicClock).toBe('function');
    
    const time1 = standardClock();
    const time2 = optimalClock();
    const time3 = monotonicClock();
    
    expect(typeof time1).toBe('number');
    expect(typeof time2).toBe('number');
    expect(typeof time3).toBe('number');
  });

  it('should provide consistent timing', async () => {
    const clock = createOptimalClock();
    
    const start = clock();
    await new Promise(resolve => setTimeout(resolve, 10));
    const end = clock();
    
    expect(end).toBeGreaterThan(start);
    expect(end - start).toBeGreaterThan(5); // At least 5ms
  });

  it('should provide clock information', () => {
    const info = getClockInfo();
    
    expect(info).toHaveProperty('hasNodeHrtime');
    expect(info).toHaveProperty('hasPerformanceNow');
    expect(info).toHaveProperty('recommendedClock');
    expect(['monotonic', 'standard']).toContain(info.recommendedClock);
  });

  it('should create optimal clock based on preference', () => {
    const monotonicPreferred = createOptimalClock(true);
    const standardPreferred = createOptimalClock(false);
    
    expect(typeof monotonicPreferred).toBe('function');
    expect(typeof standardPreferred).toBe('function');
    
    // Both should work regardless of preference
    expect(typeof monotonicPreferred()).toBe('number');
    expect(typeof standardPreferred()).toBe('number');
  });
});

describe('Fuzztok Integration', () => {
  it('should provide fallback estimation', () => {
    const text = 'Hello world, this is a test message';
    const estimate = simpleFallbackEstimate(text);
    
    expect(estimate).toBeGreaterThan(0);
    expect(typeof estimate).toBe('number');
  });

  it('should handle empty text', () => {
    expect(simpleFallbackEstimate('')).toBe(0);
    expect(simpleFallbackEstimate(null as never)).toBe(0);
    expect(simpleFallbackEstimate(undefined as never)).toBe(0);
  });

  it('should provide reasonable estimates for different text types', () => {
    const shortText = 'Hi';
    const mediumText = 'This is a medium length sentence with some words.';
    const longText = 'This is a much longer text that contains multiple sentences and should result in a higher token estimate. It has various words and punctuation marks that should be taken into account during the estimation process.';
    
    const shortEstimate = simpleFallbackEstimate(shortText);
    const mediumEstimate = simpleFallbackEstimate(mediumText);
    const longEstimate = simpleFallbackEstimate(longText);
    
    expect(shortEstimate).toBeLessThan(mediumEstimate);
    expect(mediumEstimate).toBeLessThan(longEstimate);
    
    // Reasonable bounds
    expect(shortEstimate).toBeGreaterThanOrEqual(1);
    expect(longEstimate).toBeLessThan(200);
  });

  it('should check fuzztok availability', async () => {
    const available = await isFuzztokAvailable();
    expect(typeof available).toBe('boolean');
  });

  it('should provide robust estimation with fallback', async () => {
    const text = 'Test message for token estimation';
    const estimate = await robustEstimateTokens(text);
    
    expect(estimate).toBeGreaterThan(0);
    expect(typeof estimate).toBe('number');
  });

  it('should handle estimation errors gracefully', async () => {
    // Test with various edge cases
    const estimates = await Promise.all([
      robustEstimateTokens(''),
      robustEstimateTokens('Single'),
      robustEstimateTokens('Multiple words here'),
      robustEstimateTokens('Special characters: !@#$%^&*()'),
      robustEstimateTokens('Numbers: 123 456 789'),
      robustEstimateTokens('Mixed: Hello123 World!@# Test456')
    ]);
    
    expect(estimates[0]).toBe(0); // Empty string
    expect(estimates.slice(1).every(e => e > 0)).toBe(true); // All others > 0
    expect(estimates.every(e => typeof e === 'number')).toBe(true); // All numbers
  });

  // Note: Actual fuzztok integration tests would require the module to be installed
  // These tests focus on fallback behavior and integration patterns
});

describe('Utility Integration', () => {
  it('should work together in realistic scenarios', async () => {
    const lock = new AsyncLock();
    const clock = createOptimalClock();
    
    let operations = 0;
    const startTime = clock();
    
    const promises = Array.from({ length: 10 }, (_, i) =>
      lock.withLock(async () => {
        operations++;
        const text = `Operation ${i} with some text content`;
        const estimate = await robustEstimateTokens(text);
        
        expect(estimate).toBeGreaterThan(0);
        
        await new Promise(resolve => setTimeout(resolve, 1));
        return { operation: i, estimate, timestamp: clock() };
      })
    );
    
    const results = await Promise.all(promises);
    const endTime = clock();
    
    expect(results).toHaveLength(10);
    expect(operations).toBe(10);
    expect(endTime - startTime).toBeGreaterThan(0);
    
    // Results should be in order due to lock serialization
    results.forEach((result, index) => {
      expect(result.operation).toBe(index);
      expect(result.estimate).toBeGreaterThan(0);
      expect(result.timestamp).toBeGreaterThanOrEqual(startTime);
    });
  });
});