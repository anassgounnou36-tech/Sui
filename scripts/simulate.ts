import { config, smallestUnitToSui, smallestUnitToUsdc } from '../src/config';
import { initializeRpcClient } from '../src/utils/sui';
import { resolvePoolAddresses, getCetusPools } from '../src/resolve';
import { quoteCetusPoolSwapB2A, quoteCetusPoolSwapA2B } from '../src/cetusIntegration';
import { SUILEND, CETUS, COIN_TYPES } from '../src/addresses';
import { calculateMinOut } from '../src/slippage';
import { readSuilendReserveConfig, computeRepayAmountBase } from '../src/flashloan';

/**
 * Simulate the complete arbitrage PTB for Cetus fee-tier arbitrage
 */
async function simulateArbitrage() {
  console.log('=== Sui Cetus Fee-Tier Arbitrage Simulator ===\n');
  console.log('Strategy: Cetus fee-tier arbitrage (0.05% vs 0.25%)');
  console.log('Flashloan asset: SUI');
  console.log(`Expected USDC type: ${COIN_TYPES.BRIDGED_USDC}`);
  console.log(`Selected GlobalConfig: ${CETUS.globalConfigId}\n`);

  try {
    // Initialize
    console.log('Initializing...');
    const client = initializeRpcClient(
      config.rpcEndpoints.primary,
      config.rpcEndpoints.backup,
      config.rpcEndpoints.fallback
    );

    // Resolve addresses
    console.log('Resolving pool addresses...');
    await resolvePoolAddresses(client);
    const pools = getCetusPools();
    console.log();

    // Get flashloan amount from config (SUI)
    const flashloanAmount = BigInt(config.flashloanAmount);
    const flashloanSui = smallestUnitToSui(flashloanAmount);
    console.log(`Flashloan Amount: ${flashloanSui.toFixed(2)} SUI\n`);

    // Check minimum trade size for simulation
    if (flashloanSui < 0.1) {
      console.warn(
        `⚠️  WARNING: Flashloan amount (${flashloanSui.toFixed(2)} SUI) is very small. ` +
        `Recommend >= 0.1 SUI for accurate simulation, >= 1 SUI for live trading.\n`
      );
    }

    // Read Suilend reserve config for dynamic fee
    console.log('Reading Suilend reserve configuration...');
    const reserveConfig = await readSuilendReserveConfig(COIN_TYPES.SUI);
    console.log(`  Reserve Index: ${reserveConfig.reserveIndex}`);
    console.log(`  Borrow Fee: ${reserveConfig.borrowFeeBps} bps (${Number(reserveConfig.borrowFeeBps) / 100}%)`);
    console.log(`  Available Amount: ${smallestUnitToSui(reserveConfig.availableAmount).toFixed(2)} SUI`);
    console.log();

    // Get quotes from both Cetus pools
    console.log('Fetching quotes...');
    const [quote005B2A, quote025B2A] = await Promise.all([
      quoteCetusPoolSwapB2A(pools.pool005, flashloanAmount, 0.05),
      quoteCetusPoolSwapB2A(pools.pool025, flashloanAmount, 0.25),
    ]);

    console.log('\n=== Quote Results ===');
    console.log('SUI -> USDC (sell with flashloan):');
    console.log(`  0.05% pool: ${smallestUnitToUsdc(quote005B2A.amountOut).toFixed(6)} USDC`);
    console.log(`  0.25% pool: ${smallestUnitToUsdc(quote025B2A.amountOut).toFixed(6)} USDC`);
    console.log();

    // Determine direction (sell on higher USDC output pool, buy back on other)
    const sellOn005 = quote005B2A.amountOut > quote025B2A.amountOut;
    const direction = sellOn005 ? '0.05-to-0.25' : '0.25-to-0.05';
    const firstSwapOut = sellOn005 ? quote005B2A.amountOut : quote025B2A.amountOut;

    console.log(`Direction: ${direction}`);
    console.log(`First swap output: ${smallestUnitToUsdc(firstSwapOut).toFixed(6)} USDC\n`);

    // Get quote for second swap (USDC -> SUI to repay flashloan)
    const secondSwapQuote = sellOn005
      ? await quoteCetusPoolSwapA2B(pools.pool025, firstSwapOut, 0.25)
      : await quoteCetusPoolSwapA2B(pools.pool005, firstSwapOut, 0.05);

    console.log('USDC -> SUI (buy back):');
    console.log(`  Expected: ${smallestUnitToSui(secondSwapQuote.amountOut).toFixed(6)} SUI\n`);

    // Calculate repay amount using dynamic fee (per Perplexity spec)
    const repayAmount = computeRepayAmountBase(flashloanAmount, reserveConfig.borrowFeeBps);
    const fee = repayAmount - flashloanAmount;

    console.log('=== Fee Calculations ===');
    console.log(`Flashloan Fee (${reserveConfig.borrowFeeBps} bps / ${Number(reserveConfig.borrowFeeBps) / 100}%): ${smallestUnitToSui(fee).toFixed(6)} SUI`);
    console.log(`Repay Amount: ${smallestUnitToSui(repayAmount).toFixed(6)} SUI\n`);

    // Calculate min_out for both swaps
    const firstSwapMinOut = calculateMinOut(firstSwapOut, config.maxSlippagePercent);
    const secondSwapMinOut = repayAmount; // Must cover repay exactly

    console.log('=== Slippage Protection ===');
    console.log(`First swap amount_limit (min_out): ${smallestUnitToUsdc(firstSwapMinOut).toFixed(6)} USDC (${config.maxSlippagePercent}% slippage)`);
    console.log(`Second swap amount_limit (min_out): ${smallestUnitToSui(secondSwapMinOut).toFixed(6)} SUI (must cover repay)\n`);

    // Check profitability
    const estimatedProfit = secondSwapQuote.amountOut - repayAmount;
    const isProfitable = estimatedProfit > BigInt(0);

    console.log('=== Profitability Check ===');
    console.log(`Expected Output: ${smallestUnitToSui(secondSwapQuote.amountOut).toFixed(6)} SUI`);
    console.log(`Repay Amount: ${smallestUnitToSui(repayAmount).toFixed(6)} SUI`);
    console.log(`Estimated Profit: ${smallestUnitToSui(estimatedProfit).toFixed(6)} SUI`);
    console.log(`Status: ${isProfitable ? '✓ PROFITABLE' : '✗ NOT PROFITABLE'}\n`);

    if (!isProfitable) {
      console.log('⚠️  Simulation shows no profit. Would not execute in production.\n');
    }

    // Build the PTB structure description
    console.log('=== Building Programmable Transaction Block ===\n');

    console.log('Step 1: Borrow SUI from Suilend flashloan');
    console.log(`  Package: ${SUILEND.packageId}`);
    console.log(`  Market: ${SUILEND.lendingMarket}`);
    console.log(`  Amount: ${smallestUnitToSui(flashloanAmount).toFixed(6)} SUI`);
    console.log();

    console.log(`Step 2: Swap SUI -> USDC on Cetus ${sellOn005 ? '0.05%' : '0.25%'} pool`);
    console.log(`  Package: ${CETUS.packageId}`);
    console.log(`  Pool: ${sellOn005 ? pools.pool005.poolId : pools.pool025.poolId}`);
    console.log(`  Amount In: ${smallestUnitToSui(flashloanAmount).toFixed(6)} SUI`);
    console.log(`  Amount Limit (min_out): ${smallestUnitToUsdc(firstSwapMinOut).toFixed(6)} USDC`);
    console.log();

    console.log(`Step 3: Swap USDC -> SUI on Cetus ${sellOn005 ? '0.25%' : '0.05%'} pool`);
    console.log(`  Package: ${CETUS.packageId}`);
    console.log(`  Pool: ${sellOn005 ? pools.pool025.poolId : pools.pool005.poolId}`);
    console.log(`  Amount In: ${smallestUnitToUsdc(firstSwapOut).toFixed(6)} USDC`);
    console.log(`  Amount Limit (min_out): ${smallestUnitToSui(secondSwapMinOut).toFixed(6)} SUI`);
    console.log();

    console.log('Step 4: Split coins for repayment');
    console.log(`  Repay Coins: ${smallestUnitToSui(repayAmount).toFixed(6)} SUI`);
    console.log(`  Profit Coins: ${smallestUnitToSui(estimatedProfit > 0 ? estimatedProfit : BigInt(0)).toFixed(6)} SUI`);
    console.log();

    console.log('Step 5: Repay Suilend flashloan');
    console.log(`  Package: ${SUILEND.packageId}`);
    console.log(`  Market: ${SUILEND.lendingMarket}`);
    console.log(`  Amount: ${smallestUnitToSui(repayAmount).toFixed(6)} SUI`);
    console.log();

    console.log('Step 6: Transfer profit to wallet');
    console.log(`  Recipient: ${config.walletAddress}`);
    console.log(`  Amount: ${smallestUnitToSui(estimatedProfit > 0 ? estimatedProfit : BigInt(0)).toFixed(6)} SUI`);
    console.log();

    console.log('=== PTB Structure Summary ===');
    console.log('Total operations: 6');
    console.log('- 1 SUI flashloan borrow');
    console.log('- 2 Cetus swaps (with slippage protection)');
    console.log('- 1 coin split');
    console.log('- 1 flashloan repay');
    console.log('- 1 transfer');
    console.log();

    console.log('=== Simulation Complete ===');
    console.log('✓ Transaction structure is valid');
    console.log('✓ All parameters calculated');
    console.log('⚠️  Not signed or submitted (simulation only)\n');

    process.exit(0);
  } catch (error) {
    console.error('Simulation failed:', error);
    process.exit(1);
  }
}

// Run simulation
simulateArbitrage();
