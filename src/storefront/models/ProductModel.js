const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

/**
 * @description Product model for managing product data
 * @class ProductModel
 */
class ProductModel {
  /**
   * @description Create a new product
   * @param {Object} productData - Product data to create
   * @returns {Promise<Object>} Created product
   */
  async createProduct(productData) {
    try {
      const product = await prisma.product.create({
        data: {
          name: productData.name,
          description: productData.description,
          price: productData.price,
          category: productData.category,
          imageUrls: productData.imageUrls || [],
          inStock:
            productData.inStock !== undefined ? productData.inStock : true,
          sku: productData.sku,
          store: {
            connect: { id: productData.storeId },
          },
        },
      });
      return product;
    } catch (error) {
      console.error("ProductModel: Error creating product:", error);
      throw error;
    }
  }

  /**
   * @description Get product by ID
   * @param {string} productId - Product ID
   * @returns {Promise<Object|null>} Product or null
   */
  async getProductById(productId) {
    try {
      const product = await prisma.product.findUnique({
        where: { id: productId },
        include: { store: true },
      });
      return product;
    } catch (error) {
      console.error("ProductModel: Error fetching product by ID:", error);
      throw error;
    }
  }

  /**
   * @description Get products by store ID
   * @param {string} storeId - Store ID
   * @param {Object} options - Query options (category, sort, limit)
   * @returns {Promise<Array>} Array of products
   */
  async getProductsByStoreId(storeId, options = {}) {
    try {
      const { category, sort = "createdAt", order = "desc", limit } = options;

      // Build where clause
      const where = { storeId };
      if (category) {
        where.category = category;
      }

      // Build query
      const query = {
        where,
        orderBy: { [sort]: order },
      };

      // Add limit if provided
      if (limit) {
        query.take = parseInt(limit);
      }

      const products = await prisma.product.findMany(query);
      return products;
    } catch (error) {
      console.error(
        "ProductModel: Error fetching products by store ID:",
        error
      );
      throw error;
    }
  }

  /**
   * @description Update product
   * @param {string} productId - Product ID
   * @param {Object} productData - Product data to update
   * @returns {Promise<Object>} Updated product
   */
  async updateProduct(productId, productData) {
    try {
      const product = await prisma.product.update({
        where: { id: productId },
        data: {
          name: productData.name,
          description: productData.description,
          price: productData.price,
          category: productData.category,
          imageUrls: productData.imageUrls,
          inStock: productData.inStock,
          sku: productData.sku,
        },
      });
      return product;
    } catch (error) {
      console.error("ProductModel: Error updating product:", error);
      throw error;
    }
  }

  /**
   * @description Delete product
   * @param {string} productId - Product ID
   * @returns {Promise<boolean>} Success status
   */
  async deleteProduct(productId) {
    try {
      await prisma.product.delete({
        where: { id: productId },
      });
      return true;
    } catch (error) {
      console.error("ProductModel: Error deleting product:", error);
      throw error;
    }
  }

  /**
   * @description Get product categories for a store
   * @param {string} storeId - Store ID
   * @returns {Promise<Array>} Array of unique categories
   */
  async getProductCategories(storeId) {
    try {
      const products = await prisma.product.findMany({
        where: { storeId },
        select: { category: true },
        distinct: ["category"],
      });

      return products
        .map((product) => product.category)
        .filter((category) => category); // Filter out null/undefined
    } catch (error) {
      console.error("ProductModel: Error fetching product categories:", error);
      throw error;
    }
  }

  /**
   * @description Check if product belongs to store
   * @param {string} productId - Product ID
   * @param {string} storeId - Store ID
   * @returns {Promise<boolean>} Whether product belongs to store
   */
  async isProductInStore(productId, storeId) {
    try {
      const product = await prisma.product.findFirst({
        where: {
          id: productId,
          storeId,
        },
      });
      return !!product;
    } catch (error) {
      console.error("ProductModel: Error checking product ownership:", error);
      throw error;
    }
  }
}

module.exports = ProductModel;
