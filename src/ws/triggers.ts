import { SuiClient } from '@mysten/sui/client';
import { logger } from '../logger';
import { config } from '../config';

// Type for SuiEvent
type SuiEvent = any; // Using any for compatibility with @mysten/sui API

export type TriggerCallback = () => Promise<void>;

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

  constructor(
    client: SuiClient,
    poolIds: string[],
    mode: 'object' | 'event',
    minSwapUsd: number,
    callback: TriggerCallback
  ) {
    this.client = client;
    this.mode = mode;
    this.minSwapUsd = minSwapUsd;
    this.poolIds = poolIds;
    this.callback = callback;
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

    if (this.mode === 'object') {
      await this.subscribeToObjectUpdates();
    } else if (this.mode === 'event') {
      await this.subscribeToSwapEvents();
    }

    logger.success('WebSocket trigger manager started');
  }

  /**
   * Stop monitoring pool updates
   */
  async stop(): Promise<void> {
    if (!this.isActive) {
      return;
    }

    logger.info('Stopping WebSocket trigger manager...');
    
    // Unsubscribe from all subscriptions
    for (const unsubscribe of this.unsubscribeFunctions) {
      try {
        await unsubscribe();
      } catch (error) {
        logger.error('Error unsubscribing from WebSocket', error);
      }
    }
    
    this.unsubscribeFunctions = [];
    this.isActive = false;
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
      } catch (error) {
        logger.error(`Failed to subscribe to pool ${poolId}`, error);
      }
    }
  }

  /**
   * Subscribe to swap events (mode: event)
   * Filters events by MIN_SWAP_USD if configured
   */
  private async subscribeToSwapEvents(): Promise<void> {
    for (const poolId of this.poolIds) {
      try {
        logger.debug(`Subscribing to swap events for pool: ${poolId}`);
        
        const unsubscribe = await this.client.subscribeEvent({
          filter: {
            MoveEventType: `${poolId}::pool::SwapEvent` as any,
          },
          onMessage: async (event: SuiEvent) => {
            // Apply MIN_SWAP_USD filter if configured
            if (this.minSwapUsd > 0) {
              // Extract swap amount from event data and compare to threshold
              // This is a simplified check - in production, parse event.parsedJson
              const swapData = event.parsedJson as any;
              if (swapData && swapData.amount_in) {
                const amountUsd = parseFloat(swapData.amount_in) / 1_000_000; // Assuming USDC decimals
                if (amountUsd < this.minSwapUsd) {
                  logger.debug(`Swap amount (${amountUsd} USD) below threshold (${this.minSwapUsd} USD), skipping`);
                  return;
                }
              }
            }

            logger.debug(`Swap event detected on pool: ${poolId}`);
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
      } catch (error) {
        logger.error(`Failed to subscribe to swap events on pool ${poolId}`, error);
      }
    }
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
    callback
  );

  await manager.start();
  return manager;
}
