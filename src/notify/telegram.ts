import { logger } from '../logger';
import { smallestUnitToSui } from '../config';
import { ArbDirection } from '../executor';

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

/**
 * Telegram notifier for arbitrage opportunities
 */
export class TelegramNotifier {
  private botToken: string;
  private chatId: string;
  private enabled: boolean;

  constructor(config?: TelegramConfig) {
    if (!config || !config.botToken || !config.chatId) {
      this.enabled = false;
      this.botToken = '';
      this.chatId = '';
    } else {
      this.enabled = true;
      this.botToken = config.botToken;
      this.chatId = config.chatId;
    }
  }

  /**
   * Send a message to Telegram
   */
  private async sendMessage(text: string): Promise<void> {
    if (!this.enabled) {
      return; // Silent no-op when disabled
    }

    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: this.chatId,
          text: text,
          parse_mode: 'HTML',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`Telegram API error: ${response.status} ${errorText}`);
      }
    } catch (error) {
      logger.error('Failed to send Telegram notification', error);
    }
  }

  /**
   * Notify about a detected arbitrage opportunity (spread detection)
   */
  async notifyOpportunity(
    price005: number,
    price025: number,
    spread: number,
    direction: ArbDirection,
    poolId005: string,
    poolId025: string
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    const directionText = direction === 'cetus-005-to-025' 
      ? 'Buy 0.05% → Sell 0.25%' 
      : 'Buy 0.25% → Sell 0.05%';

    const message = `
<b>🎯 Cetus Fee-Tier Arb Opportunity</b>

<b>Prices:</b>
0.05% = ${price005.toFixed(6)} USDC/SUI
0.25% = ${price025.toFixed(6)} USDC/SUI

<b>Spread:</b> ${spread.toFixed(4)}%
<b>Direction:</b> ${directionText}

<b>Pools:</b>
0.05%: <code>${poolId005.substring(0, 10)}...${poolId005.substring(poolId005.length - 6)}</code>
0.25%: <code>${poolId025.substring(0, 10)}...${poolId025.substring(poolId025.length - 6)}</code>

<b>Time:</b> ${timestamp}
`.trim();

    await this.sendMessage(message);
  }

  /**
   * Notify when execution starts (before building/submitting PTB)
   */
  async notifyExecutionStart(
    direction: ArbDirection,
    flashloanAmount: bigint,
    minProfit: bigint,
    expectedProfit: bigint,
    isDryRun: boolean
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    const directionText = direction === 'cetus-005-to-025' 
      ? 'Buy 0.05% → Sell 0.25%' 
      : 'Buy 0.25% → Sell 0.05%';
    
    const flashloanSui = smallestUnitToSui(flashloanAmount);
    const minProfitSui = smallestUnitToSui(minProfit);
    const expectedProfitSui = smallestUnitToSui(expectedProfit);

    const mode = isDryRun ? '🔷 DRY RUN' : '🚀 LIVE';

    const message = `
<b>${mode} Execution Starting</b>

<b>Direction:</b> ${directionText}
<b>Flashloan:</b> ${flashloanSui.toFixed(2)} SUI
<b>Min Profit:</b> ${minProfitSui.toFixed(6)} SUI
<b>Expected Profit:</b> ${expectedProfitSui.toFixed(6)} SUI

<b>Time:</b> ${timestamp}
`.trim();

    await this.sendMessage(message);
  }

  /**
   * Notify execution result (success or failure)
   */
  async notifyExecutionResult(
    direction: ArbDirection,
    success: boolean,
    profit?: bigint,
    txDigest?: string,
    error?: string,
    isDryRun?: boolean
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    const directionText = direction === 'cetus-005-to-025' 
      ? 'Buy 0.05% → Sell 0.25%' 
      : 'Buy 0.25% → Sell 0.05%';

    let message: string;

    if (success) {
      const profitSui = profit ? smallestUnitToSui(profit) : 0;
      const profitUsdc = profit ? profitSui * 2.5 : 0; // Rough estimate for display

      if (isDryRun) {
        message = `
<b>✅ Dry Run Successful</b>

<b>Direction:</b> ${directionText}
<b>Estimated Profit:</b> ${profitSui.toFixed(6)} SUI (~$${profitUsdc.toFixed(2)})

<b>Time:</b> ${timestamp}
`.trim();
      } else {
        const txLink = txDigest 
          ? `https://suiscan.xyz/mainnet/tx/${txDigest}`
          : 'N/A';

        message = `
<b>✅ Execution Successful</b>

<b>Direction:</b> ${directionText}
<b>Profit:</b> ${profitSui.toFixed(6)} SUI (~$${profitUsdc.toFixed(2)})

<b>TX:</b> <a href="${txLink}">${txDigest?.substring(0, 10)}...${txDigest?.substring(txDigest.length - 6)}</a>

<b>Time:</b> ${timestamp}
`.trim();
      }
    } else {
      message = `
<b>❌ Execution Failed</b>

<b>Direction:</b> ${directionText}
<b>Error:</b> ${error || 'Unknown error'}

<b>Time:</b> ${timestamp}
`.trim();
    }

    await this.sendMessage(message);
  }
}

/**
 * Initialize Telegram notifier from environment variables
 */
export function initializeTelegramNotifier(): TelegramNotifier {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    logger.info('Telegram notifications disabled (missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID)');
    return new TelegramNotifier();
  }

  logger.info('Telegram notifications enabled');
  return new TelegramNotifier({ botToken, chatId });
}
