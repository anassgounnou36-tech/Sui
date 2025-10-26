# Sui Flashloan Arbitrage Bot

A production-ready TypeScript bot that performs atomic spot-to-spot arbitrage between Cetus and Turbos DEXes on Sui Mainnet, using Suilend flashloans (with Navi as fallback).

## Features

### Core Functionality
- **Atomic Transactions**: All operations in a single Programmable Transaction Block (PTB)
- **Flashloan Funded**: Uses Suilend flashloans (0.05% fee) with automatic Navi fallback (0.06%)
- **Multi-DEX Arbitrage**: Real-time price monitoring between Cetus and Turbos CLMM pools
- **Real SDK Integration**: Uses actual pool state and sqrtPrice calculations from on-chain data
- **Native USDC Support**: Uses native mainnet USDC (6 decimals)

### Safety & Risk Management
- **Multi-RPC Failover**: Automatic failover between 3 RPC endpoints for reliability
- **Slippage Protection**: Hard 1% maximum slippage cap with sqrt_price_limit enforcement
- **Profit Verification**: On-chain verification that profit >= MIN_PROFIT_USDC
- **Kill Switch**: Automatic shutdown after 3 consecutive failed executions
- **BigInt Math**: All calculations use BigInt to prevent precision loss
- **Live Confirmation**: Safety check prevents accidental large-amount executions (>100k USDC)

### Operational Features
- **Dynamic Pool Resolution**: Automatically discovers and verifies pool IDs at startup
- **Rate Limiting**: Max 1 tx per 3 seconds, max 5 pending transactions
- **Spread Confirmation**: Requires 2 consecutive intervals with sufficient spread
- **JSON Event Logging**: Structured logging for trade events, profits, and errors
- **Dry Run Mode**: Full simulation without signing or submitting transactions
- **Docker Support**: Production-ready containerized deployment

## Prerequisites

- Node.js 20.0.0 or higher
- Docker and Docker Compose (for containerized deployment)
- A Sui wallet with:
  - SUI tokens for gas fees (minimum 0.1 SUI recommended)
  - No USDC needed initially (flashloan funded)
- Multi-RPC access to Sui Mainnet (provided by default)

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd sui-flashloan-arbitrage-bot

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your configuration
nano .env
```

## Configuration

The bot uses environment variables for configuration. See `.env.example` for all available options.

### Essential Configuration

```env
# Multi-RPC Configuration (automatic failover)
SUI_RPC_MAINNET_PRIMARY=https://sui-mainnet.public.blastapi.io
SUI_RPC_MAINNET_BACKUP=https://1rpc.io/sui
SUI_RPC_MAINNET_FALLBACK=https://sui.rpc.grove.city/v1/01fdb492

# Wallet Configuration
PRIVATE_KEY=your_private_key_here  # Supports hex (with/without 0x) or base64
WALLET_ADDRESS=0x_your_wallet_address_here

# Start small for testing!
FLASHLOAN_AMOUNT=10000000  # 10 USDC (6 decimals)
MIN_PROFIT_USDC=0.1        # Minimum profit: $0.10
MIN_SPREAD_PERCENT=0.5     # Require 0.5% spread
MAX_SLIPPAGE_PERCENT=1.0   # Max 1% slippage (hard cap)
```

### Advanced Configuration

```env
# Safety
LIVE_CONFIRM=false              # MUST be true for amounts >100k USDC
MAX_CONSECUTIVE_FAILURES=3      # Kill switch threshold
CONSECUTIVE_SPREAD_REQUIRED=2   # Confirmations before execution

# Monitoring
CHECK_INTERVAL_MS=5000          # Price check interval
FINALITY_POLL_INTERVAL_MS=500   # TX finality check interval
FINALITY_MAX_WAIT_MS=10000      # Max wait for finality

# Verification
VERIFY_ON_CHAIN=true            # Verify pool IDs at startup (recommended)

