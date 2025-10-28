import { SuiClient } from '@mysten/sui/client';
import WebSocket from 'ws';
import { logger } from '../logger';
import { config } from '../config';
import { CETUS } from '../addresses';

// Type for SuiEvent
type SuiEvent = any; // Using any for compatibility with @mysten/sui API

export type TriggerCallback = () => Promise<void>;

// WebSocket close codes
const WS_CLOSE_NORMAL = 1000; // Normal closure
const WS_CLOSE_UNSUPPORTED = 4000; // Unsupported data or protocol

// USDC token configuration
const USDC_DECIMALS = 6;
const USDC_DECIMALS_DIVISOR = Math.pow(10, USDC_DECIMALS);

/**
 * Extract swap amount in USD from event data
 * Note: This specifically assumes USDC (6 decimals) for the amount_in field
 * @param eventData The parsed event data
 * @returns The swap amount in USD, or null if not available
 */
function extractSwapAmountUsd(eventData: any): number | null {
  if (!eventData || !eventData.amount_in) {
    return null;
  }
  return parseFloat(eventData.amount_in) / USDC_DECIMALS_DIVISOR;
}

/**
 * WebSocket Trigger Manager
 * Monitors Cetus pools for updates and triggers re-evaluation
 */
export class WebSocketTriggerManager {
  private client: SuiClient;
  private mode: 'object' | 'event';
  private minSwapUsd: number;
  private poolIds: string[];
  private callback: TriggerCallback;
  private unsubscribeFunctions: Array<() => Promise<void>> = [];
  private isActive: boolean = false;
  private wsEndpoint?: string;
  private rawWsClients: WebSocket[] = [];
  private reconnectTimeouts: NodeJS.Timeout[] = [];
  private subscriptionSuccessCount: number = 0;

  constructor(
    client: SuiClient,
    poolIds: string[],
    mode: 'object' | 'event',
    minSwapUsd: number,
    callback: TriggerCallback,
    wsEndpoint?: string
  ) {
    this.client = client;
    this.mode = mode;
    this.minSwapUsd = minSwapUsd;
    this.poolIds = poolIds;
    this.callback = callback;
    this.wsEndpoint = wsEndpoint;
  }

  /**
   * Start monitoring pool updates
   */
  async start(): Promise<void> {
    if (this.isActive) {
      logger.warn('WebSocket trigger manager already active');
      return;
    }

    this.isActive = true;
    logger.info(`Starting WebSocket trigger manager (mode: ${this.mode})`);
    
    if (this.wsEndpoint) {
      logger.info(`  Using explicit WS endpoint: ${this.wsEndpoint}`);
    }

    if (this.mode === 'object') {
      await this.subscribeToObjectUpdates();
    } else if (this.mode === 'event') {
      if (this.wsEndpoint) {
        // Use raw WebSocket connection for event subscriptions
        await this.subscribeToSwapEventsRaw();
      } else {
        // Use SDK subscription (may fail with some providers)
        await this.subscribeToSwapEvents();
      }
    }

    // Only log success if at least one subscription is active
    if (this.subscriptionSuccessCount > 0) {
      logger.success('WebSocket trigger manager started successfully');
    } else {
      logger.warn('WebSocket trigger manager started but no subscriptions are active');
    }
  }

  /**
   * Stop monitoring pool updates
   */
  async stop(): Promise<void> {
    if (!this.isActive) {
      return;
    }

    logger.info('Stopping WebSocket trigger manager...');
    
    // Clear reconnect timeouts
    for (const timeout of this.reconnectTimeouts) {
      clearTimeout(timeout);
    }
    this.reconnectTimeouts = [];
    
    // Close raw WebSocket connections
    for (const ws of this.rawWsClients) {
      try {
        ws.close();
      } catch (error) {
        logger.error('Error closing raw WebSocket', error);
      }
    }
    this.rawWsClients = [];
    
    // Unsubscribe from SDK subscriptions
    for (const unsubscribe of this.unsubscribeFunctions) {
      try {
        await unsubscribe();
      } catch (error) {
        logger.error('Error unsubscribing from WebSocket', error);
      }
    }
    
    this.unsubscribeFunctions = [];
    this.isActive = false;
    this.subscriptionSuccessCount = 0;
    logger.info('WebSocket trigger manager stopped');
  }

