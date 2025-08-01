import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LLMThrottle } from '../index.js';
import { RateLimitError } from '../errors.js';

describe('LLMThrottle', () => {
  let mockClock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockClock = vi.fn(() => 1000);
  });

  describe('constructor', () => {
    it('should create limiter with valid config', () => {
      const limiter = new LLMThrottle({
        rpm: 60,
        tpm: 1000,
        clock: mockClock
      });

      expect(limiter).toBeInstanceOf(LLMThrottle);
    });

    it('should use burst limits when provided', () => {
      const limiter = new LLMThrottle({
        rpm: 60,
        tpm: 1000,
        burstRPM: 120,
        burstTPM: 2000,
        clock: mockClock
      });

      const metrics = limiter.getMetrics();
      expect(metrics.rpm.limit).toBe(120);
      expect(metrics.tpm.limit).toBe(2000);
    });

    it('should throw error for invalid config', () => {
      expect(() => new LLMThrottle({
        rpm: 0,
        tpm: 1000
      })).toThrow('Configuration validation failed');

      expect(() => new LLMThrottle({
        rpm: 60,
        tpm: 0
      })).toThrow('Configuration validation failed');
    });

    it('should throw error when burst limits are less than base limits', () => {
      expect(() => new LLMThrottle({
        rpm: 60,
        tpm: 1000,
        burstRPM: 30
      })).toThrow('Configuration validation failed');
    });
  });

  describe('canProcess', () => {
    let limiter: LLMThrottle;

    beforeEach(() => {
      limiter = new LLMThrottle({
        rpm: 60, // 1 per second
        tpm: 1000, // ~16.67 per second
        clock: mockClock
      });
    });

    it('should allow processing when within limits', () => {
      const result = limiter.canProcess(500);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should reject when exceeding token limit', () => {
      const result = limiter.canProcess(1500);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('tpm_limit');
      expect(result.availableIn).toBeGreaterThan(0);
    });

    it('should throw error for negative tokens', () => {
      expect(() => limiter.canProcess(-1)).toThrow('Estimated tokens cannot be negative');
    });
  });

  describe('consume', () => {
    let limiter: LLMThrottle;

    beforeEach(() => {
      limiter = new LLMThrottle({
        rpm: 60,
        tpm: 1000,
        clock: mockClock
      });
    });

    it('should consume tokens successfully', async () => {
      const result = await limiter.consume('request-1', 500);
      expect(result).toBe(true);

      const history = limiter.getConsumptionHistory();
      expect(history).toHaveLength(1);
      expect(history[0].requestId).toBe('request-1');
      expect(history[0].tokens).toBe(500);
    });

    it('should fail to consume when exceeding limits', async () => {
      const result = await limiter.consume('request-1', 1500);
      expect(result).toBe(false);

      const history = limiter.getConsumptionHistory();
      expect(history).toHaveLength(0);
    });

    it('should store metadata when provided', async () => {
      const metadata = { userId: '123', endpoint: '/chat' };
      await limiter.consume('request-1', 100, metadata);

      const history = limiter.getConsumptionHistory();
      expect(history[0].metadata).toEqual(metadata);
    });

    it('should throw error for empty request ID', () => {
      expect(() => limiter.consume('', 100)).toThrow('Request ID cannot be empty');
      expect(() => limiter.consume('   ', 100)).toThrow('Request ID cannot be empty');
    });
  });

  describe('consumeOrThrow', () => {
    let limiter: LLMThrottle;

    beforeEach(() => {
      limiter = new LLMThrottle({
        rpm: 60,
        tpm: 1000,
        clock: mockClock
      });
    });

    it('should consume successfully when within limits', () => {
      expect(() => limiter.consumeOrThrow('request-1', 500)).not.toThrow();
      
      const history = limiter.getConsumptionHistory();
      expect(history).toHaveLength(1);
    });

    it('should throw RateLimitError when exceeding limits', () => {
      expect(() => limiter.consumeOrThrow('request-1', 1500)).toThrow(RateLimitError);
      
      try {
        limiter.consumeOrThrow('request-1', 1500);
      } catch (error) {
        expect(error).toBeInstanceOf(RateLimitError);
        expect((error as RateLimitError).reason).toBe('tpm_limit');
        expect((error as RateLimitError).availableIn).toBeGreaterThan(0);
      }
    });
  });

  describe('adjustConsumption', () => {
    let limiter: LLMThrottle;

    beforeEach(() => {
      limiter = new LLMThrottle({
        rpm: 60,
        tpm: 1000,
        clock: mockClock
      });
    });

    it('should adjust consumption upward', async () => {
      await limiter.consume('request-1', 500);
      
      const beforeMetrics = limiter.getMetrics();
      const tpmUsedBefore = beforeMetrics.tpm.used;
      
      await limiter.adjustConsumption('request-1', 700);
      
      const afterMetrics = limiter.getMetrics();
      const tpmUsedAfter = afterMetrics.tpm.used;
      
      expect(tpmUsedAfter).toBeGreaterThan(tpmUsedBefore);
      
      const history = limiter.getConsumptionHistory();
      expect(history[0].tokens).toBe(700);
    });

    it('should adjust consumption downward (refund)', async () => {
      await limiter.consume('request-1', 500);
      
      const beforeMetrics = limiter.getMetrics();
      const tpmUsedBefore = beforeMetrics.tpm.used;
      
      await limiter.adjustConsumption('request-1', 300);
      
      const afterMetrics = limiter.getMetrics();
      const tpmUsedAfter = afterMetrics.tpm.used;
      
      expect(tpmUsedAfter).toBeLessThan(tpmUsedBefore);
      
      const history = limiter.getConsumptionHistory();
      expect(history[0].tokens).toBe(300);
    });

    it('should throw error for non-existent request ID', () => {
      expect(() => limiter.adjustConsumption('non-existent', 100))
        .toThrow("Request ID 'non-existent' not found in consumption history");
    });

    it('should throw error for negative actual tokens', async () => {
      await limiter.consume('request-1', 500);
      expect(() => limiter.adjustConsumption('request-1', -100))
        .toThrow('Actual tokens cannot be negative');
    });
  });

  describe('getMetrics', () => {
    let limiter: LLMThrottle;

    beforeEach(() => {
      limiter = new LLMThrottle({
        rpm: 60,
        tpm: 1000,
        clock: mockClock
      });
    });

    it('should return correct metrics', async () => {
      await limiter.consume('request-1', 400);
      await limiter.consume('request-2', 300);
      
      const metrics = limiter.getMetrics();
      
      expect(metrics.rpm.limit).toBe(60);
      expect(metrics.tpm.limit).toBe(1000);
      expect(metrics.rpm.used).toBe(2); // 2 requests
      expect(metrics.tpm.used).toBe(700); // 400 + 300 tokens
      expect(metrics.consumptionHistory.count).toBe(2);
      expect(metrics.consumptionHistory.totalTokens).toBe(700);
      expect(metrics.consumptionHistory.averageTokensPerRequest).toBe(350);
    });

    it('should return zero metrics when no consumption', () => {
      const metrics = limiter.getMetrics();
      
      expect(metrics.consumptionHistory.count).toBe(0);
      expect(metrics.consumptionHistory.totalTokens).toBe(0);
      expect(metrics.consumptionHistory.averageTokensPerRequest).toBe(0);
    });
  });

  describe('reset', () => {
    let limiter: LLMThrottle;

    beforeEach(() => {
      limiter = new LLMThrottle({
        rpm: 60,
        tpm: 1000,
        clock: mockClock
      });
    });

    it('should reset all buckets and history', async () => {
      await limiter.consume('request-1', 500);
      await limiter.consume('request-2', 300);
      
      expect(limiter.getConsumptionHistory()).toHaveLength(2);
      
      await limiter.reset();
      
      expect(limiter.getConsumptionHistory()).toHaveLength(0);
      
      const metrics = limiter.getMetrics();
      expect(metrics.rpm.used).toBe(0);
      expect(metrics.tpm.used).toBe(0);
    });
  });

  describe('history management', () => {
    let limiter: LLMThrottle;

    beforeEach(() => {
      limiter = new LLMThrottle({
        rpm: 60,
        tpm: 1000,
        clock: mockClock
      });
    });

    it('should clean up old history entries', async () => {
      await limiter.consume('request-1', 100);
      
      // Advance time by 2 minutes (beyond default 1-minute retention)
      mockClock.mockReturnValue(1000 + 120000);
      
      await limiter.consume('request-2', 200);
      
      const history = limiter.getConsumptionHistory();
      expect(history).toHaveLength(1);
      expect(history[0].requestId).toBe('request-2');
    });

    it('should allow setting custom history retention', async () => {
      limiter.setHistoryRetention(30000); // 30 seconds
      
      await limiter.consume('request-1', 100);
      
      // Advance time by 45 seconds
      mockClock.mockReturnValue(1000 + 45000);
      
      await limiter.consume('request-2', 200);
      
      const history = limiter.getConsumptionHistory();
      expect(history).toHaveLength(1);
      expect(history[0].requestId).toBe('request-2');
    });

    it('should throw error for invalid retention time', () => {
      expect(() => limiter.setHistoryRetention(0))
        .toThrow('History retention must be positive');
    });
  });
});