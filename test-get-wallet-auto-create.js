/**
 * Test script for auto-creation of wallet during GET operations
 * This tests the new behavior where GET /ai-text/wallet/{walletAddress} automatically creates wallet if not found
 */

const axios = require("axios");

const BASE_URL = "http://localhost:5000/api/leadgen";

async function testGetWalletAutoCreate() {
  console.log("🧪 Testing Auto-Create Wallet Feature on GET Request...\n");

  const testWalletAddress = `test-get-auto-create-${Date.now()}`;

  try {
    // Step 1: First GET request - should auto-create wallet
    console.log(
      "📍 Step 1: First GET request on non-existent wallet (should auto-create)"
    );
    const firstResponse = await axios.get(
      `${BASE_URL}/ai-text/wallet/${testWalletAddress}`
    );

    console.log("✅ First GET Response:");
    console.log(JSON.stringify(firstResponse.data, null, 2));

    // Verify response structure and default values
    const walletData = firstResponse.data.data;

    if (walletData.generationsAllowed === 3) {
      console.log("✅ SUCCESS: generationsAllowed correctly set to 3");
    } else {
      console.log(
        `❌ ERROR: generationsAllowed is ${walletData.generationsAllowed}, expected 3`
      );
    }

    if (walletData.generationsCount === 0) {
      console.log("✅ SUCCESS: generationsCount correctly set to 0");
    } else {
      console.log(
        `❌ ERROR: generationsCount is ${walletData.generationsCount}, expected 0`
      );
    }

    if (walletData.planType === "free") {
      console.log("✅ SUCCESS: planType correctly set to 'free'");
    } else {
      console.log(
        `❌ ERROR: planType is ${walletData.planType}, expected 'free'`
      );
    }

    if (walletData.generationsRemaining === 3) {
      console.log("✅ SUCCESS: generationsRemaining correctly calculated as 3");
    } else {
      console.log(
        `❌ ERROR: generationsRemaining is ${walletData.generationsRemaining}, expected 3`
      );
    }

    // Check message to see if it indicates creation
    if (firstResponse.data.message.includes("created")) {
      console.log("✅ SUCCESS: Response message indicates wallet was created");
    } else {
      console.log(
        "ℹ️  Note: Response message doesn't specifically indicate creation"
      );
    }

    // Step 2: Second GET request - should return existing wallet
    console.log(
      "\n📍 Step 2: Second GET request (should return existing wallet)"
    );
    const secondResponse = await axios.get(
      `${BASE_URL}/ai-text/wallet/${testWalletAddress}`
    );

    console.log("✅ Second GET Response:");
    console.log(JSON.stringify(secondResponse.data, null, 2));

    // Verify it's the same wallet
    const secondWalletData = secondResponse.data.data;

    if (secondWalletData.createdAt === walletData.createdAt) {
      console.log("✅ SUCCESS: Same wallet returned (createdAt matches)");
    } else {
      console.log(
        "❌ ERROR: Different wallet returned (createdAt doesn't match)"
      );
    }

    if (secondResponse.data.message.includes("retrieved")) {
      console.log(
        "✅ SUCCESS: Second response indicates retrieval, not creation"
      );
    }

    // Step 3: Test with invalid wallet address
    console.log("\n📍 Step 3: Testing with empty wallet address");
    try {
      await axios.get(`${BASE_URL}/ai-text/wallet/`);
      console.log("❌ ERROR: Should have failed with empty wallet address");
    } catch (error) {
      if (error.response && error.response.status === 404) {
        console.log(
          "✅ SUCCESS: Correctly handled empty wallet address with 404"
        );
      } else if (error.response && error.response.status === 400) {
        console.log(
          "✅ SUCCESS: Correctly handled empty wallet address with 400"
        );
      } else {
        console.log(
          `ℹ️  Note: Got ${
            error.response?.status || "unknown"
          } status for empty address`
        );
      }
    }

    console.log("\n🎉 All tests completed successfully!");
  } catch (error) {
    if (error.response) {
      console.log("❌ API Error:");
      console.log(`   Status: ${error.response.status}`);
      console.log(`   Data:`, error.response.data);
    } else if (error.code === "ECONNREFUSED") {
      console.log("❌ Server is not running on port 5000");
      console.log("   Please start your server first");
    } else {
      console.log("❌ Request Error:", error.message);
    }
  }
}

// Run the test
testGetWalletAutoCreate();
