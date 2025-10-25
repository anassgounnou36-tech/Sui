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

// Configuration constants
export const config = {
  // RPC Configuration
  rpcUrl: getEnvString('SUI_RPC_MAINNET', 'https://fullnode.mainnet.sui.io:443'),

  // Wallet Configuration
  privateKey: getEnvString('PRIVATE_KEY', ''),
  walletAddress: getEnvString('WALLET_ADDRESS', ''),

  // Flashloan Configuration
  flashloanAmount: getEnvNumber('FLASHLOAN_AMOUNT', 10_000_000), // 10 USDC (6 decimals)

  // Profit and Spread Thresholds
  minProfitUsdc: getEnvNumber('MIN_PROFIT_USDC', 0.1),
  minSpreadPercent: getEnvNumber('MIN_SPREAD_PERCENT', 0.5),

  // Risk Management
  maxSlippagePercent: getEnvNumber('MAX_SLIPPAGE_PERCENT', 1.0),
  gasBudget: getEnvNumber('GAS_BUDGET', 100_000),

  // Monitoring
  checkIntervalMs: getEnvNumber('CHECK_INTERVAL_MS', 5_000),

  // Verification
  verifyOnChain: getEnvBoolean('VERIFY_ON_CHAIN', true),

  // Dry run mode
  dryRun: getEnvBoolean('DRY_RUN', false),

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
    console.warn(
      'Warning: MIN_SPREAD_PERCENT < 0.1% may result in unprofitable trades after fees'
    );
  }

  if (config.flashloanAmount < 1_000_000) {
    console.warn('Warning: FLASHLOAN_AMOUNT is very low (<1 USDC)');
  }

  // Ensure logs directory exists
  const logsDir = resolve(process.cwd(), 'logs');
  if (!existsSync(logsDir)) {
    throw new Error('Logs directory does not exist. Please create it: mkdir logs');
  }
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
