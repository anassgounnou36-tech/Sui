/**
 * Pool Resolver - Dynamically resolves DEX pool IDs and market IDs at startup
 * This module fetches pool and market object IDs from the SDKs/state at startup
 * and caches them for use throughout the application.
 */

import { SuiClient } from '@mysten/sui/client';
import { logger } from './logger.js';

/**
 * Resolved pool and market information
 */
export interface ResolvedAddresses {
  cetus: {
    globalConfigId: string;
    suiUsdcPoolId: string;
  };
  turbos: {
    factoryId: string;
    suiUsdcPoolId: string;
  };
  suilend: {
    lendingMarket: string;
  };
  navi: {
    storageId: string;
    usdcPoolId: string;
  };
}

let cachedAddresses: ResolvedAddresses | null = null;

/**
 * Get cached resolved addresses (throws if not yet resolved)
 */
export function getResolvedAddresses(): ResolvedAddresses {
  if (!cachedAddresses) {
    throw new Error('Pool addresses not yet resolved. Call resolvePoolAddresses() first.');
  }
  return cachedAddresses;
}

/**
 * Resolve Cetus pool and config IDs
 */
async function resolveCetusAddresses(client: SuiClient): Promise<{
  globalConfigId: string;
  suiUsdcPoolId: string;
}> {
  logger.info('Resolving Cetus addresses...');

  // For now, we'll use hardcoded values from environment or defaults
  // In a real implementation, you would use the Cetus SDK to discover pools
  // TODO: Integrate with Cetus SDK to dynamically discover pools
  const globalConfigId =
    process.env.CETUS_GLOBAL_CONFIG_ID ||
    '0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f';

  const suiUsdcPoolId =
    process.env.CETUS_SUI_USDC_POOL_ID ||
    '0xcf994611fd4c48e277ce3ffd4d4364c914af2c3cbb05f7bf6facd371de688630';

  // Verify the pool exists
  try {
    const poolObj = await client.getObject({
      id: suiUsdcPoolId,
      options: { showType: true },
    });

    if (!poolObj.data) {
      throw new Error(`Cetus pool not found: ${suiUsdcPoolId}`);
    }

    logger.info(`✓ Cetus SUI/USDC pool verified: ${suiUsdcPoolId}`);
  } catch (error) {
    logger.error('Failed to verify Cetus pool', error);
    throw error;
  }

  return { globalConfigId, suiUsdcPoolId };
}

/**
 * Resolve Turbos pool and factory IDs
 */
async function resolveTurbosAddresses(client: SuiClient): Promise<{
  factoryId: string;
  suiUsdcPoolId: string;
}> {
  logger.info('Resolving Turbos addresses...');

  // For now, use hardcoded values from environment or defaults
  // TODO: Integrate with Turbos SDK to dynamically discover pools
  const factoryId =
    process.env.TURBOS_FACTORY_ID ||
    '0x91bfbc386a41afcfd9b2533058d7e915a1d3829089cc268ff4333d54d6339ca1';

  const suiUsdcPoolId =
    process.env.TURBOS_SUI_USDC_POOL_ID ||
    '0x5eb2dfcdd1b15d2021328258f6d5ec081e9a0cdcfa9e13a0eaeb9b5f7505ca78';

  // Verify the pool exists
  try {
    const poolObj = await client.getObject({
      id: suiUsdcPoolId,
      options: { showType: true },
    });

    if (!poolObj.data) {
      throw new Error(`Turbos pool not found: ${suiUsdcPoolId}`);
    }

    logger.info(`✓ Turbos SUI/USDC pool verified: ${suiUsdcPoolId}`);
  } catch (error) {
    logger.error('Failed to verify Turbos pool', error);
    throw error;
  }

  return { factoryId, suiUsdcPoolId };
}

/**
 * Resolve Suilend market IDs
 */
