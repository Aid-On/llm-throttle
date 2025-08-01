/**
 * Clock utilities for high-precision timing
 */

let hasNodeHrtime: boolean;
let hasPerformanceNow: boolean;

// Check availability at module load time
try {
  hasNodeHrtime = typeof process !== 'undefined' && 
                  typeof process.hrtime !== 'undefined' && 
                  typeof process.hrtime.bigint === 'function';
} catch {
  hasNodeHrtime = false;
}

try {
  hasPerformanceNow = typeof performance !== 'undefined' && 
                      typeof performance.now === 'function';
} catch {
  hasPerformanceNow = false;
}

/**
 * Creates a monotonic clock function based on the environment
 */
export function createMonotonicClock(): () => number {
  if (hasNodeHrtime) {
    // Node.js: Use high-resolution time
    const startTime = process.hrtime.bigint();
    return () => {
      const current = process.hrtime.bigint();
      return Number(current - startTime) / 1000000; // Convert nanoseconds to milliseconds
    };
  } else if (hasPerformanceNow) {
    // Browser: Use performance.now()
    const startTime = performance.now();
    return () => performance.now() - startTime;
  } else {
    // Fallback: Use Date.now() (not monotonic but better than nothing)
    const startTime = Date.now();
    return () => Date.now() - startTime;
  }
}

/**
 * Creates a standard clock function (Date.now)
 */
export function createStandardClock(): () => number {
  return () => Date.now();
}

/**
 * Auto-detects and creates the best available clock
 */
export function createOptimalClock(preferMonotonic: boolean = true): () => number {
  if (preferMonotonic && (hasNodeHrtime || hasPerformanceNow)) {
    return createMonotonicClock();
  }
  return createStandardClock();
}

/**
 * Gets environment information for debugging
 */
export function getClockInfo(): {
  hasNodeHrtime: boolean;
  hasPerformanceNow: boolean;
  recommendedClock: 'monotonic' | 'standard';
} {
  return {
    hasNodeHrtime,
    hasPerformanceNow,
    recommendedClock: (hasNodeHrtime || hasPerformanceNow) ? 'monotonic' : 'standard'
  };
}