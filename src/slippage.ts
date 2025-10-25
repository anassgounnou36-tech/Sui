import { config } from './config';

/**
 * Calculate minimum output amount with slippage protection
 * @param expectedAmount Expected output amount (in smallest units)
 * @param maxSlippagePercent Maximum allowed slippage as percentage (e.g., 1.0 for 1%)
 * @returns Minimum acceptable output amount
 */
export function calculateMinOut(expectedAmount: bigint, maxSlippagePercent: number): bigint {
  const slippageFactor = BigInt(Math.floor((100 - maxSlippagePercent) * 100));
  return (expectedAmount * slippageFactor) / BigInt(10000);
}

/**
 * Calculate expected output after swap fees
 * @param amountIn Input amount (in smallest units)
 * @param feeBps Fee in basis points (e.g., 50 for 0.5%, 500 for 5%)
 * @returns Expected output amount after fees
 */
export function calculateAmountAfterFee(amountIn: bigint, feeBps: number): bigint {
  const bps = BigInt(10000);
  const feeAmount = (amountIn * BigInt(feeBps)) / bps;
  return amountIn - feeAmount;
}

/**
 * Calculate minimum output considering both price, fees, and slippage
 * @param amountIn Input amount
 * @param price Price (output per input)
 * @param feeBps Swap fee in basis points
 * @param maxSlippagePercent Maximum slippage percentage
 * @returns Minimum acceptable output
 */
export function calculateMinOutWithFees(
  amountIn: bigint,
  price: number,
  feeBps: number,
  maxSlippagePercent: number
): bigint {
  // Calculate expected output
  const expectedOut = BigInt(Math.floor(Number(amountIn) * price));

  // Apply fee
  const afterFee = calculateAmountAfterFee(expectedOut, feeBps);

  // Apply slippage
  return calculateMinOut(afterFee, maxSlippagePercent);
}

/**
 * Assert that actual output meets minimum requirement
 * @param actualAmount Actual output amount received
 * @param minAmount Minimum required amount
 * @throws Error if actual is less than minimum
 */
export function assertMinOut(actualAmount: bigint, minAmount: bigint): void {
  if (actualAmount < minAmount) {
    throw new Error(
      `Slippage exceeded: got ${actualAmount}, expected at least ${minAmount} ` +
        `(shortfall: ${minAmount - actualAmount})`
    );
  }
}

/**
 * Calculate price impact as percentage
 * @param amountIn Input amount
 * @param amountOut Output amount
 * @param expectedPrice Expected price without impact
 * @returns Price impact as percentage
 */
export function calculatePriceImpact(
  amountIn: bigint,
  amountOut: bigint,
  expectedPrice: number
): number {
  const actualPrice = Number(amountOut) / Number(amountIn);
  const impact = ((expectedPrice - actualPrice) / expectedPrice) * 100;
  return Math.max(0, impact);
}

/**
 * Check if slippage is acceptable
 * @param actualAmount Actual amount received
 * @param expectedAmount Expected amount
 * @param maxSlippagePercent Maximum allowed slippage
 * @returns true if slippage is within limits
 */
export function isSlippageAcceptable(
  actualAmount: bigint,
  expectedAmount: bigint,
  maxSlippagePercent: number
): boolean {
  const minAcceptable = calculateMinOut(expectedAmount, maxSlippagePercent);
  return actualAmount >= minAcceptable;
}

/**
 * Calculate effective slippage percentage
 * @param actualAmount Actual amount received
 * @param expectedAmount Expected amount
 * @returns Slippage as percentage (positive means loss)
 */
export function calculateSlippagePercent(actualAmount: bigint, expectedAmount: bigint): number {
  if (expectedAmount === BigInt(0)) return 0;
  const diff = expectedAmount - actualAmount;
  return (Number(diff) / Number(expectedAmount)) * 100;
}

/**
 * Guard function to validate slippage before transaction
 * @param quote Quoted output amount
 * @param minOut Minimum required output
 * @throws Error if quote doesn't meet minimum
 */
export function guardSlippage(quote: bigint, minOut: bigint): void {
  assertMinOut(quote, minOut);
}

/**
 * Apply max slippage cap from config
 * @param expectedAmount Expected output amount
 * @returns Minimum output with config slippage applied
 */
export function applyConfigSlippage(expectedAmount: bigint): bigint {
  return calculateMinOut(expectedAmount, config.maxSlippagePercent);
}

/**
 * Calculate total fees for a flashloan arbitrage
 * @param flashloanAmount Amount borrowed
 * @param flashloanFeePercent Flashloan fee percentage
 * @param swapFee1Bps First swap fee in bps
 * @param swapFee2Bps Second swap fee in bps
 * @returns Total fee amount
 */
export function calculateTotalFees(
  flashloanAmount: bigint,
  flashloanFeePercent: number,
  swapFee1Bps: number,
  swapFee2Bps: number
): bigint {
  // Flashloan fee
  const flashloanFee = (flashloanAmount * BigInt(Math.floor(flashloanFeePercent * 100))) / BigInt(10000);

  // Swap fees (approximate, as they apply to different amounts)
  const swap1Fee = (flashloanAmount * BigInt(swapFee1Bps)) / BigInt(10000);
  const swap2Fee = (flashloanAmount * BigInt(swapFee2Bps)) / BigInt(10000);

  return flashloanFee + swap1Fee + swap2Fee;
}

/**
 * Calculate minimum spread required for profitability
 * @param flashloanFeePercent Flashloan fee percentage
 * @param swapFee1Bps First swap fee in bps
 * @param swapFee2Bps Second swap fee in bps
 * @returns Minimum spread percentage required
 */
export function calculateMinSpreadRequired(
  flashloanFeePercent: number,
  swapFee1Bps: number,
  swapFee2Bps: number
): number {
  // Convert bps to percent and sum
  return flashloanFeePercent + swapFee1Bps / 100 + swapFee2Bps / 100;
}
