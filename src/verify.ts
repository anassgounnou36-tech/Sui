import { getSuiClient, objectExists } from './utils/sui';
import { logger } from './logger';
import { ALL_ADDRESSES, SUILEND, NAVI, CETUS, TURBOS, COIN_TYPES } from './addresses';
import { config } from './config';

interface VerificationResult {
  success: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Verify a single object ID exists on-chain
 */
async function verifyObjectId(
  name: string,
  objectId: string,
  critical: boolean = true
): Promise<{ exists: boolean; error?: string; warning?: string }> {
  try {
    logger.debug(`Verifying ${name}: ${objectId}`);
    const exists = await objectExists(objectId);

    if (!exists) {
      const message = `${name} not found on-chain: ${objectId}`;
      if (critical) {
        return { exists: false, error: message };
      } else {
        return { exists: false, warning: message };
      }
    }

    logger.debug(`✓ ${name} verified: ${objectId}`);
    return { exists: true };
  } catch (error) {
    const message = `Failed to verify ${name}: ${error}`;
    if (critical) {
      return { exists: false, error: message };
    } else {
      return { exists: false, warning: message };
    }
  }
}

/**
 * Verify all critical on-chain addresses
 */
export async function verifyOnChainAddresses(): Promise<VerificationResult> {
  const result: VerificationResult = {
    success: true,
    errors: [],
    warnings: [],
  };

  logger.info('Starting on-chain address verification...');

  // Verify Suilend addresses (critical)
  const suilendChecks = [
    verifyObjectId('Suilend Package', SUILEND.packageId, true),
    verifyObjectId('Suilend Market', SUILEND.marketObjectId, true),
    verifyObjectId('Suilend Lending Market', SUILEND.lendingMarket, true),
  ];

  // Verify Navi addresses (non-critical, as it's a fallback)
  const naviChecks = [
    verifyObjectId('Navi Package', NAVI.packageId, false),
    verifyObjectId('Navi Storage', NAVI.storageId, false),
    verifyObjectId('Navi USDC Pool', NAVI.usdcPoolId, false),
  ];

  // Verify Cetus addresses (critical)
  const cetusChecks = [
    verifyObjectId('Cetus Package', CETUS.packageId, true),
    verifyObjectId('Cetus Global Config', CETUS.globalConfigId, true),
    verifyObjectId('Cetus SUI/USDC Pool', CETUS.suiUsdcPoolId, true),
  ];

  // Verify Turbos addresses (critical)
  const turbosChecks = [
    verifyObjectId('Turbos Package', TURBOS.packageId, true),
    verifyObjectId('Turbos SUI/USDC Pool', TURBOS.suiUsdcPoolId, true),
  ];

  // Run all checks
  const allChecks = [
    ...suilendChecks,
    ...naviChecks,
    ...cetusChecks,
    ...turbosChecks,
  ];

  const checkResults = await Promise.all(allChecks);

  // Process results
  for (const checkResult of checkResults) {
    if (checkResult.error) {
      result.errors.push(checkResult.error);
      result.success = false;
    }
    if (checkResult.warning) {
      result.warnings.push(checkResult.warning);
    }
  }

  // Summary
  if (result.success) {
    logger.success('✓ All critical on-chain addresses verified successfully');
  } else {
    logger.error('✗ On-chain address verification failed');
    result.errors.forEach((error) => logger.error(`  - ${error}`));
  }

  if (result.warnings.length > 0) {
    logger.warn('Warnings during verification:');
    result.warnings.forEach((warning) => logger.warn(`  - ${warning}`));
  }

  return result;
}

/**
 * Verify package module visibility (where feasible)
 */
async function verifyPackageModule(
  packageId: string,
  moduleName: string
): Promise<boolean> {
  try {
    const client = getSuiClient();
    const pkg = await client.getObject({
      id: packageId,
      options: {
        showContent: true,
      },
    });

    // Basic check - just verify package exists
    // More detailed module checks would require parsing package contents
    return pkg.data !== null;
  } catch (error) {
    logger.debug(`Could not verify package module ${moduleName}: ${error}`);
    return false;
  }
}

/**
 * Run full startup verification routine
 */
export async function runStartupVerification(): Promise<void> {
  logger.info('=== Starting Startup Verification ===');

  // Check if verification is enabled
  if (!config.verifyOnChain) {
    logger.warn('On-chain verification is disabled (VERIFY_ON_CHAIN=false)');
    return;
  }

  try {
    // Verify on-chain addresses
    const verificationResult = await verifyOnChainAddresses();

    if (!verificationResult.success) {
      logger.error('Critical verification failures detected');

      // Hard fail if configured
      if (config.verifyOnChain) {
        throw new Error(
          'Startup verification failed. Please check your address configuration.'
        );
      }
    }

    // Additional sanity checks
    logger.info('Running sanity checks...');

    // Check that coin types are defined
    if (!COIN_TYPES.SUI || !COIN_TYPES.USDC) {
      throw new Error('Coin types not properly configured');
    }

    logger.info(`SUI coin type: ${COIN_TYPES.SUI}`);
    logger.info(`USDC coin type: ${COIN_TYPES.USDC}`);

    // Verify client connectivity
    try {
      const client = getSuiClient();
      const chainId = await client.getChainIdentifier();
      logger.info(`Connected to Sui network: ${chainId}`);
    } catch (error) {
      logger.error('Failed to connect to Sui RPC', error);
      throw new Error('Cannot connect to Sui RPC endpoint');
    }

    logger.success('=== Startup Verification Complete ===');
  } catch (error) {
    logger.error('Startup verification failed', error);
    throw error;
  }
}

/**
 * Quick health check (can be run periodically)
 */
export async function healthCheck(): Promise<boolean> {
  try {
    const client = getSuiClient();

    // Try to fetch latest checkpoint
    const checkpoint = await client.getLatestCheckpointSequenceNumber();

    logger.debug(`Health check passed. Latest checkpoint: ${checkpoint}`);
    return true;
  } catch (error) {
    logger.error('Health check failed', error);
    return false;
  }
}
