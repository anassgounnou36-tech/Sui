import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { fromB64 } from '@mysten/sui/utils';
import { config } from '../config';
import { logger } from '../logger';

let suiClient: SuiClient | null = null;
let keypair: Ed25519Keypair | null = null;

/**
 * Initialize the Sui RPC client
 */
export function initializeRpcClient(rpcUrl: string): SuiClient {
  if (!suiClient) {
    suiClient = new SuiClient({ url: rpcUrl });
    logger.info(`Initialized Sui RPC client: ${rpcUrl}`);
  }
  return suiClient;
}

/**
 * Get the initialized Sui client (throws if not initialized)
 */
export function getSuiClient(): SuiClient {
  if (!suiClient) {
    throw new Error('Sui client not initialized. Call initializeRpcClient first.');
  }
  return suiClient;
}

/**
 * Initialize keypair from private key
 */
export function initializeKeypair(privateKey: string): Ed25519Keypair {
  if (!keypair) {
    try {
      // Handle both base64 and hex formats
      const secretKey = privateKey.startsWith('0x')
        ? Uint8Array.from(Buffer.from(privateKey.slice(2), 'hex'))
        : fromB64(privateKey);
      keypair = Ed25519Keypair.fromSecretKey(secretKey);
      logger.info('Keypair initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize keypair', error);
      throw error;
    }
  }
  return keypair;
}

/**
 * Get the initialized keypair
 */
export function getKeypair(): Ed25519Keypair {
  if (!keypair) {
    throw new Error('Keypair not initialized. Call initializeKeypair first.');
  }
  return keypair;
}

/**
 * Sign and execute a transaction with exponential backoff and finality polling
 */
export async function signAndExecuteTransaction(
  tx: Transaction,
  options: {
    maxRetries?: number;
    initialDelayMs?: number;
    pollIntervalMs?: number;
  } = {}
): Promise<{ digest: string; effects: any }> {
  const { maxRetries = 3, initialDelayMs = 1000, pollIntervalMs = 500 } = options;

  const client = getSuiClient();
  const kp = getKeypair();

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = initialDelayMs * Math.pow(2, attempt - 1);
        logger.info(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`);
        await sleep(delay);
      }

      // Sign and execute the transaction
      const result = await client.signAndExecuteTransaction({
        transaction: tx,
        signer: kp,
        options: {
          showEffects: true,
          showEvents: true,
        },
      });

      // Poll for finality
      const digest = result.digest;
      logger.info(`Transaction submitted: ${digest}`);

      // Wait for finality
      let finalTx = result;
      let pollAttempts = 0;
      const maxPollAttempts = 20; // 10 seconds max

      while (pollAttempts < maxPollAttempts) {
        const txResponse = await client.getTransactionBlock({
          digest,
          options: {
            showEffects: true,
            showEvents: true,
          },
        });

        if (txResponse.effects?.status?.status === 'success') {
          logger.success(`Transaction finalized successfully: ${digest}`);
          return {
            digest,
            effects: txResponse.effects,
          };
        } else if (txResponse.effects?.status?.status === 'failure') {
          throw new Error(
            `Transaction failed: ${txResponse.effects?.status?.error || 'Unknown error'}`
          );
        }

        await sleep(pollIntervalMs);
        pollAttempts++;
      }

      // If we got here, we have a result but didn't confirm finality
      logger.warn(`Transaction submitted but finality not confirmed: ${digest}`);
      return {
        digest,
        effects: finalTx.effects,
      };
    } catch (error) {
      lastError = error as Error;
      logger.error(`Transaction attempt ${attempt + 1} failed`, error);

      if (attempt === maxRetries - 1) {
        throw lastError;
      }
    }
  }

  throw lastError || new Error('Transaction failed after all retries');
}

/**
 * Get object info from Sui network
 */
export async function getObject(objectId: string): Promise<any> {
  const client = getSuiClient();
  return await client.getObject({
    id: objectId,
    options: {
      showType: true,
      showContent: true,
      showOwner: true,
    },
  });
}

/**
 * Check if an object exists on-chain
 */
export async function objectExists(objectId: string): Promise<boolean> {
  try {
    const obj = await getObject(objectId);
    return obj.data !== null;
  } catch {
    return false;
  }
}

/**
 * Get coin balance for an address
 */
export async function getCoinBalance(address: string, coinType: string): Promise<bigint> {
  const client = getSuiClient();
  try {
    const balance = await client.getBalance({
      owner: address,
      coinType,
    });
    return BigInt(balance.totalBalance);
  } catch (error) {
    logger.error(`Failed to get balance for ${coinType}`, error);
    return BigInt(0);
  }
}

/**
 * Get all coin balances for an address
 */
export async function getAllBalances(address: string): Promise<Map<string, bigint>> {
  const client = getSuiClient();
  const balances = new Map<string, bigint>();

  try {
    const allBalances = await client.getAllBalances({
      owner: address,
    });

    for (const balance of allBalances) {
      balances.set(balance.coinType, BigInt(balance.totalBalance));
    }
  } catch (error) {
    logger.error('Failed to get all balances', error);
  }

  return balances;
}

/**
 * Dry run a transaction to estimate gas and effects
 */
export async function dryRunTransaction(tx: Transaction): Promise<any> {
  const client = getSuiClient();
  const kp = getKeypair();

  try {
    const result = await client.dryRunTransactionBlock({
      transactionBlock: await tx.build({ client }),
    });

    return result;
  } catch (error) {
    logger.error('Dry run failed', error);
    throw error;
  }
}

/**
 * Helper to sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build transaction with proper gas budget
 */
export function buildTransaction(): Transaction {
  const tx = new Transaction();
  tx.setGasBudget(config.gasBudget);
  return tx;
}
