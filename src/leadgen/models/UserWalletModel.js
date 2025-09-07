const { MongoClient } = require("mongodb");

/**
 * @description UserWallet model for managing AI text generations per wallet
 * @class UserWalletModel
 */
class UserWalletModel {
  constructor() {
    this.client = null;
    this.db = null;
    this.collection = null;
    this.transactionCollection = null;
  }

  /**
   * @description Initialize database connection
   * @returns {Promise<void>}
   */
  async connect() {
    try {
      this.client = new MongoClient(process.env.DATABASE_URL);
      await this.client.connect();
      this.db = this.client.db("Partners");
      this.collection = this.db.collection("user_wallets");
      this.transactionCollection = this.db.collection("wallet_transactions");

      // Create indexes for better performance
      await this.collection.createIndex({ walletAddress: 1 }, { unique: true });
      await this.collection.createIndex({ createdAt: -1 });
      await this.collection.createIndex({ updatedAt: -1 });

      // Create indexes for transaction collection
      await this.transactionCollection.createIndex(
        { sessionId: 1 },
        { unique: true }
      );
      await this.transactionCollection.createIndex({ walletAddress: 1 });
      await this.transactionCollection.createIndex({ createdAt: -1 });

      console.log("UserWalletModel: Connected to MongoDB");
    } catch (error) {
      console.error("UserWalletModel: Connection error:", error);
      throw error;
    }
  }

  /**
   * @description Create or update wallet with initial generations count and SaaS limits
   * @param {string} walletAddress - Wallet address
   * @param {number} generationsCount - Initial generations count (default: 0)
   * @param {number} generationsAllowed - Initial generations allowed (default: 10 for free tier)
   * @returns {Promise<Object>} Created/updated wallet document
   */
  async createWallet(
    walletAddress,
    generationsCount = 0,
    generationsAllowed = 3
  ) {
    try {
      const now = new Date();
      const walletData = {
        walletAddress,
        generationsCount,
        generationsAllowed,
        planType: "free", // free, basic, premium, enterprise
        createdAt: now,
        updatedAt: now,
      };

      const result = await this.collection.updateOne(
        { walletAddress },
        {
          $setOnInsert: walletData,
        },
        { upsert: true }
      );

      // Return the created/updated document
      return await this.collection.findOne({ walletAddress });
    } catch (error) {
      console.error("UserWalletModel: Error creating wallet:", error);
      throw error;
    }
  }

  /**
   * @description Get wallet by address with SaaS usage analytics
   * @param {string} walletAddress - Wallet address
   * @returns {Promise<Object|null>} Wallet document with usage stats or null
   */
  async getWallet(walletAddress) {
    try {
      const wallet = await this.collection.findOne({ walletAddress });

      if (wallet) {
        // Add computed fields for SaaS analytics
        wallet.generationsRemaining = Math.max(
          0,
          wallet.generationsAllowed - wallet.generationsCount
        );
        wallet.usagePercentage = Math.round(
          (wallet.generationsCount / wallet.generationsAllowed) * 100
        );
        wallet.isLimitReached =
          wallet.generationsCount >= wallet.generationsAllowed;
        wallet.needsUpgrade = wallet.generationsRemaining <= 2; // Alert when 2 or fewer remaining
      }

      return wallet;
    } catch (error) {
      console.error("UserWalletModel: Error fetching wallet:", error);
      throw error;
    }
  }

  /**
   * @description Update generations count for a wallet
   * @param {string} walletAddress - Wallet address
   * @param {number} newCount - New generations count
   * @returns {Promise<Object>} Updated wallet document
   */
  async updateGenerationsCount(walletAddress, newCount) {
    try {
      const result = await this.collection.updateOne(
        { walletAddress },
        {
          $set: {
            generationsCount: newCount,
            updatedAt: new Date(),
          },
        }
      );

      if (result.matchedCount === 0) {
        throw new Error("Wallet not found");
      }

      return await this.collection.findOne({ walletAddress });
    } catch (error) {
      console.error(
        "UserWalletModel: Error updating generations count:",
        error
      );
      throw error;
    }
  }

