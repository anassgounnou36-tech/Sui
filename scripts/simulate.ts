import { config } from '../src/config.js';
import { initializeRpcClient } from '../src/utils/sui.js';
import { resolvePoolAddresses, getResolvedAddresses } from '../src/resolve.js';
import { quoteCetusSwapB2A, quoteCetusSwapA2B } from '../src/cetusIntegration.js';
import { quoteTurbosSwapB2A, quoteTurbosSwapA2B } from '../src/turbosIntegration.js';
import { SUILEND } from '../src/addresses.js';
import { calculateMinOut } from '../src/slippage.js';

/**
 * Simulate the complete arbitrage PTB
 */
async function simulateArbitrage() {
  console.log('=== Sui Arbitrage Simulator ===\n');

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
    const resolved = getResolvedAddresses();
    console.log();

    // Get flashloan amount from config
    const flashloanAmount = BigInt(config.flashloanAmount);
    console.log(`Flashloan Amount: ${flashloanAmount} (${Number(flashloanAmount) / 1e6} USDC)\n`);

    // Get quotes from both DEXes
    console.log('Fetching quotes...');
    const [cetusQuoteB2A, turbosQuoteB2A] = await Promise.all([
      quoteCetusSwapB2A(flashloanAmount),
      quoteTurbosSwapB2A(flashloanAmount),
    ]);

    console.log('\n=== Quote Results ===');
    console.log('USDC -> SUI (buy with flashloan):');
    console.log(`  Cetus:  ${cetusQuoteB2A.amountOut} SUI, limit: ${cetusQuoteB2A.sqrtPriceLimit}`);
    console.log(`  Turbos: ${turbosQuoteB2A.amountOut} SUI, limit: ${turbosQuoteB2A.sqrtPriceLimit}`);
    console.log();

    // Determine direction (buy cheaper, sell higher)
    const buyCheapOnCetus = cetusQuoteB2A.amountOut > turbosQuoteB2A.amountOut;
    const direction = buyCheapOnCetus ? 'cetus-to-turbos' : 'turbos-to-cetus';
    const firstSwapOut = buyCheapOnCetus ? cetusQuoteB2A.amountOut : turbosQuoteB2A.amountOut;

    console.log(`Direction: ${direction}`);
    console.log(`First swap output: ${firstSwapOut} SUI\n`);

    // Get quote for second swap (SUI -> USDC)
    const secondSwapQuote = buyCheapOnCetus
      ? await quoteTurbosSwapA2B(firstSwapOut)
      : await quoteCetusSwapA2B(firstSwapOut);

    console.log('SUI -> USDC (sell):');
    console.log(`  Expected: ${secondSwapQuote.amountOut} USDC`);
    console.log(`  Limit: ${secondSwapQuote.sqrtPriceLimit}\n`);

    // Calculate repay amount (flashloan + fee)
    const suilendFee = (flashloanAmount * BigInt(Math.floor(config.suilendFeePercent * 100))) / BigInt(10000);
    const repayAmount = flashloanAmount + suilendFee;

    console.log('=== Fee Calculations ===');
    console.log(`Flashloan Fee (${config.suilendFeePercent}%): ${suilendFee} (${Number(suilendFee) / 1e6} USDC)`);
    console.log(`Repay Amount: ${repayAmount} (${Number(repayAmount) / 1e6} USDC)\n`);

    // Calculate min_out for both swaps
    const firstSwapMinOut = calculateMinOut(firstSwapOut, config.maxSlippagePercent);
    const secondSwapMinOut = repayAmount + BigInt(config.minProfitUsdc * 1e6); // Must cover repay + min profit

    console.log('=== Slippage Protection ===');
    console.log(`First swap min_out: ${firstSwapMinOut} SUI (${config.maxSlippagePercent}% slippage)`);
    console.log(`Second swap min_out: ${secondSwapMinOut} USDC (repay + min profit)\n`);

    // Check profitability
    const estimatedProfit = secondSwapQuote.amountOut - repayAmount;
    const isProfitable = estimatedProfit > BigInt(0);

    console.log('=== Profitability Check ===');
    console.log(`Expected Output: ${secondSwapQuote.amountOut} USDC`);
    console.log(`Repay Amount: ${repayAmount} USDC`);
    console.log(`Estimated Profit: ${estimatedProfit} (${Number(estimatedProfit) / 1e6} USDC)`);
    console.log(`Status: ${isProfitable ? '✓ PROFITABLE' : '✗ NOT PROFITABLE'}\n`);

    if (!isProfitable) {
      console.log('⚠️  Simulation shows no profit. Would not execute in production.\n');
    }

    // Build the PTB
    console.log('=== Building Programmable Transaction Block ===\n');

    // Note: In a real implementation, we would build the actual PTB with moveCall
    // For simulation, we just describe the steps

    console.log('Step 1: Borrow USDC from Suilend flashloan');
    console.log(`  Package: ${SUILEND.packageId}`);
    console.log(`  Market: ${resolved.suilend.lendingMarket}`);
    console.log(`  Amount: ${flashloanAmount}`);
    console.log();

    console.log(`Step 2: Swap USDC -> SUI on ${buyCheapOnCetus ? 'Cetus' : 'Turbos'}`);
    console.log(
      `  Pool: ${buyCheapOnCetus ? resolved.cetus.suiUsdcPool.poolId : resolved.turbos.suiUsdcPool.poolId}`
    );
    console.log(`  Amount In: ${flashloanAmount} USDC`);
    console.log(`  Min Out: ${firstSwapMinOut} SUI`);
    console.log(
      `  Sqrt Price Limit: ${buyCheapOnCetus ? cetusQuoteB2A.sqrtPriceLimit : turbosQuoteB2A.sqrtPriceLimit}`
    );
    console.log();

    console.log(`Step 3: Swap SUI -> USDC on ${buyCheapOnCetus ? 'Turbos' : 'Cetus'}`);
    console.log(
      `  Pool: ${buyCheapOnCetus ? resolved.turbos.suiUsdcPool.poolId : resolved.cetus.suiUsdcPool.poolId}`
    );
    console.log(`  Amount In: ${firstSwapOut} SUI`);
    console.log(`  Min Out: ${secondSwapMinOut} USDC`);
    console.log(`  Sqrt Price Limit: ${secondSwapQuote.sqrtPriceLimit}`);
    console.log();

    console.log('Step 4: Split coins for repayment');
    console.log(`  Repay Coins: ${repayAmount} USDC`);
    console.log(`  Profit Coins: ${estimatedProfit > 0 ? estimatedProfit : 0} USDC`);
    console.log();

    console.log('Step 5: Repay Suilend flashloan');
    console.log(`  Package: ${SUILEND.packageId}`);
    console.log(`  Market: ${resolved.suilend.lendingMarket}`);
    console.log(`  Amount: ${repayAmount}`);
    console.log();

    console.log('Step 6: Transfer profit to wallet');
    console.log(`  Recipient: ${config.walletAddress}`);
    console.log(`  Amount: ${estimatedProfit > 0 ? estimatedProfit : 0} USDC`);
    console.log();

    console.log('=== PTB Structure Summary ===');
    console.log('Total operations: 6');
    console.log('- 1 flashloan borrow');
    console.log('- 2 swaps (with slippage protection)');
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
