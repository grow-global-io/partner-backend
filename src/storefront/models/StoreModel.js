const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

/**
 * @description Store model for managing store data
 * @class StoreModel
 */
class StoreModel {
  /**
   * @description Create a new store
   * @param {Object} storeData - Store data to create
   * @returns {Promise<Object>} Created store
   */
  async createStore(storeData) {
    try {
      const store = await prisma.store.create({
        data: {
          name: storeData.name,
          description: storeData.description,
          slug: storeData.slug,
          logoUrl: storeData.logoUrl,
          bannerUrl: storeData.bannerUrl,
          walletId: storeData.walletId,
          isActive: true,
          user: storeData.userId
            ? {
                connect: { id: storeData.userId },
              }
            : undefined,
        },
      });
      return store;
    } catch (error) {
      console.error("StoreModel: Error creating store:", error);
      throw error;
    }
  }

  /**
   * @description Get store by ID
   * @param {string} storeId - Store ID
   * @returns {Promise<Object|null>} Store or null
   */
  async getStoreById(storeId) {
    try {
      const store = await prisma.store.findUnique({
        where: { id: storeId },
        include: { products: true },
      });
      return store;
    } catch (error) {
      console.error("StoreModel: Error fetching store by ID:", error);
      throw error;
    }
  }

  /**
   * @description Get store by slug
   * @param {string} slug - Store slug
   * @returns {Promise<Object|null>} Store or null
   */
  async getStoreBySlug(slug) {
    try {
      const store = await prisma.store.findUnique({
        where: { slug },
        include: { products: true },
      });
      return store;
    } catch (error) {
      console.error("StoreModel: Error fetching store by slug:", error);
      throw error;
    }
  }

  /**
   * @description Get stores by wallet ID
   * @param {string} walletId - Wallet ID
   * @returns {Promise<Array>} Array of stores
   */
  async getStoresByWalletId(walletId) {
    try {
      const stores = await prisma.store.findMany({
        where: { walletId },
        include: { products: true },
        orderBy: { createdAt: "desc" },
      });
      return stores;
    } catch (error) {
      console.error("StoreModel: Error fetching stores by wallet ID:", error);
      throw error;
    }
  }

  /**
   * @description Update store
   * @param {string} storeId - Store ID
   * @param {Object} storeData - Store data to update
   * @returns {Promise<Object>} Updated store
   */
  async updateStore(storeId, storeData) {
    try {
      const store = await prisma.store.update({
        where: { id: storeId },
        data: {
          name: storeData.name,
          description: storeData.description,
          slug: storeData.slug,
          logoUrl: storeData.logoUrl,
          bannerUrl: storeData.bannerUrl,
          isActive: storeData.isActive,
        },
      });
      return store;
    } catch (error) {
      console.error("StoreModel: Error updating store:", error);
      throw error;
    }
  }

  /**
   * @description Delete store
   * @param {string} storeId - Store ID
   * @returns {Promise<boolean>} Success status
   */
  async deleteStore(storeId) {
    try {
      await prisma.store.delete({
        where: { id: storeId },
      });
      return true;
    } catch (error) {
      console.error("StoreModel: Error deleting store:", error);
      throw error;
    }
  }

  /**
   * @description Check if store belongs to wallet
   * @param {string} storeId - Store ID
   * @param {string} walletId - Wallet ID
   * @returns {Promise<boolean>} Whether store belongs to wallet
   */
  async isStoreOwnedByWallet(storeId, walletId) {
    try {
      const store = await prisma.store.findFirst({
        where: {
          id: storeId,
          walletId,
        },
      });
      return !!store;
    } catch (error) {
      console.error("StoreModel: Error checking store ownership:", error);
      throw error;
    }
  }
}

module.exports = StoreModel;
