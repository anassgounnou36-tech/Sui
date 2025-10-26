import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';

// Load environment variables
dotenv.config();

// Validate and parse environment variables
function getEnvString(key: string, defaultValue?: string): string {
  const value = process.env[key] || defaultValue;
  if (!value) {
    throw new Error(`Environment variable ${key} is required`);
  }
  return value;
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = Number(value);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a valid number`);
  }
  return parsed;
}

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true';
}

// Strategy mode type
export type StrategyMode = 'CETUS_TURBOS' | 'CETUS_FEE_TIER_ARB';

// Flashloan asset type
export type FlashloanAsset = 'SUI' | 'USDC';

// Configuration constants
export const config = {
  // Strategy mode
  mode: getEnvString('MODE', 'CETUS_TURBOS') as StrategyMode,

  // Multi-RPC Configuration with failover
  rpcEndpoints: {
    primary: getEnvString(
      'SUI_RPC_MAINNET_PRIMARY',
      'https://sui-mainnet.public.blastapi.io'
    ),
    backup: getEnvString('SUI_RPC_MAINNET_BACKUP', 'https://1rpc.io/sui'),
    fallback: getEnvString(
      'SUI_RPC_MAINNET_FALLBACK',
      'https://sui.rpc.grove.city/v1/01fdb492'
    ),
  },
  // Legacy single RPC URL (for backward compatibility)
  rpcUrl: getEnvString('SUI_RPC_MAINNET', 'https://sui-mainnet.public.blastapi.io'),

  // Wallet Configuration
  privateKey: getEnvString('PRIVATE_KEY', ''),
  walletAddress: getEnvString('WALLET_ADDRESS', ''),

  // Flashloan Configuration
  flashloanAsset: getEnvString('FLASHLOAN_ASSET', 'USDC') as FlashloanAsset,
  flashloanAmount: getEnvNumber('FLASHLOAN_AMOUNT', 10_000_000), // 10 USDC (6 decimals) or 10 SUI (9 decimals)
  maxFlashloanUsdc: getEnvNumber('MAX_FLASHLOAN_USDC', 5_000_000), // 5M USDC max

  // Safety confirmation for large amounts
  liveConfirm: getEnvBoolean('LIVE_CONFIRM', false),

  // Profit and Spread Thresholds
  minProfitUsdc: getEnvNumber('MIN_PROFIT_USDC', 0.1),
  minSpreadPercent: getEnvNumber('MIN_SPREAD_PERCENT', 0.5),
  consecutiveSpreadRequired: getEnvNumber('CONSECUTIVE_SPREAD_REQUIRED', 2),

  // Risk Management
  maxSlippagePercent: getEnvNumber('MAX_SLIPPAGE_PERCENT', 1.0),
  gasBudget: getEnvNumber('GAS_BUDGET', 100_000),
  maxConsecutiveFailures: getEnvNumber('MAX_CONSECUTIVE_FAILURES', 3),

  // Monitoring
  checkIntervalMs: getEnvNumber('CHECK_INTERVAL_MS', 5_000),
  finalityPollIntervalMs: getEnvNumber('FINALITY_POLL_INTERVAL_MS', 500),
  finalityMaxWaitMs: getEnvNumber('FINALITY_MAX_WAIT_MS', 10_000),

  // Verification
  verifyOnChain: getEnvBoolean('VERIFY_ON_CHAIN', true),

  // Dry run mode
  dryRun: getEnvBoolean('DRY_RUN', false),

  // Coin type safety
  allowWrappedUsdc: getEnvBoolean('ALLOW_WRAPPED_USDC', false),

  // Fee configurations (as percentages)
  suilendFeePercent: getEnvNumber('SUILEND_FEE_PERCENT', 0.05),
  naviFeePercent: getEnvNumber('NAVI_FEE_PERCENT', 0.06),
  cetusSwapFeePercent: getEnvNumber('CETUS_SWAP_FEE_PERCENT', 0.05),
  turbosSwapFeePercent: getEnvNumber('TURBOS_SWAP_FEE_PERCENT', 0.05),

  // Rate limiting
  maxTxPerInterval: getEnvNumber('MAX_TX_PER_INTERVAL', 1),
  txIntervalMs: getEnvNumber('TX_INTERVAL_MS', 3_000),
  maxPendingTx: getEnvNumber('MAX_PENDING_TX', 5),

  // Cache configuration
  priceCacheTtlMs: getEnvNumber('PRICE_CACHE_TTL_MS', 2_000),

  // Retry configuration
  maxRetries: getEnvNumber('MAX_RETRIES', 3),
  retryDelayMs: getEnvNumber('RETRY_DELAY_MS', 1_000),
};

// Validate critical configuration
export function validateConfig(): void {
  // Validate mode
  if (config.mode !== 'CETUS_TURBOS' && config.mode !== 'CETUS_FEE_TIER_ARB') {
    throw new Error(
      `Invalid MODE: ${config.mode}. Must be CETUS_TURBOS or CETUS_FEE_TIER_ARB`
    );
  }

  // Validate flashloan asset
  if (config.flashloanAsset !== 'SUI' && config.flashloanAsset !== 'USDC') {
    throw new Error(
      `Invalid FLASHLOAN_ASSET: ${config.flashloanAsset}. Must be SUI or USDC`
    );
  }

  // Default to SUI for CETUS_FEE_TIER_ARB mode
  if (config.mode === 'CETUS_FEE_TIER_ARB' && config.flashloanAsset === 'USDC') {
    console.warn('Warning: CETUS_FEE_TIER_ARB mode defaults to SUI flashloan. Consider setting FLASHLOAN_ASSET=SUI');
  }

  if (!config.dryRun) {
    if (!config.privateKey || config.privateKey === 'your_private_key_here') {
      throw new Error('PRIVATE_KEY must be set for live trading');
    }
    if (!config.walletAddress || config.walletAddress.includes('your_wallet')) {
      throw new Error('WALLET_ADDRESS must be set for live trading');
    }
  }

  if (config.maxSlippagePercent > 10) {
    throw new Error('MAX_SLIPPAGE_PERCENT too high (>10%), possible configuration error');
  }

  if (config.minSpreadPercent < 0.1) {
    console.warn('Warning: MIN_SPREAD_PERCENT < 0.1% may result in unprofitable trades after fees');
  }

  // Validate flashloan amount based on asset type
  const minAmount = config.flashloanAsset === 'SUI' ? 1_000_000_000 : 1_000_000; // 1 SUI or 1 USDC
  if (config.flashloanAmount < minAmount) {
    console.warn(`Warning: FLASHLOAN_AMOUNT is very low (<1 ${config.flashloanAsset})`);
  }

  // Safety check for large flashloan amounts
  const flashloanUsdcAmount = config.flashloanAmount / 1_000_000; // Convert to USDC
  const largeAmountThreshold = 100_000; // 100k USDC

  if (flashloanUsdcAmount > largeAmountThreshold && !config.liveConfirm) {
    throw new Error(
      `FLASHLOAN_AMOUNT exceeds ${largeAmountThreshold} USDC (${flashloanUsdcAmount.toFixed(2)} USDC). ` +
        `Set LIVE_CONFIRM=true to proceed with large amounts.`
    );
  }

  // Validate max flashloan limit
  if (config.flashloanAmount > config.maxFlashloanUsdc * 1_000_000) {
    throw new Error(
      `FLASHLOAN_AMOUNT (${flashloanUsdcAmount.toFixed(2)} USDC) exceeds ` +
        `MAX_FLASHLOAN_USDC limit (${config.maxFlashloanUsdc} USDC)`
    );
  }

  // Ensure logs directory exists
  const logsDir = resolve(process.cwd(), 'logs');
  if (!existsSync(logsDir)) {
    throw new Error('Logs directory does not exist. Please create it: mkdir logs');
  }
}

/**
 * Normalize private key format (support hex with/without 0x and base64)
 */
export function normalizePrivateKey(privateKey: string): string {
  // If it starts with 0x, assume hex
  if (privateKey.startsWith('0x') || privateKey.startsWith('0X')) {
    return privateKey;
  }

  // Check if it looks like hex (64 chars, all hex digits)
  if (/^[0-9a-fA-F]{64}$/.test(privateKey)) {
    return '0x' + privateKey;
  }

  // Otherwise assume base64
  return privateKey;
}

// Constants for calculations
export const USDC_DECIMALS = 6;
export const SUI_DECIMALS = 9;
export const USDC_UNIT = BigInt(10 ** USDC_DECIMALS);
export const SUI_UNIT = BigInt(10 ** SUI_DECIMALS);

// Helper to convert USDC to smallest units
export function usdcToSmallestUnit(usdc: number): bigint {
  return BigInt(Math.floor(usdc * 10 ** USDC_DECIMALS));
}

// Helper to convert SUI to smallest units
export function suiToSmallestUnit(sui: number): bigint {
  return BigInt(Math.floor(sui * 10 ** SUI_DECIMALS));
}

// Helper to convert smallest units to USDC
export function smallestUnitToUsdc(amount: bigint): number {
  return Number(amount) / 10 ** USDC_DECIMALS;
}

// Helper to convert smallest units to SUI
export function smallestUnitToSui(amount: bigint): number {
  return Number(amount) / 10 ** SUI_DECIMALS;
}