  /**
   * Subscribe to pool object updates (mode: object)
   */
  private async subscribeToObjectUpdates(): Promise<void> {
    for (const poolId of this.poolIds) {
      try {
        logger.debug(`Subscribing to object updates for pool: ${poolId}`);
        
        const unsubscribe = await this.client.subscribeEvent({
          filter: {
            MoveEventType: `${poolId}::pool::PoolUpdated` as any,
          },
          onMessage: async (_event: SuiEvent) => {
            logger.debug(`Pool object update detected: ${poolId}`);
            try {
              await this.callback();
            } catch (error) {
              logger.error('Error in trigger callback', error);
            }
          },
        });

        this.unsubscribeFunctions.push(async () => {
          await unsubscribe();
        });
        
        this.subscriptionSuccessCount++;
      } catch (error) {
        logger.error(`Failed to subscribe to pool ${poolId}`, error);
      }
    }
  }

  /**
   * Subscribe to swap events using SDK (mode: event, no explicit WS endpoint)
   * Filters events by MIN_SWAP_USD if configured
   */
  private async subscribeToSwapEvents(): Promise<void> {
    // Use Cetus SwapEvent type
    const swapEventType = `${CETUS.packageId}::pool::SwapEvent`;
    
    logger.info(`  Event type: ${swapEventType}`);
    if (this.minSwapUsd > 0) {
      logger.info(`  Event filtering: MIN_SWAP_USD = ${this.minSwapUsd} USD`);
    }

    try {
      logger.debug(`Subscribing to swap events: ${swapEventType}`);
      
      const unsubscribe = await this.client.subscribeEvent({
        filter: {
          MoveEventType: swapEventType as any,
        },
        onMessage: async (event: SuiEvent) => {
          // Apply MIN_SWAP_USD filter if configured
          if (this.minSwapUsd > 0) {
            const swapData = event.parsedJson as any;
            const amountUsd = extractSwapAmountUsd(swapData);
            if (amountUsd !== null && amountUsd < this.minSwapUsd) {
              logger.debug(`Swap amount (${amountUsd} USD) below threshold (${this.minSwapUsd} USD), skipping`);
              return;
            }
          }

          logger.debug(`Swap event detected: ${swapEventType}`);
          try {
            await this.callback();
          } catch (error) {
            logger.error('Error in trigger callback', error);
          }
        },
      });

      this.unsubscribeFunctions.push(async () => {
        await unsubscribe();
      });
      
      this.subscriptionSuccessCount++;
    } catch (error: any) {
      const errorMsg = error?.message || String(error);
      
      // Check for known unsupported method errors
      if (errorMsg.includes('Unsupported method') || errorMsg.includes('suix_subscribeEvent')) {
        logger.error(
          `Provider does not support suix_subscribeEvent. ` +
          `Consider using WS_ENDPOINT to point to a WS-capable provider (e.g., wss://sui-mainnet.public.blastapi.io)`
        );
      } else if (errorMsg.includes('405') || errorMsg.includes('Method Not Allowed')) {
        logger.error(
          `WebSocket upgrade returned 405 Method Not Allowed. ` +
          `The RPC endpoint may not support WebSocket subscriptions. ` +
          `Use WS_ENDPOINT to specify a WS-capable provider.`
        );
      } else {
        logger.error(`Failed to subscribe to swap events: ${errorMsg}`);
      }
      
      logger.warn('Falling back to polling mode (WebSocket subscription failed)');
    }
  }

  /**
   * Subscribe to swap events using raw WebSocket with JSON-RPC (mode: event, explicit WS endpoint)
   * Filters events by MIN_SWAP_USD if configured
   */
  private async subscribeToSwapEventsRaw(): Promise<void> {
    if (!this.wsEndpoint) {
      logger.error('WS endpoint not configured for raw WebSocket subscription');
      return;
    }

    // Use Cetus SwapEvent type
    const swapEventType = `${CETUS.packageId}::pool::SwapEvent`;
    
    logger.info(`  Method: suix_subscribeEvent`);
    logger.info(`  Event type: ${swapEventType}`);
    if (this.minSwapUsd > 0) {
      logger.info(`  Event filtering: MIN_SWAP_USD = ${this.minSwapUsd} USD`);
    }

    this.connectRawWebSocket(swapEventType, 0);
  }

  /**
   * Connect to WebSocket with exponential backoff retry
   */
  private connectRawWebSocket(eventType: string, retryCount: number): void {
    if (!this.wsEndpoint || !this.isActive) {
      return;
    }

    const ws = new WebSocket(this.wsEndpoint);
    let subscriptionId: number | null = null;
    
    ws.on('open', () => {
      logger.debug(`Raw WebSocket connected to ${this.wsEndpoint}`);
      
      // Send JSON-RPC subscription request
      const subscriptionRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'suix_subscribeEvent',
        params: [
          {
            MoveEventType: eventType,
          },
        ],
      };
      
      logger.debug(`Sending subscription request: ${JSON.stringify(subscriptionRequest)}`);
      ws.send(JSON.stringify(subscriptionRequest));
    });

