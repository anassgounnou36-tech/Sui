# Sui Flashloan Arbitrage Bot

A production-ready TypeScript bot that performs atomic arbitrage on Sui Mainnet using Suilend flashloans. The bot executes intra-Cetus arbitrage between different fee tier pools (0.05% vs 0.25%).

## Default Strategy

**Cetus Fee-Tier Arbitrage**: Exploits price differences between Cetus 0.05% and 0.25% fee tier pools using SUI flashloans and bridged USDC.

### How It Works
1. Borrow SUI via Suilend flashloan (0.05% fee)
2. Swap SUI → USDC on one Cetus pool (either 0.05% or 0.25% tier)
3. Swap USDC → SUI on the other Cetus pool
4. Repay flashloan with profit

### Key Features
- **SUI Flashloans**: Uses SUI as the flashloan asset with dynamic reserve discovery
- **Bridged USDC Pools**: Operates on Circle's legacy bridged USDC (`0xdba34672...::usdc::USDC`)
- **Strict Type Verification**: Raw RPC-based verification to avoid SDK ticker ambiguity
- **No MODE Required**: Defaults to fee-tier arbitrage (previous MODE environment variable is deprecated)

## Features

### Core Functionality
- **Atomic Transactions**: All operations in a single Programmable Transaction Block (PTB)
- **Flashloan Funded**: Uses Suilend flashloans (0.05% fee) with automatic Navi fallback (0.06%)
  - **SUI Flashloans**: Default with dynamic reserve discovery
- **Cetus Fee-Tier Arbitrage**: Real-time price monitoring between 0.05% and 0.25% fee pools
- **Real SDK Integration**: Uses actual pool state and sqrtPrice calculations from on-chain data
- **Strict Coin Type Verification**: Raw RPC-based verification to prevent incorrect USDC types

### Safety & Risk Management
- **Multi-RPC Failover**: Automatic failover between 3 RPC endpoints for reliability
- **Slippage Protection**: Hard 1% maximum slippage cap with sqrt_price_limit enforcement
- **Profit Verification**: On-chain verification that profit >= MIN_PROFIT_USDC
- **Kill Switch**: Automatic shutdown after 3 consecutive failed executions
- **BigInt Math**: All calculations use BigInt to prevent precision loss
- **Live Confirmation**: Safety check prevents accidental large-amount executions (>100k USDC)
- **Coin Type Guards**: Hard fails on incorrect USDC types (Wormhole vs native vs bridged)

### Operational Features
- **Dynamic Pool Resolution**: Automatically discovers and verifies pool IDs at startup
- **Rate Limiting**: Max 1 tx per 3 seconds, max 5 pending transactions
- **Spread Confirmation**: Requires 2 consecutive intervals with sufficient spread
- **JSON Event Logging**: Structured logging for trade events, profits, and errors
- **Dry Run Mode**: Full simulation without signing or submitting transactions
- **Docker Support**: Production-ready containerized deployment

## Prerequisites

- Node.js 20.x or higher
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

# Generate a new wallet (optional)
npm run wallet:generate

# Edit .env with your configuration
nano .env
```

## Configuration

The bot uses environment variables for configuration. See `.env.example` for all available options.

### Default Strategy: Cetus Fee-Tier Arbitrage

The bot is configured by default for intra-Cetus arbitrage between 0.05% and 0.25% fee tier pools using SUI flashloans and bridged USDC.

**Configuration:**
```env
FLASHLOAN_ASSET=SUI
FLASHLOAN_AMOUNT=10000000000  # 10 SUI (9 decimals)
BRIDGED_USDC_COIN_TYPE=0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC
CETUS_POOL_ID_005=0x51e883ba7c0b566a26cbc8a94cd33eb0abd418a77cc1e60ad22fd9b1f29cd2ab
CETUS_POOL_ID_025=0xb8d7d9e66a60c239e7a60110efcf8de6c705580ed924d0dde141f4a0e2c90105
```

**Key Features:**
- Uses **SUI flashloans** (Suilend reserve index discovered dynamically, typically 0)
- Operates on **bridged USDC** pools (Circle's legacy bridge: `0xdba34672...::usdc::USDC`)
- Uses **raw RPC type verification** to avoid SDK ticker ambiguity
- **No MODE variable needed** - fee-tier arbitrage is the default behavior

**Important:** Pool coin types are strictly verified via RPC `sui_getObject` with type parsing. The bot will hard fail if:
- Wormhole USDC (`0x5d4b3025...`) is detected
- Native USDC (`0xaf8cd...`) is found (expected bridged USDC only)

### Troubleshooting

If you see an error mentioning `0x5d4b30...` (Wormhole USDC):
1. Ensure `CETUS_POOL_ID_005` and `CETUS_POOL_ID_025` target bridged USDC pools
2. Set `BRIDGED_USDC_COIN_TYPE=0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC`
3. Remove any `USDC_COIN_TYPE` or `ALLOW_WRAPPED_USDC` settings (deprecated)

### Essential Configuration

#### Generating a Wallet

If you need a new Sui wallet, you can use the built-in generator:

```bash
npm run wallet:generate
```

This will output a new Ed25519 keypair in `.env`-ready format:
```
PRIVATE_KEY=suiprivkey1...
```

Simply copy the output line to your `.env` file. The script also displays your wallet address for reference.

**Security Warning:** Never share your private key or commit it to version control!

#### Environment Variables

```env
# Multi-RPC Configuration (automatic failover)
SUI_RPC_MAINNET_PRIMARY=https://sui-mainnet.public.blastapi.io
SUI_RPC_MAINNET_BACKUP=https://1rpc.io/sui
SUI_RPC_MAINNET_FALLBACK=https://sui.rpc.grove.city/v1/01fdb492

