import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TokenBucket } from '../token-bucket.js';
import { InvalidConfigError } from '../errors.js';

describe('TokenBucket', () => {
  let mockClock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockClock = vi.fn(() => 1000);
  });

  describe('constructor', () => {
    it('should create token bucket with valid config', () => {
      const bucket = new TokenBucket({
        capacity: 100,
        refillRate: 10,
        clock: mockClock
      });

      expect(bucket.capacity).toBe(100);
      expect(bucket.available).toBe(100);
      expect(bucket.refillRate).toBe(10);
    });

    it('should use initialTokens when provided', () => {
      const bucket = new TokenBucket({
        capacity: 100,
        refillRate: 10,
        initialTokens: 50,
        clock: mockClock
      });

      expect(bucket.available).toBe(50);
    });

    it('should throw error for invalid capacity', () => {
      expect(() => new TokenBucket({
        capacity: 0,
        refillRate: 10
      })).toThrow(InvalidConfigError);
    });

    it('should throw error for invalid refill rate', () => {
      expect(() => new TokenBucket({
        capacity: 100,
        refillRate: 0
      })).toThrow(InvalidConfigError);
    });

    it('should throw error for negative initial tokens', () => {
      expect(() => new TokenBucket({
        capacity: 100,
        refillRate: 10,
        initialTokens: -1
      })).toThrow(InvalidConfigError);
    });

    it('should throw error when initial tokens exceed capacity', () => {
      expect(() => new TokenBucket({
        capacity: 100,
        refillRate: 10,
        initialTokens: 150
      })).toThrow(InvalidConfigError);
    });
  });

  describe('token consumption', () => {
    let bucket: TokenBucket;

    beforeEach(() => {
      bucket = new TokenBucket({
        capacity: 100,
        refillRate: 10,
        initialTokens: 50,
        clock: mockClock
      });
    });

    it('should consume tokens when available', () => {
      expect(bucket.consume(30)).toBe(true);
      expect(bucket.available).toBe(20);
    });

    it('should not consume tokens when insufficient', () => {
      expect(bucket.consume(60)).toBe(false);
      expect(bucket.available).toBe(50);
    });

    it('should check token availability', () => {
      expect(bucket.hasTokens(30)).toBe(true);
      expect(bucket.hasTokens(60)).toBe(false);
    });

    it('should throw error for negative consumption', () => {
      expect(() => bucket.consume(-1)).toThrow('Cannot consume negative tokens');
    });
  });

  describe('token refill', () => {
    let bucket: TokenBucket;

    beforeEach(() => {
      bucket = new TokenBucket({
        capacity: 100,
        refillRate: 10, // 10 tokens per second
        initialTokens: 50,
        clock: mockClock
      });
    });

    it('should refill tokens over time', () => {
      // Advance time by 2 seconds
      mockClock.mockReturnValue(3000);
      
      // Should add 20 tokens (2 seconds * 10 tokens/second)
      expect(bucket.available).toBe(70);
    });

    it('should not exceed capacity when refilling', () => {
      // Advance time by 10 seconds (would add 100 tokens)
      mockClock.mockReturnValue(11000);
      
      // Should cap at capacity
      expect(bucket.available).toBe(100);
    });

    it('should not refill when time has not advanced', () => {
      bucket.consume(10);
      expect(bucket.available).toBe(40);
      
      // Same time, no refill
      expect(bucket.available).toBe(40);
    });
  });

  describe('token refund', () => {
    let bucket: TokenBucket;

    beforeEach(() => {
      bucket = new TokenBucket({
        capacity: 100,
        refillRate: 10,
        initialTokens: 50,
        clock: mockClock
      });
    });

    it('should refund tokens', () => {
      bucket.consume(20);
      expect(bucket.available).toBe(30);
      
      bucket.refund(10);
      expect(bucket.available).toBe(40);
    });

    it('should not exceed capacity when refunding', () => {
      bucket.refund(60);
      expect(bucket.available).toBe(100);
    });

    it('should throw error for negative refund', () => {
      expect(() => bucket.refund(-1)).toThrow('Cannot refund negative tokens');
    });
  });

  describe('timing calculations', () => {
    let bucket: TokenBucket;

    beforeEach(() => {
      bucket = new TokenBucket({
        capacity: 100,
        refillRate: 10, // 10 tokens per second
        initialTokens: 0,
        clock: mockClock
      });
    });

    it('should calculate time until next token', () => {
      const timeUntil = bucket.timeUntilNextToken();
      expect(timeUntil).toBe(100); // 100ms for 1 token at 10 tokens/second
    });

    it('should calculate time until specific token count', () => {
      const timeUntil = bucket.timeUntilTokens(5);
      expect(timeUntil).toBe(500); // 500ms for 5 tokens at 10 tokens/second
    });

    it('should return 0 when tokens are already available', () => {
      bucket.refund(10);
      expect(bucket.timeUntilNextToken()).toBe(0);
      expect(bucket.timeUntilTokens(5)).toBe(0);
    });
  });

  describe('reset', () => {
    let bucket: TokenBucket;

    beforeEach(() => {
      bucket = new TokenBucket({
        capacity: 100,
        refillRate: 10,
        initialTokens: 50,
        clock: mockClock
      });
    });

    it('should reset bucket to full capacity', () => {
      bucket.consume(30);
      expect(bucket.available).toBe(20);
      
      bucket.reset();
      expect(bucket.available).toBe(100);
    });
  });
});