# Dry Run
DRY_RUN=false                   # Set to true for simulation mode
```

### Coin Types and Package IDs

The bot uses these mainnet addresses by default (can be overridden via env vars):

- **Native USDC (Recommended)**: `0xaf8cd5edc19637e05da0dd46f6ddb1a8b81cc532fcccf6d5d41ba77bba6eddd5::coin::COIN` (6 decimals)
- **Wormhole USDC (NOT Recommended)**: `0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN` (6 decimals)
  - ⚠️ **WARNING**: Using Wormhole wrapped USDC requires setting `ALLOW_WRAPPED_USDC=true`. Native USDC is strongly recommended for arbitrage.
- **SUI**: `0x2::sui::SUI` (9 decimals)
- **Cetus CLMM**: `0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb`
- **Turbos CLMM**: `0x91bfbc386a41afcfd9b2533058d7e915a1d3829089cc268ff4333d54d6339ca1`
- **Suilend**: `0x902f7ee4a68f6f63b05acd66e7aacc6de72703da4d8e0c6f94c1dd4b73c62e85`
- **Navi**: `0x06d8af64fe58327e9f2b7b33b9fad9a5d0f0fb1ba38b024de09c767c10241e42`

**Pool Discovery**: Pool IDs for SUI/USDC pairs are resolved dynamically at startup using the SDKs. The resolver:
- Discovers pools based on coin types and 0.05% fee tier
- Validates coin ordering in pools (SUI vs USDC as coin A or B)
- Extracts current sqrtPrice and liquidity for accurate quotes
- Verifies all pool IDs exist on-chain before trading

This ensures the bot always uses the correct pools with proper coin ordering, preventing price calculation errors.

## Build

```bash
npm run build
```

## Usage

### 1. Discover Pool Addresses

```bash
npm run find-pools
```

Discovers and displays all DEX pool addresses and lending market IDs from on-chain data. Shows:
- Cetus and Turbos SUI/USDC pool IDs
- Pool metadata (coin types, fee tiers, liquidity)
- Suilend and Navi lending market addresses
- Environment variable overrides for custom configurations

Useful for verifying pool configurations before trading.

### 2. Check Current Spreads (No Trading)

```bash
npm run spread
```

Shows current executable prices from both DEXes at your configured flashloan size, with spread analysis and profitability estimation. No trades executed.

### 3. Simulate Full Arbitrage (No Signing)

```bash
npm run simulate
```

Builds the complete PTB with:
- Flashloan borrow
- Both swaps with min_out and sqrt_price_limit
- Repay amount calculations
- Profit projections

Does not sign or submit - safe to run anytime.

### 4. Dry Run Mode (Build But Don't Execute)

```bash
npm run dry-run
```

Runs the full monitoring loop with real price checks, but constructs PTBs without signing or submitting. Useful for testing the monitoring logic.

### 5. Live Trading

⚠️ **Safety Checklist Before Going Live:**

- [ ] Verify wallet address is correct
- [ ] Start with tiny amount (10 USDC)
- [ ] Run `npm run find-pools` to verify pool addresses
- [ ] Run `npm run spread` to check current market
- [ ] Run `npm run simulate` to verify PTB construction
- [ ] Monitor first few trades manually
- [ ] Check transactions on [Suiscan](https://suiscan.xyz)
- [ ] Set up monitoring/alerts
- [ ] Have a kill switch ready (Ctrl+C)

```bash
npm start
```

### 6. Docker Deployment

Build and run in Docker:

```bash
# Build the image
docker build -t sui-arbitrage-bot .

# Run with docker-compose
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

The Docker deployment:
- Runs as non-root user
- Includes health checks
- Persists logs to ./logs
- Has resource limits (1 CPU, 1GB RAM)
- Auto-restarts on failure

### 3. Live Trading

⚠️ **Safety Checklist Before Going Live:**

