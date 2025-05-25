const AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid");

/**
 * @description S3 service for PDF file upload and management
 * @class S3Service
 */
class S3Service {
  constructor() {
    // Validate required environment variables
    this.validateEnvironmentVariables();

    // Configure AWS SDK
    AWS.config.update({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION || "eu-north-1",
    });

    this.s3 = new AWS.S3();
    this.bucketName = process.env.AWS_BUCKET_NAME;
  }

  /**
   * @description Validate required environment variables
   * @private
   */
  validateEnvironmentVariables() {
    const requiredVars = [
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_BUCKET_NAME",
    ];

    const missingVars = requiredVars.filter((varName) => !process.env[varName]);

    if (missingVars.length > 0) {
      const errorMessage =
        `Missing required AWS environment variables: ${missingVars.join(
          ", "
        )}\n` +
        "Please set the following environment variables:\n" +
        "- AWS_ACCESS_KEY_ID\n" +
        "- AWS_SECRET_ACCESS_KEY\n" +
        "- AWS_REGION (optional, defaults to eu-north-1)\n" +
        "- AWS_BUCKET_NAME\n\n" +
        "You can:\n" +
        "1. Create a .env file with these variables\n" +
        '2. Export them in your shell: export AWS_ACCESS_KEY_ID="your_key"\n' +
        "3. Use AWS CLI configuration: aws configure\n\n" +
        "See src/pdf-chat/AWS_SETUP.md for detailed instructions.";

      console.error("S3Service Configuration Error:", errorMessage);
      throw new Error(errorMessage);
    }

    if (!process.env.AWS_REGION) {
      console.warn("AWS_REGION not set, defaulting to eu-north-1");
    }
  }

  /**
   * @description Upload PDF file to S3
   * @param {Buffer} fileBuffer - File buffer
   * @param {string} fileName - Original file name
   * @param {string} walletId - User's wallet ID
   * @param {string} mimeType - File MIME type
   * @returns {Promise<Object>} Upload result with S3 key and URL
   */
  async uploadPDF(fileBuffer, fileName, walletId, mimeType) {
    try {
      // Generate unique file key
      const fileExtension = fileName.split(".").pop();
      const uniqueFileName = `${uuidv4()}.${fileExtension}`;
      const s3Key = `pdf-documents/${walletId}/${uniqueFileName}`;

      const uploadParams = {
        Bucket: this.bucketName,
        Key: s3Key,
        Body: fileBuffer,
        ContentType: mimeType,
        Metadata: {
          "original-name": fileName,
          "wallet-id": walletId,
          "upload-timestamp": new Date().toISOString(),
        },
        ServerSideEncryption: "AES256",
      };

      // Upload file to S3
      const uploadResult = await this.s3.upload(uploadParams).promise();

      return {
        s3Key: s3Key,
        s3Url: uploadResult.Location,
        bucketName: this.bucketName,
        fileName: fileName,
        fileSize: fileBuffer.length,
        mimeType: mimeType,
        uploadedAt: new Date(),
      };
    } catch (error) {
      console.error("S3Service: Error uploading PDF:", error);
      throw error;
    }
  }

  /**
   * @description Download PDF file from S3
   * @param {string} s3Key - S3 object key
   * @returns {Promise<Buffer>} File buffer
   */
  async downloadPDF(s3Key) {
    try {
      const downloadParams = {
        Bucket: this.bucketName,
        Key: s3Key,
      };

      const result = await this.s3.getObject(downloadParams).promise();
      return result.Body;
    } catch (error) {
      console.error("S3Service: Error downloading PDF:", error);
      throw error;
    }
  }

  /**
   * @description Delete PDF file from S3
   * @param {string} s3Key - S3 object key
   * @returns {Promise<boolean>} Success status
   */
  async deletePDF(s3Key) {
    try {
      const deleteParams = {
        Bucket: this.bucketName,
        Key: s3Key,
      };

      await this.s3.deleteObject(deleteParams).promise();
      return true;
    } catch (error) {
      console.error("S3Service: Error deleting PDF:", error);
      throw error;
    }
  }

  /**
   * @description Generate presigned URL for file access
   * @param {string} s3Key - S3 object key
   * @param {number} expiresIn - URL expiration time in seconds (default: 3600)
   * @returns {Promise<string>} Presigned URL
   */
  async generatePresignedUrl(s3Key, expiresIn = 3600) {
    try {
      const params = {
        Bucket: this.bucketName,
        Key: s3Key,
        Expires: expiresIn,
      };

      const url = await this.s3.getSignedUrlPromise("getObject", params);
      return url;
    } catch (error) {
      console.error("S3Service: Error generating presigned URL:", error);
      throw error;
    }
  }

  /**
   * @description List PDF files for a wallet ID
   * @param {string} walletId - User's wallet ID
   * @returns {Promise<Array>} Array of file objects
   */
  async listPDFsForWallet(walletId) {
    try {
      const listParams = {
        Bucket: this.bucketName,
        Prefix: `pdf-documents/${walletId}/`,
      };

      const result = await this.s3.listObjectsV2(listParams).promise();

      return result.Contents.map((object) => ({
        s3Key: object.Key,
        fileName: object.Key.split("/").pop(),
        size: object.Size,
        lastModified: object.LastModified,
        etag: object.ETag,
      }));
    } catch (error) {
      console.error("S3Service: Error listing PDFs:", error);
      throw error;
    }
  }

  /**
   * @description Get file metadata from S3
   * @param {string} s3Key - S3 object key
   * @returns {Promise<Object>} File metadata
   */
  async getFileMetadata(s3Key) {
    try {
      const params = {
        Bucket: this.bucketName,
        Key: s3Key,
      };

      const result = await this.s3.headObject(params).promise();

      return {
        fileName: result.Metadata["original-name"] || s3Key.split("/").pop(),
        fileSize: result.ContentLength,
        mimeType: result.ContentType,
        lastModified: result.LastModified,
        etag: result.ETag,
        walletId: result.Metadata["wallet-id"],
        uploadTimestamp: result.Metadata["upload-timestamp"],
      };
    } catch (error) {
      console.error("S3Service: Error getting file metadata:", error);
      throw error;
    }
  }

  /**
   * @description Check if file exists in S3
   * @param {string} s3Key - S3 object key
   * @returns {Promise<boolean>} True if file exists
   */
  async fileExists(s3Key) {
    try {
      await this.s3
        .headObject({
          Bucket: this.bucketName,
          Key: s3Key,
        })
        .promise();
      return true;
    } catch (error) {
      if (error.statusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * @description Validate S3 configuration
   * @returns {Promise<boolean>} True if configuration is valid
   */
  async validateConfiguration() {
    try {
      // Check if bucket exists and is accessible
      await this.s3.headBucket({ Bucket: this.bucketName }).promise();
      return true;
    } catch (error) {
      console.error(
        "S3Service: Configuration validation failed:",
        error.message
      );
      return false;
    }
  }

  /**
   * @description Get storage usage for a wallet ID
   * @param {string} walletId - User's wallet ID
   * @returns {Promise<Object>} Storage usage statistics
   */
  async getStorageUsage(walletId) {
    try {
      const files = await this.listPDFsForWallet(walletId);

      const totalSize = files.reduce((sum, file) => sum + file.size, 0);
      const fileCount = files.length;

      return {
        walletId,
        totalFiles: fileCount,
        totalSize: totalSize,
        totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
        files: files,
      };
    } catch (error) {
      console.error("S3Service: Error getting storage usage:", error);
      throw error;
    }
  }
}

module.exports = S3Service;
