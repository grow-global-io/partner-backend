const express = require("express");
const StoreController = require("../controllers/StoreController");
const ProductController = require("../controllers/ProductController");

const router = express.Router();

// Initialize controllers
const storeController = new StoreController();
const productController = new ProductController();

/**
 * @swagger
 * components:
 *   schemas:
 *     Store:
 *       type: object
 *       required:
 *         - name
 *         - walletId
 *       properties:
 *         id:
 *           type: string
 *           description: Store ID
 *         name:
 *           type: string
 *           description: Store name
 *         description:
 *           type: string
 *           description: Store description
 *         slug:
 *           type: string
 *           description: Store slug for URL
 *         logoUrl:
 *           type: string
 *           description: Store logo URL
 *         bannerUrl:
 *           type: string
 *           description: Store banner URL
 *         walletId:
 *           type: string
 *           description: Owner's wallet ID
 *         isActive:
 *           type: boolean
 *           description: Store active status
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: Creation timestamp
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           description: Update timestamp
 *
 *     Product:
 *       type: object
 *       required:
 *         - name
 *         - price
 *         - storeId
 *       properties:
 *         id:
 *           type: string
 *           description: Product ID
 *         name:
 *           type: string
 *           description: Product name
 *         description:
 *           type: string
 *           description: Product description
 *         price:
 *           type: number
 *           description: Product price
 *         category:
 *           type: string
 *           description: Product category
 *         imageUrls:
 *           type: array
 *           items:
 *             type: string
 *           description: Product image URLs
 *         inStock:
 *           type: boolean
 *           description: Product stock status
 *         sku:
 *           type: string
 *           description: Product SKU
 *         storeId:
 *           type: string
 *           description: Store ID
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: Creation timestamp
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           description: Update timestamp
 */

// Store Routes

/**
 * @swagger
 * /api/storefront/stores:
 *   post:
 *     summary: Create a new store
 *     tags: [Stores]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - walletId
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               walletId:
 *                 type: string
 *     responses:
 *       201:
 *         description: Store created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Store'
 */
router.post("/stores", (req, res) => storeController.createStore(req, res));

/**
 * @swagger
 * /api/storefront/stores:
 *   get:
 *     summary: Get stores by wallet ID
 *     tags: [Stores]
 *     parameters:
 *       - in: query
 *         name: walletId
 *         required: true
 *         schema:
 *           type: string
 *         description: User's wallet ID
 *     responses:
 *       200:
 *         description: Stores retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Store'
 */
router.get("/stores", (req, res) =>
  storeController.getStoresByWallet(req, res)
);

/**
 * @swagger
 * /api/storefront/stores/{storeId}:
 *   get:
 *     summary: Get store by ID
 *     tags: [Stores]
 *     parameters:
 *       - in: path
 *         name: storeId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Store retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Store'
 */
router.get("/stores/:storeId", (req, res) =>
  storeController.getStore(req, res)
);

/**
 * @swagger
 * /api/storefront/stores/slug/{slug}:
 *   get:
 *     summary: Get store by slug
 *     tags: [Stores]
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Store retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Store'
 */
router.get("/stores/slug/:slug", (req, res) =>
  storeController.getStoreBySlug(req, res)
);

/**
 * @swagger
 * /api/storefront/stores/{storeId}:
 *   put:
 *     summary: Update store
 *     tags: [Stores]
 *     parameters:
 *       - in: path
 *         name: storeId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - walletId
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               isActive:
 *                 type: boolean
 *               walletId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Store updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Store'
 */
router.put("/stores/:storeId", (req, res) =>
  storeController.updateStore(req, res)
);

/**
 * @swagger
 * /api/storefront/stores/{storeId}:
 *   delete:
 *     summary: Delete store
 *     tags: [Stores]
 *     parameters:
 *       - in: path
 *         name: storeId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - walletId
 *             properties:
 *               walletId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Store deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 */
router.delete("/stores/:storeId", (req, res) =>
  storeController.deleteStore(req, res)
);

