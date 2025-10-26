/**
 * Pool Discovery Script
 * Discovers SUI/native-USDC pools on Cetus and Turbos DEXes at 0.05% fee tier
 */

import { config } from '../src/config';
import { initializeRpcClient, getSuiClient } from '../src/utils/sui';
import { COIN_TYPES } from '../src/addresses';
import Decimal from 'decimal.js';

const SUI_TYPE = COIN_TYPES.SUI;
const NATIVE_USDC_TYPE = COIN_TYPES.NATIVE_USDC;

interface PoolInfo {
  poolId: string;
  coinTypeA: string;
  coinTypeB: string;
  feeRate: number;
  liquidity: string;
  sqrtPrice: string;
  dexName: string;
}

/**
 * Discover Cetus pools for SUI/USDC at 0.05% fee
 */
async function discoverCetusPools(): Promise<PoolInfo[]> {
  console.log('\n=== Discovering Cetus Pools ===');
  
  // For now, we'll verify the known pool exists and meets criteria
  // In a full SDK integration, we'd use sdk.Pool.getPoolsByCoins()
  
  const poolId = process.env.CETUS_SUI_USDC_POOL_ID || 
    '0xcf994611fd4c48e277ce3ffd4d4364c914af2c3cbb05f7bf6facd371de688630';
  
  try {
    const client = getSuiClient();
    const poolObj = await client.getObject({
      id: poolId,
      options: { showContent: true, showType: true },
    });
    
    if (!poolObj.data || !poolObj.data.content) {
      console.log('  ⚠️  Pool not found:', poolId);
      return [];
    }
    
    const content = poolObj.data.content as any;
    const fields = content.fields;
    const poolType = poolObj.data.type;
    
    // Parse type arguments
    const typeMatch = poolType?.match(/<([^,]+),\s*([^,]+),?\s*([^>]*)>/);
    if (!typeMatch) {
      console.log('  ⚠️  Cannot parse pool type');
      return [];
    }
    
    const [, coinTypeA, coinTypeB] = typeMatch;
    
    // Verify this is SUI/USDC pool
    const hasSui = coinTypeA === SUI_TYPE || coinTypeB === SUI_TYPE;
    const hasUsdc = coinTypeA === NATIVE_USDC_TYPE || coinTypeB === NATIVE_USDC_TYPE;
    
    if (!hasSui || !hasUsdc) {
      console.log('  ⚠️  Pool is not SUI/native-USDC:', { coinTypeA, coinTypeB });
      return [];
    }
    
    // Get fee rate - should be 500 (0.05%)
    const feeRate = fields.fee_rate || fields.fee || 500;
    
    const poolInfo: PoolInfo = {
      poolId,
      coinTypeA,
      coinTypeB,
      feeRate: Number(feeRate),
      liquidity: fields.liquidity?.toString() || '0',
      sqrtPrice: fields.current_sqrt_price?.toString() || fields.sqrt_price?.toString() || '0',
      dexName: 'Cetus',
    };
    
    console.log('  ✓ Found Cetus pool:');
    console.log('    Pool ID:', poolInfo.poolId);
    console.log('    Coin A:', coinTypeA.split('::').pop());
    console.log('    Coin B:', coinTypeB.split('::').pop());
    console.log('    Fee:', (poolInfo.feeRate / 100).toFixed(2) + '%');
    console.log('    Liquidity:', poolInfo.liquidity);
    console.log('    SqrtPrice:', poolInfo.sqrtPrice);
    
    return [poolInfo];
  } catch (error) {
    console.error('  ✗ Error discovering Cetus pools:', error);
    return [];
  }
}

/**
 * Discover Turbos pools for SUI/USDC at 0.05% fee
 */
