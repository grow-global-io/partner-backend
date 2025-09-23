/**
 * @fileoverview Payment Routes
 * @description API routes for handling plan purchases and payment processing
 * @author GrowLimitless Team
 */

const express = require("express");
const axios = require("axios");
const prisma = require("../config/db");
const fs = require("fs");
const path = require("path");
const { getMyBalance } = require("../config/blockchain");

const router = express.Router();


// Payment Gateway Configuration
const PAYMENT_GATEWAY_URL =
  "https://gll-gateway.growlimitless.app/api/sessions";
const FRONTEND_URL = process.env.NODE_ENV === "production"
  ? "https://www.gll.one"
  : "http://localhost:3000";
const BASE_URL = process.env.BASE_URL;

// Currency Cache Configuration
const CACHE_FILE_PATH = path.join(__dirname, "../cache/currency_cache.json");
let currencyCache = new Map();

/**
 * @description Initialize currency cache from file on server start
 */
function initializeCurrencyCache() {
  try {
    // Create cache directory if it doesn't exist
    const cacheDir = path.dirname(CACHE_FILE_PATH);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    // Load existing cache from file
    if (fs.existsSync(CACHE_FILE_PATH)) {
      const cacheData = JSON.parse(fs.readFileSync(CACHE_FILE_PATH, "utf8"));
      currencyCache = new Map(Object.entries(cacheData));
      console.log(
        `💾 Currency cache loaded with ${currencyCache.size} entries`
      );

      // Clean expired entries on startup
      cleanExpiredCacheEntries();
    } else {
      console.log("💾 No existing currency cache found, starting fresh");
    }
  } catch (error) {
    console.error("❌ Error initializing currency cache:", error);
    currencyCache = new Map();
  }
}

/**
 * @description Save currency cache to file
 */
function saveCurrencyCache() {
  try {
    const cacheObject = Object.fromEntries(currencyCache);
    fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(cacheObject, null, 2));
    console.log(`💾 Currency cache saved with ${currencyCache.size} entries`);
  } catch (error) {
    console.error("❌ Error saving currency cache:", error);
  }
}

/**
 * @description Clean expired cache entries (older than 24 hours)
 */
function cleanExpiredCacheEntries() {
  const now = new Date();
  const oneDayMs = 24 * 60 * 60 * 1000;
  let removedCount = 0;

  for (const [key, entry] of currencyCache.entries()) {
    const entryTime = new Date(entry.timestamp);
    if (now - entryTime > oneDayMs) {
      currencyCache.delete(key);
      removedCount++;
    }
  }

  if (removedCount > 0) {
    console.log(`🧹 Cleaned ${removedCount} expired cache entries`);
    saveCurrencyCache();
  }
}

/**
 * @description Get cache key for currency pair
 */
function getCacheKey(from, to) {
  return `${from.toUpperCase()}_${to.toUpperCase()}`;
}

/**
 * @description Check if cache entry is valid (less than 24 hours old)
 */
function isCacheValid(cacheEntry) {
  if (!cacheEntry || !cacheEntry.timestamp) return false;

  const now = new Date();
  const entryTime = new Date(cacheEntry.timestamp);
  const oneDayMs = 24 * 60 * 60 * 1000;

  return now - entryTime < oneDayMs;
}

/**
 * @description Get cached exchange rate or null if not available/expired
 */
function getCachedRate(from, to) {
  const cacheKey = getCacheKey(from, to);
  const cacheEntry = currencyCache.get(cacheKey);

  if (cacheEntry && isCacheValid(cacheEntry)) {
    console.log(
      `💰 Using cached rate for ${from} → ${to}: ${cacheEntry.exchangeRate}`
    );
    return cacheEntry;
  }

  // Remove expired entry
  if (cacheEntry && !isCacheValid(cacheEntry)) {
    currencyCache.delete(cacheKey);
    console.log(`🗑️ Removed expired cache entry for ${from} → ${to}`);
  }

  return null;
}

/**
 * @description Cache exchange rate data
 */
function cacheExchangeRate(from, to, exchangeRate, rawResponse) {
  const cacheKey = getCacheKey(from, to);
  const cacheEntry = {
    from: from.toUpperCase(),
    to: to.toUpperCase(),
    exchangeRate,
    timestamp: new Date().toISOString(),
    rawResponse,
    cached: true,
  };

  currencyCache.set(cacheKey, cacheEntry);
  console.log(`💾 Cached exchange rate for ${from} → ${to}: ${exchangeRate}`);

  // Save to file for persistence
  saveCurrencyCache();
}

// Initialize cache on module load
initializeCurrencyCache();

// Clean expired cache entries every hour
setInterval(cleanExpiredCacheEntries, 60 * 60 * 1000);

/**
 * @description Validates the request payload for payment processing
 * @param {Object} payload - The request payload to validate
 * @returns {Object} Validation result with isValid boolean and error message
 */
function validatePaymentPayload(payload) {
  const requiredFields = [
    "walletId",
    "mode",
    "line_items",
    "metadata",
    "noOfDocs",
  ];

  for (const field of requiredFields) {
    if (!payload[field]) {
      return { isValid: false, error: `Missing required field: ${field}` };
    }
  }

  // Validate noOfDocs is a positive number
  if (typeof payload.noOfDocs !== "number" || payload.noOfDocs <= 0) {
    return { isValid: false, error: "noOfDocs must be a positive number" };
  }

  // Validate line_items structure
  if (!Array.isArray(payload.line_items) || payload.line_items.length === 0) {
    return { isValid: false, error: "line_items must be a non-empty array" };
  }

  for (const item of payload.line_items) {
    if (
      !item.price_data ||
      !item.price_data.product_data ||
      typeof item.price_data.unit_amount !== "number"
    ) {
      return { isValid: false, error: "Invalid line_items structure" };
    }
  }

  return { isValid: true };
}

/**
 * @description Get masked Stripe API key for debugging
 * @returns {Object} Masked API key info
 */
function getMaskedStripeKey() {
  const apiKey = process.env.STRIPE_SECRET_KEY;

  if (!apiKey) {
    return {
      masked: "NOT_SET",
      length: 0,
      isValid: false,
      error: "STRIPE_SECRET_KEY environment variable is not set",
    };
  }

  if (apiKey.length < 8) {
    return {
      masked: "TOO_SHORT",
      length: apiKey.length,
      isValid: false,
      error: "Stripe API key is too short (should be at least 8 characters)",
    };
  }

  const first4 = apiKey.substring(0, 4);
  const last4 = apiKey.substring(apiKey.length - 4);
  const masked = `${first4}${"*".repeat(
    Math.max(0, apiKey.length - 8)
  )}${last4}`;

  // Validate Stripe key format
  const isValidFormat = apiKey.startsWith("sk_") || apiKey.startsWith("pk_");
  const isSecretKey = apiKey.startsWith("sk_");

  return {
    masked,
    length: apiKey.length,
    isValid: isValidFormat && isSecretKey && apiKey.length > 20,
    startsWithSk: isSecretKey,
    startsWithPk: apiKey.startsWith("pk_"),
    keyType: isSecretKey
      ? "secret"
      : apiKey.startsWith("pk_")
        ? "publishable"
        : "unknown",
    error: !isValidFormat
      ? "Stripe key must start with 'sk_' (secret) or 'pk_' (publishable)"
      : !isSecretKey
        ? "Must use secret key (sk_) for server-side operations"
        : null,
  };
}

/**
 * @description Test Stripe API key functionality
 * @returns {Promise<Object>} Test result
 */
async function testStripeKey() {
  try {
    const keyInfo = getMaskedStripeKey();

    if (!keyInfo.isValid) {
      return {
        isValid: false,
        error: keyInfo.error || "Stripe API key format is invalid",
        keyInfo,
        details:
          "Check that your Stripe key starts with 'sk_' and is the correct length",
      };
    }

    // Initialize Stripe and test the key
    const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

    // Make a simple API call to test the key
    const account = await stripe.accounts.retrieve();

    return {
      isValid: true,
      error: null,
      keyInfo,
      testResult: "Stripe API key is valid and working",
      accountId: account.id,
      accountType: account.type,
      country: account.country,
    };
  } catch (error) {
    const keyInfo = getMaskedStripeKey();

    return {
      isValid: false,
      error: error.message,
      keyInfo,
      testResult: "Stripe API key validation failed",
      details:
        error.type === "StripeAuthenticationError"
          ? "Invalid Stripe API key - check your key is correct"
          : error.type === "StripePermissionError"
            ? "Stripe API key lacks required permissions"
            : "Network or API error",
    };
  }
}

/**
 * @description Updates or creates wallet documents with new document count
 * @param {string} walletId - The wallet ID to update
 * @param {number} additionalDocs - Number of documents to add
 * @returns {Promise<Object>} Updated wallet document
 */
async function updateWalletDocuments(walletId, additionalDocs) {
  try {
    // Check if wallet exists
    const existingWallet = await prisma.walletDocuments.findUnique({
      where: { walletId },
    });

    if (existingWallet) {
      // Update existing wallet
      return await prisma.walletDocuments.update({
        where: { walletId },
        data: {
          noOfDocuments: existingWallet.noOfDocuments + additionalDocs,
        },
      });
    } else {
      // Create new wallet with default 3 documents + purchased documents
      return await prisma.walletDocuments.create({
        data: {
          walletId,
          noOfDocuments: 3 + additionalDocs, // Default 3 + purchased amount
        },
      });
    }
  } catch (error) {
    console.error("Error updating wallet documents:", error);
    throw new Error("Failed to update wallet documents");
  }
}

/**
 * @description Validates a wallet address format
 * @param {string} walletAddress - The wallet address to validate
 * @returns {Object} Validation result with isValid boolean and error message
 */
function validateWalletAddress(walletAddress) {
  if (!walletAddress || typeof walletAddress !== "string") {
    return { isValid: false, error: "Wallet address is required" };
  }

  // Check if it's a valid Ethereum address (42 characters starting with 0x)
  const ethereumAddressRegex = /^0x[a-fA-F0-9]{40}$/;
  if (!ethereumAddressRegex.test(walletAddress)) {
    return {
      isValid: false,
      error:
        "Invalid wallet address format. Must be a valid Ethereum address (0x...)",
    };
  }

  return { isValid: true };
}

/**
 * @description Validates the request payload for wallet balance payment
 * @param {Object} payload - The request payload to validate
 * @returns {Object} Validation result with isValid boolean and error message
 */
function validateWalletBalancePayload(payload) {
  const requiredFields = ["walletAddress", "noOfIons", "amount", "currency"];

  for (const field of requiredFields) {
    if (!payload[field]) {
      return { isValid: false, error: `Missing required field: ${field}` };
    }
  }

  // Validate wallet address
  const walletValidation = validateWalletAddress(payload.walletAddress);
  if (!walletValidation.isValid) {
    return walletValidation;
  }

  // Validate noOfIons is a positive number
  if (typeof payload.noOfIons !== "number" || payload.noOfIons <= 0) {
    return { isValid: false, error: "noOfIons must be a positive number" };
  }

  // Validate amount is a positive number
  if (typeof payload.amount !== "number" || payload.amount <= 0) {
    return { isValid: false, error: "amount must be a positive number" };
  }

  // Validate currency
  const supportedCurrencies = ["GLL", "IONS", "USD", "EUR", "INR"];
  if (!supportedCurrencies.includes(payload.currency.toUpperCase())) {
    return {
      isValid: false,
      error: `Currency must be one of: ${supportedCurrencies.join(", ")}`,
    };
  }

  return { isValid: true };
}

/**
 * @description Validates product purchase payload
 * @param {Object} payload - The payload to validate
 * @returns {Object} Validation result with isValid boolean and error message if invalid
 */
function validateProductPurchasePayload(payload) {
  const requiredFields = ["noOfProducts", "amount", "currency", "sellerEmail"];

  for (const field of requiredFields) {
    if (!payload[field]) {
      return { isValid: false, error: `Missing required field: ${field}` };
    }
  }

  // Validate noOfProducts is a positive number
  if (typeof payload.noOfProducts !== "number" || payload.noOfProducts <= 0) {
    return { isValid: false, error: "noOfProducts must be a positive number" };
  }

  // Validate amount is a positive number
  if (typeof payload.amount !== "number") {
    return { isValid: false, error: `amount must be a number, received: ${typeof payload.amount} (${payload.amount})` };
  }

  if (payload.amount <= 0) {
    return { isValid: false, error: `amount must be greater than 0, received: ${payload.amount}` };
  }

  // Validate currency
  const supportedCurrencies = ["GLL", "IONS", "USD", "EUR", "INR"];
  if (!supportedCurrencies.includes(payload.currency.toUpperCase())) {
    return {
      isValid: false,
      error: `Currency must be one of: ${supportedCurrencies.join(", ")}`,
    };
  }

  return { isValid: true };
}

/**
 * @description Credits ions to a wallet address using blockchain transaction
 * @param {string} walletAddress - The wallet address to credit ions to
 * @param {number} noOfIons - Number of ions to credit
 * @returns {Promise<Object>} Transaction result
 */
