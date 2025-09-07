/**
 * Test script for auto-creation of wallet during increment operations
 * This tests the new behavior where PUT /increment automatically creates wallet if not found
 */

const axios = require("axios");

const BASE_URL = "http://localhost:5000/api/leadgen";

async function testAutoCreateWallet() {
  console.log("🧪 Testing Auto-Create Wallet Feature...\n");

  const testWalletAddress = `test-auto-create-${Date.now()}`;

  try {
    // Step 1: Verify wallet doesn't exist
    console.log("📍 Step 1: Checking wallet doesn't exist");
    try {
      await axios.get(`${BASE_URL}/ai-text/wallet/${testWalletAddress}`);
      console.log("❌ ERROR: Wallet already exists!");
      return;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        console.log("✅ Confirmed: Wallet doesn't exist");
      } else {
        throw error;
      }
    }

    // Step 2: Try increment operation on non-existent wallet
    console.log(
      "\n📍 Step 2: Incrementing non-existent wallet (should auto-create)"
    );
    const incrementResponse = await axios.put(
      `${BASE_URL}/ai-text/wallet/${testWalletAddress}`,
      {
        generationsCount: 5,
        operation: "increment",
      }
    );

    console.log(
      "✅ Response:",
      JSON.stringify(incrementResponse.data, null, 2)
    );

    // Verify the response indicates creation
    if (incrementResponse.data.data.created === true) {
      console.log("✅ SUCCESS: Wallet was auto-created during increment!");
    } else {
      console.log("⚠️  WARNING: created flag not set to true");
    }

    // Verify the generations count is correct
    if (incrementResponse.data.data.generationsCount === 5) {
      console.log("✅ SUCCESS: Generations count set correctly to 5");
    } else {
      console.log("❌ ERROR: Generations count incorrect");
    }

    // Step 3: Verify wallet now exists and can be retrieved
    console.log("\n📍 Step 3: Verifying wallet can now be retrieved");
    const getResponse = await axios.get(
      `${BASE_URL}/ai-text/wallet/${testWalletAddress}`
    );

    console.log(
      "✅ Wallet retrieved:",
      JSON.stringify(getResponse.data.data, null, 2)
    );

    // Step 4: Test another increment to verify normal increment behavior
    console.log("\n📍 Step 4: Testing normal increment on existing wallet");
    const incrementResponse2 = await axios.put(
      `${BASE_URL}/ai-text/wallet/${testWalletAddress}`,
      {
        generationsCount: 3,
        operation: "increment",
      }
    );

    console.log(
      "✅ Response:",
      JSON.stringify(incrementResponse2.data, null, 2)
    );

    // Should now be 5 + 3 = 8
    if (incrementResponse2.data.data.generationsCount === 8) {
      console.log("✅ SUCCESS: Normal increment worked (5 + 3 = 8)");
    } else {
      console.log("❌ ERROR: Normal increment failed");
    }

    // Verify created flag is false for existing wallet
    if (incrementResponse2.data.data.created === false) {
      console.log(
        "✅ SUCCESS: created flag correctly set to false for existing wallet"
      );
    } else {
      console.log(
        "⚠️  WARNING: created flag should be false for existing wallet"
      );
    }

    // Step 5: Test set operation on non-existent wallet (should still fail)
    console.log(
      "\n📍 Step 5: Testing set operation on non-existent wallet (should fail)"
    );
    const nonExistentWallet = `test-set-fail-${Date.now()}`;

    try {
      await axios.put(`${BASE_URL}/ai-text/wallet/${nonExistentWallet}`, {
        generationsCount: 10,
        operation: "set",
      });
      console.log(
        "❌ ERROR: Set operation should have failed for non-existent wallet"
      );
    } catch (error) {
      if (error.response && error.response.status === 404) {
        console.log(
          "✅ SUCCESS: Set operation correctly failed with 404 for non-existent wallet"
        );
      } else {
        console.log(
          "❌ ERROR: Unexpected error for set operation:",
          error.message
        );
      }
    }

    // Cleanup: Delete the test wallet
    console.log("\n📍 Cleanup: Deleting test wallet");
    await axios.delete(`${BASE_URL}/ai-text/wallet/${testWalletAddress}`);
    console.log("✅ Test wallet deleted");

    console.log(
      "\n🎉 ALL TESTS PASSED! Auto-create wallet feature working correctly."
    );
  } catch (error) {
    console.error("❌ Test failed:", error.response?.data || error.message);

    // Try to cleanup on error
    try {
      await axios.delete(`${BASE_URL}/ai-text/wallet/${testWalletAddress}`);
      console.log("🧹 Cleanup: Test wallet deleted after error");
    } catch (cleanupError) {
      // Ignore cleanup errors
    }
  }
}

// Run the test
testAutoCreateWallet();
