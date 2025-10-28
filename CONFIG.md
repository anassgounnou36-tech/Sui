# Configuration Reference

Complete reference for all environment variables used by the Sui Flashloan Arbitrage Bot.

## Table of Contents
- [RPC Configuration](#rpc-configuration)
- [Wallet Configuration](#wallet-configuration)
- [Flashloan Configuration](#flashloan-configuration)
- [Profit and Spread Thresholds](#profit-and-spread-thresholds)
- [Risk Management](#risk-management)
- [Monitoring and Polling](#monitoring-and-polling)
- [WebSocket Triggers](#websocket-triggers)
- [Telegram Notifications](#telegram-notifications)
- [Cache and Performance](#cache-and-performance)
- [Pool and Package IDs](#pool-and-package-ids)
- [Deprecated Variables](#deprecated-variables)

---

## RPC Configuration

Multi-RPC failover for reliability.

### SUI_RPC_MAINNET_PRIMARY
- **Type**: String (URL)
- **Default**: `https://sui-mainnet.public.blastapi.io`
- **Description**: Primary RPC endpoint for Sui Mainnet
- **Example**: `https://sui-mainnet.public.blastapi.io`

### SUI_RPC_MAINNET_BACKUP
- **Type**: String (URL)
- **Default**: `https://1rpc.io/sui`
- **Description**: Backup RPC endpoint (used if primary fails)
- **Example**: `https://1rpc.io/sui`

### SUI_RPC_MAINNET_FALLBACK
- **Type**: String (URL)
- **Default**: `https://sui.rpc.grove.city/v1/01fdb492`
- **Description**: Fallback RPC endpoint (used if primary and backup fail)
- **Example**: `https://sui.rpc.grove.city/v1/01fdb492`

### ROTATE_AFTER_REQUESTS
- **Type**: Integer
- **Default**: `20`
- **Description**: Number of requests before rotating to next RPC endpoint (round-robin load balancing)
- **Range**: 1-1000
- **Example**: `ROTATE_AFTER_REQUESTS=20`

---

## Wallet Configuration

Wallet credentials for transaction signing.

### PRIVATE_KEY
- **Type**: String (hex or base64)
- **Required**: Yes (for live mode)
- **Description**: Private key for signing transactions. Supports hex (with/without 0x prefix) or base64 format
- **Security**: **NEVER commit to version control!**
- **Example**: `PRIVATE_KEY=0x1234567890abcdef...` or `PRIVATE_KEY=base64string...`

### WALLET_ADDRESS
- **Type**: String (Sui address)
- **Required**: Yes (for live mode)
- **Description**: Sui wallet address (must match PRIVATE_KEY)
- **Format**: `0x` followed by 64 hex characters
- **Example**: `WALLET_ADDRESS=0xabcd1234...`

---

## Flashloan Configuration

Settings for flashloan strategy.

### FLASHLOAN_ASSET
- **Type**: String
- **Default**: `SUI`
- **Options**: `SUI`, `USDC`
- **Description**: Asset to borrow via flashloan
- **Recommendation**: Use `SUI` for Cetus fee-tier arbitrage
- **Example**: `FLASHLOAN_ASSET=SUI`

### FLASHLOAN_AMOUNT
- **Type**: Integer (smallest units)
- **Default**: `10000000000` (10 SUI with 9 decimals)
- **Description**: Flashloan amount in smallest units
- **For SUI**: 1 SUI = 1,000,000,000 (9 decimals)
- **For USDC**: 1 USDC = 1,000,000 (6 decimals)
- **Example**: `FLASHLOAN_AMOUNT=10000000000` (10 SUI)

### MIN_TRADE_SUI
- **Type**: Float
- **Default**: `1.0`
- **Description**: Minimum flashloan size in SUI for live mode (prevents rounding errors)
- **Live Mode**: Enforced strictly
- **Simulation**: Allows smaller with warnings
- **Example**: `MIN_TRADE_SUI=1.0`

### SUILEND_SAFETY_BUFFER
- **Type**: Integer (smallest units)
- **Default**: `0`
- **Description**: Safety buffer to keep as reserve capacity in Suilend
- **Example**: `SUILEND_SAFETY_BUFFER=0`

---

## Profit and Spread Thresholds

Profitability gates and spread requirements.

### MIN_PROFIT_USD ⭐ (Canonical)
- **Type**: Float
- **Default**: `0.1`
- **Description**: Minimum profit in USD required to execute trade
- **Units**: US Dollars
- **Usage**: Primary profit threshold used by both simulate and live runner
- **Example**: `MIN_PROFIT_USD=0.5` (requires at least $0.50 profit)

**Deprecated Aliases** (read-only with warning):
- `MIN_PROFIT_USDC` - Use `MIN_PROFIT_USD` instead
- `MIN_PROFIT` - Use `MIN_PROFIT_USD` instead

### MIN_SPREAD_PERCENT
- **Type**: Float
- **Default**: `0.5`
- **Description**: Minimum spread percentage between pool prices to consider opportunity
- **Units**: Percentage
- **Range**: 0.1-10.0
- **Warning**: Below 0.1% may result in unprofitable trades after fees
- **Example**: `MIN_SPREAD_PERCENT=0.5` (0.5%)

### CONSECUTIVE_SPREAD_REQUIRED
- **Type**: Integer
- **Default**: `2`
- **Description**: Number of consecutive intervals with same spread direction required before execution
- **Range**: 1-10
- **Purpose**: Reduces false signals and ensures opportunity stability
- **Example**: `CONSECUTIVE_SPREAD_REQUIRED=2`

---

## Risk Management

Safety controls and limits.

### MAX_SLIPPAGE_PERCENT
- **Type**: Float
- **Default**: `1.0`
- **Description**: Maximum acceptable slippage percentage
- **Units**: Percentage
- **Range**: 0.1-10.0
- **Hard Limit**: >10% triggers configuration error
- **Example**: `MAX_SLIPPAGE_PERCENT=1.0`

### MAX_CONSECUTIVE_FAILURES
- **Type**: Integer
- **Default**: `3`
- **Description**: Number of consecutive failures before kill switch activates (bot shuts down)
- **Range**: 1-10
- **Example**: `MAX_CONSECUTIVE_FAILURES=3`

### LIVE_CONFIRM
- **Type**: Boolean
- **Default**: `false`
- **Description**: Safety confirmation required for flashloan amounts >100k USDC equivalent
- **Required**: Must be `true` for large amounts
- **Example**: `LIVE_CONFIRM=true`

### GAS_BUDGET
- **Type**: Integer (MIST)
- **Default**: `100000`
- **Description**: Gas budget for transactions in MIST
- **Example**: `GAS_BUDGET=100000`

---

## Monitoring and Polling

Price checking and finality monitoring.

### CHECK_INTERVAL_MS
- **Type**: Integer (milliseconds)
- **Default**: `5000` (5 seconds)
- **Description**: Interval between price checks
- **Range**: 1000-60000
- **Example**: `CHECK_INTERVAL_MS=5000`

### FINALITY_POLL_INTERVAL_MS
- **Type**: Integer (milliseconds)
- **Default**: `500`
- **Description**: Interval between transaction finality checks
- **Example**: `FINALITY_POLL_INTERVAL_MS=500`

### FINALITY_MAX_WAIT_MS
- **Type**: Integer (milliseconds)
- **Default**: `10000` (10 seconds)
- **Description**: Maximum time to wait for transaction finality
- **Example**: `FINALITY_MAX_WAIT_MS=10000`

---

## WebSocket Triggers

Real-time event subscriptions for faster reaction.

### ENABLE_WS
- **Type**: Boolean
- **Default**: `false`
- **Description**: Enable WebSocket-based triggers for immediate pool change detection
- **When Enabled**: Bot reacts to pool changes in real-time (in addition to polling)
- **When Disabled**: Bot only uses CHECK_INTERVAL_MS polling
- **Example**: `ENABLE_WS=true`

### WS_TRIGGER_MODE
- **Type**: String
- **Default**: `object`
- **Options**: `object`, `event`
- **Description**: WebSocket subscription mode
- **object mode**: Subscribe to pool object changes (any change triggers re-evaluation)
- **event mode**: Subscribe to swap events (can filter by MIN_SWAP_USD)
- **Example**: `WS_TRIGGER_MODE=object`

### MIN_SWAP_USD
- **Type**: Float
- **Default**: `0` (disabled)
- **Description**: Minimum swap size in USD to trigger re-evaluation (event mode only)
- **Units**: US Dollars
- **When 0**: All swap events trigger (no size filtering)
- **When >0**: Only swaps >= this amount trigger
- **Example**: `MIN_SWAP_USD=100` (only react to swaps >= $100)

---

## Telegram Notifications

Real-time notifications via Telegram bot.

### ENABLE_TELEGRAM
- **Type**: Boolean
- **Default**: `false`
- **Description**: Enable Telegram notifications
- **Requires**: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID
- **Example**: `ENABLE_TELEGRAM=true`

### TELEGRAM_BOT_TOKEN
- **Type**: String
- **Required**: If ENABLE_TELEGRAM=true
- **Description**: Telegram bot token from @BotFather
- **Format**: Alphanumeric string with colons
- **Security**: Keep private
- **Example**: `TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz`

### TELEGRAM_CHAT_ID
- **Type**: String
- **Required**: If ENABLE_TELEGRAM=true
- **Description**: Telegram chat ID for sending messages
- **Format**: Numeric string (can be negative)
- **How to Get**: Visit `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
- **Example**: `TELEGRAM_CHAT_ID=123456789`

**Notification Types:**
1. **Opportunity Detected**: Spread detected, includes prices and direction
2. **Execution Start**: Before PTB submission, includes amounts and expected profit
3. **Execution Result**: Success with TX digest or failure with error

---

## Cache and Performance

Caching to reduce RPC load.

### POOL_STATE_CACHE_TTL_MS
- **Type**: Integer (milliseconds)
- **Default**: `5000` (5 seconds)
- **Description**: Cache pool state for this duration to reduce RPC calls
- **Range**: 1000-30000
- **Example**: `POOL_STATE_CACHE_TTL_MS=5000`

---

## Pool and Package IDs

On-chain addresses (usually auto-discovered).

### CETUS_POOL_ID_005
- **Type**: String (Sui object ID)
- **Default**: `0x51e883ba7c0b566a26cbc8a94cd33eb0abd418a77cc1e60ad22fd9b1f29cd2ab`
- **Description**: Cetus 0.05% fee tier pool (SUI/bridged USDC)
- **Example**: `CETUS_POOL_ID_005=0x51e883...`

### CETUS_POOL_ID_025
- **Type**: String (Sui object ID)
- **Default**: `0xb8d7d9e66a60c239e7a60110efcf8de6c705580ed924d0dde141f4a0e2c90105`
- **Description**: Cetus 0.25% fee tier pool (SUI/bridged USDC)
- **Example**: `CETUS_POOL_ID_025=0xb8d7d9...`

### BRIDGED_USDC_COIN_TYPE
- **Type**: String (Move type)
- **Default**: `0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC`
- **Description**: Bridged USDC coin type for Cetus fee-tier arbitrage
- **Example**: `BRIDGED_USDC_COIN_TYPE=0xdba34672...::usdc::USDC`

---

## Deprecated Variables

These variables are deprecated but supported with warnings.

### MIN_PROFIT_USDC (Deprecated)
- **Replacement**: Use `MIN_PROFIT_USD` instead
- **Status**: Read-only fallback with warning
- **Migration**: Change `MIN_PROFIT_USDC=0.5` to `MIN_PROFIT_USD=0.5`

### MIN_PROFIT (Deprecated)
- **Replacement**: Use `MIN_PROFIT_USD` instead
- **Status**: Read-only fallback with warning
- **Migration**: Change `MIN_PROFIT=0.5` to `MIN_PROFIT_USD=0.5`

### MODE (Deprecated)
- **Status**: Ignored with warning
- **Reason**: Bot now defaults to Cetus fee-tier arbitrage
- **Migration**: Remove from .env file

### USDC_COIN_TYPE (Deprecated)
- **Replacement**: Use `BRIDGED_USDC_COIN_TYPE` for fee-tier arbitrage
- **Status**: Warning if set to non-bridged USDC
- **Migration**: Use `BRIDGED_USDC_COIN_TYPE` instead

---

## Environment Variable Validation

The bot validates configuration at startup:

✅ **Required Checks (Live Mode)**:
- PRIVATE_KEY must be set
- WALLET_ADDRESS must be set
- MAX_SLIPPAGE_PERCENT <= 10%
- FLASHLOAN_AMOUNT >= MIN_TRADE_SUI (when FLASHLOAN_ASSET=SUI)
- LIVE_CONFIRM=true if FLASHLOAN_AMOUNT > 100k USDC equivalent

⚠️ **Warnings**:
- MIN_SPREAD_PERCENT < 0.1% (may result in unprofitable trades)
- FLASHLOAN_AMOUNT very low (<1 unit)
- Using deprecated environment variables

❌ **Errors**:
- Invalid FLASHLOAN_ASSET (not SUI or USDC)
- MAX_SLIPPAGE_PERCENT > 10%
- Large flashloan without LIVE_CONFIRM=true
- Missing logs directory

---

## Example .env File

See `.env.example` in the repository for a complete, commented example configuration.

```env
# Minimal working configuration
PRIVATE_KEY=your_private_key_here
WALLET_ADDRESS=0x_your_wallet_address_here
MIN_PROFIT_USD=0.1
DRY_RUN=false

# Optional: Enable advanced features
ENABLE_WS=true
WS_TRIGGER_MODE=object
ENABLE_TELEGRAM=true
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```