async function creditIonsToWallet(walletAddress, noOfIons) {
  try {
    const {
      phoneLinkContract,
      convertToEtherAmount,
    } = require("../config/blockchain");

    // Convert ions to token amount (assuming 1 ion = 1 GLL token)
    const tokenAmount = convertToEtherAmount(noOfIons.toString());

    const transaction = await phoneLinkContract.getGLL(
      tokenAmount,
      walletAddress
    );

    // Wait for transaction confirmation
    const receipt = await transaction.wait();

    return {
      success: true,
      transactionHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
    };
  } catch (error) {
    console.error("❌ Error crediting ions to wallet:", error);
    console.error("🔍 Error details:", {
      message: error.message,
      code: error.code,
      reason: error.reason,
      walletAddress,
      noOfIons,
    });
    throw new Error(`Failed to credit ions to wallet: ${error.message}`);
  }
}

/**
 * @swagger
 * /api/payments/purchase-plan:
 *   post:
 *     summary: Create a payment session for plan purchase
 *     description: Creates a new payment session with the payment gateway for purchasing additional documents
 *     tags:
 *       - Payment Processing
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PaymentSessionRequest'
 *           example:
 *             walletId: "wallet-123"
 *             mode: "payment"
 *             line_items:
 *               - price_data:
 *                   currency: "USD"
 *                   product_data:
 *                     name: "Premium Document Plan"
 *                     description: "50 additional documents for your wallet"
 *                   unit_amount: 2999
 *                 quantity: 1
 *             metadata:
 *               plan_type: "premium"
 *               user_id: "user_456"
 *               invoice_id: "INV-001"
 *             noOfDocs: 50
 *     responses:
 *       200:
 *         description: Payment session created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaymentSessionResponse'
 *       400:
 *         description: Invalid request payload
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Missing required field: walletId"
 *       500:
 *         description: Payment gateway error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Payment gateway error: Unable to connect"
 */
router.post("/purchase-plan", async (req, res) => {
  try {
    const {
      walletId,
      mode,
      line_items,
      metadata,
      noOfDocs,
      success_url,
      cancel_url,
    } = req.body;

    // Validate payload
    const validation = validatePaymentPayload(req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: validation.error,
      });
    }

    // Prepare payment gateway payload
    const paymentPayload = {
      line_items,
      mode,
      success_url: success_url
        ? success_url
        : `${BASE_URL}/api/payments/success?session_id={CHECKOUT_SESSION_ID}&walletId=${walletId}&noOfDocs=${noOfDocs}`,
      cancel_url: cancel_url
        ? `${BASE_URL}/api/payments/cancel?session_id={CHECKOUT_SESSION_ID}&original_cancel_url=${encodeURIComponent(
          cancel_url
        )}`
        : `${BASE_URL}/api/payments/cancel?session_id={CHECKOUT_SESSION_ID}`,
      metadata: {
        ...metadata,
        walletId,
        noOfDocs: noOfDocs.toString(),
      },
      apiKey: "growinvoice",
    };

    // Call payment gateway with proper headers
    const response = await axios.post(PAYMENT_GATEWAY_URL, paymentPayload, {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      timeout: 30000, // 30 second timeout
    });

    // Check if response is HTML instead of JSON
    const contentType = response.headers["content-type"];
    if (contentType && contentType.includes("text/html")) {
      console.error("Received HTML response instead of JSON:");
      console.error("Response data:", response.data);
      throw new Error(
        "Payment gateway returned HTML error page instead of JSON. Please check the gateway URL and endpoint."
      );
    }

    // Validate response structure
    if (!response.data || typeof response.data !== "object") {
      throw new Error("Invalid response format from payment gateway");
    }

    if (!response.data.id || !response.data.uri) {
      console.error(
        "Missing required fields in payment gateway response:",
        response.data
      );
      throw new Error(
        "Payment gateway response missing required fields (id, uri)"
      );
    }

    // Return success response
    res.status(200).json({
      success: true,
      sessionId: response.data.id,
      checkoutUrl: response.data.uri,
      message: "Payment session created successfully",
    });
  } catch (error) {
    console.error("Payment creation error:", error);

    // Handle different types of errors
    if (error.response) {
      console.error("Error Response Status:", error.response.status);
      console.error("Error Response Headers:", error.response.headers);
      console.error("Error Response Data:", error.response.data);

      return res.status(500).json({
        success: false,
        error: `Payment gateway error (${error.response.status}): ${error.response.data?.message || error.message
          }`,
      });
    }

    if (error.request) {
      console.error("Request Error:", error.request);
      return res.status(500).json({
        success: false,
        error: "Unable to connect to payment gateway. Please try again later.",
      });
    }

    res.status(500).json({
      success: false,
      error: `Payment gateway error: ${error.message}`,
    });
  }
});

/**
 * @swagger
 * /api/payments/stripe/purchase-plan:
 *   post:
 *     summary: Create a Stripe payment session for plan purchase
 *     description: Creates a new payment session with Stripe for purchasing additional documents
 *     tags:
 *       - Payment Processing
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PaymentSessionRequest'
 *           example:
 *             walletId: "wallet-123"
 *             mode: "payment"
 *             line_items:
 *               - price_data:
 *                   currency: "USD"
 *                   product_data:
 *                     name: "Premium Document Plan"
 *                     description: "50 additional documents for your wallet"
 *                   unit_amount: 2999
 *                 quantity: 1
 *             metadata:
 *               plan_type: "premium"
 *               user_id: "user_456"
 *               invoice_id: "INV-001"
 *             noOfDocs: 50
 *     responses:
 *       200:
 *         description: Stripe payment session created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaymentSessionResponse'
 *       400:
 *         description: Invalid request payload
 *       500:
 *         description: Stripe payment error
 */
router.post("/stripe/purchase-plan", async (req, res) => {
  try {
    const {
      walletId,
      mode,
      line_items,
      metadata,
      noOfDocs,
      success_url,
      cancel_url,
    } = req.body;

    // Validate payload
    const validation = validatePaymentPayload(req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: validation.error,
      });
    }

    // Initialize Stripe with your secret key
    const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

    // Transform line items to Stripe format
    const stripeLineItems = line_items.map((item) => ({
      price_data: {
        currency: item.price_data.currency,
        product_data: {
          name: item.price_data.product_data.name,
          description: item.price_data.product_data.description,
        },
        unit_amount: item.price_data.unit_amount,
      },
      quantity: item.quantity,
    }));
    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: stripeLineItems,
      mode: mode,
      success_url: success_url
        ? success_url
        : `${BASE_URL}/api/payments/success?session_id={CHECKOUT_SESSION_ID}&walletId=${walletId}&noOfDocs=${noOfDocs}`,
      cancel_url: cancel_url
        ? `${BASE_URL}/api/payments/cancel?session_id={CHECKOUT_SESSION_ID}&original_cancel_url=${encodeURIComponent(
          cancel_url
        )}`
        : `${BASE_URL}/api/payments/cancel?session_id={CHECKOUT_SESSION_ID}`,
      metadata: {
        ...metadata,
        walletId,
        noOfDocs: noOfDocs.toString(),
      },
    });

    // Return success response
    res.status(200).json({
      success: true,
      sessionId: session.id,
      checkoutUrl: session.url,
      message: "Stripe payment session created successfully",
    });
  } catch (error) {
    console.error("Stripe payment creation error:", error);

    // Get masked API key for debugging
    const keyInfo = getMaskedStripeKey();
    console.error(
      `Using Stripe key: ${keyInfo.masked} (length: ${keyInfo.length})`
    );

    // Handle different Stripe error types
    if (error.type === "StripeAuthenticationError") {
      return res.status(401).json({
        success: false,
        error: "Stripe authentication failed",
        details:
          "Invalid Stripe API key. Please check your STRIPE_SECRET_KEY environment variable.",
        debug: {
          maskedApiKey: keyInfo.masked,
          keyLength: keyInfo.length,
          validFormat: keyInfo.isValid,
          keyType: keyInfo.keyType,
          startsWithSk: keyInfo.startsWithSk,
          error: keyInfo.error,
        },
      });
    }

    if (error.type === "StripeInvalidRequestError") {
      return res.status(400).json({
        success: false,
        error: error.message,
        debug: {
          maskedApiKey: keyInfo.masked,
          keyLength: keyInfo.length,
          validFormat: keyInfo.isValid,
        },
      });
    }

    if (error.type === "StripePermissionError") {
      return res.status(403).json({
        success: false,
        error: "Stripe permission error",
        details:
          "Your Stripe API key doesn't have the required permissions for this operation.",
        debug: {
          maskedApiKey: keyInfo.masked,
          keyLength: keyInfo.length,
          validFormat: keyInfo.isValid,
          keyType: keyInfo.keyType,
        },
      });
    }

    // Handle the specific "Neither apiKey nor config.authenticator provided" error
    if (
      error.message.includes("Neither apiKey nor config.authenticator provided")
    ) {
      return res.status(500).json({
        success: false,
        error: "Stripe configuration error",
        details:
          "Stripe API key is not properly configured. Please check your STRIPE_SECRET_KEY environment variable.",
        debug: {
          maskedApiKey: keyInfo.masked,
          keyLength: keyInfo.length,
          validFormat: keyInfo.isValid,
          keyType: keyInfo.keyType,
          startsWithSk: keyInfo.startsWithSk,
          error: keyInfo.error,
          originalError: error.message,
        },
      });
    }

    // Generic error handling
    res.status(500).json({
      success: false,
      error: `Stripe payment error: ${error.message}`,
      debug: {
        maskedApiKey: keyInfo.masked,
        keyLength: keyInfo.length,
        validFormat: keyInfo.isValid,
        keyType: keyInfo.keyType,
        errorType: error.type || "Unknown",
      },
    });
  }
});

/**
 * @swagger
 * /api/payments/wallet-balance:
 *   post:
 *     summary: Create a Stripe payment session for wallet balance top-up
 *     description: Creates a new payment session with Stripe for purchasing ions to be credited to a wallet
 *     tags:
 *       - Wallet Management
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - walletAddress
 *               - noOfIons
 *               - amount
 *               - currency
 *             properties:
 *               walletAddress:
 *                 type: string
 *                 description: Ethereum wallet address to credit ions to
 *                 example: "0x742d35Cc6635C0532925a3b8D400d0E0Ed8e2fcB"
 *               noOfIons:
 *                 type: number
 *                 description: Number of ions to purchase
 *                 example: 100
 *               amount:
 *                 type: number
 *                 description: Payment amount in cents (for USD) or equivalent smallest unit
 *                 example: 999
 *               currency:
 *                 type: string
 *                 description: Payment currency
 *                 enum: ["USD", "EUR", "INR"]
 *                 example: "USD"
 *               success_url:
 *                 type: string
 *                 description: Custom success URL (optional)
 *                 example: "https://example.com/success"
 *               cancel_url:
 *                 type: string
 *                 description: Custom cancel URL (optional)
 *                 example: "https://example.com/cancel"
 *     responses:
 *       200:
 *         description: Wallet balance payment session created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 sessionId:
 *                   type: string
 *                   example: "cs_test_..."
 *                 checkoutUrl:
 *                   type: string
 *                   example: "https://checkout.stripe.com/..."
 *                 message:
 *                   type: string
 *                   example: "Wallet balance payment session created successfully"
 *       400:
 *         description: Invalid request payload
 *       500:
 *         description: Stripe payment error
 */
