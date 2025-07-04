const ProductModel = require("../models/ProductModel");
const StoreModel = require("../models/StoreModel");
const ImageService = require("../services/ImageService");

/**
 * @description Product controller for managing products
 * @class ProductController
 */
class ProductController {
  constructor() {
    this.productModel = new ProductModel();
    this.storeModel = new StoreModel();
    this.imageService = new ImageService();
  }

  /**
   * @description Create a new product
   * @param {Object} req - Express request object
   * @param {Object} req.body - Request body
   * @param {string} req.body.name - Product name
   * @param {string} req.body.description - Product description
   * @param {number} req.body.price - Product price
   * @param {string} req.body.category - Product category
   * @param {boolean} req.body.inStock - Product stock status
   * @param {string} req.body.sku - Product SKU
   * @param {string} req.body.walletId - User's wallet ID for verification
   * @param {Object} req.params - Request parameters
   * @param {string} req.params.storeId - Store ID
   * @param {Object} res - Express response object
   * @returns {Object} Response with created product
   */
  async createProduct(req, res) {
    try {
      const { storeId } = req.params;
      const { name, description, price, category, inStock, sku, walletId } =
        req.body;

      // Validate required fields
      if (!name || price === undefined) {
        return res.status(400).json({
          success: false,
          error: "Product name and price are required",
        });
      }

      // Validate price format
      if (isNaN(price) || price < 0) {
        return res.status(400).json({
          success: false,
          error: "Price must be a positive number",
        });
      }

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
          error: "You do not have permission to add products to this store",
        });
      }

      // Create product
      const product = await this.productModel.createProduct({
        name,
        description,
        price: parseFloat(price),
        category,
        inStock: inStock !== undefined ? inStock : true,
        sku,
        storeId,
      });

      return res.status(201).json({
        success: true,
        data: product,
      });
    } catch (error) {
      console.error("ProductController: Error creating product:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to create product",
      });
    }
  }

  /**
   * @description Get product by ID
   * @param {Object} req - Express request object
   * @param {Object} req.params - Request parameters
   * @param {string} req.params.productId - Product ID
   * @param {Object} res - Express response object
   * @returns {Object} Response with product
   */
  async getProduct(req, res) {
    try {
      const { productId } = req.params;

      const product = await this.productModel.getProductById(productId);

      if (!product) {
        return res.status(404).json({
          success: false,
          error: "Product not found",
        });
      }

      return res.status(200).json({
        success: true,
        data: product,
      });
    } catch (error) {
      console.error("ProductController: Error fetching product:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch product",
      });
    }
  }

  /**
   * @description Get products by store ID
   * @param {Object} req - Express request object
   * @param {Object} req.params - Request parameters
   * @param {string} req.params.storeId - Store ID
   * @param {Object} req.query - Query parameters
   * @param {string} req.query.category - Filter by category
   * @param {string} req.query.sort - Sort field
   * @param {string} req.query.order - Sort order (asc/desc)
   * @param {number} req.query.limit - Limit results
   * @param {Object} res - Express response object
   * @returns {Object} Response with products
   */
  async getProductsByStore(req, res) {
    try {
      const { storeId } = req.params;
      const { category, sort, order, limit } = req.query;

      // Verify store exists
      const store = await this.storeModel.getStoreById(storeId);
      if (!store) {
        return res.status(404).json({
          success: false,
          error: "Store not found",
        });
      }

      const products = await this.productModel.getProductsByStoreId(storeId, {
        category,
        sort,
        order,
        limit,
      });

      return res.status(200).json({
        success: true,
        count: products.length,
        data: products,
      });
    } catch (error) {
      console.error(
        "ProductController: Error fetching products by store:",
        error
      );
      return res.status(500).json({
        success: false,
        error: "Failed to fetch products",
      });
    }
  }

  /**
   * @description Update product
   * @param {Object} req - Express request object
   * @param {Object} req.params - Request parameters
   * @param {string} req.params.productId - Product ID
   * @param {Object} req.body - Request body
   * @param {string} req.body.name - Product name
   * @param {string} req.body.description - Product description
   * @param {number} req.body.price - Product price
   * @param {string} req.body.category - Product category
   * @param {boolean} req.body.inStock - Product stock status
   * @param {string} req.body.sku - Product SKU
   * @param {string} req.body.walletId - User's wallet ID for verification
   * @param {Object} res - Express response object
   * @returns {Object} Response with updated product
   */
  async updateProduct(req, res) {
    try {
      const { productId } = req.params;
      const { name, description, price, category, inStock, sku, walletId } =
        req.body;

      // Validate wallet ID
      if (!walletId) {
        return res.status(400).json({
          success: false,
          error: "Wallet ID is required",
        });
      }

      // Get product and verify ownership
      const product = await this.productModel.getProductById(productId);
      if (!product) {
        return res.status(404).json({
          success: false,
          error: "Product not found",
        });
      }

      // Get store to verify ownership
      const store = await this.storeModel.getStoreById(product.storeId);
      if (!store) {
        return res.status(404).json({
          success: false,
          error: "Store not found",
        });
      }

      if (store.walletId !== walletId) {
        return res.status(403).json({
          success: false,
          error: "You do not have permission to update this product",
        });
      }

      // Validate at least one field to update
      if (
        !name &&
        description === undefined &&
        price === undefined &&
        category === undefined &&
        inStock === undefined &&
        sku === undefined
      ) {
        return res.status(400).json({
          success: false,
          error: "At least one field to update is required",
        });
      }

      // Validate price format if provided
      if (price !== undefined && (isNaN(price) || price < 0)) {
        return res.status(400).json({
          success: false,
          error: "Price must be a positive number",
        });
      }

      // Update product
      const updatedProduct = await this.productModel.updateProduct(productId, {
        name,
        description,
        price: price !== undefined ? parseFloat(price) : undefined,
        category,
        inStock,
        sku,
      });

      return res.status(200).json({
        success: true,
        data: updatedProduct,
      });
    } catch (error) {
      console.error("ProductController: Error updating product:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to update product",
      });
    }
  }

  /**
   * @description Delete product
   * @param {Object} req - Express request object
   * @param {Object} req.params - Request parameters
   * @param {string} req.params.productId - Product ID
   * @param {Object} req.body - Request body
   * @param {string} req.body.walletId - User's wallet ID for verification
   * @param {Object} res - Express response object
   * @returns {Object} Response with success status
   */
  async deleteProduct(req, res) {
    try {
      const { productId } = req.params;
      const { walletId } = req.body;

      // Validate wallet ID
      if (!walletId) {
        return res.status(400).json({
          success: false,
          error: "Wallet ID is required",
        });
      }

      // Get product and verify ownership
      const product = await this.productModel.getProductById(productId);
      if (!product) {
        return res.status(404).json({
          success: false,
          error: "Product not found",
        });
      }

      // Get store to verify ownership
      const store = await this.storeModel.getStoreById(product.storeId);
      if (!store) {
        return res.status(404).json({
          success: false,
          error: "Store not found",
        });
      }

      if (store.walletId !== walletId) {
        return res.status(403).json({
          success: false,
          error: "You do not have permission to delete this product",
        });
      }

      await this.productModel.deleteProduct(productId);

      return res.status(200).json({
        success: true,
        message: "Product deleted successfully",
      });
    } catch (error) {
      console.error("ProductController: Error deleting product:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to delete product",
      });
    }
  }

  /**
   * @description Upload product image
   * @param {Object} req - Express request object
   * @param {Object} req.params - Request parameters
   * @param {string} req.params.productId - Product ID
   * @param {Object} req.body - Request body
   * @param {string} req.body.walletId - User's wallet ID for verification
   * @param {File} req.file - Uploaded image file
   * @param {Object} res - Express response object
   * @returns {Object} Response with image URL
   */
  async uploadProductImage(req, res) {
    try {
      const { productId } = req.params;
      const { walletId } = req.body;

      // Validate wallet ID
      if (!walletId) {
        return res.status(400).json({
          success: false,
          error: "Wallet ID is required",
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: "No image file uploaded",
        });
      }

      // Get product
      const product = await this.productModel.getProductById(productId);

      if (!product) {
        return res.status(404).json({
          success: false,
          error: "Product not found",
        });
      }

      // Get store to verify ownership
      const store = await this.storeModel.getStoreById(product.storeId);
      if (!store) {
        return res.status(404).json({
          success: false,
          error: "Store not found",
        });
      }

      if (store.walletId !== walletId) {
        return res.status(403).json({
          success: false,
          error: "You do not have permission to update this product",
        });
      }

      // Upload image to S3
      const imageResult = await this.imageService.uploadImage(
        req.file.buffer,
        walletId,
        "product-images"
      );

      // Add new image URL to product's imageUrls array
      const imageUrls = [...(product.imageUrls || []), imageResult.url];

      // Update product with new image URL
      const updatedProduct = await this.productModel.updateProduct(productId, {
        imageUrls,
      });

      return res.status(200).json({
        success: true,
        data: {
          imageUrl: imageResult.url,
          product: updatedProduct,
        },
      });
    } catch (error) {
      console.error("ProductController: Error uploading product image:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to upload product image",
      });
    }
  }

  /**
   * @description Remove product image
   * @param {Object} req - Express request object
   * @param {Object} req.params - Request parameters
   * @param {string} req.params.productId - Product ID
   * @param {Object} req.body - Request body
   * @param {string} req.body.imageUrl - Image URL to remove
   * @param {string} req.body.walletId - User's wallet ID for verification
   * @param {Object} res - Express response object
   * @returns {Object} Response with updated product
   */
  async removeProductImage(req, res) {
    try {
      const { productId } = req.params;
      const { imageUrl, walletId } = req.body;

      // Validate required fields
      if (!imageUrl) {
        return res.status(400).json({
          success: false,
          error: "Image URL is required",
        });
      }

      // Validate wallet ID
      if (!walletId) {
        return res.status(400).json({
          success: false,
          error: "Wallet ID is required",
        });
      }

      // Get product
      const product = await this.productModel.getProductById(productId);

      if (!product) {
        return res.status(404).json({
          success: false,
          error: "Product not found",
        });
      }

      // Get store to verify ownership
      const store = await this.storeModel.getStoreById(product.storeId);
      if (!store) {
        return res.status(404).json({
          success: false,
          error: "Store not found",
        });
      }

      if (store.walletId !== walletId) {
        return res.status(403).json({
          success: false,
          error: "You do not have permission to update this product",
        });
      }

      // Remove image URL from product's imageUrls array
      const imageUrls = (product.imageUrls || []).filter(
        (url) => url !== imageUrl
      );

      // Update product with new imageUrls array
      const updatedProduct = await this.productModel.updateProduct(productId, {
        imageUrls,
      });

      return res.status(200).json({
        success: true,
        data: updatedProduct,
      });
    } catch (error) {
      console.error("ProductController: Error removing product image:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to remove product image",
      });
    }
  }

  /**
   * @description Get product categories for a store
   * @param {Object} req - Express request object
   * @param {Object} req.params - Request parameters
   * @param {string} req.params.storeId - Store ID
   * @param {Object} res - Express response object
   * @returns {Object} Response with categories
   */
  async getProductCategories(req, res) {
    try {
      const { storeId } = req.params;

      // Verify store exists
      const store = await this.storeModel.getStoreById(storeId);
      if (!store) {
        return res.status(404).json({
          success: false,
          error: "Store not found",
        });
      }

      const categories = await this.productModel.getProductCategories(storeId);

      return res.status(200).json({
        success: true,
        count: categories.length,
        data: categories,
      });
    } catch (error) {
      console.error(
        "ProductController: Error fetching product categories:",
        error
      );
      return res.status(500).json({
        success: false,
        error: "Failed to fetch product categories",
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

module.exports = ProductController;