# Wallet Configuration
PRIVATE_KEY=your_private_key_here  # Supports hex (with/without 0x) or base64
WALLET_ADDRESS=0x_your_wallet_address_here

# Flashloan Configuration (Default: SUI for fee-tier arbitrage)
FLASHLOAN_ASSET=SUI
FLASHLOAN_AMOUNT=10000000000  # 10 SUI (9 decimals)

# Start small for testing!
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

# Minimum Trade Size
MIN_TRADE_SUI=1.0               # Minimum 1 SUI for live mode (avoid rounding)
                                # Simulation allows smaller with warnings

# Suilend Settings
SUILEND_SAFETY_BUFFER=0         # Reserve capacity buffer (base units)

# RPC Rotation and Caching
ROTATE_AFTER_REQUESTS=20        # Rotate RPC after N requests (round-robin)
POOL_STATE_CACHE_TTL_MS=5000    # Cache pool state for 5s (reduce RPC load)

# Monitoring
CHECK_INTERVAL_MS=5000          # Price check interval
FINALITY_POLL_INTERVAL_MS=500   # TX finality check interval
FINALITY_MAX_WAIT_MS=10000      # Max wait for finality

# Verification
VERIFY_ON_CHAIN=true            # Verify pool IDs at startup (recommended)

# Dry Run
DRY_RUN=false                   # Set to true for simulation mode

# Telegram Notifications (optional)
TELEGRAM_BOT_TOKEN=             # Get from @BotFather on Telegram
TELEGRAM_CHAT_ID=               # Get by messaging your bot and visiting:
                                # https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
```

### Telegram Notifications

The bot supports optional Telegram notifications to alert you of arbitrage opportunities and execution results.

**Setup:**
1. Create a Telegram bot by messaging [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the instructions to get your `TELEGRAM_BOT_TOKEN`
3. Start a chat with your bot and send any message
4. Visit `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates` to find your `TELEGRAM_CHAT_ID`
5. Add both values to your `.env` file

**Notifications:**
- **Opportunity Detected**: When spread >= MIN_SPREAD_PERCENT (includes prices, spread %, direction, and pool IDs)
- **Execution Start**: Before building/submitting the transaction (includes flashloan amount, expected profit)
- **Execution Result**: After success/failure with transaction digest (live mode only) or error message

If either `TELEGRAM_BOT_TOKEN` or `TELEGRAM_CHAT_ID` is missing, notifications are gracefully disabled with a single log message at startup.
```

### Coin Types and Package IDs

The bot uses these mainnet addresses by default (can be overridden via env vars):

- **Native USDC (CETUS_TURBOS mode)**: `0xaf8cd5edc19637e05da0dd46f6ddb1a8b81cc532fcccf6d5d41ba77bba6eddd5::coin::COIN` (6 decimals)
- **Bridged USDC (CETUS_FEE_TIER_ARB mode)**: `0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC` (6 decimals)
- **Wormhole USDC (NOT Recommended)**: `0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN` (6 decimals)
  - ⚠️ **WARNING**: Using Wormhole wrapped USDC requires setting `ALLOW_WRAPPED_USDC=true`. Native USDC is strongly recommended for arbitrage.
- **SUI**: `0x2::sui::SUI` (9 decimals)
- **Cetus CLMM**: `0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb`
  - **CLMM GlobalConfig** (for direct pool::swap calls): `0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f` (default)
    - This bot uses direct `pool::swap` calls for maximum efficiency
  - **Integration GlobalConfig** (for integration/router): `0x996c4d9480708fb8b92aa7acf819fb0497b5ec8e65ba06601cae2fb6db3312c3`
    - Use if calling via Cetus integration wrapper functions (not used by default)
  - Override via `CETUS_GLOBAL_CONFIG_ID` if needed
