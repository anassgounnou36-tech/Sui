# Sui Flashloan Arbitrage Bot

A TypeScript bot that performs atomic spot-to-spot arbitrage between Cetus and Turbos DEXes on Sui Mainnet, using Suilend flashloans (with Navi as fallback).

## Features

- **Atomic Transactions**: All operations in a single Programmable Transaction Block (PTB)
- **Flashloan Funded**: Uses Suilend flashloans (0.05% fee) with Navi fallback (0.06%)
- **Multi-DEX Arbitrage**: Monitors price spreads between Cetus and Turbos
- **Safety First**: Built-in slippage protection, profit verification, and dry-run mode
- **Real-time Monitoring**: Continuous price monitoring with configurable intervals

## Prerequisites

- Node.js 20.x or higher
- A Sui wallet with:
  - SUI tokens for gas fees
  - Initial USDC for small test runs
- RPC access to Sui Mainnet

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

Edit `.env` with your settings:

```env
# Required
SUI_RPC_MAINNET=https://fullnode.mainnet.sui.io:443
PRIVATE_KEY=your_private_key_here
WALLET_ADDRESS=0x_your_wallet_address_here

# Start small for testing!
FLASHLOAN_AMOUNT=10000000  # 10 USDC (6 decimals)
MIN_PROFIT_USDC=0.1        # Minimum profit: $0.10
MIN_SPREAD_PERCENT=0.5     # Require 0.5% spread
MAX_SLIPPAGE_PERCENT=1.0   # Max 1% slippage
GAS_BUDGET=100000          # Gas budget in MIST
CHECK_INTERVAL_MS=5000     # Check every 5 seconds
```

## Build

```bash
npm run build
```

## Usage

### 1. Check Current Spreads (No Trading)

```bash
npm run spread
```

This will show current prices and spreads without executing any trades.

### 2. Dry Run Mode (Simulate Trades)

```bash
npm run dry-run
```

This constructs PTBs and prints execution plans without signing or submitting transactions.

### 3. Live Trading

⚠️ **Safety Checklist Before Going Live:**

- [ ] Verify wallet address is correct
- [ ] Start with small amount ($10 USDC)
- [ ] Run dry-run mode first
- [ ] Monitor first few trades manually
- [ ] Check transactions on [Suiscan](https://suiscan.xyz)
- [ ] Gradually increase to $50-100 after success
- [ ] Set up monitoring/alerts
- [ ] Have a kill switch ready

```bash
npm start
```

### Run Modes

- **Spread Check**: `npm run spread` - View prices only
- **Dry Run**: `npm run dry-run` - Simulate without executing
- **Live**: `npm start` - Execute real trades

## Safety and Risk Management

### Built-in Protections

1. **Slippage Cap**: Hard 1% maximum slippage limit
2. **Profit Verification**: On-chain verification that profit >= MIN_PROFIT_USDC
3. **Atomic Execution**: All steps in one PTB - either all succeed or all revert
4. **Rate Limiting**: Max 1 tx per 3 seconds, max 5 pending
5. **Spread Confirmation**: Requires 2 consecutive ticks with sufficient spread

### Fee Structure

- **Flashloan Fee**: 0.05% (Suilend) or 0.06% (Navi fallback)
- **Swap Fees**: ~0.05% per swap on SUI/USDC pools
- **Total Cost**: ~0.15% minimum
- **Breakeven**: Need >0.15% spread; default minimum is 0.5%

### Recommended Testing Progression

1. **Week 1**: $10 USDC, monitor every trade
2. **Week 2**: $50 USDC if no issues
3. **Week 3**: $100-500 USDC with proven stability
4. **Month 2+**: Scale to $50k only after extensive successful runs

### Emergency Procedures

**Kill Switch**: `Ctrl+C` or `kill <process_id>`

The bot will complete any pending transaction and shut down gracefully.

## Project Structure

```
sui-flashloan-arbitrage-bot/
├── src/
│   ├── index.ts           # Main monitoring loop
│   ├── config.ts          # Configuration and validation
│   ├── logger.ts          # Logging system
│   ├── addresses.ts       # On-chain contract addresses
│   ├── verify.ts          # Startup verification
│   ├── cetus.ts           # Cetus DEX integration
│   ├── turbos.ts          # Turbos DEX integration
│   ├── flashloan.ts       # Suilend/Navi flashloan wrappers
│   ├── executor.ts        # PTB execution logic
│   ├── slippage.ts        # Slippage calculations
│   └── utils/
│       └── sui.ts         # Sui RPC client utilities
├── scripts/
│   └── print-spread.ts    # Price monitoring script
├── logs/                  # Log files (auto-generated)
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
└── README.md
```

## Monitoring and Operations

### Logs

Logs are written to:
- Console (stdout)
- `logs/bot-YYYY-MM-DD.log` (rotating daily)

### Key Metrics to Monitor

- Spread detection frequency
- Execution success rate
- Profit per trade
- Gas costs
- Failed transactions (and reasons)

### Common Issues

**No spreads detected**: Market is efficient, spreads below threshold
**Transaction failed**: Slippage exceeded, price moved too fast
**Insufficient balance**: Need more USDC or SUI for gas

## Development

```bash
# Type checking
npm run typecheck

# Linting
npm run lint

# Formatting
npm run format

# Run tests (placeholder)
npm test
```

## License

MIT License - See LICENSE file for details

## Disclaimer

**Use at your own risk.** This bot interacts with DeFi protocols and executes real financial transactions. Always:

- Start with small amounts
- Understand the code before running
- Monitor actively during initial runs
- Be aware of smart contract risks
- Never commit private keys to version control

The authors assume no liability for any losses incurred.

## Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Test thoroughly
4. Submit a pull request

## Support

For issues or questions, please open a GitHub issue.