router.post("/wallet-balance", async (req, res) => {
  try {
    const {
      walletAddress,
      noOfIons,
      amount,
      currency,
      success_url,
      cancel_url,
    } = req.body;

    // Validate payload
    const validation = validateWalletBalancePayload(req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: validation.error,
      });
    }

    // Initialize Stripe with your secret key
    const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

    // Create line items for the payment
    const stripeLineItems = [
      {
        price_data: {
          currency: currency.toLowerCase(),
          product_data: {
            name: `${noOfIons} Ions`,
            description: `Purchase ${noOfIons} ions for wallet ${walletAddress.substring(
              0,
              6
            )}...${walletAddress.substring(38)}`,
          },
          unit_amount: currency.toUpperCase() === "USD" ? amount * 100 : amount, // Only multiply by 100 for USD (cents)
        },
        quantity: 1,
      },
    ];

    console.log("Wallet Balance Payment - Stripe Line Items:", stripeLineItems);

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: stripeLineItems,
      mode: "payment",
      success_url: `${BASE_URL}/api/payments/wallet-balance/success?session_id={CHECKOUT_SESSION_ID}&walletAddress=${walletAddress}&noOfIons=${noOfIons}`,
      cancel_url: cancel_url
        ? `${BASE_URL}/api/payments/wallet-balance/cancel?session_id={CHECKOUT_SESSION_ID}&original_cancel_url=${encodeURIComponent(
          cancel_url
        )}`
        : `${BASE_URL}/api/payments/wallet-balance/cancel?session_id={CHECKOUT_SESSION_ID}`,
      metadata: {
        walletAddress,
        noOfIons: noOfIons.toString(),
        currency: currency.toUpperCase(),
        paymentType: "wallet_balance",
      },
    });

    // Return success response
    res.status(200).json({
      success: true,
      sessionId: session.id,
      checkoutUrl: session.url,
      message: "Wallet balance payment session created successfully",
    });
  } catch (error) {
    console.error("Wallet balance payment creation error:", error);

    // Get masked API key for debugging
    const keyInfo = getMaskedStripeKey();

    // Handle different Stripe error types
    if (error.type === "StripeAuthenticationError") {
      return res.status(401).json({
        success: false,
        error: "Stripe authentication failed",
        details:
          "Invalid Stripe API key. Please check your STRIPE_SECRET_KEY environment variable.",
        debug: {
          maskedApiKey: keyInfo.masked,
          keyLength: keyInfo.length,
          validFormat: keyInfo.isValid,
          keyType: keyInfo.keyType,
          startsWithSk: keyInfo.startsWithSk,
          error: keyInfo.error,
        },
      });
    }

    if (error.type === "StripeInvalidRequestError") {
      return res.status(400).json({
        success: false,
        error: error.message,
        debug: {
          maskedApiKey: keyInfo.masked,
          keyLength: keyInfo.length,
          validFormat: keyInfo.isValid,
        },
      });
    }

    if (error.type === "StripePermissionError") {
      return res.status(403).json({
        success: false,
        error: "Stripe permission error",
        details:
          "Your Stripe API key doesn't have the required permissions for this operation.",
        debug: {
          maskedApiKey: keyInfo.masked,
          keyLength: keyInfo.length,
          validFormat: keyInfo.isValid,
          keyType: keyInfo.keyType,
        },
      });
    }

    // Handle the specific "Neither apiKey nor config.authenticator provided" error
    if (
      error.message.includes("Neither apiKey nor config.authenticator provided")
    ) {
      return res.status(500).json({
        success: false,
        error: "Stripe configuration error",
        details:
          "Stripe API key is not properly configured. Please check your STRIPE_SECRET_KEY environment variable.",
        debug: {
          maskedApiKey: keyInfo.masked,
          keyLength: keyInfo.length,
          validFormat: keyInfo.isValid,
          keyType: keyInfo.keyType,
          startsWithSk: keyInfo.startsWithSk,
          error: keyInfo.error,
          originalError: error.message,
        },
      });
    }

    // Generic error handling
    res.status(500).json({
      success: false,
      error: `Wallet balance payment error: ${error.message}`,
      debug: {
        maskedApiKey: keyInfo.masked,
        keyLength: keyInfo.length,
        validFormat: keyInfo.isValid,
        keyType: keyInfo.keyType,
        errorType: error.type || "Unknown",
      },
    });
  }
});

/**
 * @swagger
 * /api/payments/gateway/wallet-balance:
 *   post:
 *     summary: Create a payment gateway session for wallet balance top-up
 *     description: Creates a new payment session with the payment gateway for purchasing ions to be credited to a wallet
 *     tags:
 *       - Wallet Management
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - walletAddress
 *               - noOfIons
 *               - amount
 *               - currency
 *             properties:
 *               walletAddress:
 *                 type: string
 *                 description: Ethereum wallet address to credit ions to
 *                 example: "0x742d35Cc6635C0532925a3b8D400d0E0Ed8e2fcB"
 *               noOfIons:
 *                 type: number
 *                 description: Number of ions to purchase
 *                 example: 100
 *               amount:
 *                 type: number
 *                 description: Payment amount in cents (for USD) or equivalent smallest unit
 *                 example: 999
 *               currency:
 *                 type: string
 *                 description: Payment currency
 *                 enum: ["USD", "EUR", "INR"]
 *                 example: "USD"
 *               success_url:
 *                 type: string
 *                 description: Custom success URL (optional)
 *                 example: "https://example.com/success"
 *               cancel_url:
 *                 type: string
 *                 description: Custom cancel URL (optional)
 *                 example: "https://example.com/cancel"
 *     responses:
 *       200:
 *         description: Payment gateway session created successfully for wallet balance
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 sessionId:
 *                   type: string
 *                   example: "session_123"
 *                 checkoutUrl:
 *                   type: string
 *                   example: "https://gll-gateway.growlimitless.app/checkout/..."
 *                 message:
 *                   type: string
 *                   example: "Payment gateway session created successfully for wallet balance"
 *       400:
 *         description: Invalid request payload
 *       500:
 *         description: Payment gateway error
 */
router.post("/gateway/wallet-balance", async (req, res) => {
  try {
    console.log("🎯 Creating payment gateway session for wallet balance");
    const { walletAddress, noOfIons, amount, currency, cancel_url } = req.body;

    console.log("📋 Received wallet balance payment request:", {
      walletAddress,
      noOfIons,
      amount,
      currency,
    });

    // Validate payload
    const validation = validateWalletBalancePayload(req.body);
    if (!validation.isValid) {
      console.error(
        "❌ Wallet balance payload validation failed:",
        validation.error
      );
      return res.status(400).json({
        success: false,
        error: validation.error,
      });
    }

    console.log("✅ Wallet balance payload validation passed");

    // Create line items for the payment gateway
    const line_items = [
      {
        price_data: {
          currency: currency.toLowerCase(),
          product_data: {
            name: `${noOfIons} GLL Ions`,
            description: `Purchase ${noOfIons} GLL ions for wallet ${walletAddress.substring(
              0,
              6
            )}...${walletAddress.substring(38)}`,
          },
          unit_amount: currency.toUpperCase() === "USD" ? amount * 100 : amount, // Only multiply by 100 for USD (cents)
        },
        quantity: 1,
      },
    ];

    console.log("🏷️ Created line items for payment gateway:", line_items);

    // Prepare payment gateway payload
    const paymentPayload = {
      line_items,
      mode: "payment",
      success_url: `${BASE_URL}/api/payments/gateway/wallet-balance/success?session_id={CHECKOUT_SESSION_ID}&walletAddress=${walletAddress}&noOfIons=${noOfIons}`,
      cancel_url: cancel_url
        ? `${BASE_URL}/api/payments/gateway/wallet-balance/cancel?session_id={CHECKOUT_SESSION_ID}&original_cancel_url=${encodeURIComponent(
          cancel_url
        )}`
        : `${BASE_URL}/api/payments/gateway/wallet-balance/cancel?session_id={CHECKOUT_SESSION_ID}`,
      metadata: {
        walletAddress,
        noOfIons: noOfIons.toString(),
        currency: currency.toUpperCase(),
        paymentType: "gateway_wallet_balance",
      },
      apiKey: "growinvoice",
    };

    console.log("🔧 Prepared payment gateway payload:");
    console.log("📡 Payment Gateway URL:", PAYMENT_GATEWAY_URL);
    console.log("📦 Payload:", JSON.stringify(paymentPayload, null, 2));

    // Call payment gateway with proper headers
    const response = await axios.post(PAYMENT_GATEWAY_URL, paymentPayload, {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      timeout: 30000, // 30 second timeout
    });

    console.log("📊 Payment Gateway Response Status:", response.status);
    console.log("📝 Payment Gateway Response Headers:", response.headers);

    // Check if response is HTML instead of JSON
    const contentType = response.headers["content-type"];
    if (contentType && contentType.includes("text/html")) {
      console.error("❌ Received HTML response instead of JSON:");
      console.error("🌐 Response data:", response.data);
      throw new Error(
        "Payment gateway returned HTML error page instead of JSON. Please check the gateway URL and endpoint."
      );
    }

    console.log(
      "✅ Payment Gateway Response (JSON):",
      JSON.stringify(response.data, null, 2)
    );

    // Validate response structure
    if (!response.data || typeof response.data !== "object") {
      throw new Error("Invalid response format from payment gateway");
    }

    if (!response.data.id || !response.data.uri) {
      console.error(
        "❌ Missing required fields in payment gateway response:",
        response.data
      );
      throw new Error(
        "Payment gateway response missing required fields (id, uri)"
      );
    }

    console.log("🎉 Payment gateway session created successfully!");
    console.log("🆔 Session ID:", response.data.id);
    console.log("🔗 Checkout URL:", response.data.uri);

    // Return success response
    res.status(200).json({
      success: true,
      sessionId: response.data.id,
      checkoutUrl: response.data.uri,
      message:
        "Payment gateway session created successfully for wallet balance",
    });
  } catch (error) {
    console.error("❌ Payment gateway wallet balance creation error:", error);

    // Handle different types of errors
    if (error.response) {
      console.error("📊 Error Response Status:", error.response.status);
      console.error("📝 Error Response Headers:", error.response.headers);
      console.error("📦 Error Response Data:", error.response.data);

      return res.status(500).json({
        success: false,
        error: `Payment gateway error (${error.response.status}): ${error.response.data?.message || error.message
          }`,
        details: {
          status: error.response.status,
          data: error.response.data,
        },
      });
    }

    if (error.request) {
      console.error("🌐 Request Error:", error.request);
      return res.status(500).json({
        success: false,
        error: "Unable to connect to payment gateway. Please try again later.",
        details: "Network connectivity issue",
      });
    }

    // Generic error handling
    res.status(500).json({
      success: false,
      error: `Payment gateway error: ${error.message}`,
      details: {
        errorType: error.constructor.name,
        message: error.message,
      },
    });
  }
});

/**
 * @swagger
 * /api/payments/success:
 *   get:
 *     summary: Handle successful payment callback
 *     description: Processes successful payment completion, updates wallet document count, and redirects to frontend
 *     tags:
 *       - Payment Processing
 *     parameters:
 *       - $ref: '#/components/parameters/SessionId'
 *       - $ref: '#/components/parameters/PaymentWalletId'
 *       - $ref: '#/components/parameters/NoOfDocs'
 *     responses:
 *       302:
 *         description: Redirects to frontend with success status
 *       400:
 *         description: Missing required parameters - redirects to frontend with error
 *       500:
 *         description: Error processing payment - redirects to frontend with error
 */
router.get("/success", async (req, res) => {
  try {
    const { session_id, walletId, noOfDocs } = req.query;

    // Validate required parameters
    if (!session_id || !walletId || !noOfDocs) {
      console.error("Missing required parameters:", {
        session_id,
        walletId,
        noOfDocs,
      });
      return res.redirect(
        `${FRONTEND_URL}/resume?status=error&message=Missing required parameters`
      );
    }

    const additionalDocs = parseInt(noOfDocs);

    // Update wallet documents
    const updatedWallet = await updateWalletDocuments(walletId, additionalDocs);

    // Log successful payment processing
    console.log(
      `Payment successful: Session ${session_id}, Wallet ${walletId}, Added ${additionalDocs} documents`
    );
    console.log(`Updated wallet documents: ${updatedWallet.noOfDocuments}`);

    // Determine if this was a new wallet or existing one
    const isNewWallet = updatedWallet.noOfDocuments === 3 + additionalDocs;
    const message = isNewWallet
      ? "Payment successful! New wallet created with documents."
      : "Payment successful! Documents updated successfully.";

    // Redirect to frontend with success parameters
    const redirectUrl = `${FRONTEND_URL}/resume?status=success&sessionId=${session_id}&walletId=${walletId}&documents=${updatedWallet.noOfDocuments
      }&message=${encodeURIComponent(message)}`;
    res.redirect(redirectUrl);
  } catch (error) {
    console.error("Payment success handler error:", error);

    // Redirect to frontend with error
    const errorMessage = "Failed to process successful payment";
    res.redirect(
      `${FRONTEND_URL}/resume?status=error&message=${encodeURIComponent(
        errorMessage
      )}`
    );
  }
});

/**
 * @swagger
 * /api/payments/cancel:
 *   get:
 *     summary: Handle payment cancellation
 *     description: Processes payment cancellation by user and redirects to frontend or original cancel URL
 *     tags:
 *       - Payment Processing
 *     parameters:
 *       - name: session_id
 *         in: query
 *         required: false
 *         description: Payment session ID (optional)
 *         schema:
 *           type: string
 *           example: "session_123"
 *       - name: original_cancel_url
 *         in: query
 *         required: false
 *         description: Original cancel URL to redirect to (URL encoded)
 *         schema:
 *           type: string
 *           example: "https%3A//example.com/cancel"
 *     responses:
 *       302:
 *         description: Redirects to frontend with cancellation status
 *       500:
 *         description: Error processing cancellation - redirects to frontend with error
 */
