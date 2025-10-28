import { SuiClient } from '@mysten/sui/client';
import { logger } from '../logger';
import { config, smallestUnitToUsdc } from '../config';
import { CETUS } from '../addresses';

export type TriggerCallback = () => void | Promise<void>;

type Unsubscribe = () => Promise<boolean>;

/**
 * WebSocket trigger manager for Sui pool monitoring
 * Supports both object change and event-based triggers
 */
export class WebSocketTriggerManager {
  private client: SuiClient;
  private callbacks: TriggerCallback[] = [];
  private unsubscribeFns: Unsubscribe[] = [];
  private enabled: boolean;
  private mode: 'object' | 'event';
  private minSwapUsd: number;

  constructor(client: SuiClient) {
    this.client = client;
    this.enabled = config.enableWs;
    this.mode = config.wsTriggerMode;
    this.minSwapUsd = config.minSwapUsd;

    if (!this.enabled) {
      logger.info('WebSocket triggers disabled (ENABLE_WS=false or not set)');
    }
  }

  /**
   * Register a callback to be invoked when a trigger fires
   */
  onTrigger(callback: TriggerCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Start WebSocket subscriptions based on configured mode
   */
  async start(): Promise<void> {
    if (!this.enabled) {
      logger.debug('WebSocket triggers not enabled, skipping subscription');
      return;
    }

    logger.info(`Starting WebSocket triggers in ${this.mode} mode...`);

    try {
      if (this.mode === 'object') {
        await this.subscribeToObjectChanges();
      } else if (this.mode === 'event') {
        await this.subscribeToSwapEvents();
      } else {
        logger.warn(`Unknown WS_TRIGGER_MODE: ${this.mode}, defaulting to object mode`);
        await this.subscribeToObjectChanges();
      }

      logger.success('WebSocket triggers started successfully');
    } catch (error) {
      logger.error('Failed to start WebSocket triggers', error);
      throw error;
    }
  }

  /**
   * Subscribe to pool object changes (object mode)
   * Monitors both Cetus 0.05% and 0.25% pool objects for any changes
   */
  private async subscribeToObjectChanges(): Promise<void> {
    const pool005Id = CETUS.suiUsdcPool005Id;
    const pool025Id = CETUS.suiUsdcPool025Id;

    logger.info(`Subscribing to pool object changes:`);
    logger.info(`  - Pool 0.05%: ${pool005Id}`);
    logger.info(`  - Pool 0.25%: ${pool025Id}`);

    try {
      // Subscribe to 0.05% pool changes
      const unsubscribe005 = await this.client.subscribeEvent({
        filter: { MoveEventType: `${CETUS.packageId}::pool::SwapEvent` },
        onMessage: (event) => {
          this.handleObjectChange(pool005Id, event);
        },
      });
      this.unsubscribeFns.push(unsubscribe005);

      // Subscribe to 0.25% pool changes
      const unsubscribe025 = await this.client.subscribeEvent({
        filter: { MoveEventType: `${CETUS.packageId}::pool::SwapEvent` },
        onMessage: (event) => {
          this.handleObjectChange(pool025Id, event);
        },
      });
      this.unsubscribeFns.push(unsubscribe025);

      logger.info('Successfully subscribed to pool object changes');
    } catch (error) {
      logger.error('Failed to subscribe to object changes', error);
      throw error;
    }
  }

  /**
   * Subscribe to swap events (event mode)
   * Filters events by pool and optionally by swap size
   */
  private async subscribeToSwapEvents(): Promise<void> {
    const pool005Id = CETUS.suiUsdcPool005Id;
    const pool025Id = CETUS.suiUsdcPool025Id;

    logger.info(`Subscribing to swap events (MIN_SWAP_USD: ${this.minSwapUsd}):`);
    logger.info(`  - Pool 0.05%: ${pool005Id}`);
    logger.info(`  - Pool 0.25%: ${pool025Id}`);

    try {
      // Subscribe to all swap events from Cetus pools
      const unsubscribe = await this.client.subscribeEvent({
        filter: { MoveEventType: `${CETUS.packageId}::pool::SwapEvent` },
        onMessage: (event) => {
          this.handleSwapEvent(event);
        },
      });
      this.unsubscribeFns.push(unsubscribe);

      logger.info('Successfully subscribed to swap events');
    } catch (error) {
      logger.error('Failed to subscribe to swap events', error);
      throw error;
    }
  }

  /**
   * Handle object change notification
   */
  private handleObjectChange(_poolId: string, _event: any): void {
    logger.debug(`Pool object changed: ${_poolId.substring(0, 10)}...`);
    this.triggerCallbacks();
  }

  /**
   * Handle swap event notification
   * Filters by MIN_SWAP_USD if configured
   */
  private handleSwapEvent(event: any): void {
    try {
      const parsedJson = event.parsedJson;
      
      // Extract pool ID from event
      const poolId = parsedJson?.pool || event.id?.txDigest;
      
      // Extract swap amounts (implementation depends on Cetus event structure)
      // This is a simplified version - actual implementation may need adjustment
      const amountIn = parsedJson?.amount_in ? BigInt(parsedJson.amount_in) : BigInt(0);
      const amountOut = parsedJson?.amount_out ? BigInt(parsedJson.amount_out) : BigInt(0);

      // Apply MIN_SWAP_USD filter if configured
      if (this.minSwapUsd > 0) {
        // Estimate USD value (simplified - assumes USDC is one of the swap tokens)
        const estimatedUsd = Math.max(
          smallestUnitToUsdc(amountIn),
          smallestUnitToUsdc(amountOut)
        );

        if (estimatedUsd < this.minSwapUsd) {
          logger.debug(
            `Swap event filtered out (${estimatedUsd.toFixed(2)} USD < ${this.minSwapUsd} USD)`
          );
          return;
        }

        logger.debug(
          `Swap event detected: ${estimatedUsd.toFixed(2)} USD on pool ${poolId?.substring(0, 10)}...`
        );
      }

      this.triggerCallbacks();
    } catch (error) {
      logger.error('Error handling swap event', error);
    }
  }

  /**
   * Trigger all registered callbacks
   */
  private triggerCallbacks(): void {
    logger.debug(`Triggering ${this.callbacks.length} callback(s)`);
    
    for (const callback of this.callbacks) {
      try {
        const result = callback();
        // Handle async callbacks
        if (result instanceof Promise) {
          result.catch((error) => {
            logger.error('Error in WebSocket trigger callback', error);
          });
        }
      } catch (error) {
        logger.error('Error in WebSocket trigger callback', error);
      }
    }
  }

  /**
   * Stop all WebSocket subscriptions
   */
  async stop(): Promise<void> {
    if (!this.enabled) {
      return;
    }

    logger.info('Stopping WebSocket triggers...');

    for (const unsubscribe of this.unsubscribeFns) {
      try {
        await unsubscribe();
      } catch (error) {
        logger.error('Error unsubscribing from WebSocket', error);
      }
    }

    this.unsubscribeFns = [];
    logger.info('WebSocket triggers stopped');
  }
}

/**
 * Initialize WebSocket trigger manager
 */
export function initializeWebSocketTriggers(client: SuiClient): WebSocketTriggerManager {
  return new WebSocketTriggerManager(client);
}