- [ ] Verify wallet address is correct
- [ ] Start with tiny amount (10 USDC)
- [ ] Run `npm run spread` to check current market
- [ ] Run `npm run simulate` to verify PTB construction
- [ ] Monitor first few trades manually
- [ ] Check transactions on [Suiscan](https://suiscan.xyz)
- [ ] Set up monitoring/alerts
- [ ] Have a kill switch ready (Ctrl+C)

```bash
npm start
```

## Safety and Risk Management

### Built-in Protections

1. **Native USDC Enforcement**: Rejects Wormhole wrapped USDC by default (requires explicit `ALLOW_WRAPPED_USDC=true` override)
2. **Pre-Execution Validation**: Validates opportunities with real quotes before building transactions:
   - Ensures quote outputs are valid (not zero/negative)
   - Calculates total costs including all fees
   - Verifies second swap output covers repay + minProfit
   - Rejects opportunities early if validation fails
3. **Price Sanity Checks**: Rejects prices outside reasonable bounds (0.01-5.0 USDC/SUI) to prevent calculation errors
4. **Multi-RPC Failover**: Automatic failover to backup RPCs if primary fails
5. **Slippage Cap**: Hard 1% maximum with sqrt_price_limit enforcement on both swaps
6. **Coin Ordering Validation**: Automatically determines correct A->B or B->A direction based on pool coin ordering
7. **Profit Verification**: On-chain verification that output >= repay + minProfit using min_amount_out
8. **Atomic Execution**: All steps in one PTB - either all succeed or all revert
9. **Rate Limiting**: Max 1 tx per 3 seconds, max 5 pending
10. **Spread Confirmation**: Requires 2 consecutive ticks with sufficient spread
11. **Kill Switch**: Auto-shutdown after 3 consecutive failures
12. **Dynamic Pool Resolution**: Discovers and verifies all pool IDs exist on-chain before starting
13. **BigInt Math**: No precision loss even with large amounts
14. **Live Confirmation Gate**: Blocks >100k USDC without explicit confirmation

### Fee Structure

All fees are paid from the flashloan proceeds:

- **Flashloan Fee**: 0.05% (Suilend) or 0.06% (Navi fallback)
- **Swap Fees**: 0.05% per swap on SUI/USDC 0.05% fee tier pools
- **Total Cost**: ~0.15% minimum (0.05% flashloan + 0.05% × 2 swaps)
- **Breakeven**: Need >0.15% spread; default minimum is 0.5%
- **Gas**: ~0.1-0.5 SUI per transaction (~$0.30-1.50 at $3/SUI)

### Recommended Testing Progression

Test in production with increasing amounts:

1. **Day 1-7**: 10 USDC - verify basic functionality
2. **Week 2-3**: 50-100 USDC - confirm stable operation
3. **Month 2**: 500-1,000 USDC - scale gradually
4. **Month 3+**: Up to 50k USDC - only after proven stability
5. **Never**: Don't go above 5M USDC (protocol limits)

Monitor success rate, gas costs, and net profit at each level.

### Emergency Procedures

**Kill Switch**: 

- `Ctrl+C` or `docker-compose down` for graceful shutdown
- Bot completes pending transaction before exit
- Automatic shutdown after 3 consecutive failures

**If Bot Misbehaves**:

1. Stop immediately: `Ctrl+C` or `docker-compose down`
2. Check logs in `./logs/` directory
3. Review last transactions on Suiscan
4. Adjust configuration before restarting
5. Consider running `npm run simulate` first

## Monitoring and Operations

### Log Files

Logs are written to:
- **Console**: Real-time stdout
- **File**: `logs/bot-YYYY-MM-DD.log` (rotating daily, max 10 files)
- **JSON Events**: Trade events logged as JSON for parsing

### Key Metrics to Monitor

- **Spread Detection**: How often profitable spreads appear
- **Success Rate**: % of successful vs failed executions
- **Profit Per Trade**: Average and total profits
- **Gas Costs**: Total SUI spent on gas
- **Failed Transactions**: Reasons for failures
- **RPC Failovers**: Frequency of RPC switching

### Logs Location

```bash
# View today's log
tail -f logs/bot-$(date +%Y-%m-%d).log

# Search for trade events
grep "TRADE" logs/*.log | jq .

# View errors only
grep "ERROR" logs/*.log
```

### Common Issues and Solutions

**No spreads detected**: 
- Market is efficient, spreads below threshold
- Try lowering MIN_SPREAD_PERCENT (but watch profitability)
- Increase CHECK_INTERVAL_MS to catch fleeting opportunities

**Transaction failed - slippage exceeded**: 
- Price moved too fast between quote and execution
- Market volatility too high
- Consider lowering MAX_SLIPPAGE_PERCENT or FLASHLOAN_AMOUNT

**RPC connection errors**:
- Multi-RPC failover should handle automatically
- Check if all 3 RPC endpoints are accessible
- Verify firewall/network settings

**Insufficient balance for gas**:
- Need at least 0.1 SUI for gas fees
- Bot will warn on startup if SUI balance is low

**Kill switch activated**:
- Review logs to understand failure cause
- Fix configuration or wait for better market conditions
- Bot protects you from repeated failures

## Project Structure

```
sui-flashloan-arbitrage-bot/
├── src/
│   ├── index.ts              # Main monitoring loop
│   ├── config.ts             # Configuration and validation
│   ├── logger.ts             # Logging system with JSON events
│   ├── addresses.ts          # On-chain contract addresses
│   ├── poolResolver.ts       # Dynamic pool ID resolution
│   ├── cetusIntegration.ts   # Cetus DEX with real quotes
│   ├── turbosIntegration.ts  # Turbos DEX with real quotes
│   ├── verify.ts             # Startup verification
│   ├── flashloan.ts          # Suilend/Navi flashloan wrappers
│   ├── executor.ts           # PTB execution logic
│   ├── slippage.ts           # Slippage calculations
│   └── utils/
│       └── sui.ts            # Sui RPC client with failover
├── scripts/
│   ├── print-spread.ts       # Price monitoring script
│   └── simulate.ts           # PTB simulation script
├── logs/                     # Log files (auto-generated)
├── Dockerfile                # Production Docker image
├── docker-compose.yml        # Docker Compose configuration
├── .dockerignore
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
└── README.md
```

## Development

```bash
# Type checking
npm run typecheck

# Linting
npm run lint

# Formatting
npm run format

# Build
npm run build
```

## Architecture

### Arbitrage Flow

1. **Initialization**: 
   - Connect to multi-RPC endpoints with automatic failover
   - Validate USDC coin type (native vs wrapped) with ALLOW_WRAPPED_USDC guard
   - Use resolver module (src/resolve.ts) to discover pool IDs dynamically:
     - Query Cetus and Turbos SDKs for SUI/USDC 0.05% fee tier pools
     - Extract coin ordering (which is A, which is B) from pool types
     - Verify all pool IDs exist on-chain
     - Cache resolved metadata (poolId, coinTypes, sqrtPrice, liquidity)
   - Verify package IDs and critical objects
   
2. **Monitoring Loop**:
   - Fetch executable quotes at configured flashloan size from both DEXes
   - Calculate price from actual sqrtPrice with proper coin ordering
   - Apply sanity checks: reject prices outside 0.01-5.0 USDC/SUI range
   - Require 2 consecutive intervals above MIN_SPREAD_PERCENT
   
3. **Pre-Execution Validation**:
   - Get real quotes from both DEXes at actual trade size
   - Verify quote outputs are valid (not zero/negative)
   - Calculate total costs: flashloan fee + 2 swap fees + slippage
   - Ensure second swap output covers repay + minProfit
   - Reject opportunity early if validation fails
   
4. **Execution** (when validated):
   - Borrow USDC via Suilend flashloan (Navi fallback)
   - Build first swap using integration module:
     - Determine correct a2b direction based on pool coin ordering
     - Apply min_out with slippage protection
     - Set sqrt_price_limit from quote
   - Build second swap:
     - Set min_out = repayAmount + minProfit (hard requirement)
     - Use quote-derived sqrt_price_limit
   - Split coins: repay exact amount, send profit to wallet
   - All in single atomic PTB
   
5. **Safety Checks Throughout**:
   - Price sanity: 0.01 ≤ price ≤ 5.0 USDC/SUI
   - Quote validity: output > 0
   - Profitability: secondSwap.out ≥ repay + minProfit
   - Slippage: both swaps protected with limits
   - Rate limit: 1 tx per 3s, max 5 pending
   - Kill switch: after 3 consecutive failures

### Key Design Decisions

- **Native USDC First**: Default to native USDC with explicit guard against wrapped tokens
- **Pre-Execution Validation**: Validate opportunities with real quotes before building PTBs
- **Coin Ordering Aware**: Automatically handle different coin orderings in pools (SUI/USDC vs USDC/SUI)
- **Price Sanity Checks**: Reject implausible prices (< $0.01 or > $5.00 per SUI) to prevent errors
- **BigInt Throughout**: No Number conversions to prevent precision loss
- **Dynamic Resolution**: Pool IDs discovered at startup using SDKs, not hardcoded
- **Real Quotes**: Calculate from actual sqrtPrice with proper decimal adjustments
- **Quote-Based Execution**: Use SDK quote results for min_out and sqrt_price_limit values
- **Multi-RPC**: Automatic failover for reliability
- **Atomic PTBs**: All-or-nothing execution
- **Structured Logging**: JSON events for monitoring/alerting

## License

MIT License - See LICENSE file for details

## Disclaimer

**Use at your own risk.** This bot interacts with DeFi protocols and executes real financial transactions on Sui Mainnet. Always:

- **Start with tiny amounts** (10 USDC) and scale gradually
- **Understand the code** before running in production
- **Monitor actively** during initial runs and scale-up
- **Be aware of risks**: Smart contract risks, market risks, execution risks
- **Never commit private keys** to version control
- **Use testnet first** if available for your testing
- **Set LIVE_CONFIRM=true** for amounts >100k USDC

The bot includes multiple safety features (kill switch, slippage caps, rate limiting, etc.) but cannot eliminate all risks. Market conditions can change rapidly. DeFi protocols may have bugs or vulnerabilities. You are responsible for all trades executed.

**The authors and contributors assume no liability for any losses incurred.**

## Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Test thoroughly with dry-run and small amounts
4. Submit a pull request with clear description

## Troubleshooting

### Build and Installation Issues

**Problem**: TypeScript build errors with "Cannot find module" or import errors
- **Solution**: Ensure you're using Node.js 20.0.0 or higher. Run `node --version` to check.
- **Solution**: Delete `node_modules` and `package-lock.json`, then run `npm install` again.
- **Solution**: Verify that the project has `"type": "module"` in package.json for ESM support.

**Problem**: Running scripts fails with "ERR_MODULE_NOT_FOUND"
- **Solution**: Run `npm run build` first to compile TypeScript to JavaScript.
- **Solution**: Check that import statements in TypeScript files include `.js` extensions for relative imports.

**Problem**: Decimal.js constructor errors during build
- **Solution**: Ensure you're using the named import syntax: `import { Decimal } from 'decimal.js';` instead of the default import `import Decimal from 'decimal.js';`.

### Runtime Issues

**Problem**: "fetch failed" or network connection errors
- **Solution**: Check your internet connection and ensure RPC endpoints are accessible.
- **Solution**: Try alternative RPC endpoints in your `.env` file.
- **Solution**: Some networks may block certain domains. Verify firewall settings.

**Problem**: "TypeError: Cannot read property" or similar runtime errors
- **Solution**: Ensure all required environment variables are set in `.env` file.
- **Solution**: Run `mkdir logs` to create the logs directory if it doesn't exist.
- **Solution**: For dry-run testing, set `DRY_RUN=true` and `VERIFY_ON_CHAIN=false` in `.env`.

**Problem**: Scripts timeout or hang
- **Solution**: This may be due to network latency. Increase timeout values in the CI workflow if running in CI.
- **Solution**: Verify RPC endpoints are responsive: `curl -X POST <RPC_URL> -H "Content-Type: application/json"`

### Directory Confusion

**Problem**: "Are you in the wrong directory?" warning
- **Cause**: This can happen if you cloned or are working in a different project directory (e.g., zkSync-Era-main).
- **Solution**: Ensure you're in the correct project directory: `cd sui-flashloan-arbitrage-bot`
- **Solution**: Check that `package.json` contains `"name": "sui-flashloan-arbitrage-bot"`

### CI/CD Issues

**Problem**: CI build fails with dependency installation errors
- **Solution**: The CI workflow now supports both `npm ci` (with lockfile) and `npm install` (without lockfile).
- **Solution**: Commit `package-lock.json` to the repository for deterministic builds.

**Problem**: CI scripts fail with network errors
- **Solution**: Network access may be restricted in CI environments. Scripts are designed to fail gracefully.
- **Solution**: Use mocked or local tests for CI validation instead of live network calls.

## Support

For issues, questions, or feature requests, please open a GitHub issue.

## Acknowledgments

- Sui Foundation for the Sui blockchain
- Cetus Protocol for the CLMM DEX
- Turbos Finance for the CLMM DEX  
- Suilend and Navi Protocol for flashloan infrastructure

## Version History

### v1.0.0 - Production Release
- Native mainnet USDC support
- Real SDK integrations for Cetus and Turbos
- Dynamic pool resolution
- Multi-RPC failover
- BigInt-only math
- Slippage protection with sqrt_price_limit
- Kill switch and safety checks
- JSON event logging
- Docker deployment support
- Comprehensive documentation
