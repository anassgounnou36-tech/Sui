"use strict";
// On-chain contract addresses and IDs for Sui Mainnet
// These can be overridden via environment variables for testing or updates
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_ADDRESSES = exports.POOLS = exports.TURBOS = exports.CETUS = exports.NAVI = exports.SUILEND = exports.COIN_TYPES = void 0;
exports.validateUsdcCoinType = validateUsdcCoinType;
exports.validateFeeTierPoolCoinTypes = validateFeeTierPoolCoinTypes;
// Helper to get address from env or use default
function getAddress(envKey, defaultValue) {
    return process.env[envKey] || defaultValue;
}
// Native USDC (recommended)
const NATIVE_USDC = '0xaf8cd5edc19637e05da0dd46f6ddb1a8b81cc532fcccf6d5d41ba77bba6eddd5::coin::COIN';
const NATIVE_USDC_HASH = 'af8cd5edc19637e05da0dd46f6ddb1a8b81cc532fcccf6d5d41ba77bba6eddd5';
// Wormhole wrapped USDC (legacy, not recommended)
const WORMHOLE_USDC = '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN';
const WORMHOLE_USDC_HASH = '5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf';
// Bridged USDC (legacy/Circle bridged, used in some Cetus pools)
const BRIDGED_USDC = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
// Coin Types
exports.COIN_TYPES = {
    SUI: '0x2::sui::SUI',
    // Bridged USDC is the default for Cetus fee-tier arbitrage
    USDC: getAddress('BRIDGED_USDC_COIN_TYPE', BRIDGED_USDC),
    // Keep BRIDGED_USDC as explicit reference
    BRIDGED_USDC: getAddress('BRIDGED_USDC_COIN_TYPE', BRIDGED_USDC),
    // Reference constants (deprecated for runtime use)
    NATIVE_USDC,
    WORMHOLE_USDC,
    // Hash constants for partial matching
    NATIVE_USDC_HASH,
    WORMHOLE_USDC_HASH,
};
// Warn if USDC_COIN_TYPE is set (backward compatibility check)
if (process.env.USDC_COIN_TYPE && process.env.USDC_COIN_TYPE !== BRIDGED_USDC) {
    console.warn('⚠️  WARNING: USDC_COIN_TYPE environment variable is deprecated for Cetus fee-tier arbitrage. ' +
        'The strategy uses bridged USDC by default. ' +
        `Set BRIDGED_USDC_COIN_TYPE instead if you need to override (current: ${process.env.USDC_COIN_TYPE})`);
}
// Suilend Configuration
exports.SUILEND = {
    // Suilend core package ID per spec
    packageId: getAddress('SUILEND_PACKAGE_ID', '0x902f7ee4a68f6f63b05acd66e7aacc6de72703da4d8e0c6f94c1dd4b73c62e85'),
    // Market object ID - to be resolved dynamically at startup
    marketObjectId: getAddress('SUILEND_MARKET_ID', ''),
    // Suilend lending market for flashloans - mainnet default
    lendingMarket: getAddress('SUILEND_LENDING_MARKET', '0x84030d26d85eaa7035084a057f2f11f701b7e2e4eda87551becbc7c97505ece1'),
};
// Navi Protocol Configuration (Fallback)
exports.NAVI = {
    // Navi core package ID per spec
    packageId: getAddress('NAVI_PACKAGE_ID', '0x06d8af64fe58327e9f2b7b33b9fad9a5d0f0fb1ba38b024de09c767c10241e42'),
    // Storage and pool IDs - to be resolved dynamically at startup
    storageId: getAddress('NAVI_STORAGE_ID', ''),
    usdcPoolId: getAddress('NAVI_USDC_POOL_ID', ''),
};
// Cetus DEX Configuration
exports.CETUS = {
    // Cetus CLMM package ID per spec
    packageId: getAddress('CETUS_PACKAGE_ID', '0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb'),
    // Cetus CLMM Integration package (for GlobalConfig)
    integrationPackageId: getAddress('CETUS_CLMM_INTEGRATION', '0x996c4d9480708fb8b92aa7acf819fb0497b5ec8e65ba06601cae2fb6db3312c3'),
    // Global config and pool IDs - to be resolved dynamically at startup
    globalConfigId: getAddress('CETUS_GLOBAL_CONFIG_ID', '0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f'),
    // Fee-tier specific pools for Cetus fee-tier arbitrage (default strategy)
    suiUsdcPool005Id: getAddress('CETUS_POOL_ID_005', '0x51e883ba7c0b566a26cbc8a94cd33eb0abd418a77cc1e60ad22fd9b1f29cd2ab'), // 0.05% fee tier
    suiUsdcPool025Id: getAddress('CETUS_POOL_ID_025', '0xb8d7d9e66a60c239e7a60110efcf8de6c705580ed924d0dde141f4a0e2c90105'), // 0.25% fee tier
};
// Turbos DEX Configuration (DEPRECATED - kept for backward compatibility)
exports.TURBOS = {
    // Turbos CLMM package ID per spec
    packageId: getAddress('TURBOS_PACKAGE_ID', '0x91bfbc386a41afcfd9b2533058d7e915a1d3829089cc268ff4333d54d6339ca1'),
    // Factory and pool IDs - DEPRECATED, no longer used in runtime
    factoryId: getAddress('TURBOS_FACTORY_ID', ''),
    suiUsdcPoolId: getAddress('TURBOS_SUI_USDC_POOL_ID', ''),
    suiUsdcPoolAddress: getAddress('TURBOS_SUI_USDC_POOL_ADDRESS', ''),
};
// Warn if Turbos env vars are set
if (process.env.TURBOS_FACTORY_ID || process.env.TURBOS_SUI_USDC_POOL_ID) {
    console.warn('⚠️  WARNING: Turbos environment variables are deprecated. ' +
        'The bot now uses Cetus fee-tier arbitrage only. Turbos configuration will be ignored.');
}
// Pool configurations with fee tiers (DEPRECATED - for backward compatibility only)
exports.POOLS = {
    cetus: {
        suiUsdc005: {
            poolId: exports.CETUS.suiUsdcPool005Id,
            feeTier: 500, // 0.05% = 500 basis points
            coinTypeA: exports.COIN_TYPES.SUI,
            coinTypeB: exports.COIN_TYPES.USDC,
        },
        suiUsdc025: {
            poolId: exports.CETUS.suiUsdcPool025Id,
            feeTier: 2500, // 0.25% = 2500 basis points
            coinTypeA: exports.COIN_TYPES.SUI,
            coinTypeB: exports.COIN_TYPES.USDC,
        },
    },
    // Turbos deprecated
    turbos: {
        suiUsdc: {
            poolId: '', // Deprecated
            feeTier: 500,
            coinTypeA: exports.COIN_TYPES.SUI,
            coinTypeB: exports.COIN_TYPES.USDC,
        },
    },
};
// Export all addresses for verification
exports.ALL_ADDRESSES = {
    suilend: Object.values(exports.SUILEND),
    navi: Object.values(exports.NAVI),
    cetus: Object.values(exports.CETUS),
    turbos: Object.values(exports.TURBOS),
};
/**
 * Validate that USDC coin type is native, not Wormhole wrapped
 * @param allowWrappedUsdc If true, allow Wormhole USDC (default: false)
 * @throws Error if Wormhole USDC is used without explicit permission
 */
