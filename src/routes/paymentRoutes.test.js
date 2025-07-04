/**
 * @fileoverview Test suite for Payment Routes
 * @description Comprehensive test cases for the payment API following TDD principles
 */

const request = require("supertest");
const express = require("express");

// Mock external dependencies before importing modules
jest.mock("../config/db");
jest.mock("axios");

const prisma = require("../config/db");
const paymentRoutes = require("./paymentRoutes");
const axios = require("axios");

const app = express();
app.use(express.json());
app.use("/api/payments", paymentRoutes);

describe("Payment Routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("POST /api/payments/purchase-plan", () => {
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

    test("should successfully create payment session and return checkout URL", async () => {
      // Mock successful payment gateway response
      const mockGatewayResponse = {
        data: {
          id: "session_123",
          url: "https://checkout.example.com/session_123",
          status: "created",
        },
      };

      axios.post.mockResolvedValueOnce(mockGatewayResponse);

      const response = await request(app)
        .post("/api/payments/purchase-plan")
        .send(validPayload);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        sessionId: "session_123",
        checkoutUrl: "https://checkout.example.com/session_123",
        message: "Payment session created successfully",
      });

      // Verify payment gateway was called with correct payload
      expect(axios.post).toHaveBeenCalledWith(
        "https://gll-gateway.growlimitless.app/docs",
        expect.objectContaining({
          line_items: validPayload.line_items,
          mode: validPayload.mode,
          success_url: expect.stringContaining("/payment/success"),
          cancel_url: expect.stringContaining("/payment/cancel"),
          metadata: expect.objectContaining({
            ...validPayload.metadata,
            walletId: validPayload.walletId,
            noOfDocs: validPayload.noOfDocs.toString(),
          }),
        }),
        expect.any(Object)
      );
    });

    test("should return 400 for missing required fields", async () => {
      const invalidPayload = { ...validPayload };
      delete invalidPayload.walletId;

      const response = await request(app)
        .post("/api/payments/purchase-plan")
        .send(invalidPayload);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        success: false,
        error: "Missing required field: walletId",
      });
    });

    test("should return 400 for invalid line_items structure", async () => {
      const invalidPayload = {
        ...validPayload,
        line_items: [
          {
            price_data: {
              currency: "USD",
              // Missing product_data and unit_amount
            },
          },
        ],
      };

      const response = await request(app)
        .post("/api/payments/purchase-plan")
        .send(invalidPayload);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        success: false,
        error: "Invalid line_items structure",
      });
    });

    test("should handle payment gateway errors gracefully", async () => {
      axios.post.mockRejectedValueOnce(
        new Error("Payment gateway unavailable")
      );

      const response = await request(app)
        .post("/api/payments/purchase-plan")
        .send(validPayload);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        success: false,
        error: "Payment gateway error: Payment gateway unavailable",
      });
    });

    test("should validate noOfDocs is a positive number", async () => {
      const invalidPayload = { ...validPayload, noOfDocs: -5 };

      const response = await request(app)
        .post("/api/payments/purchase-plan")
        .send(invalidPayload);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        success: false,
        error: "noOfDocs must be a positive number",
      });
    });
  });

  describe("GET /api/payments/success", () => {
    test("should handle successful payment callback and update wallet documents", async () => {
      const sessionId = "session_123";
      const walletId = "test-wallet-123";
      const noOfDocs = 10;

      // Mock existing wallet document
      prisma.walletDocuments.findUnique.mockResolvedValueOnce({
        id: "wallet-doc-1",
        walletId: walletId,
        noOfDocuments: 5,
      });

      // Mock successful update
      prisma.walletDocuments.update.mockResolvedValueOnce({
        id: "wallet-doc-1",
        walletId: walletId,
        noOfDocuments: 15,
      });

      const response = await request(app).get("/api/payments/success").query({
        session_id: sessionId,
        walletId: walletId,
        noOfDocs: noOfDocs,
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        message: "Payment successful! Documents updated successfully.",
        walletId: walletId,
        updatedDocuments: 15,
      });

      expect(prisma.walletDocuments.update).toHaveBeenCalledWith({
        where: { walletId: walletId },
        data: { noOfDocuments: 15 },
      });
    });

    test("should create new wallet document if none exists", async () => {
      const sessionId = "session_123";
      const walletId = "new-wallet-123";
      const noOfDocs = 5;

      // Mock no existing wallet document
      prisma.walletDocuments.findUnique.mockResolvedValueOnce(null);

      // Mock successful creation
      prisma.walletDocuments.create.mockResolvedValueOnce({
        id: "new-wallet-doc-1",
        walletId: walletId,
        noOfDocuments: 8, // 3 default + 5 purchased
      });

      const response = await request(app).get("/api/payments/success").query({
        session_id: sessionId,
        walletId: walletId,
        noOfDocs: noOfDocs,
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        message: "Payment successful! New wallet created with documents.",
        walletId: walletId,
        updatedDocuments: 8,
      });

      expect(prisma.walletDocuments.create).toHaveBeenCalledWith({
        data: {
          walletId: walletId,
          noOfDocuments: 8,
        },
      });
    });

    test("should return 400 for missing session_id", async () => {
      const response = await request(app).get("/api/payments/success").query({
        walletId: "test-wallet",
        noOfDocs: 5,
      });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        success: false,
        error: "Missing required parameters",
      });
    });
  });

  describe("GET /api/payments/cancel", () => {
    test("should handle payment cancellation gracefully", async () => {
      const sessionId = "session_123";

      const response = await request(app)
        .get("/api/payments/cancel")
        .query({ session_id: sessionId });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: false,
        message: "Payment was cancelled by user",
        sessionId: sessionId,
      });
    });

    test("should handle cancellation without session_id", async () => {
      const response = await request(app).get("/api/payments/cancel");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: false,
        message: "Payment was cancelled",
        sessionId: null,
      });
    });
  });

  describe("POST /api/payments/webhook", () => {
    test("should handle webhook events for payment completion", async () => {
      const webhookPayload = {
        type: "checkout.session.completed",
        data: {
          object: {
            id: "session_123",
            metadata: {
              walletId: "test-wallet-123",
              noOfDocs: "10",
            },
          },
        },
      };

      // Mock existing wallet document
      prisma.walletDocuments.findUnique.mockResolvedValueOnce({
        id: "wallet-doc-1",
        walletId: "test-wallet-123",
        noOfDocuments: 5,
      });

      // Mock successful update
      prisma.walletDocuments.update.mockResolvedValueOnce({
        id: "wallet-doc-1",
        walletId: "test-wallet-123",
        noOfDocuments: 15,
      });

      const response = await request(app)
        .post("/api/payments/webhook")
        .send(webhookPayload);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        message: "Webhook processed successfully",
      });
    });
  });

  describe("GET /api/payments/wallet/:walletId", () => {
    test("should return wallet information when wallet exists", async () => {
      const walletId = "test-wallet-123";
      const mockWallet = {
        id: "wallet-doc-1",
        walletId: walletId,
        noOfDocuments: 15,
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-02"),
      };

      prisma.walletDocuments.findUnique.mockResolvedValueOnce(mockWallet);

      const response = await request(app).get(
        `/api/payments/wallet/${walletId}`
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        walletId: walletId,
        noOfDocuments: 15,
        createdAt: mockWallet.createdAt.toISOString(),
        updatedAt: mockWallet.updatedAt.toISOString(),
      });
    });

    test("should return 404 when wallet does not exist", async () => {
      const walletId = "non-existent-wallet";

      prisma.walletDocuments.findUnique.mockResolvedValueOnce(null);

      const response = await request(app).get(
        `/api/payments/wallet/${walletId}`
      );

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        success: false,
        error: "Wallet not found",
      });
    });
  });
});
