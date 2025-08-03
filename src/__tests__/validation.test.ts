/**
 * Configuration validation tests
 */

import { describe, it, expect, vi } from 'vitest';
import { LLMThrottle } from '../index.js';
import { validateConfig, validateAndNormalizeConfig } from '../utils/validation.js';
import type { DualRateLimitConfig, ValidationRule, Logger } from '../types/index.js';

describe('Configuration Validation', () => {
  let mockLogger: Logger;
  
  beforeEach(() => {
    mockLogger = {
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn()
    };
  });

  describe('Basic Validation', () => {
    it('should validate correct configuration', () => {
      const config: DualRateLimitConfig = {
        rpm: 60,
        tpm: 1000
      };
      
      const result = validateConfig(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should reject invalid RPM', () => {
      const config: DualRateLimitConfig = {
        rpm: 0,
        tpm: 1000
      };
      
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('RPM must be greater than 0');
    });

    it('should reject invalid TPM', () => {
      const config: DualRateLimitConfig = {
        rpm: 60,
        tpm: -100
      };
      
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('TPM must be greater than 0');
    });

    it('should reject invalid burst settings', () => {
      const config: DualRateLimitConfig = {
        rpm: 60,
        tpm: 1000,
        burstRPM: 30, // Less than RPM
        burstTPM: 500 // Less than TPM
      };
      
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Burst RPM cannot be less than RPM');
      expect(result.errors).toContain('Burst TPM cannot be less than TPM');
    });
  });

  describe('Warning Conditions', () => {
    it('should warn about high RPM values', () => {
      const config: DualRateLimitConfig = {
        rpm: 15000,
        tpm: 1000000
      };
      
      const result = validateConfig(config, [], mockLogger);
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('RPM above 10,000 may impact performance and API stability');
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should warn about excessive burst limits', () => {
      const config: DualRateLimitConfig = {
        rpm: 60,
        tpm: 1000,
        burstRPM: 1000, // 16.7x the base RPM
        burstTPM: 50000 // 50x the base TPM
      };
      
      const result = validateConfig(config);
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('Burst RPM should not exceed 10x the base RPM for optimal performance');
      expect(result.warnings).toContain('Burst TPM should not exceed 10x the base TPM for optimal performance');
    });

    it('should warn about high TPM values', () => {
      const config: DualRateLimitConfig = {
        rpm: 60,
        tpm: 2000000
      };
      
      const result = validateConfig(config, [], mockLogger);
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('TPM above 1,000,000 may impact performance and memory usage');
    });
  });

  describe('Custom Validation Rules', () => {
    it('should apply custom validation rules', () => {
      const customRule: ValidationRule<DualRateLimitConfig> = {
        name: 'custom_rpm_limit',
        validate: (config) => config.rpm <= 100 || 'RPM should not exceed 100 for this use case',
        level: 'error'
      };
      
      const config: DualRateLimitConfig = {
        rpm: 200,
        tpm: 1000
      };
      
      const result = validateConfig(config, [customRule]);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('RPM should not exceed 100 for this use case');
    });

    it('should handle custom warning rules', () => {
      const customRule: ValidationRule<DualRateLimitConfig> = {
        name: 'custom_tpm_warning',
        validate: (config) => config.tpm <= 5000 || 'Consider reducing TPM for better resource usage',
        level: 'warn'
      };
      
      const config: DualRateLimitConfig = {
        rpm: 60,
        tpm: 10000
      };
      
      const result = validateConfig(config, [customRule], mockLogger);
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('Consider reducing TPM for better resource usage');
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should handle validation rule errors gracefully', () => {
      const faultyRule: ValidationRule<DualRateLimitConfig> = {
        name: 'faulty_rule',
        validate: () => { throw new Error('Rule implementation error'); },
        level: 'error'
      };
      
      const config: DualRateLimitConfig = {
        rpm: 60,
        tpm: 1000
      };
      
      const result = validateConfig(config, [faultyRule]);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Validation rule \'faulty_rule\' threw an error');
    });
  });

  describe('Normalization', () => {
    it('should normalize configuration with defaults', () => {
      const config: DualRateLimitConfig = {
        rpm: 60,
        tpm: 1000
      };
      
      const normalized = validateAndNormalizeConfig(config);
      expect(normalized.adjustmentFailureStrategy).toBe('warn');
      expect(normalized.maxHistoryRecords).toBe(10000);
      expect(normalized.historyRetentionMs).toBe(60000);
      expect(normalized.efficiencyWindowSize).toBe(50);
      expect(normalized.logger).toBeDefined();
    });

    it('should preserve existing values during normalization', () => {
      const config: DualRateLimitConfig = {
        rpm: 60,
        tpm: 1000,
        adjustmentFailureStrategy: 'strict',
        maxHistoryRecords: 5000,
        historyRetentionMs: 30000,
        efficiencyWindowSize: 100
      };
      
      const normalized = validateAndNormalizeConfig(config);
      expect(normalized.adjustmentFailureStrategy).toBe('strict');
      expect(normalized.maxHistoryRecords).toBe(5000);
      expect(normalized.historyRetentionMs).toBe(30000);
      expect(normalized.efficiencyWindowSize).toBe(100);
    });

    it('should throw on invalid configuration during normalization', () => {
      const config = {
        rpm: -10,
        tpm: 1000
      } as DualRateLimitConfig;
      
      expect(() => validateAndNormalizeConfig(config)).toThrow('Configuration validation failed');
    });
  });

  describe('Edge Cases', () => {
    it('should validate optional parameters', () => {
      const config: DualRateLimitConfig = {
        rpm: 60,
        tpm: 1000,
        historyRetentionMs: -1000,
        maxHistoryRecords: 0,
        efficiencyWindowSize: -10
      };
      
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('History retention must be positive');
      expect(result.errors).toContain('Max history records must be positive');
      expect(result.errors).toContain('Efficiency window size must be positive');
    });

    it('should handle null/undefined configuration', () => {
      expect(() => validateAndNormalizeConfig(null as never)).toThrow('Config must be an object');
      expect(() => validateAndNormalizeConfig(undefined as never)).toThrow('Config must be an object');
      expect(() => validateAndNormalizeConfig('invalid' as never)).toThrow('Config must be an object');
    });
  });

  describe('Integration with LLMThrottle', () => {
    it('should reject invalid configuration in constructor', () => {
      expect(() => new LLMThrottle({
        rpm: 0,
        tpm: 1000
      })).toThrow('Configuration validation failed');
    });

    it('should accept valid configuration with warnings', () => {
      const limiter = new LLMThrottle({
        rpm: 15000, // Will generate warning
        tpm: 1000,
        logger: mockLogger
      });
      
      expect(limiter).toBeDefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Config validation warning')
      );
    });

    it('should work with custom validation rules', () => {
      const customRule: ValidationRule<DualRateLimitConfig> = {
        name: 'test_environment',
        validate: (config) => config.rpm <= 1000 || 'Test environment should use lower RPM',
        level: 'warn'
      };
      
      const limiter = new LLMThrottle({
        rpm: 2000,
        tpm: 10000,
        validationRules: [customRule],
        logger: mockLogger
      });
      
      expect(limiter).toBeDefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Test environment should use lower RPM')
      );
    });
  });
});