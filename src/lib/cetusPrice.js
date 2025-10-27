"use strict";
/**
 * Robust Cetus price calculation from sqrt_price_x64
 * Handles both coin orders (A=USDC,B=SUI or A=SUI,B=USDC) unambiguously
 * with decimals USDC=6, SUI=9
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeUsdcPerSuiFromSqrtPrice = computeUsdcPerSuiFromSqrtPrice;
exports.chooseUsdcPerSui = chooseUsdcPerSui;
exports.clearOrientationCache = clearOrientationCache;
const decimal_js_1 = __importDefault(require("decimal.js"));
const logger_1 = require("../logger");
const addresses_1 = require("../addresses");
// Sanity band for USDC/SUI price
const MIN_REASONABLE_PRICE = 0.01;
const MAX_REASONABLE_PRICE = 5.0;
const orientationCache = new Map();
const ORIENTATION_CACHE_TTL_MS = 60000; // 1 minute
/**
 * Compute both candidate USDC/SUI prices from sqrt_price_x64
 */
function computeUsdcPerSuiFromSqrtPrice(params) {
    const { sqrtPriceX64, coinTypeA } = params;
    // Note: coinTypeB not explicitly used but kept in params for API consistency
    // Convert to Decimal for precision
    const sqrtPriceDec = new decimal_js_1.default(sqrtPriceX64.toString());
    const Q64 = new decimal_js_1.default(2).pow(64);
    // sqrtP = sqrtPriceX64 / 2^64
    const sqrtP = sqrtPriceDec.div(Q64);
    // P = sqrtP^2 (this is the raw price ratio from the pool)
    const P = sqrtP.pow(2);
    // Decimals: USDC=6, SUI=9
    const USDC_DECIMALS = 6;
    const SUI_DECIMALS = 9;
    const decimalDiff = SUI_DECIMALS - USDC_DECIMALS; // = 3
    // Compute both candidates:
    // P = amount_B_raw / amount_A_raw (this is what sqrt_price^2 gives us)
    // If A=USDC, B=SUI: P = SUI_raw/USDC_raw
    // SUI_std/USDC_std = P * 10^(6-9) = P * 10^(-3)
    // USDC/SUI = 1 / (SUI/USDC) = 10^3 / P
    const candidateAisUSDC = new decimal_js_1.default(10).pow(decimalDiff).div(P);
    // If A=SUI, B=USDC: P = USDC_raw/SUI_raw
    // USDC_std/SUI_std = P * 10^(9-6) = P * 10^3
    const candidateAisSUI = P.mul(new decimal_js_1.default(10).pow(decimalDiff));
    const candidates = {
        aIsUSDC: candidateAisUSDC.toNumber(),
        aIsSUI: candidateAisSUI.toNumber(),
    };
    // Log both candidates for debugging
    logger_1.logger.debug(`Price candidates: AisUSDC=${candidates.aIsUSDC.toFixed(6)}, AisSUI=${candidates.aIsSUI.toFixed(6)}`);
    // Determine which candidate is valid
    const aIsUSDCValid = candidates.aIsUSDC >= MIN_REASONABLE_PRICE && candidates.aIsUSDC <= MAX_REASONABLE_PRICE;
    const aIsSUIValid = candidates.aIsSUI >= MIN_REASONABLE_PRICE && candidates.aIsSUI <= MAX_REASONABLE_PRICE;
    // Actual coin type check
    const actualAisUSDC = coinTypeA.includes('usdc') ||
        coinTypeA.includes('USDC') ||
        coinTypeA === addresses_1.COIN_TYPES.BRIDGED_USDC;
    const actualAisSUI = coinTypeA === addresses_1.COIN_TYPES.SUI;
    let method;
    let price;
    // Use actual coin types to determine orientation
    if (actualAisUSDC) {
        method = 'AisUSDC';
        price = candidates.aIsUSDC;
    }
    else if (actualAisSUI) {
        method = 'AisSUI';
        price = candidates.aIsSUI;
    }
    else {
        // Fallback: use sanity check
        if (aIsUSDCValid && !aIsSUIValid) {
            method = 'AisUSDC';
            price = candidates.aIsUSDC;
            logger_1.logger.debug('Chose AisUSDC based on sanity check (only it is valid)');
        }
        else if (aIsSUIValid && !aIsUSDCValid) {
            method = 'AisSUI';
            price = candidates.aIsSUI;
            logger_1.logger.debug('Chose AisSUI based on sanity check (only it is valid)');
        }
        else {
            // Both valid or both invalid - fallback to the one closer to expected range center
            const expectedCenter = 0.37;
            const distAisUSDC = Math.abs(candidates.aIsUSDC - expectedCenter);
            const distAisSUI = Math.abs(candidates.aIsSUI - expectedCenter);
            if (distAisUSDC <= distAisSUI) {
                method = 'AisUSDC';
                price = candidates.aIsUSDC;
                logger_1.logger.debug('Chose AisUSDC based on proximity to expected price');
            }
            else {
                method = 'AisSUI';
                price = candidates.aIsSUI;
                logger_1.logger.debug('Chose AisSUI based on proximity to expected price');
            }
        }
    }
    return { price, method, candidates };
}
/**
 * Choose USDC/SUI price with quote-first orientation lock
 */