function validateUsdcCoinType(allowWrappedUsdc = false) {
    const usdcType = exports.COIN_TYPES.USDC;
    if (usdcType === WORMHOLE_USDC && !allowWrappedUsdc) {
        throw new Error('Wormhole wrapped USDC detected! This is not recommended for arbitrage.\n' +
            'Native USDC should be used instead. If you must use wrapped USDC,\n' +
            'set ALLOW_WRAPPED_USDC=true and ensure USDC_COIN_TYPE is set correctly.\n' +
            `Current USDC type: ${usdcType}\n` +
            `Native USDC: ${NATIVE_USDC}\n` +
            `Wormhole USDC: ${WORMHOLE_USDC}`);
    }
    if (usdcType === NATIVE_USDC) {
        // Good - using native USDC
        return;
    }
    if (usdcType === WORMHOLE_USDC && allowWrappedUsdc) {
        console.warn('⚠️  WARNING: Using Wormhole wrapped USDC. Native USDC is recommended.');
        return;
    }
    // Custom coin type provided
    if (usdcType !== NATIVE_USDC && usdcType !== WORMHOLE_USDC) {
        console.warn(`⚠️  WARNING: Using custom USDC coin type: ${usdcType}`);
        console.warn('Ensure this is correct for your use case.');
    }
}
/**
 * Validate that pool coin types match expected types for fee-tier arbitrage
 * @param coinTypeA First coin type from pool
 * @param coinTypeB Second coin type from pool
 * @returns true if valid, throws error otherwise
 */
function validateFeeTierPoolCoinTypes(coinTypeA, coinTypeB) {
    const hasSui = coinTypeA === exports.COIN_TYPES.SUI || coinTypeB === exports.COIN_TYPES.SUI;
    const hasBridgedUsdc = coinTypeA === BRIDGED_USDC || coinTypeB === BRIDGED_USDC;
    if (!hasSui || !hasBridgedUsdc) {
        // Check for incorrect coin types
        if (coinTypeA === WORMHOLE_USDC || coinTypeB === WORMHOLE_USDC) {
            throw new Error(`Pool contains Wormhole USDC (${WORMHOLE_USDC}) which is not supported for fee-tier arbitrage. ` +
                `Expected bridged USDC: ${BRIDGED_USDC}`);
        }
        if (coinTypeA === NATIVE_USDC || coinTypeB === NATIVE_USDC) {
            throw new Error(`Pool contains native USDC (${NATIVE_USDC}) which is not the expected bridged USDC. ` +
                `Expected bridged USDC: ${BRIDGED_USDC}`);
        }
        throw new Error(`Pool does not contain SUI and bridged USDC. Found: ${coinTypeA}, ${coinTypeB}. ` +
            `Expected: ${exports.COIN_TYPES.SUI}, ${BRIDGED_USDC}`);
    }
    return true;
}