router.get("/cancel", async (req, res) => {
  try {
    const { session_id, original_cancel_url } = req.query;

    console.log(`Payment cancelled for session: ${session_id || "unknown"}`);
    console.log(
      `Original cancel URL: ${original_cancel_url || "not provided"}`
    );

    // If original_cancel_url is provided, redirect to it
    if (original_cancel_url) {
      console.log(`Redirecting to original cancel URL: ${original_cancel_url}`);
      return res.redirect(decodeURIComponent(original_cancel_url));
    }

    // Redirect to frontend with cancellation status
    const message = session_id
      ? "Payment was cancelled by user"
      : "Payment was cancelled";

    const redirectUrl = `${FRONTEND_URL}/resume?status=cancelled&sessionId=${session_id || ""
      }&message=${encodeURIComponent(message)}`;
    res.redirect(redirectUrl);
  } catch (error) {
    console.error("Payment cancel handler error:", error);

    // Redirect to frontend with error
    const errorMessage = "Failed to process payment cancellation";
    res.redirect(
      `${FRONTEND_URL}/resume?status=error&message=${encodeURIComponent(
        errorMessage
      )}`
    );
  }
});

/**
 * @swagger
 * /api/payments/wallet-balance/success:
 *   get:
 *     summary: Handle successful wallet balance payment callback
 *     description: Processes successful wallet balance payment completion, credits ions to wallet, and redirects to frontend
 *     tags:
 *       - Wallet Management
 *     parameters:
 *       - name: session_id
 *         in: query
 *         required: true
 *         description: Payment session ID
 *         schema:
 *           type: string
 *           example: "cs_test_..."
 *       - name: walletAddress
 *         in: query
 *         required: true
 *         description: Wallet address to credit ions to
 *         schema:
 *           type: string
 *           example: "0x742d35Cc6635C0532925a3b8D400d0E0Ed8e2fcB"
 *       - name: noOfIons
 *         in: query
 *         required: true
 *         description: Number of ions to credit
 *         schema:
 *           type: number
 *           example: 100
 *     responses:
 *       302:
 *         description: Redirects to frontend with success status
 *       400:
 *         description: Missing required parameters - redirects to frontend with error
 *       500:
 *         description: Error processing payment - redirects to frontend with error
 */
router.get("/wallet-balance/success", async (req, res) => {
  try {
    console.log("🎯 Processing wallet balance payment success callback");
    const { session_id, walletAddress, noOfIons } = req.query;

    console.log("📋 Received parameters:", {
      session_id,
      walletAddress,
      noOfIons,
    });

    // Validate required parameters
    if (!session_id || !walletAddress || !noOfIons) {
      console.error(
        "❌ Missing required parameters for wallet balance success:",
        {
          session_id,
          walletAddress,
          noOfIons,
        }
      );
      return res.redirect(
        `${FRONTEND_URL}/wallet?payment=error&message=Missing required parameters`
      );
    }

    const ionsToCredit = parseInt(noOfIons);
    console.log("🔢 Parsed ions to credit:", ionsToCredit);

    // Validate wallet address format
    const walletValidation = validateWalletAddress(walletAddress);
    if (!walletValidation.isValid) {
      console.error("❌ Invalid wallet address:", walletAddress);
      console.error("🔍 Validation error:", walletValidation.error);
      return res.redirect(
        `${FRONTEND_URL}/wallet?payment=error&message=${encodeURIComponent(
          walletValidation.error
        )}`
      );
    }

    console.log("✅ Wallet address validation passed");

    // Credit ions to the wallet address
    let transactionResult;
    try {
      console.log("🔄 Starting ion credit process...");
      transactionResult = await creditIonsToWallet(walletAddress, ionsToCredit);

      // Log successful payment and ion credit
      console.log("🎉 Wallet balance payment successful!");
      console.log(`📊 Session: ${session_id}`);
      console.log(`💰 Wallet: ${walletAddress}`);
      console.log(`🪙 Credited: ${ionsToCredit} ions`);
      console.log(`🔗 Transaction hash: ${transactionResult.transactionHash}`);
      console.log(`📦 Block number: ${transactionResult.blockNumber}`);
      console.log(`⛽ Gas used: ${transactionResult.gasUsed}`);
    } catch (creditError) {
      console.error("❌ Error crediting ions to wallet:", creditError);
      console.error("🔍 Credit error details:", {
        message: creditError.message,
        stack: creditError.stack,
        walletAddress,
        ionsToCredit,
      });
      return res.redirect(
        `${FRONTEND_URL}/wallet?payment=error&message=${encodeURIComponent(
          "Failed to credit ions to wallet: " + creditError.message
        )}`
      );
    }

    // Redirect to frontend with success parameters
    const redirectUrl = `${FRONTEND_URL}/wallet?payment=success&sessionId=${session_id}&walletAddress=${walletAddress}&ions=${ionsToCredit}&transaction_id=${transactionResult.transactionHash
      }&message=${encodeURIComponent(
        "Payment successful! Ions credited to wallet."
      )}`;

    console.log("🚀 Redirecting to frontend with success status");
    console.log("🔗 Redirect URL:", redirectUrl);

    res.redirect(redirectUrl);
  } catch (error) {
    console.error("❌ Wallet balance payment success handler error:", error);
    console.error("🔍 Handler error details:", {
      message: error.message,
      stack: error.stack,
    });

    // Redirect to frontend with error
    const errorMessage = "Failed to process successful wallet balance payment";
    res.redirect(
      `${FRONTEND_URL}/wallet?payment=error&message=${encodeURIComponent(
        errorMessage
      )}`
    );
  }
});

/**
 * @swagger
 * /api/payments/wallet-balance/cancel:
 *   get:
 *     summary: Handle wallet balance payment cancellation
 *     description: Processes wallet balance payment cancellation by user and redirects to frontend or original cancel URL
 *     tags:
 *       - Wallet Management
 *     parameters:
 *       - name: session_id
 *         in: query
 *         required: false
 *         description: Payment session ID (optional)
 *         schema:
 *           type: string
 *           example: "cs_test_..."
 *       - name: original_cancel_url
 *         in: query
 *         required: false
 *         description: Original cancel URL to redirect to (URL encoded)
 *         schema:
 *           type: string
 *           example: "https%3A//example.com/cancel"
 *     responses:
 *       302:
 *         description: Redirects to frontend with cancellation status or to original cancel URL
 *       500:
 *         description: Error processing cancellation - redirects to frontend with error
 */
router.get("/wallet-balance/cancel", async (req, res) => {
  try {
    const { session_id, original_cancel_url } = req.query;

    console.log(
      `Wallet balance payment cancelled for session: ${session_id || "unknown"}`
    );
    console.log(
      `Original cancel URL: ${original_cancel_url || "not provided"}`
    );

    // If original_cancel_url is provided, redirect to it
    if (original_cancel_url) {
      console.log(`Redirecting to original cancel URL: ${original_cancel_url}`);
      return res.redirect(decodeURIComponent(original_cancel_url));
    }

    // Redirect to frontend with cancellation status
    const message = session_id
      ? "Wallet balance payment was cancelled by user"
      : "Wallet balance payment was cancelled";

    const redirectUrl = `${FRONTEND_URL}/wallet?payment=cancelled&sessionId=${session_id || ""
      }&message=${encodeURIComponent(message)}`;
    res.redirect(redirectUrl);
  } catch (error) {
    console.error("Wallet balance payment cancel handler error:", error);

    // Redirect to frontend with error
    const errorMessage =
      "Failed to process wallet balance payment cancellation";
    res.redirect(
      `${FRONTEND_URL}/wallet?payment=error&message=${encodeURIComponent(
        errorMessage
      )}`
    );
  }
});

/**
 * @swagger
 * /api/payments/gateway/wallet-balance/success:
 *   get:
 *     summary: Handle successful payment gateway wallet balance payment callback
 *     description: Processes successful payment gateway wallet balance payment completion, credits ions to wallet, and redirects to frontend
 *     tags:
 *       - Wallet Management
 *     parameters:
 *       - name: session_id
 *         in: query
 *         required: true
 *         description: Payment session ID
 *         schema:
 *           type: string
 *           example: "session_123"
 *       - name: walletAddress
 *         in: query
 *         required: true
 *         description: Wallet address to credit ions to
 *         schema:
 *           type: string
 *           example: "0x742d35Cc6635C0532925a3b8D400d0E0Ed8e2fcB"
 *       - name: noOfIons
 *         in: query
 *         required: true
 *         description: Number of ions to credit
 *         schema:
 *           type: number
 *           example: 100
 *     responses:
 *       302:
 *         description: Redirects to frontend with success status
 *       400:
 *         description: Missing required parameters - redirects to frontend with error
 *       500:
 *         description: Error processing payment - redirects to frontend with error
 */
router.get("/gateway/wallet-balance/success", async (req, res) => {
  try {
    console.log(
      "🎯 Processing payment gateway wallet balance payment success callback"
    );
    const { session_id, walletAddress, noOfIons } = req.query;

    console.log("📋 Received payment gateway parameters:", {
      session_id,
      walletAddress,
      noOfIons,
    });

    // Validate required parameters
    if (!session_id || !walletAddress || !noOfIons) {
      console.error(
        "❌ Missing required parameters for payment gateway wallet balance success:",
        {
          session_id,
          walletAddress,
          noOfIons,
        }
      );
      return res.redirect(
        `${FRONTEND_URL}/wallet?payment=error&message=Missing required parameters&gateway=true`
      );
    }

    const ionsToCredit = parseInt(noOfIons);
    console.log("🔢 Parsed ions to credit:", ionsToCredit);

    // Validate wallet address format
    const walletValidation = validateWalletAddress(walletAddress);
    if (!walletValidation.isValid) {
      console.error("❌ Invalid wallet address:", walletAddress);
      console.error("🔍 Validation error:", walletValidation.error);
      return res.redirect(
        `${FRONTEND_URL}/wallet?payment=error&message=${encodeURIComponent(
          walletValidation.error
        )}&gateway=true`
      );
    }

    console.log("✅ Payment gateway wallet address validation passed");

    // Credit ions to the wallet address
    let transactionResult;
    try {
      console.log("🔄 Starting payment gateway ion credit process...");
      transactionResult = await creditIonsToWallet(walletAddress, ionsToCredit);

      // Log successful payment and ion credit
      console.log("🎉 Payment gateway wallet balance payment successful!");
      console.log(`📊 Session: ${session_id}`);
      console.log(`💰 Wallet: ${walletAddress}`);
      console.log(`🪙 Credited: ${ionsToCredit} ions`);
      console.log(`🔗 Transaction hash: ${transactionResult.transactionHash}`);
      console.log(`📦 Block number: ${transactionResult.blockNumber}`);
      console.log(`⛽ Gas used: ${transactionResult.gasUsed}`);
    } catch (creditError) {
      console.error(
        "❌ Error crediting ions to wallet via payment gateway:",
        creditError
      );
      console.error("🔍 Payment gateway credit error details:", {
        message: creditError.message,
        stack: creditError.stack,
        walletAddress,
        ionsToCredit,
      });
      return res.redirect(
        `${FRONTEND_URL}/wallet?payment=error&message=${encodeURIComponent(
          "Failed to credit ions to wallet: " + creditError.message
        )}&gateway=true`
      );
    }

    // Redirect to frontend with success parameters
    const redirectUrl = `${FRONTEND_URL}/wallet?payment=success&sessionId=${session_id}&walletAddress=${walletAddress}&ions=${ionsToCredit}&transaction_id=${transactionResult.transactionHash
      }&gateway=true&message=${encodeURIComponent(
        "Payment successful! Ions credited to wallet via payment gateway."
      )}`;

    console.log(
      "🚀 Redirecting to frontend with payment gateway success status"
    );
    console.log("🔗 Redirect URL:", redirectUrl);

    res.redirect(redirectUrl);
  } catch (error) {
    console.error(
      "❌ Payment gateway wallet balance payment success handler error:",
      error
    );
    console.error("🔍 Payment gateway handler error details:", {
      message: error.message,
      stack: error.stack,
    });

    // Redirect to frontend with error
    const errorMessage =
      "Failed to process successful payment gateway wallet balance payment";
    res.redirect(
      `${FRONTEND_URL}/wallet?payment=error&message=${encodeURIComponent(
        errorMessage
      )}&gateway=true`
    );
  }
});

/**
 * @swagger
 * /api/payments/gateway/wallet-balance/cancel:
 *   get:
 *     summary: Handle payment gateway wallet balance payment cancellation
 *     description: Processes payment gateway wallet balance payment cancellation by user and redirects to frontend or original cancel URL
 *     tags:
 *       - Wallet Management
 *     parameters:
 *       - name: session_id
 *         in: query
 *         required: false
 *         description: Payment session ID (optional)
 *         schema:
 *           type: string
 *           example: "session_123"
 *       - name: original_cancel_url
 *         in: query
 *         required: false
 *         description: Original cancel URL to redirect to (URL encoded)
 *         schema:
 *           type: string
 *           example: "https%3A//example.com/cancel"
 *     responses:
 *       302:
 *         description: Redirects to frontend with cancellation status or to original cancel URL
 *       500:
 *         description: Error processing cancellation - redirects to frontend with error
 */