  /**
   * @description Increment generations count with SaaS limit validation
   * @param {string} walletAddress - Wallet address
   * @param {number} increment - Amount to increment (default: 1)
   * @returns {Promise<Object>} Updated wallet document
   */
  async incrementGenerations(walletAddress, increment = 1) {
    try {
      // First check current usage and limits
      const currentWallet = await this.collection.findOne({ walletAddress });

      if (!currentWallet) {
        // Create wallet if it doesn't exist with free tier limits
        return await this.createWallet(walletAddress, increment, 10);
      }

      const newCount = currentWallet.generationsCount + increment;

      // Check if increment would exceed limit
      if (newCount > currentWallet.generationsAllowed) {
        throw new Error(
          `Usage limit exceeded. Allowed: ${currentWallet.generationsAllowed}, Requested: ${newCount}. Please upgrade your plan.`
        );
      }

      const result = await this.collection.updateOne(
        { walletAddress },
        {
          $inc: { generationsCount: increment },
          $set: { updatedAt: new Date() },
        }
      );

      return await this.getWallet(walletAddress);
    } catch (error) {
      console.error("UserWalletModel: Error incrementing generations:", error);
      throw error;
    }
  }

  /**
   * @description Check if wallet can perform generation (SaaS gate)
   * @param {string} walletAddress - Wallet address
   * @returns {Promise<Object>} Usage validation result
   */
  async canGenerate(walletAddress) {
    try {
      const wallet = await this.getWallet(walletAddress);

      if (!wallet) {
        return {
          allowed: false,
          reason: "Wallet not found",
          needsRegistration: true,
        };
      }

      const canUse = wallet.generationsCount < wallet.generationsAllowed;

      return {
        allowed: canUse,
        reason: canUse ? "Usage within limits" : "Generation limit exceeded",
        currentUsage: wallet.generationsCount,
        limit: wallet.generationsAllowed,
        remaining: wallet.generationsRemaining,
        needsUpgrade: !canUse || wallet.needsUpgrade,
        planType: wallet.planType,
      };
    } catch (error) {
      console.error(
        "UserWalletModel: Error checking generation permission:",
        error
      );
      throw error;
    }
  }

  /**
   * @description Upgrade wallet plan and increase allowed generations
   * @param {string} walletAddress - Wallet address
   * @param {string} planType - Plan type (basic, premium, enterprise)
   * @param {number} newGenerationsAllowed - New generations limit
   * @returns {Promise<Object>} Updated wallet document
   */
  async upgradePlan(walletAddress, planType, newGenerationsAllowed) {
    try {
      const result = await this.collection.updateOne(
        { walletAddress },
        {
          $set: {
            planType,
            generationsAllowed: newGenerationsAllowed,
            updatedAt: new Date(),
            lastUpgrade: new Date(),
          },
        }
      );

      if (result.matchedCount === 0) {
        throw new Error("Wallet not found");
      }

      return await this.getWallet(walletAddress);
    } catch (error) {
      console.error("UserWalletModel: Error upgrading plan:", error);
      throw error;
    }
  }

  /**
   * @description Add generations to wallet (for purchases/renewals)
   * @param {string} walletAddress - Wallet address
   * @param {number} additionalGenerations - Additional generations to add
   * @returns {Promise<Object>} Updated wallet document
   */
  async addGenerations(walletAddress, additionalGenerations) {
    try {
      const result = await this.collection.updateOne(
        { walletAddress },
        {
          $inc: { generationsAllowed: additionalGenerations },
          $set: {
            updatedAt: new Date(),
            lastPurchase: new Date(),
          },
        }
      );

      if (result.matchedCount === 0) {
        throw new Error("Wallet not found");
      }

      return await this.getWallet(walletAddress);
    } catch (error) {
      console.error("UserWalletModel: Error adding generations:", error);
      throw error;
    }
  }

  /**
   * @description Check if a session ID already exists in transaction history
   * @param {string} sessionId - Session ID to check
   * @returns {Promise<boolean>} True if session ID exists, false otherwise
   */
  async isSessionIdExists(sessionId) {
    try {
      // Use $eq to ensure sessionId is always treated as a literal value
      const transaction = await this.transactionCollection.findOne({
        sessionId: { $eq: sessionId },
      });
      return transaction !== null;
    } catch (error) {
      console.error("UserWalletModel: Error checking session ID:", error);
      throw error;
    }
  }

