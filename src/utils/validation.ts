/**
 * Configuration validation utilities
 */

import { DualRateLimitConfig, ValidationRule, Logger } from '../types/index.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Default validation rules for DualRateLimitConfig
 */
export const defaultValidationRules: ValidationRule<DualRateLimitConfig>[] = [
  {
    name: 'rpm_positive',
    validate: (config) => config.rpm > 0 || 'RPM must be greater than 0',
    level: 'error'
  },
  {
    name: 'tpm_positive', 
    validate: (config) => config.tpm > 0 || 'TPM must be greater than 0',
    level: 'error'
  },
  {
    name: 'burst_rpm_valid',
    validate: (config) => {
      if (config.burstRPM !== undefined && config.burstRPM < config.rpm) {
        return 'Burst RPM cannot be less than RPM';
      }
      return true;
    },
    level: 'error'
  },
  {
    name: 'burst_tpm_valid',
    validate: (config) => {
      if (config.burstTPM !== undefined && config.burstTPM < config.tpm) {
        return 'Burst TPM cannot be less than TPM';
      }
      return true;
    },
    level: 'error'
  },
  {
    name: 'burst_rpm_limit',
    validate: (config) => {
      if (config.burstRPM !== undefined && config.burstRPM > config.rpm * 10) {
        return 'Burst RPM should not exceed 10x the base RPM for optimal performance';
      }
      return true;
    },
    level: 'warn'
  },
  {
    name: 'burst_tpm_limit',
    validate: (config) => {
      if (config.burstTPM !== undefined && config.burstTPM > config.tpm * 10) {
        return 'Burst TPM should not exceed 10x the base TPM for optimal performance';
      }
      return true;
    },
    level: 'warn'
  },
  {
    name: 'rpm_high_warning',
    validate: (config) => {
      if (config.rpm > 10000) {
        return 'RPM above 10,000 may impact performance and API stability';
      }
      return true;
    },
    level: 'warn'
  },
  {
    name: 'tpm_high_warning', 
    validate: (config) => {
      if (config.tpm > 1000000) {
        return 'TPM above 1,000,000 may impact performance and memory usage';
      }
      return true;
    },
    level: 'warn'
  },
  {
    name: 'history_retention_valid',
    validate: (config) => {
      if (config.historyRetentionMs !== undefined && config.historyRetentionMs <= 0) {
        return 'History retention must be positive';
      }
      return true;
    },
    level: 'error'
  },
  {
    name: 'max_history_valid',
    validate: (config) => {
      if (config.maxHistoryRecords !== undefined && config.maxHistoryRecords <= 0) {
        return 'Max history records must be positive';
      }
      return true;
    },
    level: 'error'
  },
  {
    name: 'efficiency_window_valid',
    validate: (config) => {
      if (config.efficiencyWindowSize !== undefined && config.efficiencyWindowSize <= 0) {
        return 'Efficiency window size must be positive';
      }
      return true;
    },
    level: 'error'
  }
];

/**
 * Validates configuration against rules
 */
export function validateConfig(
  config: DualRateLimitConfig,
  customRules: ValidationRule<DualRateLimitConfig>[] = [],
  logger?: Logger
): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: []
  };

  // Combine default and custom rules
  const allRules = [...defaultValidationRules, ...customRules];

  for (const rule of allRules) {
    try {
      const validationResult = rule.validate(config);
      
      if (validationResult !== true) {
        const message = typeof validationResult === 'string' 
          ? validationResult 
          : `Validation failed for rule: ${rule.name}`;
        
        if (rule.level === 'error') {
          result.errors.push(message);
          result.valid = false;
        } else {
          result.warnings.push(message);
        }
      }
    } catch (error) {
      const message = `Validation rule '${rule.name}' threw an error: ${error instanceof Error ? error.message : String(error)}`;
      result.errors.push(message);
      result.valid = false;
    }
  }

  // Log warnings if logger is provided
  if (logger && result.warnings.length > 0) {
    result.warnings.forEach(warning => logger.warn(`Config validation warning: ${warning}`));
  }

  return result;
}

/**
 * Validates and normalizes configuration, throwing on errors
 */
export function validateAndNormalizeConfig(
  config: DualRateLimitConfig,
  customRules: ValidationRule<DualRateLimitConfig>[] = [],
  logger?: Logger
): DualRateLimitConfig {
  // Basic type check
  if (!config || typeof config !== 'object') {
    throw new Error('Config must be an object');
  }

  const result = validateConfig(config, customRules, logger);
  
  if (!result.valid) {
    throw new Error(`Configuration validation failed: ${result.errors.join(', ')}`);
  }

  // Return normalized config with defaults
  return {
    ...config,
    adjustmentFailureStrategy: config.adjustmentFailureStrategy || 'warn',
    maxHistoryRecords: config.maxHistoryRecords || 10000,
    historyRetentionMs: config.historyRetentionMs || 60000,
    efficiencyWindowSize: config.efficiencyWindowSize || 50,
    logger: config.logger || console
  };
}