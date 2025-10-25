// On-chain contract addresses and IDs for Sui Mainnet
// These can be overridden via environment variables for testing or updates

// Helper to get address from env or use default
function getAddress(envKey: string, defaultValue: string): string {
  return process.env[envKey] || defaultValue;
}

// Coin Types
export const COIN_TYPES = {
  SUI: '0x2::sui::SUI',
  // Native USDC coin type (6 decimals) - mainnet
  USDC: getAddress(
    'USDC_COIN_TYPE',
    '0xaf8cd5edc19637e05da0dd46f6ddb1a8b81cc532fcccf6d5d41ba77bba6eddd5::coin::COIN'
  ),
};

// Suilend Configuration
export const SUILEND = {
  // Suilend core package ID per spec
  packageId: getAddress(
    'SUILEND_PACKAGE_ID',
    '0x902f7ee4a68f6f63b05acd66e7aacc6de72703da4d8e0c6f94c1dd4b73c62e85'
  ),
  // Market object ID - to be resolved dynamically at startup
  marketObjectId: getAddress('SUILEND_MARKET_ID', ''),
  // Suilend lending market for flashloans - to be resolved dynamically
  lendingMarket: getAddress('SUILEND_LENDING_MARKET', ''),
};

// Navi Protocol Configuration (Fallback)
export const NAVI = {
  // Navi core package ID per spec
  packageId: getAddress(
    'NAVI_PACKAGE_ID',
    '0x06d8af64fe58327e9f2b7b33b9fad9a5d0f0fb1ba38b024de09c767c10241e42'
  ),
  // Storage and pool IDs - to be resolved dynamically at startup
  storageId: getAddress('NAVI_STORAGE_ID', ''),
  usdcPoolId: getAddress('NAVI_USDC_POOL_ID', ''),
};

// Cetus DEX Configuration
export const CETUS = {
  // Cetus CLMM package ID per spec
  packageId: getAddress(
    'CETUS_PACKAGE_ID',
    '0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb'
  ),
  // Global config and pool IDs - to be resolved dynamically at startup
  globalConfigId: getAddress('CETUS_GLOBAL_CONFIG_ID', ''),
  suiUsdcPoolId: getAddress('CETUS_SUI_USDC_POOL_ID', ''),
  suiUsdcPoolAddress: getAddress('CETUS_SUI_USDC_POOL_ADDRESS', ''),
};

// Turbos DEX Configuration
export const TURBOS = {
  // Turbos CLMM package ID per spec
  packageId: getAddress(
    'TURBOS_PACKAGE_ID',
    '0x91bfbc386a41afcfd9b2533058d7e915a1d3829089cc268ff4333d54d6339ca1'
  ),
  // Factory and pool IDs - to be resolved dynamically at startup
  factoryId: getAddress('TURBOS_FACTORY_ID', ''),
  suiUsdcPoolId: getAddress('TURBOS_SUI_USDC_POOL_ID', ''),
  suiUsdcPoolAddress: getAddress('TURBOS_SUI_USDC_POOL_ADDRESS', ''),
};

// Pool configurations with fee tiers
export const POOLS = {
  cetus: {
    suiUsdc: {
      poolId: CETUS.suiUsdcPoolId,
      feeTier: 500, // 0.05% = 500 basis points
      coinTypeA: COIN_TYPES.SUI,
      coinTypeB: COIN_TYPES.USDC,
    },
  },
  turbos: {
    suiUsdc: {
      poolId: TURBOS.suiUsdcPoolId,
      feeTier: 500, // 0.05% = 500 basis points
      coinTypeA: COIN_TYPES.SUI,
      coinTypeB: COIN_TYPES.USDC,
    },
  },
};

// Export all addresses for verification
export const ALL_ADDRESSES = {
  suilend: Object.values(SUILEND),
  navi: Object.values(NAVI),
  cetus: Object.values(CETUS),
  turbos: Object.values(TURBOS),
};
