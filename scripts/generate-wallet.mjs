#!/usr/bin/env node

/**
 * Generate a new Sui Ed25519 keypair and print .env-ready values
 * 
 * Usage: npm run generate-wallet
 * Or: node scripts/generate-wallet.mjs
 */

async function generateWallet() {
  try {
    // Dynamically import Ed25519Keypair from @mysten/sui
    const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');

    // Generate a new random keypair
    const keypair = new Ed25519Keypair();

    // Get the private key in Bech32 format (suiprivkey1...)
    const privateKey = keypair.getSecretKey();

    // Get the Sui address
    const address = keypair.toSuiAddress();

    // Output in .env-ready format
    console.log('PRIVATE_KEY=' + privateKey);
    console.log('WALLET_ADDRESS=' + address);

  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') {
      console.error('Error: @mysten/sui package is not installed.');
      console.error('Please run: npm install');
      process.exit(1);
    }
    throw error;
  }
}

// Run the generator
generateWallet().catch((error) => {
  console.error('Error generating wallet:', error.message);
  process.exit(1);
});
