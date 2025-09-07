/**
 * Test script for the enhanced add-generations endpoint with session ID validation
 * This tests the new behavior where POST /add-generations requires a session ID and prevents duplicate transactions
 */

const axios = require("axios");

const BASE_URL = "http://localhost:5000/api/leadgen";

async function testAddGenerationsWithSession() {
  console.log("🧪 Testing Add Generations with Session ID Validation...\n");

  const testWalletAddress = `test-session-wallet-${Date.now()}`;
  const sessionId1 = `session-${Date.now()}-1`;
  const sessionId2 = `session-${Date.now()}-2`;

  try {
    // Step 1: First request - should create wallet and add generations
    console.log(
      "📍 Step 1: First add-generations request (should auto-create wallet and add generations)"
    );
    const firstResponse = await axios.post(
      `${BASE_URL}/ai-text/wallet/${testWalletAddress}/add-generations`,
      {
        additionalGenerations: 100,
        sessionId: sessionId1,
        metadata: {
          source: "test_payment",
          planType: "premium",
          paymentAmount: 29.99,
        },
      }
    );

    console.log("✅ First Request Response:");
    console.log(JSON.stringify(firstResponse.data, null, 2));

    // Verify response structure
    const firstData = firstResponse.data.data;

    if (firstData.generationsAllowed >= 100) {
      console.log("✅ SUCCESS: Generations were added correctly");
    } else {
      console.log(
        `❌ ERROR: Expected at least 100 generations, got ${firstData.generationsAllowed}`
      );
    }

    if (
      firstResponse.data.transaction &&
      firstResponse.data.transaction.sessionId === sessionId1
    ) {
      console.log(
        "✅ SUCCESS: Transaction info returned with correct session ID"
      );
    } else {
      console.log("❌ ERROR: Transaction info missing or incorrect");
    }

    // Step 2: Duplicate request with same session ID - should fail
    console.log(
      "\n📍 Step 2: Duplicate request with same session ID (should fail with 409)"
    );
    try {
      await axios.post(
        `${BASE_URL}/ai-text/wallet/${testWalletAddress}/add-generations`,
        {
          additionalGenerations: 50,
          sessionId: sessionId1, // Same session ID - should fail
          metadata: {
            source: "duplicate_test",
          },
        }
      );
      console.log("❌ ERROR: Duplicate request should have failed!");
    } catch (error) {
      if (error.response && error.response.status === 409) {
        console.log(
          "✅ SUCCESS: Duplicate session ID correctly rejected with 409"
        );
        console.log(`   Response: ${error.response.data.message}`);
      } else {
        console.log(
          `❌ ERROR: Expected 409, got ${error.response?.status || "unknown"}`
        );
        console.log(`   Response:`, error.response?.data);
      }
    }

    // Step 3: New request with different session ID - should succeed
    console.log(
      "\n📍 Step 3: New request with different session ID (should succeed)"
    );
    const thirdResponse = await axios.post(
      `${BASE_URL}/ai-text/wallet/${testWalletAddress}/add-generations`,
      {
        additionalGenerations: 200,
        sessionId: sessionId2,
        metadata: {
          source: "second_payment",
          planType: "enterprise",
        },
      }
    );

    console.log("✅ Third Request Response:");
    console.log(JSON.stringify(thirdResponse.data, null, 2));

    const thirdData = thirdResponse.data.data;

    if (thirdData.generationsAllowed >= 300) {
      // Should be at least 3 (default) + 100 + 200 = 303
      console.log("✅ SUCCESS: Second transaction added generations correctly");
    } else {
      console.log(
        `❌ ERROR: Expected at least 300 generations, got ${thirdData.generationsAllowed}`
      );
    }

    // Step 4: Test transaction history endpoint
    console.log("\n📍 Step 4: Testing transaction history endpoint");
    const historyResponse = await axios.get(
      `${BASE_URL}/ai-text/wallet/${testWalletAddress}/transactions`
    );

    console.log("✅ Transaction History Response:");
    console.log(JSON.stringify(historyResponse.data, null, 2));

    const historyData = historyResponse.data.data;

    if (historyData.transactions && historyData.transactions.length >= 2) {
      console.log(
        "✅ SUCCESS: Transaction history contains expected transactions"
      );

      // Check if both session IDs are present
      const sessionIds = historyData.transactions.map((tx) => tx.sessionId);
      if (sessionIds.includes(sessionId1) && sessionIds.includes(sessionId2)) {
        console.log(
          "✅ SUCCESS: Both session IDs found in transaction history"
        );
      } else {
        console.log("❌ ERROR: Missing session IDs in transaction history");
      }
    } else {
      console.log("❌ ERROR: Transaction history missing or incomplete");
    }

    // Step 5: Test missing session ID validation
    console.log("\n📍 Step 5: Testing missing session ID validation");
    try {
      await axios.post(
        `${BASE_URL}/ai-text/wallet/${testWalletAddress}/add-generations`,
        {
          additionalGenerations: 50,
          // Missing sessionId
        }
      );
      console.log("❌ ERROR: Request without session ID should have failed!");
    } catch (error) {
      if (error.response && error.response.status === 400) {
        console.log(
          "✅ SUCCESS: Missing session ID correctly rejected with 400"
        );
        console.log(`   Response: ${error.response.data.message}`);
      } else {
        console.log(
          `❌ ERROR: Expected 400, got ${error.response?.status || "unknown"}`
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
testAddGenerationsWithSession();
