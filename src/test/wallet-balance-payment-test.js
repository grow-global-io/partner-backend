/**
 * @fileoverview Test file for wallet balance payment API
 * @description Examples of how to use the new wallet balance payment endpoints
 */

// Example: Validate a wallet address
const validateWalletExample = {
  method: "POST",
  url: "/api/payments/validate-wallet",
  body: {
    walletAddress: "0x742d35Cc6635C0532925a3b8D400d0E0Ed8e2fcB",
    checkBalance: true,
  },
};

// Example: Create a wallet balance payment session
const createWalletBalancePaymentExample = {
  method: "POST",
  url: "/api/payments/wallet-balance",
  body: {
    walletAddress: "0x742d35Cc6635C0532925a3b8D400d0E0Ed8e2fcB",
    noOfIons: 100,
    amount: 999, // $9.99 in cents
    currency: "USD",
    // Optional custom URLs
    success_url: "https://example.com/wallet-success",
    cancel_url: "https://example.com/wallet-cancel",
  },
};

// Example: Test the wallet balance payment flow
async function testWalletBalancePayment() {
  const baseUrl = "https://backend.gll.one";

  try {
    // Step 1: Validate wallet address
    console.log("Step 1: Validating wallet address...");
    const validateResponse = await fetch(
      `${baseUrl}/api/payments/validate-wallet`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          walletAddress: "0x742d35Cc6635C0532925a3b8D400d0E0Ed8e2fcB",
          checkBalance: true,
        }),
      }
    );

    const validateResult = await validateResponse.json();
    console.log("Validation result:", validateResult);

    if (!validateResult.success) {
      throw new Error(`Wallet validation failed: ${validateResult.error}`);
    }

    // Step 2: Create payment session
    console.log("Step 2: Creating payment session...");
    const paymentResponse = await fetch(
      `${baseUrl}/api/payments/wallet-balance`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          walletAddress: "0x742d35Cc6635C0532925a3b8D400d0E0Ed8e2fcB",
          noOfIons: 100,
          amount: 999, // $9.99 in cents
          currency: "USD",
        }),
      }
    );

    const paymentResult = await paymentResponse.json();
    console.log("Payment session result:", paymentResult);

    if (paymentResult.success) {
      console.log("Payment session created successfully!");
      console.log("Checkout URL:", paymentResult.checkoutUrl);
      console.log("Session ID:", paymentResult.sessionId);

      // In a real application, redirect user to paymentResult.checkoutUrl
      // After successful payment, user will be redirected to:
      // https://www.gll.one/wallet?payment=success&transaction_id={hash}
    }
  } catch (error) {
    console.error("Test failed:", error);
  }
}

// Example: HTTP requests using curl commands
const curlExamples = {
  validateWallet: `
curl -X POST https://backend.gll.one/api/payments/validate-wallet \\
  -H "Content-Type: application/json" \\
  -d '{
    "walletAddress": "0x742d35Cc6635C0532925a3b8D400d0E0Ed8e2fcB",
    "checkBalance": true
  }'
  `,

  createWalletPayment: `
curl -X POST https://backend.gll.one/api/payments/wallet-balance \\
  -H "Content-Type: application/json" \\
  -d '{
    "walletAddress": "0x742d35Cc6635C0532925a3b8D400d0E0Ed8e2fcB",
    "noOfIons": 100,
    "amount": 999,
    "currency": "USD"
  }'
  `,
};

// Expected response formats
const expectedResponses = {
  validateWallet: {
    success: true,
    isValid: true,
    walletAddress: "0x742d35Cc6635C0532925a3b8D400d0E0Ed8e2fcB",
    balance: "0.0",
    message: "Wallet address is valid and balance retrieved",
  },

  createWalletPayment: {
    success: true,
    sessionId: "cs_test_...",
    checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_...",
    message: "Wallet balance payment session created successfully",
  },

  successRedirect: {
    url: "https://www.gll.one/wallet?payment=success&sessionId=cs_test_...&walletAddress=0x742d35Cc6635C0532925a3b8D400d0E0Ed8e2fcB&ions=100&transaction_id=0x123...&message=Payment%20successful!%20Ions%20credited%20to%20wallet.",
    params: {
      payment: "success",
      sessionId: "cs_test_...",
      walletAddress: "0x742d35Cc6635C0532925a3b8D400d0E0Ed8e2fcB",
      ions: "100",
      transaction_id: "0x123...",
      message: "Payment successful! Ions credited to wallet.",
    },
  },

  cancelRedirect: {
    url: "https://www.gll.one/wallet?payment=cancelled&sessionId=cs_test_...&message=Wallet%20balance%20payment%20was%20cancelled%20by%20user",
    params: {
      payment: "cancelled",
      sessionId: "cs_test_...",
      message: "Wallet balance payment was cancelled by user",
    },
  },

  errorRedirect: {
    url: "https://www.gll.one/wallet?payment=error&message=Invalid%20wallet%20address%20format",
    params: {
      payment: "error",
      message: "Invalid wallet address format",
    },
  },
};

module.exports = {
  validateWalletExample,
  createWalletBalancePaymentExample,
  testWalletBalancePayment,
  curlExamples,
  expectedResponses,
};
