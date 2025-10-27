import { getSuiClient, initializeRpcClient } from '../src/utils/sui';
import { SUILEND } from '../src/addresses';
import { config } from '../src/config';

async function inspectSuilendMarket() {
  console.log('=== Suilend Market Inspection ===\n');
  console.log(`Market ID: ${SUILEND.lendingMarket}\n`);
  
  try {
    // Initialize RPC client
    initializeRpcClient(
      config.rpcEndpoints.primary,
      config.rpcEndpoints.backup,
      config.rpcEndpoints.fallback
    );
    
    const client = getSuiClient();
    const lendingMarket = await client.getObject({
      id: SUILEND.lendingMarket,
      options: { showContent: true, showType: true },
    });

    if (!lendingMarket.data || !lendingMarket.data.content) {
      console.error('Suilend lending market not found');
      process.exit(1);
    }

    console.log('Market Type:', lendingMarket.data.type);
    console.log();

    const content = lendingMarket.data.content as any;
    if (content.dataType !== 'moveObject') {
      console.error('Invalid lending market object type');
      process.exit(1);
    }

    console.log('Content Fields Keys:', Object.keys(content.fields));
    console.log();

    // Check reserves structure
    const reserves = content.fields.reserves || [];
    console.log(`Number of reserves: ${reserves.length}`);
    console.log();

    // Inspect each reserve
    for (let i = 0; i < reserves.length; i++) {
      const reserve = reserves[i];
      console.log(`\n=== Reserve ${i} ===`);
      console.log('Reserve Fields Keys:', Object.keys(reserve.fields || reserve));
      
      // Try different ways to access coin_type
      console.log('\nCoin type access attempts:');
      console.log('  reserve.fields?.coin_type:', reserve.fields?.coin_type);
      console.log('  reserve.coin_type:', reserve.coin_type);
      
      if (reserve.fields?.coin_type) {
        console.log('  reserve.fields.coin_type structure:');
        console.log('    Type:', typeof reserve.fields.coin_type);
        if (typeof reserve.fields.coin_type === 'object') {
          console.log('    Keys:', Object.keys(reserve.fields.coin_type));
          console.log('    name:', reserve.fields.coin_type.name);
        } else {
          console.log('    Value:', reserve.fields.coin_type);
        }
      }
      
      // Check config structure
      if (reserve.fields?.config) {
        console.log('\nConfig structure:');
        console.log('  Type:', typeof reserve.fields.config);
        if (typeof reserve.fields.config === 'object') {
          console.log('  Keys:', Object.keys(reserve.fields.config));
          console.log('  borrow_fee_bps:', reserve.fields.config.borrow_fee_bps);
          
          if (reserve.fields.config.fields) {
            console.log('  config.fields keys:', Object.keys(reserve.fields.config.fields));
            console.log('  config.fields.borrow_fee_bps:', reserve.fields.config.fields.borrow_fee_bps);
          }
        }
      }
      
      // Check available_amount
      console.log('\navailable_amount:', reserve.fields?.available_amount);
      
      // Only show first 3 reserves in detail
      if (i >= 2) {
        console.log('\n...(remaining reserves omitted for brevity)');
        break;
      }
    }

    // Look for SUI reserve specifically
    console.log('\n\n=== Searching for SUI Reserve ===');
    const suiReserves = reserves.filter((r: any) => {
      const coinType = r.fields?.coin_type?.name || r.fields?.coin_type || r.coin_type;
      return coinType === '0x2::sui::SUI';
    });
    
    console.log(`Found ${suiReserves.length} SUI reserve(s)`);
    
    if (suiReserves.length > 0) {
      const suiReserve = suiReserves[0];
      const idx = reserves.indexOf(suiReserve);
      console.log(`\nSUI Reserve at index ${idx}:`);
      console.log(JSON.stringify(suiReserve, null, 2));
    }

  } catch (error) {
    console.error('Failed to inspect Suilend market:', error);
    process.exit(1);
  }
}

inspectSuilendMarket();
