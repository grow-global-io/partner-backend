const StoreModel = require("../models/StoreModel");
const ImageService = require("../services/ImageService");
const { v4: uuidv4 } = require("uuid");
const slugify = require("slugify");

/**
 * @description Store controller for managing stores
 * @class StoreController
 */
class StoreController {
  constructor() {
    this.storeModel = new StoreModel();
    this.imageService = new ImageService();
  }

  /**
   * @description Create a new store
   * @param {Object} req - Express request object
   * @param {Object} req.body - Request body
   * @param {string} req.body.name - Store name
   * @param {string} req.body.description - Store description
   * @param {string} req.body.walletId - User's wallet ID
   * @param {Object} res - Express response object
   * @returns {Object} Response with created store
   */
  async createStore(req, res) {
    try {
      const { name, description, walletId } = req.body;

      // Validate required fields
      if (!name) {
        return res.status(400).json({
          success: false,
          error: "Store name is required",
        });
      }

      if (!walletId) {
        return res.status(400).json({
          success: false,
          error: "Wallet ID is required",
        });
      }

      // Generate slug from name
      let slug = slugify(name, {
        lower: true,
        strict: true,
        trim: true,
      });

      // Add random suffix to ensure uniqueness
      slug = `${slug}-${uuidv4().substring(0, 8)}`;

      // Create store
      const store = await this.storeModel.createStore({
        name,
        description,
        slug,
        walletId,
      });

      return res.status(201).json({
        success: true,
        data: store,
      });
    } catch (error) {
      console.error("StoreController: Error creating store:", error);

      // Handle duplicate slug error
      if (error.code === "P2002") {
        return res.status(400).json({
          success: false,
          error:
            "A store with this name already exists. Please try a different name.",
        });
      }

      return res.status(500).json({
        success: false,
        error: "Failed to create store",
      });
    }
  }

