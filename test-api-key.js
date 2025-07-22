#!/usr/bin/env node

/**
 * Simple script to test and debug OpenAI API key
 * Usage: node test-api-key.js
 */

require("dotenv").config();
const OpenAIService = require("./src/services/OpenAIService");

async function testApiKey() {
  console.log("🔍 Testing OpenAI API Key...\n");

  try {
    const openAIService = new OpenAIService();

    // Get masked API key info
    const keyInfo = openAIService.getMaskedApiKey();
    console.log("📋 API Key Information:");
    console.log(`   Masked Key: ${keyInfo.masked}`);
    console.log(`   Length: ${keyInfo.length} characters`);
    console.log(`   Starts with 'sk-': ${keyInfo.startsWithSk ? "✅" : "❌"}`);
    console.log(`   Valid Format: ${keyInfo.isValid ? "✅" : "❌"}`);

    if (keyInfo.error) {
      console.log(`   Error: ${keyInfo.error}`);
    }

    console.log("\n🧪 Testing API Key Functionality...");

    // Test the API key
    const testResult = await openAIService.testApiKey();

    if (testResult.isValid) {
      console.log("✅ API Key Test: PASSED");
      console.log(`   Available Models: ${testResult.modelCount}`);
      console.log(`   Has GPT-4 Access: ${testResult.hasGPT4 ? "✅" : "❌"}`);
    } else {
      console.log("❌ API Key Test: FAILED");
      console.log(`   Error: ${testResult.error}`);
      if (testResult.details) {
        console.log(`   Details: ${testResult.details}`);
      }
    }

    console.log("\n🏥 Health Status:");
    const healthStatus = await openAIService.getHealthStatus();
    console.log(`   Service Status: ${healthStatus.status}`);
    console.log(
      `   API Key Configured: ${healthStatus.apiKey.configured ? "✅" : "❌"}`
    );
    console.log(
      `   Valid Format: ${healthStatus.apiKey.validFormat ? "✅" : "❌"}`
    );
  } catch (error) {
    console.error("❌ Error during API key test:", error.message);

    // Still try to show key info even if service fails to initialize
    if (process.env.OPENAI_API_KEY) {
      const apiKey = process.env.OPENAI_API_KEY;
      const first4 = apiKey.substring(0, 4);
      const last4 = apiKey.substring(apiKey.length - 4);
      const masked = `${first4}${"*".repeat(
        Math.max(0, apiKey.length - 8)
      )}${last4}`;

      console.log("\n📋 Raw API Key Information:");
      console.log(`   Masked Key: ${masked}`);
      console.log(`   Length: ${apiKey.length} characters`);
      console.log(
        `   Starts with 'sk-': ${apiKey.startsWith("sk-") ? "✅" : "❌"}`
      );
    } else {
      console.log("\n❌ OPENAI_API_KEY environment variable is not set");
    }
  }
}

// Run the test
testApiKey().catch(console.error);
