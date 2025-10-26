/**
 * Turbos DEX Integration (DEPRECATED)
 * All Turbos functions are deprecated. The bot now uses Cetus-only fee-tier arbitrage.
 * These functions are kept for backward compatibility but will throw errors if called.
 */

import { logger } from './logger';
import { Transaction } from '@mysten/sui/transactions';

// Deprecated interfaces (kept for type compatibility)
interface QuoteResult {
  amountOut: bigint;
  sqrtPriceLimit: string;
  priceImpact: number;
}

/**
 * Get current SUI/USDC price from Turbos (DEPRECATED)
 * @deprecated Turbos integration is no longer supported
 */
export async function getTurbosPrice(): Promise<number> {
  logger.error('getTurbosPrice() is deprecated. Turbos integration is no longer supported.');
  throw new Error('Turbos integration is deprecated. Use Cetus fee-tier arbitrage instead.');
}

/**
 * Get executable quote for USDC -> SUI swap on Turbos (DEPRECATED)
 * @deprecated Turbos integration is no longer supported
 */
export async function quoteTurbosSwapB2A(_amountIn: bigint): Promise<QuoteResult> {
  logger.error('quoteTurbosSwapB2A() is deprecated. Turbos integration is no longer supported.');
  throw new Error('Turbos integration is deprecated. Use Cetus fee-tier arbitrage instead.');
}

/**
 * Get executable quote for SUI -> USDC swap on Turbos (DEPRECATED)
 * @deprecated Turbos integration is no longer supported
 */
export async function quoteTurbosSwapA2B(_amountIn: bigint): Promise<QuoteResult> {
  logger.error('quoteTurbosSwapA2B() is deprecated. Turbos integration is no longer supported.');
  throw new Error('Turbos integration is deprecated. Use Cetus fee-tier arbitrage instead.');
}

/**
 * Build swap transaction for Turbos (DEPRECATED)
 * @deprecated Turbos integration is no longer supported
 */
export function buildTurbosSwap(
  _tx: Transaction,
  _inputCoin: any,
  _amountIn: bigint,
  _minAmountOut: bigint,
  _sqrtPriceLimit: string,
  _a2b: boolean
): any {
  logger.error('buildTurbosSwap() is deprecated. Turbos integration is no longer supported.');
  throw new Error('Turbos integration is deprecated. Use Cetus fee-tier arbitrage instead.');
}

/**
 * Get Turbos pool info for debugging (DEPRECATED)
 * @deprecated Turbos integration is no longer supported
 */
export async function getTurbosPoolInfo(): Promise<any> {
  logger.error('getTurbosPoolInfo() is deprecated. Turbos integration is no longer supported.');
  throw new Error('Turbos integration is deprecated. Use Cetus fee-tier arbitrage instead.');
}

/**
 * Clear caches (DEPRECATED)
 * @deprecated Turbos integration is no longer supported
 */
export function clearTurbosCache(): void {
  // No-op
  logger.warn('clearTurbosCache() is deprecated and does nothing.');
}