  /**
   * @description Get store by ID
   * @param {Object} req - Express request object
   * @param {Object} req.params - Request parameters
   * @param {string} req.params.storeId - Store ID
   * @param {Object} res - Express response object
   * @returns {Object} Response with store
   */
  async getStore(req, res) {
    try {
      const { storeId } = req.params;

      const store = await this.storeModel.getStoreById(storeId);

      if (!store) {
        return res.status(404).json({
          success: false,
          error: "Store not found",
        });
      }

      return res.status(200).json({
        success: true,
        data: store,
      });
    } catch (error) {
      console.error("StoreController: Error fetching store:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch store",
      });
    }
  }

  /**
   * @description Get store by slug
   * @param {Object} req - Express request object
   * @param {Object} req.params - Request parameters
   * @param {string} req.params.slug - Store slug
   * @param {Object} res - Express response object
   * @returns {Object} Response with store
   */
  async getStoreBySlug(req, res) {
    try {
      const { slug } = req.params;

      const store = await this.storeModel.getStoreBySlug(slug);

      if (!store) {
        return res.status(404).json({
          success: false,
          error: "Store not found",
        });
      }

      return res.status(200).json({
        success: true,
        data: store,
      });
    } catch (error) {
      console.error("StoreController: Error fetching store by slug:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch store",
      });
    }
  }

  /**
   * @description Get stores by wallet ID
   * @param {Object} req - Express request object
   * @param {Object} req.query - Query parameters
   * @param {string} req.query.walletId - User's wallet ID
   * @param {Object} res - Express response object
   * @returns {Object} Response with stores
   */
  async getStoresByWallet(req, res) {
    try {
      const { walletId } = req.query;

      if (!walletId) {
        return res.status(400).json({
          success: false,
          error: "Wallet ID is required",
        });
      }

      const stores = await this.storeModel.getStoresByWalletId(walletId);

      return res.status(200).json({
        success: true,
        data: stores,
      });
    } catch (error) {
      console.error("StoreController: Error fetching stores by wallet:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch stores",
      });
    }
  }

  /**
   * @description Update store
   * @param {Object} req - Express request object
   * @param {Object} req.params - Request parameters
   * @param {string} req.params.storeId - Store ID
   * @param {Object} req.body - Request body
   * @param {string} req.body.name - Store name
   * @param {string} req.body.description - Store description
   * @param {boolean} req.body.isActive - Store active status
   * @param {string} req.body.walletId - User's wallet ID for verification
   * @param {Object} res - Express response object
   * @returns {Object} Response with updated store
   */
  async updateStore(req, res) {
    try {
      const { storeId } = req.params;
      const { name, description, isActive, walletId } = req.body;

      // Validate wallet ID
      if (!walletId) {
        return res.status(400).json({
          success: false,
          error: "Wallet ID is required",
        });
      }

      // Verify store ownership
      const store = await this.storeModel.getStoreById(storeId);
      if (!store) {
        return res.status(404).json({
          success: false,
          error: "Store not found",
        });
      }

      if (store.walletId !== walletId) {
        return res.status(403).json({
          success: false,
          error: "You do not have permission to update this store",
        });
      }

      // Validate at least one field to update
      if (!name && description === undefined && isActive === undefined) {
        return res.status(400).json({
          success: false,
          error: "At least one field to update is required",
        });
      }

      // Generate new slug if name is updated
      let slug;
      if (name) {
        slug = slugify(name, {
          lower: true,
          strict: true,
          trim: true,
        });

        // Add random suffix to ensure uniqueness
        slug = `${slug}-${uuidv4().substring(0, 8)}`;
      }

      // Update store
      const updatedStore = await this.storeModel.updateStore(storeId, {
        name,
        description,
        slug,
        isActive,
      });

      return res.status(200).json({
        success: true,
        data: updatedStore,
      });
    } catch (error) {
      console.error("StoreController: Error updating store:", error);

      // Handle duplicate slug error
      if (error.code === "P2002") {
        return res.status(400).json({
          success: false,
          error:
            "A store with this name already exists. Please try a different name.",
        });
      }

      return res.status(500).json({
        success: false,
        error: "Failed to update store",
      });
    }
  }

  /**
   * @description Delete store
   * @param {Object} req - Express request object
   * @param {Object} req.params - Request parameters
   * @param {string} req.params.storeId - Store ID
   * @param {Object} req.body - Request body
   * @param {string} req.body.walletId - User's wallet ID for verification
   * @param {Object} res - Express response object
   * @returns {Object} Response with success status
   */
  async deleteStore(req, res) {
    try {
      const { storeId } = req.params;
      const { walletId } = req.body;

      // Validate wallet ID
      if (!walletId) {
        return res.status(400).json({
          success: false,
          error: "Wallet ID is required",
        });
      }

      // Verify store ownership
      const store = await this.storeModel.getStoreById(storeId);
      if (!store) {
        return res.status(404).json({
          success: false,
          error: "Store not found",
        });
      }

      if (store.walletId !== walletId) {
        return res.status(403).json({
          success: false,
          error: "You do not have permission to delete this store",
        });
      }

      await this.storeModel.deleteStore(storeId);

      return res.status(200).json({
        success: true,
        message: "Store deleted successfully",
      });
    } catch (error) {
      console.error("StoreController: Error deleting store:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to delete store",
      });
    }
  }

  /**
   * @description Upload store logo
   * @param {Object} req - Express request object
   * @param {Object} req.params - Request parameters
   * @param {string} req.params.storeId - Store ID
   * @param {Object} req.body - Request body
   * @param {string} req.body.walletId - User's wallet ID for verification
   * @param {File} req.file - Uploaded logo file
   * @param {Object} res - Express response object
   * @returns {Object} Response with logo URL
   */
  async uploadLogo(req, res) {
    try {
      const { storeId } = req.params;
      const { walletId } = req.body;

      // Validate wallet ID
      if (!walletId) {
        return res.status(400).json({
          success: false,
          error: "Wallet ID is required",
        });
      }

      // Verify store ownership
      const store = await this.storeModel.getStoreById(storeId);
      if (!store) {
        return res.status(404).json({
          success: false,
          error: "Store not found",
        });
      }

      if (store.walletId !== walletId) {
        return res.status(403).json({
          success: false,
          error: "You do not have permission to update this store",
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: "No image file uploaded",
        });
      }

      // Upload image to S3
      const imageResult = await this.imageService.uploadImage(
        req.file.buffer,
        walletId,
        "store-logos"
      );

      // Update store with logo URL
      const updatedStore = await this.storeModel.updateStore(storeId, {
        logoUrl: imageResult.url,
      });

      return res.status(200).json({
        success: true,
        data: {
          logoUrl: imageResult.url,
          store: updatedStore,
        },
      });
    } catch (error) {
      console.error("StoreController: Error uploading logo:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to upload logo",
      });
    }
  }

  /**
   * @description Upload store banner
   * @param {Object} req - Express request object
   * @param {Object} req.params - Request parameters
   * @param {string} req.params.storeId - Store ID
   * @param {Object} req.body - Request body
   * @param {string} req.body.walletId - User's wallet ID for verification
   * @param {File} req.file - Uploaded banner file
   * @param {Object} res - Express response object
   * @returns {Object} Response with banner URL
   */
  async uploadBanner(req, res) {
    try {
      const { storeId } = req.params;
      const { walletId } = req.body;

      // Validate wallet ID
      if (!walletId) {
        return res.status(400).json({
          success: false,
          error: "Wallet ID is required",
        });
      }

      // Verify store ownership
      const store = await this.storeModel.getStoreById(storeId);
      if (!store) {
        return res.status(404).json({
          success: false,
          error: "Store not found",
        });
      }

      if (store.walletId !== walletId) {
        return res.status(403).json({
          success: false,
          error: "You do not have permission to update this store",
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: "No image file uploaded",
        });
      }

      // Upload image to S3
      const imageResult = await this.imageService.uploadImage(
        req.file.buffer,
        walletId,
        "store-banners"
      );

      // Update store with banner URL
      const updatedStore = await this.storeModel.updateStore(storeId, {
        bannerUrl: imageResult.url,
      });

      return res.status(200).json({
        success: true,
        data: {
          bannerUrl: imageResult.url,
          store: updatedStore,
        },
      });
    } catch (error) {
      console.error("StoreController: Error uploading banner:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to upload banner",
      });
    }
  }

  /**
   * @description Get upload middleware
   * @returns {Function} Multer middleware
   */
  getUploadMiddleware() {
    return this.imageService.getUploadMiddleware().single("image");
  }
}

module.exports = StoreController;