  /**
   * @description Add generations to wallet with session tracking (for purchases/renewals)
   * @param {string} walletAddress - Wallet address
   * @param {number} additionalGenerations - Additional generations to add
   * @param {string} sessionId - Unique session ID for this transaction
   * @param {Object} metadata - Additional transaction metadata
   * @returns {Promise<Object>} Updated wallet document with transaction record
   */
  async addGenerationsWithSession(
    walletAddress,
    additionalGenerations,
    sessionId,
    metadata = {}
  ) {
    try {
      // First check if session ID already exists
      const sessionExists = await this.isSessionIdExists(sessionId);
      if (sessionExists) {
        throw new Error(
          "Session ID already exists - duplicate transaction not allowed"
        );
      }

      // Use MongoDB transaction to ensure atomicity
      const session = this.client.startSession();

      try {
        await session.withTransaction(async () => {
          // Create transaction record first
          const transactionRecord = {
            sessionId,
            walletAddress,
            type: "add_generations",
            additionalGenerations,
            metadata,
            createdAt: new Date(),
            status: "completed",
          };

          await this.transactionCollection.insertOne(transactionRecord, {
            session,
          });

          // Update wallet
          const result = await this.collection.updateOne(
            { walletAddress },
            {
              $inc: { generationsAllowed: additionalGenerations },
              $set: {
                updatedAt: new Date(),
                lastPurchase: new Date(),
              },
            },
            { session }
          );

          if (result.matchedCount === 0) {
            throw new Error("Wallet not found");
          }
        });

        return await this.getWallet(walletAddress);
      } finally {
        await session.endSession();
      }
    } catch (error) {
      console.error(
        "UserWalletModel: Error adding generations with session:",
        error
      );
      throw error;
    }
  }

  /**
   * @description Get transaction history for a wallet
   * @param {string} walletAddress - Wallet address
   * @param {number} page - Page number (default: 1)
   * @param {number} limit - Number of transactions per page (default: 50)
   * @returns {Promise<Object>} Transaction history with pagination
   */
  async getTransactionHistory(walletAddress, page = 1, limit = 50) {
    try {
      const skip = (page - 1) * limit;

      const transactions = await this.transactionCollection
        .find({ walletAddress })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      const totalTransactions = await this.transactionCollection.countDocuments(
        { walletAddress }
      );
      const totalPages = Math.ceil(totalTransactions / limit);

      return {
        transactions,
        pagination: {
          currentPage: page,
          totalPages,
          totalTransactions,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      };
    } catch (error) {
      console.error(
        "UserWalletModel: Error getting transaction history:",
        error
      );
      throw error;
    }
  }

  /**
   * @description Get all wallets with pagination and SaaS analytics
   * @param {number} page - Page number (default: 1)
   * @param {number} limit - Number of wallets per page (default: 50)
   * @param {Object} sortOptions - Sort options (default: { updatedAt: -1 })
   * @param {string} planType - Filter by plan type (optional)
   * @returns {Promise<Object>} Wallets with pagination info and SaaS analytics
   */
  async getAllWallets(
    page = 1,
    limit = 50,
    sortOptions = { updatedAt: -1 },
    planType = null
  ) {
    try {
      const skip = (page - 1) * limit;
      const query = planType ? { planType } : {};

      const [wallets, totalCount] = await Promise.all([
        this.collection
          .find(query)
          .sort(sortOptions)
          .skip(skip)
          .limit(limit)
          .toArray(),
        this.collection.countDocuments(query),
      ]);

      // Add computed SaaS fields to each wallet
      const enrichedWallets = wallets.map((wallet) => {
        wallet.generationsRemaining = Math.max(
          0,
          (wallet.generationsAllowed || 10) - wallet.generationsCount
        );
        wallet.usagePercentage = Math.round(
          (wallet.generationsCount / (wallet.generationsAllowed || 10)) * 100
        );
        wallet.isLimitReached =
          wallet.generationsCount >= (wallet.generationsAllowed || 10);
        wallet.needsUpgrade = wallet.generationsRemaining <= 2;
        wallet.planType = wallet.planType || "free"; // Default to free if not set
        return wallet;
      });

      return {
        wallets: enrichedWallets,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(totalCount / limit),
          totalCount,
          hasNext: page * limit < totalCount,
          hasPrev: page > 1,
        },
      };
    } catch (error) {
      console.error("UserWalletModel: Error fetching all wallets:", error);
      throw error;
    }
  }