    ws.on('message', async (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString());
        
        // Check for subscription confirmation
        if (message.id === 1 && message.result !== undefined) {
          subscriptionId = message.result;
          logger.info(`Subscription successful (ID: ${subscriptionId})`);
          this.subscriptionSuccessCount++;
          return;
        }
        
        // Check for subscription error
        if (message.id === 1 && message.error) {
          const errorMsg = message.error.message || JSON.stringify(message.error);
          
          if (errorMsg.includes('Unsupported method') || errorMsg.includes('suix_subscribeEvent')) {
            logger.error(
              `Provider does not support suix_subscribeEvent (error: ${errorMsg}). ` +
              `This endpoint may not support Sui WebSocket event subscriptions.`
            );
          } else {
            logger.error(`Subscription error: ${errorMsg}`);
          }
          
          logger.warn('Falling back to polling mode (WebSocket subscription failed)');
          ws.close();
          return;
        }
        
        // Handle subscription events
        if (message.params && message.params.subscription === subscriptionId) {
          const event = message.params.result;
          
          // Apply MIN_SWAP_USD filter if configured
          if (this.minSwapUsd > 0) {
            const swapData = event.parsedJson as any;
            const amountUsd = extractSwapAmountUsd(swapData);
            if (amountUsd !== null && amountUsd < this.minSwapUsd) {
              logger.debug(`Swap amount (${amountUsd} USD) below threshold (${this.minSwapUsd} USD), skipping`);
              return;
            }
          }
          
          logger.debug(`Swap event received via raw WebSocket`);
          try {
            await this.callback();
          } catch (error) {
            logger.error('Error in trigger callback', error);
          }
        }
      } catch (error) {
        logger.error('Error processing WebSocket message', error);
      }
    });

    ws.on('error', (error: Error) => {
      const errorMsg = error?.message || String(error);
      
      // Check for HTTP 405 error
      if (errorMsg.includes('405') || errorMsg.includes('Unexpected server response')) {
        logger.error(
          `WebSocket upgrade failed with HTTP 405. ` +
          `The endpoint ${this.wsEndpoint} may not support WebSocket connections. ` +
          `Verify that the WS_ENDPOINT is correct and supports WebSocket subscriptions.`
        );
        logger.warn('Falling back to polling mode (WebSocket connection failed)');
        return; // Don't retry on 405
      }
      
      logger.error(`Raw WebSocket error: ${errorMsg}`);
    });

    ws.on('close', (code: number, reason: Buffer) => {
      logger.warn(`Raw WebSocket closed (code: ${code}, reason: ${reason.toString()})`);
      
      // Don't decrement subscriptionSuccessCount if we never successfully subscribed
      if (subscriptionId !== null && this.subscriptionSuccessCount > 0) {
        this.subscriptionSuccessCount--;
      }
      
      // Exponential backoff retry (if still active and not a hard failure)
      if (this.isActive && code !== WS_CLOSE_NORMAL && code !== WS_CLOSE_UNSUPPORTED) {
        const delay = Math.min(1000 * Math.pow(2, retryCount), 60000); // Max 60s
        logger.info(`Reconnecting in ${delay}ms (attempt ${retryCount + 1})...`);
        
        const timeout = setTimeout(() => {
          this.connectRawWebSocket(eventType, retryCount + 1);
        }, delay);
        
        this.reconnectTimeouts.push(timeout);
      }
    });

    this.rawWsClients.push(ws);
  }
}

/**
 * Initialize WebSocket trigger manager if enabled in config
 */
export async function initializeWebSocketTriggers(
  client: SuiClient,
  poolIds: string[],
  callback: TriggerCallback
): Promise<WebSocketTriggerManager | null> {
  if (!config.enableWs) {
    logger.info('WebSocket triggers disabled (ENABLE_WS=false)');
    return null;
  }

  logger.info(`Initializing WebSocket triggers (mode: ${config.wsTriggerMode})`);
  
  if (config.wsTriggerMode === 'event' && config.minSwapUsd > 0) {
    logger.info(`  Event filtering: MIN_SWAP_USD = ${config.minSwapUsd} USD`);
  }

  const manager = new WebSocketTriggerManager(
    client,
    poolIds,
    config.wsTriggerMode,
    config.minSwapUsd,
    callback,
    config.wsEndpoint
  );

  await manager.start();
  return manager;
}