router.get("/gateway/wallet-balance/cancel", async (req, res) => {
  try {
    const { session_id, original_cancel_url } = req.query;

    console.log(
      `Payment gateway wallet balance payment cancelled for session: ${session_id || "unknown"
      }`
    );
    console.log(
      `Original cancel URL: ${original_cancel_url || "not provided"}`
    );

    // If original_cancel_url is provided, redirect to it
    if (original_cancel_url) {
      console.log(`Redirecting to original cancel URL: ${original_cancel_url}`);
      return res.redirect(decodeURIComponent(original_cancel_url));
    }

    // Redirect to frontend with cancellation status
    const message = session_id
      ? "Payment gateway wallet balance payment was cancelled by user"
      : "Payment gateway wallet balance payment was cancelled";

    const redirectUrl = `${FRONTEND_URL}/wallet?payment=cancel`;

    console.log(
      "🚀 Redirecting to frontend with payment gateway cancellation status"
    );
    console.log("🔗 Redirect URL:", redirectUrl);

    res.redirect(redirectUrl);
  } catch (error) {
    console.error(
      "Payment gateway wallet balance payment cancel handler error:",
      error
    );

    // Redirect to frontend with error
    const errorMessage =
      "Failed to process payment gateway wallet balance payment cancellation";
    res.redirect(
      `${FRONTEND_URL}/wallet?payment=error&message=${encodeURIComponent(
        errorMessage
      )}&gateway=true`
    );
  }
});

/**
 * @swagger
 * /api/payments/webhook:
 *   post:
 *     summary: Handle payment gateway webhooks
 *     description: Processes webhook events from the payment gateway for additional security
 *     tags:
 *       - Payment Processing
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/WebhookRequest'
 *           example:
 *             type: "checkout.session.completed"
 *             data:
 *               object:
 *                 id: "session_123"
 *                 metadata:
 *                   walletId: "wallet-123"
 *                   noOfDocs: "10"
 *     responses:
 *       200:
 *         description: Webhook processed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Webhook processed successfully"
 *       500:
 *         description: Error processing webhook
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/webhook", async (req, res) => {
  try {
    const { type, data } = req.body;

    if (type === "checkout.session.completed") {
      const session = data.object;
      const { walletId, noOfDocs } = session.metadata;

      if (walletId && noOfDocs) {
        await updateWalletDocuments(walletId, parseInt(noOfDocs));
        console.log(
          `Webhook: Successfully updated wallet ${walletId} with ${noOfDocs} documents`
        );
      }
    }

    res.status(200).json({
      success: true,
      message: "Webhook processed successfully",
    });
  } catch (error) {
    console.error("Webhook processing error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to process webhook",
    });
  }
});

/**
 * @swagger
 * /api/payments/wallet/{walletId}:
 *   get:
 *     summary: Get wallet information
 *     description: Retrieves current document count and information for a specific wallet
 *     tags:
 *       - Wallet Management
 *     parameters:
 *       - name: walletId
 *         in: path
 *         required: true
 *         description: Unique wallet identifier
 *         schema:
 *           type: string
 *           example: "wallet-123"
 *     responses:
 *       200:
 *         description: Wallet information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WalletInfoResponse'
 *       404:
 *         description: Wallet not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Wallet not found"
 *       500:
 *         description: Error retrieving wallet information
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/wallet/:walletId", async (req, res) => {
  try {
    const { walletId } = req.params;

    const wallet = await prisma.walletDocuments.findUnique({
      where: { walletId },
    });

    if (!wallet) {
      return res.status(404).json({
        success: false,
        error: "Wallet not found",
      });
    }

    res.status(200).json({
      success: true,
      walletId: wallet.walletId,
      noOfDocuments: wallet.noOfDocuments,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
    });
  } catch (error) {
    console.error("Wallet query error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to retrieve wallet information",
    });
  }
});

/**
 * @swagger
 * /api/payments/balance/{email}:
 *   get:
 *     summary: Get GLL token balance for user
 *     description: Retrieves the GLL token balance for a user by their email address
 *     tags:
 *       - Wallet Management
 *     parameters:
 *       - name: email
 *         in: path
 *         required: true
 *         description: User's email address
 *         schema:
 *           type: string
 *           format: email
 *           example: "user@example.com"
 *     responses:
 *       200:
 *         description: Token balance retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TokenBalanceResponse'
 *       400:
 *         description: Invalid email format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Invalid email format"
 *       404:
 *         description: User not found or wallet address not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Email not found. Please login to gll.one first."
 *       500:
 *         description: Error retrieving token balance
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/balance/:email", async (req, res) => {
  try {
    const { email } = req.params;

    // Basic email validation - using simple string operations to avoid regex vulnerabilities
    function isValidEmail(email) {
      if (!email || typeof email !== "string") return false;

      const trimmed = email.trim();
      if (trimmed.length === 0 || trimmed.length > 254) return false;

      // Must contain exactly one @ symbol
      const atIndex = trimmed.indexOf("@");
      if (atIndex === -1 || atIndex !== trimmed.lastIndexOf("@")) return false;
      if (atIndex === 0 || atIndex === trimmed.length - 1) return false;

      const localPart = trimmed.substring(0, atIndex);
      const domainPart = trimmed.substring(atIndex + 1);

      // Basic local part validation
      if (localPart.length === 0 || localPart.length > 64) return false;
      if (localPart.startsWith(".") || localPart.endsWith(".")) return false;
      if (localPart.includes("..")) return false;

      // Basic domain part validation
      if (domainPart.length === 0 || domainPart.length > 253) return false;
      if (
        domainPart.startsWith(".") ||
        domainPart.endsWith(".") ||
        domainPart.startsWith("-") ||
        domainPart.endsWith("-")
      )
        return false;
      if (domainPart.includes("..") || domainPart.includes("--")) return false;
      if (!domainPart.includes(".")) return false;

      // Check for valid characters using simple regex (no complex patterns)
      const validLocalChars = /^[a-zA-Z0-9._%+-]+$/;
      if (!validLocalChars.test(localPart)) return false;

      const validDomainChars = /^[a-zA-Z0-9.-]+$/;
      if (!validDomainChars.test(domainPart)) return false;

      // Check domain has valid TLD (at least 2 chars after last dot)
      const lastDotIndex = domainPart.lastIndexOf(".");
      if (lastDotIndex === -1 || domainPart.length - lastDotIndex - 1 < 2)
        return false;

      return true;
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        error: "Invalid email format",
      });
    }

    // Get token balance using blockchain service
    const balance = await getMyBalance(email);

    res.status(200).json({
      success: true,
      email: email,
      balance: balance,
      message: "Token balance retrieved successfully",
    });
  } catch (error) {
    console.error("Token balance query error:", error);

    // Handle specific error cases
    if (error.message.includes("Email not found")) {
      return res.status(404).json({
        success: false,
        error: error.message,
      });
    }

    if (error.message.includes("Wallet address not found")) {
      return res.status(404).json({
        success: false,
        error: error.message,
      });
    }

    res.status(500).json({
      success: false,
      error: "Failed to retrieve token balance",
      details: error.message,
    });
  }
});

/**
 * @swagger
 * /api/payments/debug/stripe-key:
 *   get:
 *     summary: Debug Stripe API key status and configuration
 *     tags:
 *       - Payment Processing
 *     description: Returns masked Stripe API key information and validation results for debugging purposes
 *     responses:
 *       200:
 *         description: Stripe API key debug information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Stripe API key debug information"
 *                 data:
 *                   type: object
 *                   properties:
 *                     keyInfo:
 *                       type: object
 *                       properties:
 *                         masked:
 *                           type: string
 *                           description: "Masked Stripe API key showing first 4 and last 4 characters"
 *                           example: "sk_t***************************abc123"
 *                         length:
 *                           type: integer
 *                           description: "Total length of the Stripe API key"
 *                           example: 107
 *                         validFormat:
 *                           type: boolean
 *                           description: "Whether the Stripe API key has valid format"
 *                           example: true
 *                         keyType:
 *                           type: string
 *                           enum: [secret, publishable, unknown]
 *                           description: "Type of Stripe API key"
 *                           example: "secret"
 *                         startsWithSk:
 *                           type: boolean
 *                           description: "Whether the API key starts with 'sk_'"
 *                           example: true
 *                         error:
 *                           type: string
 *                           nullable: true
 *                           description: "Error message if key format is invalid"
 *                           example: null
 *                     testResult:
 *                       type: object
 *                       properties:
 *                         isValid:
 *                           type: boolean
 *                           description: "Whether the Stripe API key is valid and functional"
 *                           example: true
 *                         error:
 *                           type: string
 *                           nullable: true
 *                           description: "Error message if validation failed"
 *                           example: null
 *                         accountId:
 *                           type: string
 *                           description: "Stripe account ID"
 *                           example: "acct_1234567890"
 *                         accountType:
 *                           type: string
 *                           description: "Stripe account type"
 *                           example: "standard"
 *                         country:
 *                           type: string
 *                           description: "Account country"
 *                           example: "US"
 *       401:
 *         description: Stripe API key is invalid or missing
 *       500:
 *         description: Server error during Stripe API key testing
 */
router.get("/debug/stripe-key", async (req, res) => {
  try {
    console.log("PaymentRoutes: Debug Stripe API key request");

    // Get masked API key info
    const keyInfo = getMaskedStripeKey();

    // Test the API key
    const testResult = await testStripeKey();

    return res.status(200).json({
      success: true,
      message: "Stripe API key debug information",
      data: {
        keyInfo: {
          masked: keyInfo.masked,
          length: keyInfo.length,
          validFormat: keyInfo.isValid,
          keyType: keyInfo.keyType,
          startsWithSk: keyInfo.startsWithSk,
          startsWithPk: keyInfo.startsWithPk,
          error: keyInfo.error,
        },
        testResult: {
          isValid: testResult.isValid,
          error: testResult.error,
          details: testResult.details,
          accountId: testResult.accountId,
          accountType: testResult.accountType,
          country: testResult.country,
        },
      },
    });
  } catch (error) {
    console.error("PaymentRoutes: Error in debugStripeKey:", error);

    // Still try to return basic key info even if test fails
    try {
      const keyInfo = getMaskedStripeKey();
      return res.status(500).json({
        success: false,
        error: "Failed to test Stripe API key",
        details: error.message,
        keyInfo: {
          masked: keyInfo.masked,
          length: keyInfo.length,
          validFormat: keyInfo.isValid,
          keyType: keyInfo.keyType,
          startsWithSk: keyInfo.startsWithSk,
          error: keyInfo.error,
        },
      });
    } catch (keyError) {
      return res.status(500).json({
        success: false,
        error: "Failed to get Stripe API key information",
        details: error.message,
      });
    }
  }
});

/**
 * @swagger
 * /api/payments/test-gateway:
 *   get:
 *     summary: Test payment gateway connection
 *     description: Tests the connection to the payment gateway and validates response format
 *     tags:
 *       - Payment Processing
 *     responses:
 *       200:
 *         description: Gateway connection test results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 gatewayUrl:
 *                   type: string
 *                 responseType:
 *                   type: string
 *       500:
 *         description: Gateway connection failed
 */
router.get("/test-gateway", async (req, res) => {
  try {
    console.log("Testing payment gateway connection...");
    console.log("Gateway URL:", PAYMENT_GATEWAY_URL);

    // Test with a minimal payload
    const testPayload = {
      test: true,
      apiKey: "growinvoice",
    };

    const response = await axios.post(PAYMENT_GATEWAY_URL, testPayload, {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      timeout: 10000,
    });

    const contentType = response.headers["content-type"] || "";
    const isHtml = contentType.includes("text/html");
    const isJson = contentType.includes("application/json");

    console.log("Test Response Status:", response.status);
    console.log("Test Response Content-Type:", contentType);
    console.log(
      "Test Response Data (first 500 chars):",
      typeof response.data === "string"
        ? response.data.substring(0, 500)
        : JSON.stringify(response.data).substring(0, 500)
    );

    res.status(200).json({
      success: true,
      message: "Gateway connection test completed",
      gatewayUrl: PAYMENT_GATEWAY_URL,
      responseStatus: response.status,
      responseType: isHtml ? "HTML" : isJson ? "JSON" : "Other",
      contentType: contentType,
      isValidApiEndpoint: !isHtml && response.status === 200,
    });
  } catch (error) {
    console.error("Gateway test error:", error.message);

    let errorDetails = {
      success: false,
      message: "Gateway connection test failed",
      gatewayUrl: PAYMENT_GATEWAY_URL,
      error: error.message,
    };

    if (error.response) {
      errorDetails.responseStatus = error.response.status;
      errorDetails.responseType = error.response.headers[
        "content-type"
      ]?.includes("text/html")
        ? "HTML"
        : "Other";
    }

    res.status(500).json(errorDetails);
  }
});

