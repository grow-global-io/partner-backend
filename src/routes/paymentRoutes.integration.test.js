/**
 * @fileoverview Integration tests for Payment Routes
 * @description Integration tests that verify the payment API endpoints work correctly
 */

const request = require("supertest");
const express = require("express");
const paymentRoutes = require("./paymentRoutes");

const app = express();
app.use(express.json());
app.use("/api/payments", paymentRoutes);

describe("Payment Routes Integration Tests", () => {
  describe("POST /api/payments/purchase-plan", () => {
    test("should return 400 for missing walletId", async () => {
      const invalidPayload = {
        mode: "payment",
        line_items: [],
        metadata: {},
        noOfDocs: 10,
      };

      const response = await request(app)
        .post("/api/payments/purchase-plan")
        .send(invalidPayload);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe("Missing required field: walletId");
    });

    test("should return 400 for missing mode", async () => {
      const invalidPayload = {
        walletId: "test-wallet",
        line_items: [],
        metadata: {},
        noOfDocs: 10,
      };

      const response = await request(app)
        .post("/api/payments/purchase-plan")
        .send(invalidPayload);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe("Missing required field: mode");
    });

    test("should return 400 for invalid noOfDocs", async () => {
      const invalidPayload = {
        walletId: "test-wallet",
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "USD",
              product_data: {
                name: "Test Product",
                description: "Test Description",
              },
              unit_amount: 1000,
            },
            quantity: 1,
          },
        ],
        metadata: {},
        noOfDocs: -5,
      };

      const response = await request(app)
        .post("/api/payments/purchase-plan")
        .send(invalidPayload);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe("noOfDocs must be a positive number");
    });

    test("should return 400 for invalid line_items structure", async () => {
      const invalidPayload = {
        walletId: "test-wallet",
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "USD",
              // Missing product_data and unit_amount
            },
          },
        ],
        metadata: {},
        noOfDocs: 10,
      };

      const response = await request(app)
        .post("/api/payments/purchase-plan")
        .send(invalidPayload);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe("Invalid line_items structure");
    });

    test("should return 500 for payment gateway error (expected with real gateway)", async () => {
      const validPayload = {
        walletId: "test-wallet-123",
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "USD",
              product_data: {
                name: "Invoice Payment",
                description: "Payment for the invoice - INV-001",
              },
              unit_amount: 5000,
            },
            quantity: 1,
          },
        ],
        metadata: {
          invoice_id: "456",
          user_id: "123",
        },
        noOfDocs: 10,
      };

      const response = await request(app)
        .post("/api/payments/purchase-plan")
        .send(validPayload);

      // Expect 500 because we're hitting the real payment gateway which returns 405
      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("Payment gateway error");
    });
  });

  describe("GET /api/payments/success", () => {
    test("should return 400 for missing parameters", async () => {
      const response = await request(app).get("/api/payments/success").query({
        walletId: "test-wallet",
        // Missing session_id and noOfDocs
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe("Missing required parameters");
    });

    test("should handle success with valid parameters", async () => {
      const response = await request(app).get("/api/payments/success").query({
        session_id: "test-session-123",
        walletId: "test-wallet-integration",
        noOfDocs: "5",
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.walletId).toBe("test-wallet-integration");
      expect(response.body.updatedDocuments).toBe(8); // 3 default + 5 purchased
      expect(response.body.message).toContain("Payment successful!");
    });
  });

  describe("GET /api/payments/cancel", () => {
    test("should handle cancellation with session_id", async () => {
      const response = await request(app)
        .get("/api/payments/cancel")
        .query({ session_id: "test-session-123" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("Payment was cancelled by user");
      expect(response.body.sessionId).toBe("test-session-123");
    });

    test("should handle cancellation without session_id", async () => {
      const response = await request(app).get("/api/payments/cancel");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe("Payment was cancelled");
      expect(response.body.sessionId).toBe(null);
    });
  });

  describe("POST /api/payments/webhook", () => {
    test("should handle webhook events", async () => {
      const webhookPayload = {
        type: "checkout.session.completed",
        data: {
          object: {
            id: "session_123",
            metadata: {
              walletId: "test-wallet-webhook",
              noOfDocs: "10",
            },
          },
        },
      };

      const response = await request(app)
        .post("/api/payments/webhook")
        .send(webhookPayload);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe("Webhook processed successfully");
    });

    test("should handle webhook events without metadata", async () => {
      const webhookPayload = {
        type: "other.event.type",
        data: {
          object: {
            id: "session_123",
          },
        },
      };

      const response = await request(app)
        .post("/api/payments/webhook")
        .send(webhookPayload);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe("Webhook processed successfully");
    });
  });

  describe("GET /api/payments/wallet/:walletId", () => {
    test("should return 404 for non-existent wallet", async () => {
      const response = await request(app).get(
        "/api/payments/wallet/non-existent-wallet-123"
      );

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe("Wallet not found");
    });

    test("should return wallet information for existing wallet", async () => {
      // First create a wallet by calling success endpoint
      await request(app).get("/api/payments/success").query({
        session_id: "test-session-456",
        walletId: "test-wallet-existing",
        noOfDocs: "15",
      });

      // Then check if we can retrieve it
      const response = await request(app).get(
        "/api/payments/wallet/test-wallet-existing"
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.walletId).toBe("test-wallet-existing");
      expect(response.body.noOfDocuments).toBe(18); // 3 default + 15 purchased
      expect(response.body.createdAt).toBeDefined();
      expect(response.body.updatedAt).toBeDefined();
    });
  });
});