/**
 * @swagger
 * /api/storefront/stores/{storeId}/logo:
 *   post:
 *     summary: Upload store logo
 *     tags: [Stores]
 *     parameters:
 *       - in: path
 *         name: storeId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - image
 *               - walletId
 *             properties:
 *               image:
 *                 type: string
 *                 format: binary
 *               walletId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Logo uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     logoUrl:
 *                       type: string
 *                     store:
 *                       $ref: '#/components/schemas/Store'
 */
router.post(
  "/stores/:storeId/logo",
  storeController.getUploadMiddleware(),
  (req, res) => storeController.uploadLogo(req, res)
);

/**
 * @swagger
 * /api/storefront/stores/{storeId}/banner:
 *   post:
 *     summary: Upload store banner
 *     tags: [Stores]
 *     parameters:
 *       - in: path
 *         name: storeId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - image
 *               - walletId
 *             properties:
 *               image:
 *                 type: string
 *                 format: binary
 *               walletId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Banner uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     bannerUrl:
 *                       type: string
 *                     store:
 *                       $ref: '#/components/schemas/Store'
 */
router.post(
  "/stores/:storeId/banner",
  storeController.getUploadMiddleware(),
  (req, res) => storeController.uploadBanner(req, res)
);

// Product Routes

/**
 * @swagger
 * /api/storefront/stores/{storeId}/products:
 *   post:
 *     summary: Create a new product
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: storeId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - price
 *               - walletId
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               price:
 *                 type: number
 *               category:
 *                 type: string
 *               inStock:
 *                 type: boolean
 *               sku:
 *                 type: string
 *               walletId:
 *                 type: string
 *     responses:
 *       201:
 *         description: Product created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Product'
 */
router.post("/stores/:storeId/products", (req, res) =>
  productController.createProduct(req, res)
);

/**
 * @swagger
 * /api/storefront/stores/{storeId}/products:
 *   get:
 *     summary: Get products by store ID
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: storeId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Products retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 count:
 *                   type: integer
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Product'
 */
router.get("/stores/:storeId/products", (req, res) =>
  productController.getProductsByStore(req, res)
);

/**
 * @swagger
 * /api/storefront/products/{productId}:
 *   get:
 *     summary: Get product by ID
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Product retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Product'
 */
router.get("/products/:productId", (req, res) =>
  productController.getProduct(req, res)
);

/**
 * @swagger
 * /api/storefront/products/{productId}:
 *   put:
 *     summary: Update product
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - walletId
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               price:
 *                 type: number
 *               category:
 *                 type: string
 *               inStock:
 *                 type: boolean
 *               sku:
 *                 type: string
 *               walletId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Product updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Product'
 */
router.put("/products/:productId", (req, res) =>
  productController.updateProduct(req, res)
);

/**
 * @swagger
 * /api/storefront/products/{productId}:
 *   delete:
 *     summary: Delete product
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - walletId
 *             properties:
 *               walletId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Product deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 */
router.delete("/products/:productId", (req, res) =>
  productController.deleteProduct(req, res)
);

/**
 * @swagger
 * /api/storefront/products/{productId}/image:
 *   post:
 *     summary: Upload product image
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - image
 *               - walletId
 *             properties:
 *               image:
 *                 type: string
 *                 format: binary
 *               walletId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Image uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     imageUrl:
 *                       type: string
 *                     product:
 *                       $ref: '#/components/schemas/Product'
 */
router.post(
  "/products/:productId/image",
  productController.getUploadMiddleware(),
  (req, res) => productController.uploadProductImage(req, res)
);

/**
 * @swagger
 * /api/storefront/products/{productId}/image:
 *   delete:
 *     summary: Remove product image
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - imageUrl
 *               - walletId
 *             properties:
 *               imageUrl:
 *                 type: string
 *               walletId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Image removed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Product'
 */
router.delete("/products/:productId/image", (req, res) =>
  productController.removeProductImage(req, res)
);

/**
 * @swagger
 * /api/storefront/stores/{storeId}/categories:
 *   get:
 *     summary: Get product categories for a store
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: storeId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Categories retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 count:
 *                   type: integer
 *                 data:
 *                   type: array
 *                   items:
 *                     type: string
 */
router.get("/stores/:storeId/categories", (req, res) =>
  productController.getProductCategories(req, res)
);

module.exports = router;