/**
 * @swagger
 * /api/payments/validate-wallet:
 *   post:
 *     summary: Validate wallet address and get balance
 *     description: Validates an Ethereum wallet address format and optionally retrieves its token balance
 *     tags:
 *       - Wallet Management
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - walletAddress
 *             properties:
 *               walletAddress:
 *                 type: string
 *                 description: Ethereum wallet address to validate
 *                 example: "0x742d35Cc6635C0532925a3b8D400d0E0Ed8e2fcB"
 *               checkBalance:
 *                 type: boolean
 *                 description: Whether to retrieve the token balance (optional)
 *                 default: false
 *                 example: true
 *     responses:
 *       200:
 *         description: Wallet validation successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 isValid:
 *                   type: boolean
 *                   example: true
 *                 walletAddress:
 *                   type: string
 *                   example: "0x742d35Cc6635C0532925a3b8D400d0E0Ed8e2fcB"
 *                 balance:
 *                   type: string
 *                   description: Token balance (only if checkBalance=true)
 *                   example: "100.0"
 *                 message:
 *                   type: string
 *                   example: "Wallet address is valid"
 *       400:
 *         description: Invalid wallet address
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 isValid:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "Invalid wallet address format"
 *       500:
 *         description: Error checking wallet
 */
router.post("/validate-wallet", async (req, res) => {
  try {
    const { walletAddress, checkBalance = false } = req.body;

    // Validate wallet address format
    const validation = validateWalletAddress(walletAddress);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        isValid: false,
        error: validation.error,
      });
    }

    const response = {
      success: true,
      isValid: true,
      walletAddress,
      message: "Wallet address is valid",
    };

    // Optionally check balance
    if (checkBalance) {
      try {
        const { tokenContract } = require("../config/blockchain");
        const { formatUnits } = require("ethers");

        const balance = await tokenContract.balanceOf(walletAddress);
        response.balance = formatUnits(balance, "ether");
        response.message = "Wallet address is valid and balance retrieved";
      } catch (balanceError) {
        console.error("Error getting wallet balance:", balanceError);
        response.message =
          "Wallet address is valid but could not retrieve balance";
        response.balanceError = balanceError.message;
      }
    }

    res.status(200).json(response);
  } catch (error) {
    console.error("Wallet validation error:", error);
    res.status(500).json({
      success: false,
      isValid: false,
      error: `Error validating wallet: ${error.message}`,
    });
  }
});

/**
 * @swagger
 * /api/payments/currency/convert:
 *   get:
 *     summary: Convert currency using live forex rates
 *     description: Get live currency conversion rates using AnyAPI.io forex service
 *     tags:
 *       - Currency Exchange
 *     parameters:
 *       - name: from
 *         in: query
 *         required: true
 *         description: Base currency code (e.g., USD, EUR, INR)
 *         schema:
 *           type: string
 *           example: "USD"
 *       - name: to
 *         in: query
 *         required: true
 *         description: Target currency code (e.g., USD, EUR, INR)
 *         schema:
 *           type: string
 *           example: "INR"
 *       - name: amount
 *         in: query
 *         required: false
 *         description: Amount to convert (default is 1)
 *         schema:
 *           type: number
 *           example: 100
 *     responses:
 *       200:
 *         description: Currency conversion successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     base:
 *                       type: string
 *                       example: "USD"
 *                     target:
 *                       type: string
 *                       example: "INR"
 *                     amount:
 *                       type: number
 *                       example: 100
 *                     convertedAmount:
 *                       type: number
 *                       example: 8350.25
 *                     exchangeRate:
 *                       type: number
 *                       example: 83.5025
 *                     timestamp:
 *                       type: string
 *                       example: "2025-08-21T10:30:00Z"
 *                 message:
 *                   type: string
 *                   example: "Currency conversion successful"
 *       400:
 *         description: Invalid request parameters
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "Missing required parameter: from"
 *       500:
 *         description: Currency conversion service error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "Currency conversion service error"
 */
