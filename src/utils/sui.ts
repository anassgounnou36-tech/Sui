import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { fromB64 } from '@mysten/sui/utils';
import { config, normalizePrivateKey } from '../config';
import { logger } from '../logger';

let suiClient: SuiClient | null = null;
let keypair: Ed25519Keypair | null = null;
let currentRpcUrl: string = '';
let rpcEndpoints: string[] = [];
let requestCounter: number = 0;
let currentRpcIndex: number = 0;

/**
 * Initialize the Sui RPC client with failover support
 */
export function initializeRpcClient(
  primaryUrl?: string,
  backupUrl?: string,
  fallbackUrl?: string
): SuiClient {
  if (!suiClient) {
    // Build list of RPC endpoints
    if (primaryUrl || config.rpcEndpoints.primary) {
      rpcEndpoints = [
        primaryUrl || config.rpcEndpoints.primary,
        backupUrl || config.rpcEndpoints.backup,
        fallbackUrl || config.rpcEndpoints.fallback,
      ].filter((url) => url && url.length > 0);
    } else {
      // Fallback to legacy single URL
      rpcEndpoints = [config.rpcUrl];
    }

    // Try to connect to first available endpoint
    let connected = false;
    for (const url of rpcEndpoints) {
      try {
        suiClient = new SuiClient({ url });
        currentRpcUrl = url;
        currentRpcIndex = 0;
        logger.info(`Initialized Sui RPC client: ${url}`);
        connected = true;
        break;
      } catch (error) {
        logger.warn(`Failed to connect to ${url}, trying next...`, error);
      }
    }

    if (!connected || !suiClient) {
      throw new Error('Failed to connect to any RPC endpoint');
    }
  }
  return suiClient;
}

/**
 * Rotate to the next RPC endpoint (round-robin)
 */
function rotateRpc(): void {
  if (rpcEndpoints.length <= 1) {
    return; // No rotation needed if only one endpoint
  }

  const nextIndex = (currentRpcIndex + 1) % rpcEndpoints.length;
  const nextUrl = rpcEndpoints[nextIndex];

  try {
    suiClient = new SuiClient({ url: nextUrl });
    currentRpcUrl = nextUrl;
    currentRpcIndex = nextIndex;
    logger.info(`Rotated to RPC endpoint: ${nextUrl}`);
  } catch (error) {
    logger.error(`Failed to rotate to ${nextUrl}, keeping current`, error);
  }
}

/**
 * Failover to next RPC endpoint if current one fails
 */
async function failoverRpc(): Promise<SuiClient> {
  const currentIndex = rpcEndpoints.indexOf(currentRpcUrl);
  const nextIndex = (currentIndex + 1) % rpcEndpoints.length;

  if (nextIndex === currentIndex) {
    throw new Error('No alternative RPC endpoints available');
  }

  const nextUrl = rpcEndpoints[nextIndex];
  logger.warn(`Failing over from ${currentRpcUrl} to ${nextUrl}`);

  try {
    const newClient = new SuiClient({ url: nextUrl });
    suiClient = newClient;
    currentRpcUrl = nextUrl;
    currentRpcIndex = nextIndex;
    logger.info(`Successfully connected to backup RPC: ${nextUrl}`);
    return newClient;
  } catch (error) {
    logger.error(`Failed to connect to ${nextUrl}`, error);
    throw error;
  }
}

/**
 * Get the initialized Sui client (throws if not initialized)
 * Automatically rotates RPC endpoints after configured number of requests
 */
export function getSuiClient(): SuiClient {
  if (!suiClient) {
    throw new Error('Sui client not initialized. Call initializeRpcClient first.');
  }

  // Increment request counter and check for rotation
  requestCounter++;
  if (requestCounter >= config.rotateAfterRequests) {
    rotateRpc();
    requestCounter = 0;
  }
  return suiClient;
}

/**
 * Initialize keypair from private key (supports hex with/without 0x and base64)
 */
export function initializeKeypair(privateKey: string): Ed25519Keypair {
  if (!keypair) {
    try {
      // Normalize the private key format
      const normalizedKey = normalizePrivateKey(privateKey);

      // Handle both base64 and hex formats
      const secretKey = normalizedKey.startsWith('0x')
        ? Uint8Array.from(Buffer.from(normalizedKey.slice(2), 'hex'))
        : fromB64(normalizedKey);
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
 * Sign and execute a transaction with exponential backoff, finality polling, and RPC failover
 */
export async function signAndExecuteTransaction(
  tx: Transaction,
  options: {
    maxRetries?: number;
    initialDelayMs?: number;
    pollIntervalMs?: number;
    maxPollWaitMs?: number;
  } = {}
): Promise<{ digest: string; effects: any }> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    pollIntervalMs = config.finalityPollIntervalMs,
    maxPollWaitMs = config.finalityMaxWaitMs,
  } = options;

  let client = getSuiClient();
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

      // Wait for finality with timeout
      let pollAttempts = 0;
      const maxPollAttempts = Math.floor(maxPollWaitMs / pollIntervalMs);

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
      logger.warn(`Transaction submitted but finality not confirmed within ${maxPollWaitMs}ms: ${digest}`);
      return {
        digest,
        effects: result.effects,
      };
    } catch (error) {
      lastError = error as Error;
      logger.error(`Transaction attempt ${attempt + 1} failed`, error);

      // Try failover if this looks like an RPC issue
      if (
        attempt < maxRetries - 1 &&
        (error instanceof Error &&
          (error.message.includes('network') ||
            error.message.includes('timeout') ||
            error.message.includes('connection')))
      ) {
        try {
          client = await failoverRpc();
          logger.info('RPC failover successful, retrying transaction');
        } catch (failoverError) {
          logger.error('RPC failover failed', failoverError);
        }
      }

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
export async function dryRunTransaction(tx: any): Promise<any> {
  const client = getSuiClient();

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