- **Turbos CLMM**: `0x91bfbc386a41afcfd9b2533058d7e915a1d3829089cc268ff4333d54d6339ca1`
- **Suilend**: `0x902f7ee4a68f6f63b05acd66e7aacc6de72703da4d8e0c6f94c1dd4b73c62e85`
  - Lending Market: `0x84030d26d85eaa7035084a057f2f11f701b7e2e4eda87551becbc7c97505ece1`
  - **Dynamic Fee Reading**: Bot reads `borrow_fee_bps` and `available_amount` at runtime from reserve config
    - On error: Falls back to 5 bps (0.05%) fee and large default available amount
    - Logs warnings if dynamic reading fails
- **Navi**: `0x06d8af64fe58327e9f2b7b33b9fad9a5d0f0fb1ba38b024de09c767c10241e42`

**Pool Discovery**: Pool IDs are resolved dynamically at startup. The resolver:
- **CETUS_TURBOS mode**: Discovers pools with native USDC + SUI at 0.05% fee tier
- **CETUS_FEE_TIER_ARB mode**: Discovers pools with bridged USDC + SUI at 0.05% and 0.25% fee tiers
- Uses **raw RPC `sui_getObject` with type parsing** to extract exact coin types
- Validates coin ordering in pools (determines if SUI is coin A or B)
- Extracts current sqrtPrice and liquidity for accurate quotes
- Verifies all pool IDs exist on-chain before trading
- Supports optional env overrides: `CETUS_SUI_USDC_POOL_ID`, `TURBOS_SUI_USDC_POOL_ID`, `CETUS_POOL_ID_005`, `CETUS_POOL_ID_025`

**Discovery Scripts:**
- `npm run find-pools` - Discover SUI/native-USDC pools on Cetus and Turbos (CETUS_TURBOS mode)
- `npm run find-cetus-fee-pools` - Discover SUI/bridged-USDC pools at 0.05% and 0.25% fee tiers (CETUS_FEE_TIER_ARB mode)

**Flashloan Entrypoints**: The bot uses the verified Move entrypoints:
- **Suilend** (primary, 0.05% fee):
  - Borrow: `lending::flash_borrow(lending_market, reserve_index, amount)` → `(Coin<T>, FlashLoanReceipt)`
  - Repay: `lending::flash_repay(lending_market, reserve_index, Coin<T>, FlashLoanReceipt)`
  - Reserve index dynamically discovered at runtime for both SUI and USDC
- **Navi** (fallback, 0.06% fee):
  - Borrow: `lending::flash_loan(storage, pool_id, amount, &Clock)` → `(Coin<T>, FlashLoanReceipt)`
  - Repay: `lending::repay_flash_loan(storage, pool_id, Coin<T>, FlashLoanReceipt)`
  - Pool ID dynamically confirmed at runtime

**Swap Entrypoints**: The bot uses the verified Move entrypoints:
- **Cetus**: `pool::swap(config, &mut Pool, Coin<A>, Coin<B>, a2b, by_amount_in, amount, amount_limit, sqrt_price_limit, &Clock)`
  - Supports both USDC types (native and bridged) based on pool coin types
  - Direction (`a2b`) determined from pool coin ordering
- **Turbos**: `pool::swap_a_b` and `pool::swap_b_a` with parameters `(pool, coin_in, amount, amount_threshold, sqrt_price_limit, &Clock)`
- Both enforce 1% max slippage via `amount_limit`/`amount_threshold` and `sqrt_price_limit` from SDK quotes

This ensures the bot always uses the correct pools with proper coin ordering, preventing price calculation errors.

## Build

```bash
npm run build
```

## Usage

### 0. Discover Pools (Recommended First Step)

```bash
npm run find-pools
```

Discovers and displays SUI/native-USDC pools on both Cetus and Turbos DEXes at the 0.05% fee tier. Shows pool IDs, coin types, fee rates, and liquidity. Outputs recommended pool IDs for your `.env` file.

### 1. Check Current Spreads (No Trading)

```bash
npm run spread
```

Shows current executable prices from both DEXes at your configured flashloan size, with spread analysis and profitability estimation. No trades executed.

### 2. Simulate Full Arbitrage (No Signing)

```bash
npm run simulate
```

Builds the complete PTB with:
- Flashloan borrow
- Both swaps with min_out and sqrt_price_limit
- Repay amount calculations
- Profit projections

Does not sign or submit - safe to run anytime.

### 3. Dry Run Mode (Build But Don't Execute)

```bash
npm run dry-run
```

Runs the full monitoring loop with real price checks, but constructs PTBs without signing or submitting. Useful for testing the monitoring logic.

### 4. Live Trading

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

### 5. Docker Deployment

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
