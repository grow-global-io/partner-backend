/**
 * Te// Example wallet addresses for testing - now supports any format
const testWallets = [
  'wallet123',
  'user@example.com',
  '0x742d35cc6634c0532925a3b8d1b9e7c1e0123456',
  'metamask-wallet-001',
  'solana-wallet-xyz'
];e for UserWallet AI Text Generation API
 *
 * This file demonstrates how to use the User Wallet AI Text Generation endpoints.
 * Run this file with Node.js to test the API endpoints.
 */

const baseURL = "http://localhost:3000/api/leadgen"; // Adjust port as needed

// Example wallet addresses for testing
const testWallets = [
  "0x742d35cc6634c0532925a3b8d1b9e7c1e0123456",
  "0x1234567890abcdef1234567890abcdef12345678",
  "0xabcdef1234567890abcdef1234567890abcdef12",
];

/**
 * Helper function to make HTTP requests
 */
async function makeRequest(url, method = "GET", body = null) {
  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, options);
    const data = await response.json();
    console.log(`${method} ${url}`);
    console.log("Status:", response.status);
    console.log("Response:", JSON.stringify(data, null, 2));
    console.log("---");
    return data;
  } catch (error) {
    console.error(`Error with ${method} ${url}:`, error.message);
    console.log("---");
    return null;
  }
}

/**
 * Test all AI Text Wallet endpoints
 */
async function testAITextWalletAPI() {
  console.log("🚀 Testing AI Text Wallet API Endpoints\n");

  // 1. Health Check
  console.log("1. Testing Health Check:");
  await makeRequest(`${baseURL}/ai-text/health`);

  // 2. Create/Initialize Wallets
  console.log("2. Creating Test Wallets:");
  for (let i = 0; i < testWallets.length; i++) {
    await makeRequest(`${baseURL}/ai-text/wallet`, "POST", {
      walletAddress: testWallets[i],
      generationsCount: i * 5, // 0, 5, 10
    });
  }

  // 3. Get Individual Wallet
  console.log("3. Getting Individual Wallet:");
  await makeRequest(`${baseURL}/ai-text/wallet/${testWallets[0]}`);

  // 4. Update Wallet (Set operation)
  console.log("4. Updating Wallet (Set operation):");
  await makeRequest(`${baseURL}/ai-text/wallet/${testWallets[0]}`, "PUT", {
    generationsCount: 20,
    operation: "set",
  });

  // 5. Update Wallet (Increment operation)
  console.log("5. Updating Wallet (Increment operation):");
  await makeRequest(`${baseURL}/ai-text/wallet/${testWallets[1]}`, "PUT", {
    generationsCount: 3,
    operation: "increment",
  });

  // 6. Get All Wallets
  console.log("6. Getting All Wallets (Page 1):");
  await makeRequest(
    `${baseURL}/ai-text/wallets?page=1&limit=10&sortBy=generationsCount&sortOrder=desc`
  );

  // 7. Get Statistics
  console.log("7. Getting Statistics:");
  await makeRequest(`${baseURL}/ai-text/statistics`);

  // 8. Test Non-existent Wallet
  console.log("8. Testing Non-existent Wallet:");
  await makeRequest(
    `${baseURL}/ai-text/wallet/0x0000000000000000000000000000000000000000`
  );

  // 9. Test Invalid Wallet Address
  console.log("9. Testing Invalid Wallet Address:");
  await makeRequest(`${baseURL}/ai-text/wallet`, "POST", {
    walletAddress: "invalid-address",
    generationsCount: 10,
  });

  // 10. Delete Wallet
  console.log("10. Deleting Wallet:");
  await makeRequest(`${baseURL}/ai-text/wallet/${testWallets[2]}`, "DELETE");

  // 11. Verify Deletion
  console.log("11. Verifying Deletion:");
  await makeRequest(`${baseURL}/ai-text/wallet/${testWallets[2]}`);

  console.log("✅ API Testing Complete!");
}

/**
 * Example usage scenarios
 */
function printUsageExamples() {
  console.log("\n📖 Usage Examples:\n");

  console.log("1. Create a new wallet:");
  console.log(`POST ${baseURL}/ai-text/wallet`);
  console.log(
    'Body: { "walletAddress": "wallet123", "generationsCount": 0 }\n'
  );

  console.log("2. Get wallet information:");
  console.log(`GET ${baseURL}/ai-text/wallet/wallet123\n`);

  console.log("3. Increment generations count:");
  console.log(`PUT ${baseURL}/ai-text/wallet/wallet123`);
  console.log('Body: { "generationsCount": 1, "operation": "increment" }\n');

  console.log("4. Set generations count:");
  console.log(`PUT ${baseURL}/ai-text/wallet/wallet123`);
  console.log('Body: { "generationsCount": 50, "operation": "set" }\n');

  console.log("5. Get all wallets with pagination:");
  console.log(
    `GET ${baseURL}/ai-text/wallets?page=1&limit=50&sortBy=updatedAt&sortOrder=desc\n`
  );

  console.log("6. Get system statistics:");
  console.log(`GET ${baseURL}/ai-text/statistics\n`);

  console.log("7. Health check:");
  console.log(`GET ${baseURL}/ai-text/health\n`);

  console.log("8. Delete wallet:");
  console.log(`DELETE ${baseURL}/ai-text/wallet/wallet123\n`);
}

/**
 * Integration example: Simulating AI text generation workflow
 */
async function simulateAIGenerationWorkflow() {
  console.log("\n🤖 Simulating AI Text Generation Workflow:\n");

  const userWallet = "wallet123";

  // Step 1: Check if wallet exists, create if not
  console.log("Step 1: Initialize user wallet");
  await makeRequest(`${baseURL}/ai-text/wallet`, "POST", {
    walletAddress: userWallet,
    generationsCount: 0,
  });

  // Step 2: Simulate multiple AI generations
  console.log("Step 2: Simulate AI text generations");
  for (let i = 0; i < 5; i++) {
    console.log(`   Generation ${i + 1}:`);
    await makeRequest(`${baseURL}/ai-text/wallet/${userWallet}`, "PUT", {
      generationsCount: 1,
      operation: "increment",
    });
  }

  // Step 3: Check final wallet state
  console.log("Step 3: Check final wallet state");
  await makeRequest(`${baseURL}/ai-text/wallet/${userWallet}`);

  console.log("✅ Workflow simulation complete!");
}

// Export functions for use in other files
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    testAITextWalletAPI,
    printUsageExamples,
    simulateAIGenerationWorkflow,
    makeRequest,
    baseURL,
    testWallets,
  };
}

// Run tests if this file is executed directly
if (typeof require !== "undefined" && require.main === module) {
  console.log(
    "⚠️  Note: Make sure your server is running before executing these tests\n"
  );
  printUsageExamples();

  // Uncomment to run actual API tests (requires running server)
  // testAITextWalletAPI();
  // simulateAIGenerationWorkflow();
}
