#!/usr/bin/env node

/**
 * Standalone Sui Ed25519 Wallet Generator
 * 
 * Generates a new Ed25519 keypair for Sui MAINNET
 * Outputs .env-ready format: PRIVATE_KEY=...
 * 
 * Usage: npm run wallet:generate
 *        OR: node scripts/generate-wallet.js
 */

// Check for required dependencies before importing
function checkDependency(name, path) {
  try {
    require.resolve(path);
    return true;
  } catch (error) {
    return false;
  }
}

const missingDeps = [];
if (!checkDependency('@mysten/sui', '@mysten/sui/keypairs/ed25519')) {
  missingDeps.push('@mysten/sui');
}

if (missingDeps.length > 0) {
  console.error('❌ Missing required dependencies:');
  missingDeps.forEach(dep => console.error(`   - ${dep}`));
  console.error('\n💡 Run: npm install');
  process.exit(1);
}

// Import dependencies after checking they exist
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');

/**
 * Generate a new Sui Ed25519 keypair and output .env-ready format
 */
function generateWallet() {
  try {
    // Generate a new random Ed25519 keypair
    const keypair = Ed25519Keypair.generate();
    
    // Get the private key in Bech32 format (suiprivkey...)
    const privateKey = keypair.getSecretKey();
    
    // Get the Sui address
    const address = keypair.getPublicKey().toSuiAddress();
    
    // Output in .env-ready format
    console.log(`PRIVATE_KEY=${privateKey}`);
    
    // Additional info to stderr so it doesn't interfere with .env output
    console.error('\n✅ New Sui Ed25519 keypair generated for MAINNET');
    console.error(`📍 Address: ${address}`);
    console.error('\n💾 Copy the line above to your .env file');
    console.error('⚠️  NEVER share your private key or commit it to version control!');
    
  } catch (error) {
    console.error('❌ Error generating wallet:', error.message);
    process.exit(1);
  }
}

// Run the generator
generateWallet();
