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
const BASE_URL = "http://localhost:8000";
const FRONTEND_URL = "http://localhost:3000";

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

    if (error.type === "StripeInvalidRequestError") {
      return res.status(400).json({
        success: false,
        error: error.message,
      });
    }

    res.status(500).json({
      success: false,
      error: `Stripe payment error: ${error.message}`,
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
