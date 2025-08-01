/**
 * Integration utility for @aid-on/fuzztok token estimation
 */

interface FuzztokModule {
  encode: (text: string) => number[];
  decode: (tokens: number[]) => string;
  countTokens: (text: string) => number;
}

let fuzztokModule: FuzztokModule | null = null;
let fuzztokAvailable = false;

/**
 * Attempts to load the fuzztok module
 */
async function loadFuzztok(): Promise<boolean> {
  if (fuzztokModule !== null) {
    return fuzztokAvailable;
  }

  try {
    // Dynamic import to handle optional dependency
    // @ts-ignore - Optional dependency may not be available
    fuzztokModule = await import('@aid-on/fuzztok');
    fuzztokAvailable = true;
    return true;
  } catch (error) {
    // Module not available or failed to load
    fuzztokAvailable = false;
    return false;
  }
}

/**
 * Estimates token count for given text using fuzztok
 */
export async function estimateTokens(text: string): Promise<number> {
  const loaded = await loadFuzztok();
  
  if (!loaded || !fuzztokModule) {
    // Fallback estimation: roughly 4 characters per token for English text
    return Math.ceil(text.length / 4);
  }

  try {
    return fuzztokModule.countTokens(text);
  } catch (error) {
    // Fallback on error
    return Math.ceil(text.length / 4);
  }
}

/**
 * Checks if fuzztok is available
 */
export async function isFuzztokAvailable(): Promise<boolean> {
  return await loadFuzztok();
}

/**
 * Simple synchronous token estimation (fallback method)
 */
export function simpleFallbackEstimate(text: string): number {
  if (!text) return 0;
  
  // More sophisticated fallback estimation
  // Account for different types of content
  const words = text.split(/\s+/).length;
  const chars = text.length;
  
  // Average of word-based and character-based estimation
  const wordBasedEstimate = Math.ceil(words * 1.3); // ~1.3 tokens per word
  const charBasedEstimate = Math.ceil(chars / 4); // ~4 chars per token
  
  return Math.max(1, Math.round((wordBasedEstimate + charBasedEstimate) / 2));
}

/**
 * Estimates tokens with automatic fallback
 */
export async function robustEstimateTokens(text: string): Promise<number> {
  if (!text) return 0;
  
  try {
    return await estimateTokens(text);
  } catch (error) {
    return simpleFallbackEstimate(text);
  }
}