  /**
   * @description Delete wallet by address
   * @param {string} walletAddress - Wallet address
   * @returns {Promise<boolean>} Success status
   */
  async deleteWallet(walletAddress) {
    try {
      const result = await this.collection.deleteOne({ walletAddress });
      return result.deletedCount > 0;
    } catch (error) {
      console.error("UserWalletModel: Error deleting wallet:", error);
      throw error;
    }
  }

  /**
   * @description Get comprehensive SaaS statistics and analytics
   * @returns {Promise<Object>} Statistics about wallets with SaaS metrics
   */
  async getStatistics() {
    try {
      const [totalWallets, planStats, usageStats, recentActivity] =
        await Promise.all([
          this.collection.countDocuments(),

          // Plan distribution statistics
          this.collection
            .aggregate([
              {
                $group: {
                  _id: { $ifNull: ["$planType", "free"] },
                  count: { $sum: 1 },
                  totalGenerationsUsed: { $sum: "$generationsCount" },
                  totalGenerationsAllowed: {
                    $sum: { $ifNull: ["$generationsAllowed", 10] },
                  },
                },
              },
            ])
            .toArray(),

          // Overall usage statistics
          this.collection
            .aggregate([
              {
                $project: {
                  walletAddress: 1,
                  generationsCount: 1,
                  generationsAllowed: { $ifNull: ["$generationsAllowed", 10] },
                  usagePercentage: {
                    $multiply: [
                      {
                        $divide: [
                          "$generationsCount",
                          { $ifNull: ["$generationsAllowed", 10] },
                        ],
                      },
                      100,
                    ],
                  },
                  isLimitReached: {
                    $gte: [
                      "$generationsCount",
                      { $ifNull: ["$generationsAllowed", 10] },
                    ],
                  },
                },
              },
              {
                $group: {
                  _id: null,
                  totalUsage: { $sum: "$generationsCount" },
                  totalAllowed: { $sum: "$generationsAllowed" },
                  averageUsage: { $avg: "$usagePercentage" },
                  limitReachedCount: {
                    $sum: { $cond: [{ $eq: ["$isLimitReached", true] }, 1, 0] },
                  },
                },
              },
            ])
            .toArray(),

          // Recent activity
          this.collection.find().sort({ updatedAt: -1 }).limit(5).toArray(),
        ]);

      const overallUsageStats = usageStats[0] || {
        totalUsage: 0,
        totalAllowed: 0,
        averageUsage: 0,
        limitReachedCount: 0,
      };

      return {
        totalWallets,
        planDistribution: planStats,
        usage: {
          ...overallUsageStats,
          overallUsagePercentage:
            overallUsageStats.totalAllowed > 0
              ? Math.round(
                  (overallUsageStats.totalUsage /
                    overallUsageStats.totalAllowed) *
                    100
                )
              : 0,
        },
        recentActivity: recentActivity.map((wallet) => ({
          walletAddress: wallet.walletAddress,
          generationsCount: wallet.generationsCount,
          generationsAllowed: wallet.generationsAllowed || 10,
          planType: wallet.planType || "free",
          updatedAt: wallet.updatedAt,
        })),
        revenue: {
          // Estimated monthly revenue based on plan distribution
          estimatedMonthlyRevenue: planStats.reduce((total, plan) => {
            const priceMap = {
              free: 0,
              basic: 29,
              premium: 99,
              enterprise: 299,
            };
            return total + plan.count * (priceMap[plan._id] || 0);
          }, 0),
        },
      };
    } catch (error) {
      console.error("UserWalletModel: Error getting statistics:", error);
      throw error;
    }
  }

  /**
   * @description Close database connection
   * @returns {Promise<void>}
   */
  async close() {
    if (this.client) {
      await this.client.close();
      console.log("UserWalletModel: Database connection closed");
    }
  }
}

module.exports = UserWalletModel;
