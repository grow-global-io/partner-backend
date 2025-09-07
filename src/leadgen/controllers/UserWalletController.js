const UserWalletModel = require("../models/UserWalletModel");
const { validationResult } = require("express-validator");

/**
 * @description Controller for managing user wallet AI text generations
 * @class UserWalletController
 */
class UserWalletController {
  constructor() {
    this.userWalletModel = new UserWalletModel();
    this.initializeModel();
  }

  /**
   * @description Initialize the wallet model connection
   * @private
   */
  async initializeModel() {
    try {
      await this.userWalletModel.connect();
    } catch (error) {
      console.error("UserWalletController: Failed to initialize model:", error);
    }
  }

  /**
   * @description Create a new wallet or get existing one
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async createWallet(req, res) {
    try {
      // Check for validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: "Validation error",
          message: "Invalid request data",
          details: errors.array(),
          code: "VALIDATION_ERROR",
        });
      }

      const {
        walletAddress,
        generationsCount = 0,
        generationsAllowed = 10,
        planType = "free",
      } = req.body;

      // Basic validation - just check if wallet address exists
      if (
        !walletAddress ||
        typeof walletAddress !== "string" ||
        walletAddress.trim() === ""
      ) {
        return res.status(400).json({
          success: false,
          error: "Invalid wallet address",
          message: "Wallet address must be a non-empty string",
          code: "INVALID_WALLET_ADDRESS",
        });
      }

      const wallet = await this.userWalletModel.createWallet(
        walletAddress,
        generationsCount,
        generationsAllowed
      );

      res.status(201).json({
        success: true,
        message: "Wallet created successfully",
        data: {
          walletAddress: wallet.walletAddress,
          generationsCount: wallet.generationsCount,
          generationsAllowed: wallet.generationsAllowed,
          planType: wallet.planType,
          generationsRemaining: wallet.generationsRemaining,
          usagePercentage: wallet.usagePercentage,
          isLimitReached: wallet.isLimitReached,
          needsUpgrade: wallet.needsUpgrade,
          createdAt: wallet.createdAt,
          updatedAt: wallet.updatedAt,
        },
      });
    } catch (error) {
      console.error("UserWalletController: Error creating wallet:", error);
      res.status(500).json({
        success: false,
        error: "Failed to create wallet",
        message: "Internal server error while creating wallet",
        code: "WALLET_CREATION_ERROR",
      });
    }
  }

  /**
   * @description Get wallet by address (auto-creates if not found)
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getWallet(req, res) {
    try {
      const { walletAddress } = req.params;

      if (!walletAddress) {
        return res.status(400).json({
          success: false,
          error: "Missing wallet address",
          message: "Wallet address is required",
          code: "MISSING_WALLET_ADDRESS",
        });
      }

      let wallet = await this.userWalletModel.getWallet(walletAddress);

      // If wallet doesn't exist, create a new one with default settings
      if (!wallet) {
        console.log(
          `UserWalletController: Wallet not found for address ${walletAddress}, creating new wallet`
        );

        // Create wallet with basic details and generationsAllowed = 3 by default
        wallet = await this.userWalletModel.createWallet(
          walletAddress,
          0, // generationsCount = 0
          3 // generationsAllowed = 3
        );

        // Get the wallet again to ensure we have all computed fields
        wallet = await this.userWalletModel.getWallet(walletAddress);
      }

      res.status(200).json({
        success: true,
        message:
          wallet.createdAt === wallet.updatedAt
            ? "Wallet created and retrieved successfully"
            : "Wallet retrieved successfully",
        data: {
          walletAddress: wallet.walletAddress,
          generationsCount: wallet.generationsCount,
          generationsAllowed: wallet.generationsAllowed,
          planType: wallet.planType,
          generationsRemaining: wallet.generationsRemaining,
          usagePercentage: wallet.usagePercentage,
          isLimitReached: wallet.isLimitReached,
          needsUpgrade: wallet.needsUpgrade,
          lastUpgrade: wallet.lastUpgrade,
          lastPurchase: wallet.lastPurchase,
          createdAt: wallet.createdAt,
          updatedAt: wallet.updatedAt,
        },
      });
    } catch (error) {
      console.error("UserWalletController: Error getting wallet:", error);
      res.status(500).json({
        success: false,
        error: "Failed to retrieve wallet",
        message: "Internal server error while retrieving wallet",
        code: "WALLET_RETRIEVAL_ERROR",
      });
    }
  }

  /**
   * @description Update wallet generations count
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async updateWallet(req, res) {
    try {
      // Check for validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: "Validation error",
          message: "Invalid request data",
          details: errors.array(),
          code: "VALIDATION_ERROR",
        });
      }

      const { walletAddress } = req.params;
      const { generationsCount, operation = "set" } = req.body;

      if (!walletAddress) {
        return res.status(400).json({
          success: false,
          error: "Missing wallet address",
          message: "Wallet address is required",
          code: "MISSING_WALLET_ADDRESS",
        });
      }

      let updatedWallet;

      if (operation === "increment") {
        const increment = generationsCount || 1;

        console.log(
          `UserWalletController: Incrementing wallet ${walletAddress} by ${increment}`
        );

        try {
          // Try to increment first
          updatedWallet = await this.userWalletModel.incrementGenerations(
            walletAddress,
            increment
          );
        } catch (error) {
          // If wallet not found, create it and then increment
          if (error.message === "Wallet not found") {
            console.log(
              `UserWalletController: Wallet ${walletAddress} not found during increment, creating new wallet with 0 and incrementing by ${increment}`
            );
            // First create wallet with 0
            await this.userWalletModel.createWallet(walletAddress, 0);
            // Then increment it by the specified amount
            updatedWallet = await this.userWalletModel.incrementGenerations(
              walletAddress,
              increment
            );
            updatedWallet.created = true; // Flag that this was created
          } else {
            throw error; // Re-throw other errors
          }
        }
      } else {
        // Default to set operation
        updatedWallet = await this.userWalletModel.updateGenerationsCount(
          walletAddress,
          generationsCount
        );
      }

      // Determine if this was a creation or update for the response message
      const isNewWallet =
        updatedWallet.createdAt &&
        new Date(updatedWallet.createdAt).getTime() ===
          new Date(updatedWallet.updatedAt).getTime();

      const message =
        operation === "increment" && isNewWallet
          ? "Wallet created and initialized successfully"
          : "Wallet updated successfully";

      res.status(200).json({
        success: true,
        message,
        data: {
          walletAddress: updatedWallet.walletAddress,
          generationsCount: updatedWallet.generationsCount,
          createdAt: updatedWallet.createdAt,
          updatedAt: updatedWallet.updatedAt,
          operation,
          created: isNewWallet,
        },
      });
    } catch (error) {
      console.error("UserWalletController: Error updating wallet:", error);

      if (error.message === "Wallet not found") {
        return res.status(404).json({
          success: false,
          error: "Wallet not found",
          message: "No wallet found with the provided address",
          code: "WALLET_NOT_FOUND",
        });
      }

      res.status(500).json({
        success: false,
        error: "Failed to update wallet",
        message: "Internal server error while updating wallet",
        code: "WALLET_UPDATE_ERROR",
      });
    }
  }

  /**
   * @description Get all wallets with pagination
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getAllWallets(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = Math.min(parseInt(req.query.limit) || 50, 100); // Max 100 per page
      const sortBy = req.query.sortBy || "updatedAt";
      const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;

      const sortOptions = { [sortBy]: sortOrder };

      const result = await this.userWalletModel.getAllWallets(
        page,
        limit,
        sortOptions
      );

      res.status(200).json({
        success: true,
        message: "Wallets retrieved successfully",
        data: {
          wallets: result.wallets.map((wallet) => ({
            walletAddress: wallet.walletAddress,
            generationsCount: wallet.generationsCount,
            createdAt: wallet.createdAt,
            updatedAt: wallet.updatedAt,
          })),
          pagination: result.pagination,
        },
      });
    } catch (error) {
      console.error("UserWalletController: Error getting all wallets:", error);
      res.status(500).json({
        success: false,
        error: "Failed to retrieve wallets",
        message: "Internal server error while retrieving wallets",
        code: "WALLETS_RETRIEVAL_ERROR",
      });
    }
  }

  /**
   * @description Delete wallet by address
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async deleteWallet(req, res) {
    try {
      const { walletAddress } = req.params;

      if (!walletAddress) {
        return res.status(400).json({
          success: false,
          error: "Missing wallet address",
          message: "Wallet address is required",
          code: "MISSING_WALLET_ADDRESS",
        });
      }

      const deleted = await this.userWalletModel.deleteWallet(walletAddress);

      if (!deleted) {
        return res.status(404).json({
          success: false,
          error: "Wallet not found",
          message: "No wallet found with the provided address",
          code: "WALLET_NOT_FOUND",
        });
      }

      res.status(200).json({
        success: true,
        message: "Wallet deleted successfully",
        data: {
          walletAddress,
          deletedAt: new Date(),
        },
      });
    } catch (error) {
      console.error("UserWalletController: Error deleting wallet:", error);
      res.status(500).json({
        success: false,
        error: "Failed to delete wallet",
        message: "Internal server error while deleting wallet",
        code: "WALLET_DELETION_ERROR",
      });
    }
  }

  /**
   * @description Get wallet statistics
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getStatistics(req, res) {
    try {
      const stats = await this.userWalletModel.getStatistics();

      res.status(200).json({
        success: true,
        message: "Statistics retrieved successfully",
        data: {
          statistics: stats,
          timestamp: new Date(),
        },
      });
    } catch (error) {
      console.error("UserWalletController: Error getting statistics:", error);
      res.status(500).json({
        success: false,
        error: "Failed to retrieve statistics",
        message: "Internal server error while retrieving statistics",
      });
    }
  }

  /**
   * @description Check if wallet can perform generation (SaaS usage validation)
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async canGenerate(req, res) {
    try {
      const { walletAddress } = req.params;

      if (!walletAddress) {
        return res.status(400).json({
          success: false,
          error: "Missing wallet address",
          message: "Wallet address is required",
          code: "MISSING_WALLET_ADDRESS",
        });
      }

      const validation = await this.userWalletModel.canGenerate(walletAddress);

      const statusCode = validation.allowed ? 200 : 403;

      res.status(statusCode).json({
        success: validation.allowed,
        message: validation.reason,
        data: validation,
      });
    } catch (error) {
      console.error(
        "UserWalletController: Error validating generation:",
        error
      );
      res.status(500).json({
        success: false,
        error: "Failed to validate generation",
        message: "Internal server error while validating generation permission",
        code: "GENERATION_VALIDATION_ERROR",
      });
    }
  }

  /**
   * @description Upgrade wallet plan
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async upgradePlan(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: "Validation error",
          message: "Invalid request data",
          details: errors.array(),
          code: "VALIDATION_ERROR",
        });
      }

      const { walletAddress } = req.params;
      const { planType, generationsAllowed } = req.body;

      if (!walletAddress) {
        return res.status(400).json({
          success: false,
          error: "Missing wallet address",
          message: "Wallet address is required",
          code: "MISSING_WALLET_ADDRESS",
        });
      }

      const wallet = await this.userWalletModel.upgradePlan(
        walletAddress,
        planType,
        generationsAllowed
      );

      res.status(200).json({
        success: true,
        message: `Plan upgraded to ${planType} successfully`,
        data: wallet,
      });
    } catch (error) {
      console.error("UserWalletController: Error upgrading plan:", error);
      if (error.message === "Wallet not found") {
        return res.status(404).json({
          success: false,
          error: "Wallet not found",
          message: "No wallet found with the provided address",
          code: "WALLET_NOT_FOUND",
        });
      }
      res.status(500).json({
        success: false,
        error: "Failed to upgrade plan",
        message: "Internal server error while upgrading plan",
        code: "PLAN_UPGRADE_ERROR",
      });
    }
  }

  /**
   * @description Add generations to wallet (purchase more) with session tracking
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async addGenerations(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: "Validation error",
          message: "Invalid request data",
          details: errors.array(),
          code: "VALIDATION_ERROR",
        });
      }

      const { walletAddress } = req.params;
      const { additionalGenerations, sessionId, metadata = {} } = req.body;

      if (!walletAddress) {
        return res.status(400).json({
          success: false,
          error: "Missing wallet address",
          message: "Wallet address is required",
          code: "MISSING_WALLET_ADDRESS",
        });
      }

      if (!sessionId) {
        return res.status(400).json({
          success: false,
          error: "Missing session ID",
          message: "Session ID is required to prevent duplicate transactions",
          code: "MISSING_SESSION_ID",
        });
      }

      // Check if wallet exists, create if it doesn't
      let existingWallet = await this.userWalletModel.getWallet(walletAddress);
      if (!existingWallet) {
        console.log(
          `UserWalletController: Wallet not found for address ${walletAddress}, creating new wallet`
        );
        await this.userWalletModel.createWallet(walletAddress, 0, 3);
      }

      const wallet = await this.userWalletModel.addGenerationsWithSession(
        walletAddress,
        additionalGenerations,
        sessionId,
        {
          ...metadata,
          requestTimestamp: new Date(),
          userAgent: req.headers["user-agent"],
          ipAddress: req.ip || req.connection.remoteAddress,
        }
      );

      res.status(200).json({
        success: true,
        message: `${additionalGenerations} generations added successfully`,
        data: {
          walletAddress: wallet.walletAddress,
          generationsCount: wallet.generationsCount,
          generationsAllowed: wallet.generationsAllowed,
          planType: wallet.planType,
          generationsRemaining: wallet.generationsRemaining,
          usagePercentage: wallet.usagePercentage,
          isLimitReached: wallet.isLimitReached,
          needsUpgrade: wallet.needsUpgrade,
          lastUpgrade: wallet.lastUpgrade,
          lastPurchase: wallet.lastPurchase,
          createdAt: wallet.createdAt,
          updatedAt: wallet.updatedAt,
        },
        transaction: {
          sessionId,
          additionalGenerations,
          timestamp: new Date(),
        },
      });
    } catch (error) {
      console.error("UserWalletController: Error adding generations:", error);

      if (
        error.message ===
        "Session ID already exists - duplicate transaction not allowed"
      ) {
        return res.status(409).json({
          success: false,
          error: "Duplicate transaction",
          message:
            "This session ID has already been used. Duplicate transactions are not allowed.",
          code: "DUPLICATE_SESSION_ID",
        });
      }

      if (error.message === "Wallet not found") {
        return res.status(404).json({
          success: false,
          error: "Wallet not found",
          message: "No wallet found with the provided address",
          code: "WALLET_NOT_FOUND",
        });
      }

      res.status(500).json({
        success: false,
        error: "Failed to add generations",
        message: "Internal server error while adding generations",
        code: "ADD_GENERATIONS_ERROR",
      });
    }
  }

  /**
   * @description Get transaction history for a wallet
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getTransactionHistory(req, res) {
    try {
      const { walletAddress } = req.params;
      const { page = 1, limit = 50 } = req.query;

      if (!walletAddress) {
        return res.status(400).json({
          success: false,
          error: "Missing wallet address",
          message: "Wallet address is required",
          code: "MISSING_WALLET_ADDRESS",
        });
      }

      const history = await this.userWalletModel.getTransactionHistory(
        walletAddress,
        parseInt(page),
        parseInt(limit)
      );

      res.status(200).json({
        success: true,
        message: "Transaction history retrieved successfully",
        data: history,
      });
    } catch (error) {
      console.error(
        "UserWalletController: Error getting transaction history:",
        error
      );
      res.status(500).json({
        success: false,
        error: "Failed to retrieve transaction history",
        message: "Internal server error while retrieving transaction history",
        code: "TRANSACTION_HISTORY_ERROR",
      });
    }
  }

  /**
   * @description Health check for wallet service
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async healthCheck(req, res) {
    try {
      // Test database connection by getting a count
      const stats = await this.userWalletModel.getStatistics();

      res.status(200).json({
        success: true,
        message: "Wallet service is healthy",
        data: {
          status: "healthy",
          timestamp: new Date(),
          databaseConnected: true,
          totalWallets: stats.totalWallets,
        },
      });
    } catch (error) {
      console.error("UserWalletController: Health check failed:", error);
      res.status(503).json({
        success: false,
        error: "Service unhealthy",
        message: "Wallet service is experiencing issues",
        code: "SERVICE_UNHEALTHY",
        data: {
          status: "unhealthy",
          timestamp: new Date(),
          databaseConnected: false,
        },
      });
    }
  }
}

module.exports = UserWalletController;