function chooseUsdcPerSui(params) {
    const { poolId, sqrtPriceX64, coinTypeA, coinTypeB, lastQuotePrice } = params;
    // If we have a quote price, use it directly
    if (lastQuotePrice !== undefined && lastQuotePrice > 0) {
        logger_1.logger.debug(`Using quote price: ${lastQuotePrice.toFixed(6)} USDC/SUI`);
        // Compute candidates to determine and cache orientation
        const { method, candidates } = computeUsdcPerSuiFromSqrtPrice({
            sqrtPriceX64,
            coinTypeA,
            coinTypeB,
        });
        // Determine which candidate matches the quote within ±10%
        const matchThreshold = 0.1; // 10%
        const aIsUSDCMatch = Math.abs(candidates.aIsUSDC - lastQuotePrice) / lastQuotePrice <= matchThreshold;
        const aIsSUIMatch = Math.abs(candidates.aIsSUI - lastQuotePrice) / lastQuotePrice <= matchThreshold;
        let finalMethod = method;
        if (aIsUSDCMatch && !aIsSUIMatch) {
            finalMethod = 'AisUSDC';
        }
        else if (aIsSUIMatch && !aIsUSDCMatch) {
            finalMethod = 'AisSUI';
        }
        else if (aIsUSDCMatch && aIsSUIMatch) {
            // Both match, prefer the closer one
            const distAisUSDC = Math.abs(candidates.aIsUSDC - lastQuotePrice);
            const distAisSUI = Math.abs(candidates.aIsSUI - lastQuotePrice);
            finalMethod = distAisUSDC <= distAisSUI ? 'AisUSDC' : 'AisSUI';
        }
        // Cache the orientation
        orientationCache.set(poolId, {
            method: finalMethod,
            timestamp: Date.now(),
            quotePrice: lastQuotePrice,
        });
        logger_1.logger.debug(`Cached orientation for pool ${poolId.slice(0, 8)}...: ${finalMethod}`);
        return lastQuotePrice;
    }
    // No quote available, use fallback
    const result = computeUsdcPerSuiFromSqrtPrice({
        sqrtPriceX64,
        coinTypeA,
        coinTypeB,
    });
    // Check cache for orientation preference
    const cached = orientationCache.get(poolId);
    if (cached && Date.now() - cached.timestamp < ORIENTATION_CACHE_TTL_MS) {
        logger_1.logger.debug(`Using cached orientation for pool ${poolId.slice(0, 8)}...: ${cached.method}`);
        const cachedPrice = result.candidates[cached.method === 'AisUSDC' ? 'aIsUSDC' : 'aIsSUI'];
        // Validate cached orientation choice
        if (cachedPrice >= MIN_REASONABLE_PRICE && cachedPrice <= MAX_REASONABLE_PRICE) {
            return cachedPrice;
        }
        else {
            logger_1.logger.warn(`Cached orientation ${cached.method} gave unreasonable price ${cachedPrice.toFixed(6)}, using computed result`);
        }
    }
    // Log the choice
    logger_1.logger.debug(`Fallback price computed: ${result.price.toFixed(6)} USDC/SUI (method: ${result.method})`);
    // Validate result
    if (result.price < MIN_REASONABLE_PRICE || result.price > MAX_REASONABLE_PRICE) {
        logger_1.logger.warn(`⚠️  Computed price ${result.price.toFixed(6)} USDC/SUI is outside reasonable bounds [${MIN_REASONABLE_PRICE}, ${MAX_REASONABLE_PRICE}]`);
        logger_1.logger.warn(`Pool: ${poolId}`);
        logger_1.logger.warn(`Coin order: A=${coinTypeA.split('::').pop()}, B=${coinTypeB.split('::').pop()}`);
        logger_1.logger.warn(`sqrt_price_x64: ${sqrtPriceX64.toString()}`);
        logger_1.logger.warn(`Candidates: AisUSDC=${result.candidates.aIsUSDC.toFixed(6)}, AisSUI=${result.candidates.aIsSUI.toFixed(6)}`);
        logger_1.logger.warn('Recommend re-quoting with SDK preSwap for accurate price');
    }
    return result.price;
}
/**
 * Clear orientation cache (for testing)
 */
function clearOrientationCache() {
    orientationCache.clear();
    logger_1.logger.debug('Orientation cache cleared');
}
