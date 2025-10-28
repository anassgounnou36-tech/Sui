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

/**
 * Get MIN_PROFIT_USD with fallback to deprecated names
 * Warns once if using deprecated keys
 */
let minProfitWarningShown = false;
function getMinProfitUsd(): number {
  // Try canonical name first
  if (process.env.MIN_PROFIT_USD) {
    return getEnvNumber('MIN_PROFIT_USD', 0.1);
  }
  
  // Fallback to deprecated names with warning
  if (process.env.MIN_PROFIT_USDC) {
    if (!minProfitWarningShown) {
      console.warn('⚠️  WARNING: MIN_PROFIT_USDC is deprecated. Please use MIN_PROFIT_USD instead.');
      minProfitWarningShown = true;
    }
    return getEnvNumber('MIN_PROFIT_USDC', 0.1);
  }
  
  if (process.env.MIN_PROFIT) {
    if (!minProfitWarningShown) {
      console.warn('⚠️  WARNING: MIN_PROFIT is deprecated. Please use MIN_PROFIT_USD instead.');
      minProfitWarningShown = true;
    }
    return getEnvNumber('MIN_PROFIT', 0.1);
  }
  
  // Default
  return 0.1;
}

// Flashloan asset type
export type FlashloanAsset = 'SUI' | 'USDC';

// Configuration constants
export const config = {
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
  privateKey: getEnvString('PRIVATE_KEY', 'dummy_key_for_simulation'),
  walletAddress: getEnvString('WALLET_ADDRESS', '0x0000000000000000000000000000000000000000000000000000000000000000'),

  // Flashloan Configuration
  flashloanAsset: getEnvString('FLASHLOAN_ASSET', 'SUI') as FlashloanAsset,
  flashloanAmount: getEnvNumber('FLASHLOAN_AMOUNT', 10_000_000_000), // 10 SUI (9 decimals)
  maxFlashloanUsdc: getEnvNumber('MAX_FLASHLOAN_USDC', 5_000_000), // 5M USDC max
  minTradeSui: getEnvNumber('MIN_TRADE_SUI', 1.0), // Minimum 1 SUI for live mode
  suilendSafetyBuffer: getEnvNumber('SUILEND_SAFETY_BUFFER', 0), // Safety buffer for available_amount

  // Safety confirmation for large amounts
  liveConfirm: getEnvBoolean('LIVE_CONFIRM', false),

  // Profit and Spread Thresholds
  minProfitUsd: getMinProfitUsd(), // Canonical: MIN_PROFIT_USD (fallback: MIN_PROFIT_USDC, MIN_PROFIT)
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
  poolStateCacheTtlMs: getEnvNumber('POOL_STATE_CACHE_TTL_MS', 5_000), // 5s cache for pool state

  // RPC rotation configuration
  rotateAfterRequests: getEnvNumber('ROTATE_AFTER_REQUESTS', 20), // Rotate RPC after N requests

  // Retry configuration
  maxRetries: getEnvNumber('MAX_RETRIES', 3),
  retryDelayMs: getEnvNumber('RETRY_DELAY_MS', 1_000),

  // WebSocket Configuration
  enableWs: getEnvBoolean('ENABLE_WS', false),
  wsTriggerMode: getEnvString('WS_TRIGGER_MODE', 'object') as 'object' | 'event',
  minSwapUsd: getEnvNumber('MIN_SWAP_USD', 0), // 0 disables size gate; event mode only

  // Telegram Configuration
  enableTelegram: getEnvBoolean('ENABLE_TELEGRAM', false),
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
};

// Validate critical configuration
export function validateConfig(): void {
  // Warn if MODE env is set (deprecated)
  if (process.env.MODE) {
    console.warn(
      '⚠️  WARNING: MODE environment variable is deprecated and ignored. ' +
      'The bot now defaults to Cetus fee-tier arbitrage with SUI flashloans.'
    );
  }

  // Validate flashloan asset
  if (config.flashloanAsset !== 'SUI' && config.flashloanAsset !== 'USDC') {
    throw new Error(
      `Invalid FLASHLOAN_ASSET: ${config.flashloanAsset}. Must be SUI or USDC`
    );
  }

  // Warn if using USDC instead of SUI
  if (config.flashloanAsset === 'USDC') {
    console.warn(
      '⚠️  WARNING: FLASHLOAN_ASSET=USDC is not typical for Cetus fee-tier arbitrage. ' +
      'Consider using FLASHLOAN_ASSET=SUI.'
    );
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

  // Enforce minimum trade size for live mode
  if (!config.dryRun && config.flashloanAsset === 'SUI') {
    const flashloanSuiAmount = config.flashloanAmount / 1_000_000_000; // Convert to SUI
    if (flashloanSuiAmount < config.minTradeSui) {
      throw new Error(
        `Live mode requires FLASHLOAN_AMOUNT >= ${config.minTradeSui} SUI to avoid rounding issues. ` +
          `Current: ${flashloanSuiAmount.toFixed(2)} SUI. ` +
          `Set MIN_TRADE_SUI to a lower value if needed, or increase FLASHLOAN_AMOUNT.`
      );
    }
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