async function resolveSuilendAddresses(client: SuiClient): Promise<{
  lendingMarket: string;
}> {
  logger.info('Resolving Suilend addresses...');

  // Use environment variable or query the package for market objects
  // TODO: Integrate with Suilend SDK if available
  const lendingMarket =
    process.env.SUILEND_LENDING_MARKET ||
    '0x84030d26d85eaa7035084a057f2f11f701b7e2e4eda87551becbc7c97505ece1';

  // Verify the market exists
  try {
    const marketObj = await client.getObject({
      id: lendingMarket,
      options: { showType: true },
    });

    if (!marketObj.data) {
      logger.warn(`Suilend market not found: ${lendingMarket}`);
      // Don't throw - allow startup to continue without Suilend
    } else {
      logger.info(`✓ Suilend lending market verified: ${lendingMarket}`);
    }
  } catch (error) {
    logger.warn('Failed to verify Suilend market, continuing without flashloan support', error);
  }

  return { lendingMarket };
}

/**
 * Resolve Navi storage and pool IDs
 */
async function resolveNaviAddresses(client: SuiClient): Promise<{
  storageId: string;
  usdcPoolId: string;
}> {
  logger.info('Resolving Navi addresses...');

  // Use environment variables or defaults
  // TODO: Integrate with Navi SDK if available
  const storageId =
    process.env.NAVI_STORAGE_ID ||
    '0xbb4e2f4b6205c2e2a2db47aeb4f830796ec7c005f88537ee775986639bc442fe';

  const usdcPoolId =
    process.env.NAVI_USDC_POOL_ID ||
    '0x96df0fce3c471489f4debaaa762cf960b3d97820bd1f3f025ff8190730e958c5';

  // Verify objects exist (non-critical, Navi is fallback)
  try {
    const storageObj = await client.getObject({
      id: storageId,
      options: { showType: true },
    });

    if (!storageObj.data) {
      logger.warn(`Navi storage not found: ${storageId}`);
    } else {
      logger.info(`✓ Navi storage verified: ${storageId}`);
    }
  } catch (error) {
    logger.warn('Failed to verify Navi storage, Navi fallback may not work', error);
  }

  return { storageId, usdcPoolId };
}

/**
 * Resolve all pool and market addresses at startup
 * @param client Initialized SuiClient
 * @returns Resolved addresses
 */
export async function resolvePoolAddresses(client: SuiClient): Promise<ResolvedAddresses> {
  logger.info('=== Resolving Pool and Market Addresses ===');

  try {
    // Resolve all addresses in parallel
    const [cetus, turbos, suilend, navi] = await Promise.all([
      resolveCetusAddresses(client),
      resolveTurbosAddresses(client),
      resolveSuilendAddresses(client),
      resolveNaviAddresses(client),
    ]);

    const resolved: ResolvedAddresses = {
      cetus,
      turbos,
      suilend,
      navi,
    };

    // Cache the resolved addresses
    cachedAddresses = resolved;

    // Log summary
    logger.success('=== Address Resolution Complete ===');
    logger.info('Resolved addresses:');
    logger.info(`  Cetus Global Config: ${resolved.cetus.globalConfigId}`);
    logger.info(`  Cetus SUI/USDC Pool: ${resolved.cetus.suiUsdcPoolId}`);
    logger.info(`  Turbos Factory: ${resolved.turbos.factoryId}`);
    logger.info(`  Turbos SUI/USDC Pool: ${resolved.turbos.suiUsdcPoolId}`);
    logger.info(`  Suilend Lending Market: ${resolved.suilend.lendingMarket}`);
    logger.info(`  Navi Storage: ${resolved.navi.storageId}`);

    return resolved;
  } catch (error) {
    logger.error('Failed to resolve pool addresses', error);
    throw new Error('Critical: Could not resolve necessary pool addresses');
  }
}

/**
 * Clear cached addresses (useful for testing)
 */
export function clearCachedAddresses(): void {
  cachedAddresses = null;
}
