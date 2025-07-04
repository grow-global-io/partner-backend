const AWS = require("aws-sdk");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");

/**
 * @description Image service for handling image uploads using AWS S3
 * @class ImageService
 */
class ImageService {
  constructor() {
    // Configure AWS S3
    this.s3 = new AWS.S3({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION,
    });

    this.bucketName = process.env.AWS_BUCKET_NAME;

    // Configure multer for file uploads
    this.storage = multer.memoryStorage();
    this.upload = multer({
      storage: this.storage,
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
      },
      fileFilter: (req, file, cb) => {
        // Accept only images
        if (file.mimetype.startsWith("image/")) {
          cb(null, true);
        } else {
          cb(new Error("Only image files are allowed"), false);
        }
      },
    });
  }

  /**
   * @description Get multer upload middleware
   * @returns {Function} Multer middleware
   */
  getUploadMiddleware() {
    return this.upload;
  }

  /**
   * @description Upload image to AWS S3
   * @param {Buffer} fileBuffer - Image file buffer
   * @param {string} walletId - User's wallet ID
   * @param {string} folderName - Folder name for organizing images
   * @returns {Promise<Object>} Upload result with URL
   */
  async uploadImage(fileBuffer, walletId, folderName = "storefront") {
    try {
      // Generate unique key for S3
      const fileName = `${uuidv4()}.jpg`;
      const key = `${folderName}/${walletId}/${fileName}`;

      // Set upload parameters
      const params = {
        Bucket: this.bucketName,
        Key: key,
        Body: fileBuffer,
        ContentType: "image/jpeg",
        ACL: "public-read",
      };

      // Upload to S3
      const uploadResult = await this.s3.upload(params).promise();

      return {
        url: uploadResult.Location,
        key: uploadResult.Key,
        bucket: uploadResult.Bucket,
      };
    } catch (error) {
      console.error("ImageService: Error uploading image:", error);
      throw error;
    }
  }

  /**
   * @description Delete image from AWS S3
   * @param {string} key - S3 object key
   * @returns {Promise<Object>} Deletion result
   */
  async deleteImage(key) {
    try {
      const params = {
        Bucket: this.bucketName,
        Key: key,
      };

      const result = await this.s3.deleteObject(params).promise();
      return result;
    } catch (error) {
      console.error("ImageService: Error deleting image:", error);
      throw error;
    }
  }
}

module.exports = ImageService;
