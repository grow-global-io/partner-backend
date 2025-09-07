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

      // Create indexes for better performance
      await this.collection.createIndex({ walletAddress: 1 }, { unique: true });
      await this.collection.createIndex({ createdAt: -1 });
      await this.collection.createIndex({ updatedAt: -1 });

      console.log("UserWalletModel: Connected to MongoDB");
    } catch (error) {
      console.error("UserWalletModel: Connection error:", error);
      throw error;
    }
  }

  /**
   * @description Create or update wallet with initial generations count
   * @param {string} walletAddress - Wallet address
   * @param {number} generationsCount - Initial generations count (default: 0)
   * @returns {Promise<Object>} Created/updated wallet document
   */
  async createWallet(walletAddress, generationsCount = 0) {
    try {
      const now = new Date();
      const walletData = {
        walletAddress,
        generationsCount,
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
   * @description Get wallet by address
   * @param {string} walletAddress - Wallet address
   * @returns {Promise<Object|null>} Wallet document or null
   */
  async getWallet(walletAddress) {
    try {
      return await this.collection.findOne({ walletAddress });
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
   * @description Increment generations count for a wallet
   * @param {string} walletAddress - Wallet address
   * @param {number} increment - Amount to increment (default: 1)
   * @returns {Promise<Object>} Updated wallet document
   */
  async incrementGenerations(walletAddress, increment = 1) {
    try {
      const result = await this.collection.updateOne(
        { walletAddress },
        {
          $inc: { generationsCount: increment },
          $set: { updatedAt: new Date() },
        }
      );

      if (result.matchedCount === 0) {
        // Create wallet if it doesn't exist
        return await this.createWallet(walletAddress, increment);
      }

      return await this.collection.findOne({ walletAddress });
    } catch (error) {
      console.error("UserWalletModel: Error incrementing generations:", error);
      throw error;
    }
  }

  /**
   * @description Get all wallets with pagination
   * @param {number} page - Page number (default: 1)
   * @param {number} limit - Number of wallets per page (default: 50)
   * @param {Object} sortOptions - Sort options (default: { updatedAt: -1 })
   * @returns {Promise<Object>} Wallets with pagination info
   */
  async getAllWallets(page = 1, limit = 50, sortOptions = { updatedAt: -1 }) {
    try {
      const skip = (page - 1) * limit;

      const [wallets, totalCount] = await Promise.all([
        this.collection
          .find({})
          .sort(sortOptions)
          .skip(skip)
          .limit(limit)
          .toArray(),
        this.collection.countDocuments({}),
      ]);

      return {
        wallets,
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
   * @description Get wallet statistics
   * @returns {Promise<Object>} Statistics about wallets
   */
  async getStatistics() {
    try {
      const pipeline = [
        {
          $group: {
            _id: null,
            totalWallets: { $sum: 1 },
            totalGenerations: { $sum: "$generationsCount" },
            averageGenerations: { $avg: "$generationsCount" },
            maxGenerations: { $max: "$generationsCount" },
            minGenerations: { $min: "$generationsCount" },
          },
        },
      ];

      const result = await this.collection.aggregate(pipeline).toArray();

      return (
        result[0] || {
          totalWallets: 0,
          totalGenerations: 0,
          averageGenerations: 0,
          maxGenerations: 0,
          minGenerations: 0,
        }
      );
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
