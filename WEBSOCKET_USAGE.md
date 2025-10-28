# WebSocket Subscriptions Usage

## Overview

The WebSocket polyfill has been added to enable real-time event subscriptions in Node.js using the Sui SDK's `subscribeEvent` method.

## How It Works

1. The polyfill (`src/polyfills/websocket.ts`) adds the `ws` package's WebSocket implementation to `globalThis.WebSocket`
2. This polyfill is imported as the first line in `src/index.ts` before any Sui SDK code
3. The Sui SDK can now use WebSocket subscriptions without errors

## Example Usage

Here's how to use `subscribeEvent` for swap events (future implementation):

```typescript
import { SuiClient } from '@mysten/sui/client';

// The polyfill is already loaded via index.ts
const client = new SuiClient({ url: 'https://sui-mainnet.public.blastapi.io' });

// Subscribe to swap events
const unsubscribe = await client.subscribeEvent({
  filter: {
    // Replace POOL_ID with actual pool address, e.g., 0x51e883ba7c0b566a26cbc8a94cd33eb0abd418a77cc1e60ad22fd9b1f29cd2ab
    MoveEventType: 'POOL_ID::pool::SwapEvent'
  },
  onMessage: (event) => {
    console.log('Swap event received:', event);
    // Handle the event (e.g., check for arbitrage opportunity)
  }
});

// Later, to unsubscribe:
// await unsubscribe();
```

## Environment Variables (Future Implementation)

When WebSocket triggers are implemented (e.g., in `src/ws/triggers.ts`), these variables could be used:

- `ENABLE_WS=true` - Enable WebSocket subscriptions instead of polling
- `WS_TRIGGER_MODE=event` - Use event-based triggers for swap detection

## Benefits

- **Real-time updates**: No polling delay, instant notification of swap events
- **Reduced RPC load**: No need to poll every 5 seconds
- **Lower latency**: React to arbitrage opportunities faster

## Current Status

✅ WebSocket polyfill implemented and working
✅ Sui SDK can now use `subscribeEvent` without errors
⏳ WebSocket trigger manager (`src/ws/triggers.ts`) - not yet implemented