router.get("/currency/convert", async (req, res) => {
  try {
    const { from, to, amount = 1 } = req.query;

    console.log("💱 Currency conversion request:", { from, to, amount });

    // Validate required parameters
    if (!from || !to) {
      return res.status(400).json({
        success: false,
        error:
          "Missing required parameters. Both 'from' and 'to' currency codes are required.",
        example: "/api/payments/currency/convert?from=USD&to=INR&amount=100",
      });
    }

    // Validate amount is a positive number
    const convertAmount = parseFloat(amount);
    if (isNaN(convertAmount) || convertAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: "Amount must be a positive number",
      });
    }

    // Validate currency codes format (should be 3-letter codes)
    const currencyCodeRegex = /^[A-Z]{3}$/;
    const fromCurrency = from.toUpperCase();
    const toCurrency = to.toUpperCase();

    if (
      !currencyCodeRegex.test(fromCurrency) ||
      !currencyCodeRegex.test(toCurrency)
    ) {
      return res.status(400).json({
        success: false,
        error: "Currency codes must be 3-letter codes (e.g., USD, EUR, INR)",
      });
    }

    // Check cache first
    const cachedRate = getCachedRate(fromCurrency, toCurrency);
    if (cachedRate) {
      // Use cached exchange rate
      const convertedAmount = convertAmount * cachedRate.exchangeRate;

      const cacheResult = {
        success: true,
        data: {
          base: fromCurrency,
          target: toCurrency,
          amount: convertAmount,
          convertedAmount: parseFloat(convertedAmount.toFixed(4)),
          exchangeRate: cachedRate.exchangeRate,
          timestamp: cachedRate.timestamp,
          cached: true,
          cacheAge:
            Math.round(
              (new Date() - new Date(cachedRate.timestamp)) / (1000 * 60 * 60)
            ) + " hours",
        },
        message: "Currency conversion successful (from cache)",
      };

      console.log("💰 Cached conversion result:", {
        from: fromCurrency,
        to: toCurrency,
        amount: convertAmount,
        converted: cacheResult.data.convertedAmount,
        rate: cachedRate.exchangeRate,
        cached: true,
      });

      return res.status(200).json(cacheResult);
    }

    // If not in cache, call API
    console.log("🌐 No valid cache found, calling AnyAPI.io for fresh data...");

    // AnyAPI.io configuration
    const ANYAPI_KEY = "j86teo4u2i876bsus61n08vop55eqg6r8i4sblb9qh480rfblkt8pb";
    const ANYAPI_URL = "https://anyapi.io/api/v1/exchange/convert";

    // Build the API URL (use amount=1 to get base rate)
    const apiUrl = `${ANYAPI_URL}?base=${fromCurrency}&to=${toCurrency}&amount=1&apiKey=${ANYAPI_KEY}`;

    console.log("📋 Request URL:", apiUrl.replace(ANYAPI_KEY, "***API_KEY***"));
    console.log("📊 API Call Stats:", {
      cacheSize: currencyCache.size,
      totalPairsInCache: Array.from(currencyCache.keys()),
      requestedPair: `${fromCurrency}_${toCurrency}`,
    });

    // Make the API call
    const response = await axios.get(apiUrl, {
      timeout: 10000, // 10 second timeout
      headers: {
        Accept: "application/json",
        "User-Agent": "GrowLimitless-PaymentAPI/1.0",
      },
    });

    console.log("✅ AnyAPI.io response received");
    console.log("📊 Response data:", response.data);

    // Check if the response is successful
    if (!response.data) {
      throw new Error("Empty response from currency conversion service");
    }

    // Extract exchange rate from response
    const exchangeRate =
      response.data.exchangeRate ||
      response.data.rate ||
      response.data.convertedAmount;

    if (!exchangeRate) {
      throw new Error("No exchange rate found in API response");
    }

    // Cache the exchange rate for 24 hours
    cacheExchangeRate(fromCurrency, toCurrency, exchangeRate, response.data);

    // Calculate converted amount
    const convertedAmount = convertAmount * exchangeRate;

    // Extract relevant data from the response
    const conversionResult = {
      success: true,
      data: {
        base: fromCurrency,
        target: toCurrency,
        amount: convertAmount,
        convertedAmount: parseFloat(convertedAmount.toFixed(4)),
        exchangeRate: exchangeRate,
        timestamp: new Date().toISOString(),
        cached: false,
        rawResponse: response.data, // Include raw response for debugging
      },
      message: "Currency conversion successful (fresh from API)",
    };

    console.log("💰 Fresh conversion result:", {
      from: fromCurrency,
      to: toCurrency,
      amount: convertAmount,
      converted: conversionResult.data.convertedAmount,
      rate: exchangeRate,
      cached: false,
      apiCallsToday: "This was a new API call",
    });

    res.status(200).json(conversionResult);
  } catch (error) {
    console.error("❌ Currency conversion error:", error);

    // Handle different types of errors
    let errorMessage = "Currency conversion service error";
    let statusCode = 500;

    if (error.response) {
      // API responded with error status
      console.error("🔍 API Error Response:", {
        status: error.response.status,
        data: error.response.data,
        headers: error.response.headers,
      });

      if (error.response.status === 401) {
        errorMessage = "Invalid API key for currency conversion service";
      } else if (error.response.status === 400) {
        errorMessage = "Invalid currency codes or parameters";
        statusCode = 400;
      } else if (error.response.status === 429) {
        errorMessage =
          "Currency conversion service rate limit exceeded. Using cached data if available.";

        // Try to return cached data even if expired as fallback
        const { from, to } = req.query;
        if (from && to) {
          const fallbackCache = currencyCache.get(
            getCacheKey(from.toUpperCase(), to.toUpperCase())
          );
          if (fallbackCache) {
            console.log(
              "⚠️ Rate limited, but returning stale cache data as fallback"
            );
            const convertAmount = parseFloat(req.query.amount || 1);
            const convertedAmount = convertAmount * fallbackCache.exchangeRate;

            return res.status(200).json({
              success: true,
              data: {
                base: from.toUpperCase(),
                target: to.toUpperCase(),
                amount: convertAmount,
                convertedAmount: parseFloat(convertedAmount.toFixed(4)),
                exchangeRate: fallbackCache.exchangeRate,
                timestamp: fallbackCache.timestamp,
                cached: true,
                stale: true,
                warning: "Rate limited - using stale cache data",
              },
              message:
                "Currency conversion using stale cache due to rate limit",
            });
          }
        }
      } else {
        errorMessage = `Currency conversion service error: ${error.response.status}`;
      }
    } else if (error.request) {
      // Request was made but no response received
      console.error("🔍 Network Error:", error.request);
      errorMessage =
        "Network error: Unable to reach currency conversion service";
    } else {
      // Error in request setup
      console.error("🔍 Request Setup Error:", error.message);
      errorMessage = `Request error: ${error.message}`;
    }

    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      cacheStats: {
        totalCachedPairs: currencyCache.size,
        availablePairs: Array.from(currencyCache.keys()),
      },
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

/**
 * @swagger
 * /api/payments/currency/cache-stats:
 *   get:
 *     summary: Get currency cache statistics
 *     description: View current cache status, entries, and management options
 *     tags:
 *       - Currency Exchange
 *     responses:
 *       200:
 *         description: Cache statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalCachedPairs:
 *                       type: number
 *                       example: 5
 *                     cacheEntries:
 *                       type: array
 *                       items:
 *                         type: object
 *                     apiCallsSaved:
 *                       type: string
 *                       example: "Estimated 10 API calls saved today"
 */
router.get("/currency/cache-stats", async (req, res) => {
  try {
    const cacheEntries = [];
    const now = new Date();

    for (const [key, entry] of currencyCache.entries()) {
      const entryTime = new Date(entry.timestamp);
      const ageHours = Math.round((now - entryTime) / (1000 * 60 * 60));
      const isValid = isCacheValid(entry);

      cacheEntries.push({
        pair: key,
        from: entry.from,
        to: entry.to,
        exchangeRate: entry.exchangeRate,
        timestamp: entry.timestamp,
        ageHours: ageHours,
        isValid: isValid,
        expiresIn: isValid ? `${24 - ageHours} hours` : "Expired",
      });
    }

    const validEntries = cacheEntries.filter((entry) => entry.isValid);
    const expiredEntries = cacheEntries.filter((entry) => !entry.isValid);

    res.status(200).json({
      success: true,
      data: {
        totalCachedPairs: currencyCache.size,
        validEntries: validEntries.length,
        expiredEntries: expiredEntries.length,
        cacheEntries: cacheEntries,
        apiCallsSaved: `Estimated ${validEntries.length} API calls saved today`,
        monthlySavings: `Potentially ${validEntries.length * 30
          } API calls saved per month`,
        freeApiLimit: "30 calls per month",
        cacheFilePath: CACHE_FILE_PATH,
      },
      message: "Currency cache statistics retrieved successfully",
    });
  } catch (error) {
    console.error("❌ Error getting cache stats:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get cache statistics",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

/**
 * @swagger
 * /api/payments/currency/clear-cache:
 *   delete:
 *     summary: Clear currency cache
 *     description: Clear all cached currency data (use with caution)
 *     tags:
 *       - Currency Exchange
 *     responses:
 *       200:
 *         description: Cache cleared successfully
 */
router.delete("/currency/clear-cache", async (req, res) => {
  try {
    const entriesCleared = currencyCache.size;
    currencyCache.clear();
    saveCurrencyCache();

    console.log(
      `🧹 Currency cache manually cleared - ${entriesCleared} entries removed`
    );

    res.status(200).json({
      success: true,
      message: `Currency cache cleared successfully. ${entriesCleared} entries removed.`,
      data: {
        entriesCleared,
        newCacheSize: currencyCache.size,
      },
    });
  } catch (error) {
    console.error("❌ Error clearing cache:", error);
    res.status(500).json({
      success: false,
      error: "Failed to clear currency cache",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ==================== ORDER TRACKING FUNCTIONS ====================

/**
 * @description Get transaction hash from Session table by searching metadata for email
 * @param {string} email - User's email address
 * @returns {Promise<string|null>} Transaction hash or null if not found
 */
async function getTransactionHashByEmail(email) {
  try {
    // console.log("🔍 Fetching transaction hash for email from Session metadata:", email);
    
    // Get all sessions with transaction hashes and filter by metadata in JavaScript
    const sessions = await prisma.session.findMany({
      where: {
        txHash: {
          not: null
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // console.log(`📊 Found ${sessions.length} sessions with transaction hashes`);

    // Search through sessions to find one with matching email in metadata
    for (const session of sessions) {
      try {
        let metadata = session.metadata;
        
        // Debug: Log metadata structure for first few sessions
        if (sessions.indexOf(session) < 3) {
          // console.log(`🔍 Debug - Session ${session.id} metadata (raw):`, metadata);
          // console.log(`🔍 Debug - Session ${session.id} metadata type:`, typeof metadata);
        }
        
        // Parse metadata if it's a string
        if (typeof metadata === 'string') {
          try {
            metadata = JSON.parse(metadata);
            // console.log(`🔍 Debug - Parsed metadata for session ${session.id}:`, metadata);
          } catch (parseError) {
            // console.log(`⚠️ Error parsing metadata string for session ${session.id}:`, parseError.message);
            continue;
          }
        }
        
        // Check if metadata contains the email in various possible fields
        if (metadata && typeof metadata === 'object') {
          // First priority: check for buyerEmail specifically
          if (metadata.buyerEmail === email) {
            // console.log(`✅ Found transaction hash in Session metadata (buyerEmail) for email:`, email, "->", session.txHash);
            return session.txHash;
          }
          
          // Second priority: check other email fields
          const otherEmailFields = ['email', 'sellerEmail', 'userEmail', 'buyer_email', 'seller_email', 'user_email'];
          
          for (const field of otherEmailFields) {
            if (metadata[field] === email) {
              // console.log(`✅ Found transaction hash in Session metadata (field: ${field}) for email:`, email, "->", session.txHash);
              return session.txHash;
            }
          }
          
          // Also check if any nested object contains the email
          for (const [key, value] of Object.entries(metadata)) {
            if (typeof value === 'object' && value !== null) {
              // Check buyerEmail in nested objects first
              if (value.buyerEmail === email) {
                // console.log(`✅ Found transaction hash in Session metadata (nested: ${key}.buyerEmail) for email:`, email, "->", session.txHash);
                return session.txHash;
              }
              
              // Then check other email fields in nested objects
              for (const nestedField of otherEmailFields) {
                if (value[nestedField] === email) {
                  // console.log(`✅ Found transaction hash in Session metadata (nested: ${key}.${nestedField}) for email:`, email, "->", session.txHash);
                  return session.txHash;
                }
              }
            }
          }
        }
      } catch (metadataError) {
        // console.log("⚠️ Error parsing metadata for session:", session.id, metadataError.message);
        continue;
      }
    }

    // console.log("⚠️ No transaction hash found in Session metadata for email:", email);
    return null;
    
  } catch (error) {
    // console.error("❌ Error fetching transaction hash by email from Session metadata:", error);
    return null;
  }
}

/**
 * @description Get payment session details from our database
 * @param {string} sessionId - Payment session ID
 * @returns {Promise<Object>} Session details
 */
async function getPaymentSessionDetails(sessionId) {
  try {
    // console.log("🔍 Fetching session details from database for:", sessionId);
    
    // Look for the payment session in our database
    const paymentSession = await prisma.paymentSession.findUnique({
      where: { sessionId: sessionId }
    });

    if (paymentSession) {
      // console.log("✅ Found payment session in database");
      
      // Update session status to COMPLETED since we're in the success handler
      await prisma.paymentSession.update({
        where: { sessionId: sessionId },
        data: { status: 'COMPLETED' }
      });
      
      return {
        id: sessionId,
        amount_total: paymentSession.amount * 100, // Convert to cents
        currency: paymentSession.currency.toLowerCase(),
        payment_status: 'paid',
        payment_method_types: ['card'],
        payment_intent: {
          charges: {
            data: [{
              id: `ch_${sessionId}_${Date.now()}`
            }]
          }
        },
        metadata: paymentSession.metadata
      };
    }

    // If no payment session found, log the issue
    // console.log("⚠️ No payment session found in database for:", sessionId);
    return {
      id: sessionId,
      amount_total: 0,
      currency: 'usd',
      payment_status: 'paid',
      payment_method_types: ['card'],
      payment_intent: {
        charges: {
          data: [{
            id: `ch_${sessionId}_${Date.now()}`
          }]
        }
      },
      metadata: {
        sessionId: sessionId,
        error: 'Payment session not found in database'
      }
    };
    
  } catch (error) {
    console.error("❌ Error fetching session details:", error);
    
    // Return minimal structure
    return {
      id: sessionId,
      amount_total: 0,
      currency: 'usd',
      payment_status: 'paid',
      payment_method_types: ['card'],
      payment_intent: {
        charges: {
          data: [{
            id: `ch_${sessionId}_${Date.now()}`
          }]
        }
      },
      metadata: {
        sessionId: sessionId,
        error: error.message
      }
    };
  }
}

/**
 * @description Record order in database after successful payment
 * @param {string} sessionId - Payment session ID
 * @param {number} noOfProducts - Number of products purchased
 * @param {Object} req - Express request object
 * @returns {Promise<Object>} Created order
 */
async function recordOrderInDatabase(sessionId, noOfProducts, req) {
  try {
    // console.log("📝 Recording order in database for session:", sessionId);
    
    // Get session details from payment gateway
    const sessionDetails = await getPaymentSessionDetails(sessionId);
    
    // Extract buyer information from session metadata or request
    const buyerEmail = sessionDetails.metadata?.buyerEmail || req.query.buyerEmail;
    const buyerName = sessionDetails.metadata?.buyerName || req.query.buyerName;
    const buyerWalletAddress = sessionDetails.metadata?.buyerWalletAddress || req.query.buyerWalletAddress;
    
    // 🔥 NEW: Get transaction hash from database by email
    let transactionHash = null;
    if (buyerEmail) {
      // console.log("🔍 Looking up transaction hash for buyer email:", buyerEmail);
      transactionHash = await getTransactionHashByEmail(buyerEmail);
      
    }
    
    // Fallback: Extract transaction hash from request parameters (sent by frontend)
    if (!transactionHash) {
      transactionHash = req.query.transaction_hash || req.query.txHash || req.query.tx_hash;
      
    }
    
    // Extract seller information
    const sellerEmail = sessionDetails.metadata?.sellerEmail;
    const sellerName = sessionDetails.metadata?.sellerName;
    
    // Get item details from session metadata
    const itemId = sessionDetails.metadata?.itemId;
    const itemType = sessionDetails.metadata?.itemType || 'product';
    const itemTitle = sessionDetails.metadata?.itemTitle;
    const itemDescription = sessionDetails.metadata?.itemDescription;
    const itemPrice = sessionDetails.amount_total / 100; // Convert from cents
    
    // Validate that we have the essential data
    if (!buyerEmail || !sellerEmail || !itemTitle) {
      console.error("❌ Missing essential order data:", {
        buyerEmail: !!buyerEmail,
        sellerEmail: !!sellerEmail,
        itemTitle: !!itemTitle,
        sessionId: sessionId
      });
      
      // If we're missing essential data, we can either:
      // 1. Skip recording this order
      // 2. Record with minimal data
      // 3. Throw an error
      
      // For now, let's record with minimal data and log the issue
      // console.log("⚠️ Recording order with minimal data due to missing metadata");
    }
    
    // Generate unique order ID
    const orderId = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Create order record with fallback values for missing data
    const finalTransactionHash = transactionHash || sessionDetails.payment_intent?.charges?.data?.[0]?.id || `ch_${sessionId}_${Date.now()}`;
    
    // console.log("💾 Creating order with transaction hash:", finalTransactionHash);
    // console.log("📊 Transaction hash source:", transactionHash ? "Database lookup" : "Fallback generated");
    
    const order = await prisma.order.create({
      data: {
        orderId: orderId,
        sessionId: sessionId,
        transactionHash: finalTransactionHash, // Real blockchain tx hash from database or fallback
        
        itemId: itemId || `item_${sessionId}`,
        itemType: itemType,
        itemTitle: itemTitle || `Product from Session ${sessionId}`,
        itemDescription: itemDescription || 'Product purchased via payment gateway',
        itemPrice: itemPrice || 0,
        itemCurrency: sessionDetails.currency?.toUpperCase() || 'USD',
        
        buyerEmail: buyerEmail || 'unknown@example.com',
        buyerName: buyerName || 'Unknown Buyer',
        buyerWalletAddress: buyerWalletAddress,
        
        sellerEmail: sellerEmail || 'unknown@example.com',
        sellerName: sellerName || 'Unknown Seller',
        
        quantity: parseInt(noOfProducts) || 1,
        totalAmount: (itemPrice || 0) * (parseInt(noOfProducts) || 1),
        status: 'COMPLETED',
        completedAt: new Date(),
        
        metadata: {
          paymentMethod: sessionDetails.payment_method_types?.[0],
          paymentStatus: sessionDetails.payment_status,
          originalSessionData: sessionDetails,
          dataSource: 'payment_gateway_api',
          hasCompleteData: !!(buyerEmail && sellerEmail && itemTitle),
          transactionHashSource: transactionHash ? 'database_lookup' : 'fallback_generated',
          buyerEmail: buyerEmail,
          transactionHashRetrieved: !!transactionHash
        }
      }
    });

    // console.log(`✅ Order recorded successfully: ${order.orderId}`);
    return order;
    
  } catch (error) {
    console.error("❌ Error recording order:", error);
    throw error;
  }
}

// ==================== PRODUCT PURCHASE PAYMENT GATEWAY ====================

router.post("/gateway/product-purchase", async (req, res) => {
  let seller = null; // Declare seller variable outside try block for error handling
  
  try {
    // console.log("🎯 Creating payment gateway session for product purchase");
    // console.log("🔍 Raw request body:", JSON.stringify(req.body, null, 2));

    const {
      noOfProducts, 
      amount, 
      currency, 
      cancel_url, 
      return_url, 
      sellerEmail,
      // 🔥 NEW: Enhanced metadata fields
      itemId,
      itemType = 'product',
      itemTitle,
      itemDescription,
      buyerEmail,
      buyerName,
      buyerWalletAddress
    } = req.body;

    // console.log("📋 Received product purchase payment request:", {
    //   noOfProducts,
    //   amount,
    //   currency,
    //   sellerEmail,
    //   amountType: typeof amount,
    //   amountValue: amount,
    //   amountTruthy: !!amount
    // });

    // Validate payload
    const validation = validateProductPurchasePayload(req.body);
    if (!validation.isValid) {
      console.error(
        "❌ Product purchase payload validation failed:",
        validation.error
      );
      return res.status(400).json({
        success: false,
        error: validation.error,
      });
    }

    // console.log("✅ Product purchase payload validation passed");

    // Fetch seller's apiKey from database
    // console.log("🔍 Fetching seller apiKey for email:", sellerEmail);
    const seller = await prisma.user.findUnique({
      where: { email: sellerEmail },
      select: { apiKey: true, name: true }
    });

    if (!seller) {
      console.error("❌ Seller not found for email:", sellerEmail);
      return res.status(404).json({
        success: false,
        error: "Seller not found",
      });
    }

    if (!seller.apiKey) {
      console.error("❌ Seller apiKey not found for email:", sellerEmail);
      return res.status(400).json({
        success: false,
        error: "Seller apiKey not configured",
      });
    }

    // console.log("✅ Seller found:", seller.name, "with apiKey:", seller.apiKey.substring(0, 8) + "...");

    // Validate apiKey format (should be similar to working apiKey "growinvoice")
    if (!seller.apiKey || seller.apiKey.length < 5) {
      console.error("❌ Invalid apiKey format for seller:", sellerEmail);
      return res.status(400).json({
        success: false,
        error: "Invalid seller apiKey format",
      });
    }

    // Log amount details for debugging
    // console.log("💰 Amount calculation:", {
    //   originalAmount: amount,
    //   amountType: typeof amount,
    //   unitAmountInCents: Math.max(1, Math.round(amount * 100)),
    //   currency: currency
    // });

    // Note: Frontend can send any supported currency, but we use USD for payment gateway
    // This ensures compatibility with the working wallet-balance route

    // Create line items for the payment gateway
    const line_items = [
      {
        price_data: {
          currency: "usd", // Use USD like the working wallet-balance route
          product_data: {
            name: `${noOfProducts} Product(s)`,
            description: `Purchase ${noOfProducts} product(s) from ${sellerEmail}`,
          },
          unit_amount: amount * 100, // Convert to cents like USD
        },
        quantity: 1,
      },
    ];

    // console.log("🏷️ Created line items for payment gateway:", line_items);

    // Prepare payment gateway payload
    const paymentPayload = {
      line_items,
      mode: "payment",
      success_url: `${BASE_URL}/api/payments/gateway/product-purchase/success?session_id={CHECKOUT_SESSION_ID}&noOfProducts=${noOfProducts}&return_url=${encodeURIComponent(return_url || '')}`,
      cancel_url: cancel_url
        ? `${BASE_URL}/api/payments/gateway/product-purchase/cancel?session_id={CHECKOUT_SESSION_ID}&original_cancel_url=${encodeURIComponent(
          cancel_url
        )}`
        : `${BASE_URL}/api/payments/gateway/product-purchase/cancel?session_id={CHECKOUT_SESSION_ID}`,
      metadata: {
        noOfProducts: noOfProducts.toString(),
        currency: "USD", // Use USD like the working wallet-balance route
        paymentType: "gateway_product_purchase",
        return_url: return_url || null,
        sellerEmail: sellerEmail,
        
        // 🔥 NEW: Enhanced metadata for order tracking
        itemId: itemId,
        itemType: itemType,
        itemTitle: itemTitle,
        itemDescription: itemDescription,
        sellerName: seller.name,
        buyerEmail: buyerEmail,
        buyerName: buyerName,
        buyerWalletAddress: buyerWalletAddress
      },
      apiKey: seller.apiKey,
    };

    // Log the full success URL for debugging
    // console.log("🔗 Success URL being sent:", paymentPayload.success_url);

    // Try with seller's apiKey first, fallback to working apiKey if it fails
    let response;
    try {
      // Call payment gateway with proper headers
      response = await axios.post(PAYMENT_GATEWAY_URL, paymentPayload, {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        timeout: 30000, // 30 second timeout
      });
    } catch (firstError) {
      // If seller's apiKey fails, try with the working apiKey
      if (firstError.response && firstError.response.status === 500) {
        paymentPayload.apiKey = "growinvoice";
        
        response = await axios.post(PAYMENT_GATEWAY_URL, paymentPayload, {
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          timeout: 30000, // 30 second timeout
        });
      } else {
        throw firstError;
      }
    }

    // Check if response is HTML instead of JSON
    const contentType = response.headers["content-type"];
    if (contentType && contentType.includes("text/html")) {
      console.error("❌ Received HTML response instead of JSON:");
      console.error("🌐 Response data:", response.data);
      throw new Error(
        "Payment gateway returned HTML error page instead of JSON. Please check the gateway URL and endpoint."
      );
    }

    // Validate response structure
    if (!response.data || typeof response.data !== "object") {
      throw new Error("Invalid response format from payment gateway");
    }

    if (!response.data.id || !response.data.uri) {
      console.error(
        "❌ Missing required fields in payment gateway response:",
        response.data
      );
      throw new Error(
        "Payment gateway response missing required fields (id, uri)"
      );
    }

    // 🔥 NEW: Store session data in database for later retrieval
    try {
      await prisma.paymentSession.create({
        data: {
          sessionId: response.data.id,
          amount: amount,
          currency: currency.toUpperCase(),
          status: 'PENDING',
          metadata: {
            // Store all the metadata we sent to the payment gateway
            noOfProducts: noOfProducts.toString(),
            currency: "USD",
            paymentType: "gateway_product_purchase",
            return_url: return_url || null,
            sellerEmail: sellerEmail,
            
            // Enhanced metadata for order tracking
            itemId: itemId,
            itemType: itemType,
            itemTitle: itemTitle,
            itemDescription: itemDescription,
            sellerName: seller.name,
            buyerEmail: buyerEmail,
            buyerName: buyerName,
            buyerWalletAddress: buyerWalletAddress,
            
            // Store the original payment payload for reference
            originalPayload: paymentPayload
          }
        }
      });
      // console.log("✅ Payment session data stored in database:", response.data.id);
    } catch (sessionError) {
      console.error("❌ Error storing payment session data:", sessionError);
      // Don't fail the entire request if session storage fails
    }

    // Return success response
    res.status(200).json({
      success: true,
      sessionId: response.data.id,
      checkoutUrl: response.data.uri,
      message:
        "Payment gateway session created successfully for product purchase",
    });
  } catch (error) {
    console.error("❌ Payment gateway product purchase creation error:", error);

      // Handle different types of errors
      if (error.response) {
        console.error("🚨 Payment Gateway Response Error:", {
          status: error.response.status,
          statusText: error.response.statusText,
          headers: error.response.headers,
          data: error.response.data
        });
        
        return res.status(500).json({
          success: false,
          error: `Payment gateway error (${error.response.status}): ${error.response.data?.message || error.message}`,
          details: {
            status: error.response.status,
            statusText: error.response.statusText,
            data: error.response.data,
            sellerEmail: req.body.sellerEmail,
            apiKeyProvided: !!seller?.apiKey,
            amount: req.body.amount,
            unitAmountInCents: Math.max(1, Math.round(req.body.amount * 100))
          },
        });
    }

    if (error.request) {
      console.error("🌐 Request Error:", error.request);
      return res.status(500).json({
        success: false,
        error: "Unable to connect to payment gateway. Please try again later.",
        details: "Network connectivity issue",
      });
    }

    // Generic error handling
    res.status(500).json({
      success: false,
      error: `Payment gateway error: ${error.message}`,
      details: {
        errorType: error.constructor.name,
        message: error.message,
      },
    });
  }
});

// ==================== PRODUCT PURCHASE SUCCESS/CANCEL HANDLERS ====================

/**
 * @swagger
 * /api/payments/gateway/product-purchase/success:
 *   get:
 *     summary: Handle successful product purchase payment
 *     description: Processes successful product purchase payment completion and redirects to frontend
 *     tags:
 *       - Payment Processing
 *     parameters:
 *       - name: session_id
 *         in: query
 *         required: true
 *         description: Payment session ID
 *         schema:
 *           type: string
 *       - name: noOfProducts
 *         in: query
 *         required: true
 *         description: Number of products purchased
 *         schema:
 *           type: string
 *       - name: return_url
 *         in: query
 *         required: true
 *         description: Return URL to redirect to
 *         schema:
 *           type: string
 *     responses:
 *       302:
 *         description: Redirects to frontend with success status
 *       400:
 *         description: Missing required parameters
 *       500:
 *         description: Error processing payment
 */
router.get("/gateway/product-purchase/success", async (req, res) => {
  try {
    // console.log("🚀 SUCCESS ROUTE HIT - Product purchase success handler called");
    // console.log("🔗 Full URL:", req.url);
    // console.log("🔗 Original URL:", req.originalUrl);
    // console.log("📋 Raw query string:", req.query);
    // console.log("📋 All query parameters:", JSON.stringify(req.query, null, 2));
    
    const { session_id, noOfProducts, return_url, transaction_hash, txHash, tx_hash } = req.query;
    
    // Log transaction hash if provided
    const transactionHash = transaction_hash || txHash || tx_hash;
    // Validate required parameters
    if (!session_id || !noOfProducts) {
      console.error("Missing required parameters for product purchase success:", {
        session_id,
        noOfProducts
      });
      return res.redirect(
        `${FRONTEND_URL}/payment?status=error&message=Missing required parameters`
      );
    }

    // 🔥 NEW: Record the order in database
    try {
      // console.log("📝 Recording order in database...");
      const order = await recordOrderInDatabase(session_id, noOfProducts, req);
      // console.log("✅ Order recorded successfully:", order.orderId);
    } catch (orderError) {
      console.error("❌ Error recording order:", orderError);
      // Don't fail the entire process if order recording fails
      // Log the error but continue with the redirect
    }

    // Here you can add additional logic to:
    // 1. Update product inventory
    // 2. Send confirmation emails
    // 3. Update user's purchase history
    // 4. Send notifications to seller

    // console.log(`Product purchase successful: Session ${session_id}, Products ${noOfProducts}`);

    // Determine redirect URL - go back to original page if provided
    let redirectUrl;
    if (return_url) {
      // Redirect back to the original page with success parameters
      redirectUrl = `${return_url}&payment=success&sessionId=${session_id}&products=${noOfProducts}&message=${encodeURIComponent('Purchase completed successfully!')}`;
    } else {
      // Fallback to payment page
      redirectUrl = `${FRONTEND_URL}/payment&status=success&sessionId=${session_id}&products=${noOfProducts}&message=${encodeURIComponent('Product purchase successful!')}`;
    }

    // console.log(`Redirecting to: ${redirectUrl}`);
    res.redirect(redirectUrl);

  } catch (error) {
    console.error("Product purchase success handler error:", error);

    // Redirect to frontend with error
    const errorMessage = "Failed to process successful product purchase";
    res.redirect(
      `${FRONTEND_URL}/payment&status=error&message=${encodeURIComponent(errorMessage)}`
    );
  }
});

/**
 * @swagger
 * /api/payments/gateway/product-purchase/cancel:
 *   get:
 *     summary: Handle cancelled product purchase payment
 *     description: Processes cancelled product purchase payment and redirects to frontend or original cancel URL
 *     tags:
 *       - Payment Processing
 *     parameters:
 *       - name: session_id
 *         in: query
 *         required: false
 *         description: Payment session ID
 *         schema:
 *           type: string
 *       - name: original_cancel_url
 *         in: query
 *         required: false
 *         description: Original cancel URL to redirect to
 *         schema:
 *           type: string
 *     responses:
 *       302:
 *         description: Redirects to frontend or original cancel URL
 */
router.get("/gateway/product-purchase/cancel", async (req, res) => {
  try {
    const { session_id, original_cancel_url } = req.query;

    // console.log("❌ Product purchase payment cancelled:", {
    //   session_id,
    //   original_cancel_url
    // });

    // Here you can add logic to:
    // 1. Log the cancellation
    // 2. Update payment status
    // 3. Send cancellation notification

    // Determine redirect URL
    let redirectUrl;
    if (original_cancel_url) {
      redirectUrl = decodeURIComponent(original_cancel_url);
    } else {
      redirectUrl = `${FRONTEND_URL}/payment&status=cancelled&sessionId=${session_id || 'unknown'}&message=${encodeURIComponent('Product purchase cancelled')}`;
    }

    // console.log(`Redirecting to: ${redirectUrl}`);
    res.redirect(redirectUrl);

  } catch (error) {
    console.error("Product purchase cancel handler error:", error);

    // Fallback redirect to frontend
    res.redirect(
      `${FRONTEND_URL}/payment&status=error&message=${encodeURIComponent('Failed to process cancellation')}`
    );
  }
});

router.get("/getLiveGLLData", async (req, res) => {
  try {

    const payload = { "query": "query MyQuery {\n  pools(where: {id_in: [\"0xbc4dcf7539d9261731888a7d95994cbedf07ab52\",\"0x5854b550482dc2785c9c4ecdb235076b5e1d75b7\"]}){\n    id,\n    token0Price,\n    token1Price\n  },\n}", "operationName": "MyQuery" }
    const payloadYesterday = { "query": "query MyQuery {\n  tokenDayDatas(first: 1, orderBy: \"id\", orderDirection: \"desc\", where: {token:\"0xc6126ebfa8b5ffd41561c086979c97416969cebf\"}) {\n    id\n    priceUSD\n  }\n}", "operationName": "MyQuery" }

    const reso = await fetch("https://graph.xspswap.finance/subgraphs/name/v3/factory-usdc", {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const resoYesterday = await fetch("https://graph.xspswap.finance/subgraphs/name/v3/factory-usdc", {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(payloadYesterday),
    });

    const json1 = await reso.json();
    const json1YesterDay = await resoYesterday.json();
    const output = {
      "gll/xdc": Number(json1.data.pools[1].token1Price).toFixed(6),
      "gll/usd": (Number(json1.data.pools[0].token1Price) / Number(json1.data.pools[1].token1Price)).toFixed(7),
      "gll/usd Yesterday": Number(json1YesterDay.data.tokenDayDatas[0].priceUSD).toFixed(7),
      "change": ((((Number(json1.data.pools[0].token1Price) / Number(json1.data.pools[1].token1Price)) - Number(json1YesterDay.data.tokenDayDatas[0].priceUSD)) / Number(json1YesterDay.data.tokenDayDatas[0].priceUSD)) * 100).toFixed(2) + " %"
    }
    res.send(JSON.stringify(output, null, 2));

  } catch (error) {
    console.error("Live GLL price query error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to retrieve live GLL price",
      details: error.message,
    });
  }
})

module.exports = router;
