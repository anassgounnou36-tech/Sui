// On-chain contract addresses and IDs for Sui Mainnet
// These can be overridden via environment variables for testing or updates

// Helper to get address from env or use default
function getAddress(envKey: string, defaultValue: string): string {
  return process.env[envKey] || defaultValue;
}

// Coin Types
export const COIN_TYPES = {
  SUI: '0x2::sui::SUI',
  USDC: getAddress(
    'USDC_COIN_TYPE',
    '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN'
  ),
};

// Suilend Configuration
export const SUILEND = {
  packageId: getAddress(
    'SUILEND_PACKAGE_ID',
    '0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf'
  ),
  marketObjectId: getAddress(
    'SUILEND_MARKET_ID',
    '0x84030d26d85eaa7035084a057f2f11f701b7e2e4eda87551becbc7c97505ece1'
  ),
  // Suilend lending market for flashloans
  lendingMarket: getAddress(
    'SUILEND_LENDING_MARKET',
    '0x84030d26d85eaa7035084a057f2f11f701b7e2e4eda87551becbc7c97505ece1'
  ),
};

// Navi Protocol Configuration (Fallback)
export const NAVI = {
  packageId: getAddress(
    'NAVI_PACKAGE_ID',
    '0xd899cf7d2b5db716bd2cf55599fb0d5ee38a3061e7b6bb6eebf73fa5bc4c81ca'
  ),
  storageId: getAddress(
    'NAVI_STORAGE_ID',
    '0xbb4e2f4b6205c2e2a2db47aeb4f830796ec7c005f88537ee775986639bc442fe'
  ),
  // Navi pool for USDC
  usdcPoolId: getAddress(
    'NAVI_USDC_POOL_ID',
    '0x96df0fce3c471489f4debaaa762cf960b3d97820bd1f3f025ff8190730e958c5'
  ),
};

// Cetus DEX Configuration
export const CETUS = {
  packageId: getAddress(
    'CETUS_PACKAGE_ID',
    '0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb'
  ),
  globalConfigId: getAddress(
    'CETUS_GLOBAL_CONFIG_ID',
    '0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f'
  ),
  // SUI/USDC 0.05% pool
  suiUsdcPoolId: getAddress(
    'CETUS_SUI_USDC_POOL_ID',
    '0xcf994611fd4c48e277ce3ffd4d4364c914af2c3cbb05f7bf6facd371de688630'
  ),
  suiUsdcPoolAddress: getAddress(
    'CETUS_SUI_USDC_POOL_ADDRESS',
    '0xcf994611fd4c48e277ce3ffd4d4364c914af2c3cbb05f7bf6facd371de688630'
  ),
};

// Turbos DEX Configuration
export const TURBOS = {
  packageId: getAddress(
    'TURBOS_PACKAGE_ID',
    '0x91bfbc386a41afcfd9b2533058d7e915a1d3829089cc268ff4333d54d6339ca1'
  ),
  factoryId: getAddress(
    'TURBOS_FACTORY_ID',
    '0x1e8b0c2a6c8f8b7e6f8a5c4b9d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e'
  ),
  // SUI/USDC 0.05% pool
  suiUsdcPoolId: getAddress(
    'TURBOS_SUI_USDC_POOL_ID',
    '0x5eb2dfcdd1b15d2021328258f6d5ec081e9a0cdcfa9e13a0eaeb9b5f7505ca78'
  ),
  suiUsdcPoolAddress: getAddress(
    'TURBOS_SUI_USDC_POOL_ADDRESS',
    '0x5eb2dfcdd1b15d2021328258f6d5ec081e9a0cdcfa9e13a0eaeb9b5f7505ca78'
  ),
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