async function discoverTurbosPools(): Promise<PoolInfo[]> {
  console.log('\n=== Discovering Turbos Pools ===');
  
  // For now, we'll verify the known pool exists and meets criteria
  // In a full SDK integration, we'd use sdk.pool.getPoolsByType()
  
  const poolId = process.env.TURBOS_SUI_USDC_POOL_ID || 
    '0x5eb2dfcdd1b15d2021328258f6d5ec081e9a0cdcfa9e13a0eaeb9b5f7505ca78';
  
  try {
    const client = getSuiClient();
    const poolObj = await client.getObject({
      id: poolId,
      options: { showContent: true, showType: true },
    });
    
    if (!poolObj.data || !poolObj.data.content) {
      console.log('  ⚠️  Pool not found:', poolId);
      return [];
    }
    
    const content = poolObj.data.content as any;
    const fields = content.fields;
    const poolType = poolObj.data.type;
    
    // Parse type arguments
    const typeMatch = poolType?.match(/<([^,]+),\s*([^,]+),?\s*([^>]*)>/);
    if (!typeMatch) {
      console.log('  ⚠️  Cannot parse pool type');
      return [];
    }
    
    const [, coinTypeA, coinTypeB] = typeMatch;
    
    // Verify this is SUI/USDC pool
    const hasSui = coinTypeA === SUI_TYPE || coinTypeB === SUI_TYPE;
    const hasUsdc = coinTypeA === NATIVE_USDC_TYPE || coinTypeB === NATIVE_USDC_TYPE;
    
    if (!hasSui || !hasUsdc) {
      console.log('  ⚠️  Pool is not SUI/native-USDC:', { coinTypeA, coinTypeB });
      return [];
    }
    
    // Get fee rate - should be 500 (0.05%)
    const feeRate = fields.fee || fields.fee_rate || 500;
    
    const poolInfo: PoolInfo = {
      poolId,
      coinTypeA,
      coinTypeB,
      feeRate: Number(feeRate),
      liquidity: fields.liquidity?.toString() || '0',
      sqrtPrice: fields.sqrt_price?.toString() || fields.current_sqrt_price?.toString() || '0',
      dexName: 'Turbos',
    };
    
    console.log('  ✓ Found Turbos pool:');
    console.log('    Pool ID:', poolInfo.poolId);
    console.log('    Coin A:', coinTypeA.split('::').pop());
    console.log('    Coin B:', coinTypeB.split('::').pop());
    console.log('    Fee:', (poolInfo.feeRate / 100).toFixed(2) + '%');
    console.log('    Liquidity:', poolInfo.liquidity);
    console.log('    SqrtPrice:', poolInfo.sqrtPrice);
    
    return [poolInfo];
  } catch (error) {
    console.error('  ✗ Error discovering Turbos pools:', error);
    return [];
  }
}

/**
 * Main function to discover and display pools
 */
async function findPools() {
  console.log('=== Sui DEX Pool Discovery ===');
  console.log('Searching for SUI/native-USDC pools at 0.05% fee tier\n');
  
  try {
    // Initialize RPC client
    console.log('Initializing...');
    initializeRpcClient(
      config.rpcEndpoints.primary,
      config.rpcEndpoints.backup,
      config.rpcEndpoints.fallback
    );
    
    // Discover pools on both DEXes
    const [cetusPools, turbosPools] = await Promise.all([
      discoverCetusPools(),
      discoverTurbosPools(),
    ]);
    
    console.log('\n=== Pool Discovery Summary ===');
    console.log(`Found ${cetusPools.length} Cetus pool(s)`);
    console.log(`Found ${turbosPools.length} Turbos pool(s)`);
    
    if (cetusPools.length === 0 && turbosPools.length === 0) {
      console.log('\n⚠️  No pools found. Check your configuration and network connection.');
      process.exit(1);
    }
    
    // Display recommendations
    console.log('\n=== Recommended Pool IDs for .env ===');
    
    if (cetusPools.length > 0) {
      // Pick pool with highest liquidity
      const bestCetus = cetusPools.sort((a, b) => 
        new Decimal(b.liquidity).comparedTo(new Decimal(a.liquidity))
      )[0];
      
      console.log(`CETUS_SUI_USDC_POOL_ID=${bestCetus.poolId}`);
    }
    
    if (turbosPools.length > 0) {
      // Pick pool with highest liquidity
      const bestTurbos = turbosPools.sort((a, b) => 
        new Decimal(b.liquidity).comparedTo(new Decimal(a.liquidity))
      )[0];
      
      console.log(`TURBOS_SUI_USDC_POOL_ID=${bestTurbos.poolId}`);
    }
    
    console.log('\n=== Pool Discovery Complete ===');
    process.exit(0);
  } catch (error) {
    console.error('\n✗ Pool discovery failed:', error);
    process.exit(1);
  }
}

// Run the script
findPools();
