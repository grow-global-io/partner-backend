/**
 * @fileoverview Payment Routes
 * @description API routes for handling plan purchases and payment processing
 * @author GrowLimitless Team
 */

const express = require("express");
const axios = require("axios");
const prisma = require("../config/db");

const router = express.Router();

// Payment Gateway Configuration
const PAYMENT_GATEWAY_URL =
  "https://gll-gateway.growlimitless.app/api/sessions";
const BASE_URL = "https://backend.gll.one";
const FRONTEND_URL = "https://www.gll.one";

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
        ? cancel_url
        : `${BASE_URL}/api/payments/cancel?session_id={CHECKOUT_SESSION_ID}`,
      metadata: {
        ...metadata,
        walletId,
        noOfDocs: noOfDocs.toString(),
      },
      apiKey: "growinvoice",
    };

    console.log("Payment Gateway URL:", PAYMENT_GATEWAY_URL);
    console.log("Payment Payload:", JSON.stringify(paymentPayload, null, 2));

    // Call payment gateway with proper headers
    const response = await axios.post(PAYMENT_GATEWAY_URL, paymentPayload, {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      timeout: 30000, // 30 second timeout
    });

    console.log("Response Status:", response.status);
    console.log("Response Headers:", response.headers);

    // Check if response is HTML instead of JSON
    const contentType = response.headers["content-type"];
    if (contentType && contentType.includes("text/html")) {
      console.error("Received HTML response instead of JSON:");
      console.error("Response data:", response.data);
      throw new Error(
        "Payment gateway returned HTML error page instead of JSON. Please check the gateway URL and endpoint."
      );
    }

    console.log(
      "Payment Gateway Response:",
      JSON.stringify(response.data, null, 2)
    );

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
        error: `Payment gateway error (${error.response.status}): ${
          error.response.data?.message || error.message
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
    console.log("Stripe Line Items:", success_url, cancel_url);
    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: stripeLineItems,
      mode: mode,
      success_url: success_url
        ? success_url
        : `${BASE_URL}/api/payments/success?session_id={CHECKOUT_SESSION_ID}&walletId=${walletId}&noOfDocs=${noOfDocs}`,
      cancel_url: cancel_url
        ? cancel_url
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
    const redirectUrl = `${FRONTEND_URL}/resume?status=success&sessionId=${session_id}&walletId=${walletId}&documents=${
      updatedWallet.noOfDocuments
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
 *     description: Processes payment cancellation by user and redirects to frontend
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
 *     responses:
 *       302:
 *         description: Redirects to frontend with cancellation status
 *       500:
 *         description: Error processing cancellation - redirects to frontend with error
 */
router.get("/cancel", async (req, res) => {
  try {
    const { session_id } = req.query;

    console.log(`Payment cancelled for session: ${session_id || "unknown"}`);

    // Redirect to frontend with cancellation status
    const message = session_id
      ? "Payment was cancelled by user"
      : "Payment was cancelled";

    const redirectUrl = `${FRONTEND_URL}/resume?status=cancelled&sessionId=${
      session_id || ""
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

module.exports = router;
