#!/usr/bin/env node

/**
 * Simple script to test and debug Stripe API key
 * Usage: node test-stripe-key.js
 */

require("dotenv").config();

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
      businessType: account.business_type,
    };
  } catch (error) {
    const keyInfo = getMaskedStripeKey();

    return {
      isValid: false,
      error: error.message,
      keyInfo,
      testResult: "Stripe API key validation failed",
      errorType: error.type,
      details:
        error.type === "StripeAuthenticationError"
          ? "Invalid Stripe API key - check your key is correct"
          : error.type === "StripePermissionError"
          ? "Stripe API key lacks required permissions"
          : "Network or API error",
    };
  }
}

async function testStripeApiKey() {
  console.log("🔍 Testing Stripe API Key...\n");

  try {
    // Get masked API key info
    const keyInfo = getMaskedStripeKey();
    console.log("📋 Stripe API Key Information:");
    console.log(`   Masked Key: ${keyInfo.masked}`);
    console.log(`   Length: ${keyInfo.length} characters`);
    console.log(`   Key Type: ${keyInfo.keyType}`);
    console.log(`   Starts with 'sk_': ${keyInfo.startsWithSk ? "✅" : "❌"}`);
    console.log(`   Starts with 'pk_': ${keyInfo.startsWithPk ? "✅" : "❌"}`);
    console.log(`   Valid Format: ${keyInfo.isValid ? "✅" : "❌"}`);

    if (keyInfo.error) {
      console.log(`   Error: ${keyInfo.error}`);
    }

    console.log("\n🧪 Testing Stripe API Key Functionality...");

    // Test the API key
    const testResult = await testStripeKey();

    if (testResult.isValid) {
      console.log("✅ Stripe API Key Test: PASSED");
      console.log(`   Account ID: ${testResult.accountId}`);
      console.log(`   Account Type: ${testResult.accountType}`);
      console.log(`   Country: ${testResult.country}`);
      if (testResult.businessType) {
        console.log(`   Business Type: ${testResult.businessType}`);
      }
    } else {
      console.log("❌ Stripe API Key Test: FAILED");
      console.log(`   Error: ${testResult.error}`);
      if (testResult.errorType) {
        console.log(`   Error Type: ${testResult.errorType}`);
      }
      if (testResult.details) {
        console.log(`   Details: ${testResult.details}`);
      }
    }
  } catch (error) {
    console.error("❌ Error during Stripe API key test:", error.message);

    // Still try to show key info even if service fails to initialize
    if (process.env.STRIPE_SECRET_KEY) {
      const apiKey = process.env.STRIPE_SECRET_KEY;
      const first4 = apiKey.substring(0, 4);
      const last4 = apiKey.substring(apiKey.length - 4);
      const masked = `${first4}${"*".repeat(
        Math.max(0, apiKey.length - 8)
      )}${last4}`;

      console.log("\n📋 Raw Stripe API Key Information:");
      console.log(`   Masked Key: ${masked}`);
      console.log(`   Length: ${apiKey.length} characters`);
      console.log(
        `   Starts with 'sk_': ${apiKey.startsWith("sk_") ? "✅" : "❌"}`
      );
      console.log(
        `   Starts with 'pk_': ${apiKey.startsWith("pk_") ? "✅" : "❌"}`
      );
    } else {
      console.log("\n❌ STRIPE_SECRET_KEY environment variable is not set");
    }
  }
}

// Run the test
testStripeApiKey().catch(console.error);
