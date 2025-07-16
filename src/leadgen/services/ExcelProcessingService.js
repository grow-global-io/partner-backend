const ExcelJS = require("exceljs");
const AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid");
const stream = require("stream");
const { promisify } = require("util");
const pipeline = promisify(stream.pipeline);
const fs = require("fs");
const path = require("path");

/**
 * @description Excel processing service for streaming Excel file parsing and S3 upload
 * @class ExcelProcessingService
 */
class ExcelProcessingService {
  constructor() {
    // Validate required environment variables
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      console.warn(
        "ExcelProcessingService: AWS credentials not fully configured. S3 operations may fail."
      );
    }

    if (!process.env.AWS_BUCKET_NAME) {
      console.warn(
        "ExcelProcessingService: AWS_BUCKET_NAME not configured. S3 operations will fail."
      );
    }

    // Configure AWS S3
    this.s3 = new AWS.S3({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION,
    });

    this.bucketName = process.env.AWS_BUCKET_NAME;
    this.supportedMimeTypes = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
    ];
    this.supportedExtensions = [".xlsx", ".xls"];

    // Batch size for processing rows
    this.batchSize = 100;
  }

  /**
   * @description Upload Excel file to S3 using streaming
   * @param {Buffer|Stream} fileInput - Excel file buffer or stream
   * @param {string} fileName - Original file name
   * @returns {Promise<Object>} Upload result with S3 key and URL
   */
  async uploadExcelToS3(fileInput, fileName) {
    try {
      const fileExtension = fileName.split(".").pop();
      const uniqueFileName = `${uuidv4()}.${fileExtension}`;
      const s3Key = `excel-documents/${uniqueFileName}`;

      let uploadStream;
      if (Buffer.isBuffer(fileInput)) {
        uploadStream = stream.Readable.from(fileInput);
      } else {
        uploadStream = fileInput;
      }

      const uploadParams = {
        Bucket: this.bucketName,
        Key: s3Key,
        Body: uploadStream,
        ContentType: this.getMimeType(fileName),
        Metadata: {
          "original-name": fileName,
          "upload-timestamp": new Date().toISOString(),
        },
        ServerSideEncryption: "AES256",
      };

      const uploadResult = await this.s3.upload(uploadParams).promise();

      return {
        fileKey: s3Key,
        s3Url: uploadResult.Location,
        bucketName: this.bucketName,
        fileName: fileName,
        uploadedAt: new Date(),
      };
    } catch (error) {
      console.error("ExcelProcessingService: Error uploading Excel:", error);
      throw error;
    }
  }

  /**
   * @description Parse Excel file using streaming for better memory usage
   * @param {Buffer|Stream} fileInput - Excel file buffer or stream
   * @returns {AsyncGenerator<Object>} Yields batches of parsed rows
   */
  async *parseExcelFile(fileInput) {
    try {
      console.log(
        "ExcelProcessingService: Starting Excel parsing with streaming..."
      );

      const workbook = new ExcelJS.Workbook();
      const worksheets = [];
      let totalRows = 0;
      let currentBatch = [];

      // Create a readable stream from buffer if needed
      const readStream = Buffer.isBuffer(fileInput)
        ? stream.Readable.from(fileInput)
        : fileInput;

      // Use streaming to read the workbook
      await workbook.xlsx.read(readStream);

      // Process each worksheet
      for (const worksheet of workbook.worksheets) {
        console.log(`Processing worksheet: ${worksheet.name}`);

        worksheets.push({
          id: worksheet.id,
          name: worksheet.name,
          rowCount: worksheet.rowCount,
          columnCount: worksheet.columnCount,
        });

        // Get headers from first row
        const headers = [];
        worksheet.getRow(1).eachCell((cell, colNumber) => {
          headers[colNumber - 1] = cell.value
            ? String(cell.value)
            : `Column_${colNumber}`;
        });

        // Process rows in batches
        let rowIndex = 0;
        const worksheetRows = [];

        worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
          if (rowNumber === 1) return; // Skip header

          const rowData = {};
          let hasData = false;

          row.eachCell((cell, colNumber) => {
            const header = headers[colNumber - 1] || `Column_${colNumber}`;
            let cellValue = cell.value;

            if (cellValue !== null && cellValue !== undefined) {
              if (
                typeof cellValue === "object" &&
                cellValue.result !== undefined
              ) {
                cellValue = cellValue.result;
              } else if (
                typeof cellValue === "object" &&
                cellValue.text !== undefined
              ) {
                cellValue = cellValue.text;
              }
              rowData[header] = String(cellValue);
              hasData = true;
            } else {
              rowData[header] = "";
            }
          });

          if (hasData) {
            const processedRow = {
              rowIndex: totalRows + rowIndex,
              worksheetName: worksheet.name,
              worksheetId: worksheet.id,
              originalRowNumber: rowNumber,
              data: rowData,
              textContent: this.extractTextContent(rowData),
            };

            worksheetRows.push(processedRow);
            rowIndex++;
          }
        });

        // CRITICAL FIX: Process all rows from this worksheet in proper batches
        for (let i = 0; i < worksheetRows.length; i += this.batchSize) {
          const batch = worksheetRows.slice(i, i + this.batchSize);
          currentBatch.push(...batch);

          // Yield when currentBatch reaches capacity
          if (currentBatch.length >= this.batchSize) {
            yield [...currentBatch];
            currentBatch = [];
          }
        }

        totalRows += rowIndex;
      }

      // Yield any remaining rows in the last batch
      if (currentBatch.length > 0) {
        yield currentBatch;
      }

      // Yield metadata as final batch
      yield {
        isMetadata: true,
        metadata: {
          totalWorksheets: worksheets.length,
          worksheets,
          totalRows,
          parsedAt: new Date(),
        },
      };
    } catch (error) {
      console.error("ExcelProcessingService: Error parsing Excel:", error);
      throw new Error(`Failed to parse Excel file: ${error.message}`);
    }
  }

  /**
   * @description Download Excel file from S3
   * @param {string} s3Key - S3 object key
   * @returns {Promise<Buffer>} File buffer
   */
  async downloadExcelFromS3(s3Key) {
    try {
      const downloadParams = {
        Bucket: this.bucketName,
        Key: s3Key,
      };

      const result = await this.s3.getObject(downloadParams).promise();
      return result.Body;
    } catch (error) {
      console.error("ExcelProcessingService: Error downloading Excel:", error);
      throw error;
    }
  }

  /**
   * @description Check if S3 delete permissions are available
   * @param {string} s3Key - S3 object key to test
   * @returns {Promise<boolean>} True if delete permissions are available
   */
  async checkS3DeletePermissions(s3Key) {
    try {
      // Try to get object metadata first (lighter operation)
      const headParams = {
        Bucket: this.bucketName,
        Key: s3Key,
      };

      await this.s3.headObject(headParams).promise();
      return true; // If we can access the object, likely we can delete it
    } catch (error) {
      console.warn(
        `ExcelProcessingService: Cannot access S3 object ${s3Key}:`,
        error.code
      );
      return false;
    }
  }

  /**
   * @description Delete Excel file from S3 with improved error handling
   * @param {string} s3Key - S3 object key
   * @returns {Promise<Object>} Deletion result
   */
  async deleteExcelFromS3(s3Key) {
    try {
      // Check if we have access to the object first
      const hasAccess = await this.checkS3DeletePermissions(s3Key);
      if (!hasAccess) {
        return {
          success: false,
          deletedKey: s3Key,
          error: "No access to S3 object or object doesn't exist",
          errorType: "ACCESS_DENIED",
        };
      }

      const deleteParams = {
        Bucket: this.bucketName,
        Key: s3Key,
      };

      const result = await this.s3.deleteObject(deleteParams).promise();

      console.log(
        `ExcelProcessingService: Successfully deleted file from S3: ${s3Key}`
      );

      return {
        success: true,
        deletedKey: s3Key,
        result: result,
      };
    } catch (error) {
      console.error(
        "ExcelProcessingService: Error deleting Excel from S3:",
        error
      );

      // Categorize the error for better handling
      let errorType = "UNKNOWN_ERROR";
      let userFriendlyMessage = "Failed to delete file from S3";

      if (error.code === "AccessDenied") {
        errorType = "ACCESS_DENIED";
        userFriendlyMessage =
          "Insufficient permissions to delete file from S3 storage";
      } else if (error.code === "NoSuchKey") {
        errorType = "FILE_NOT_FOUND";
        userFriendlyMessage = "File not found in S3 storage";
      } else if (error.code === "NoSuchBucket") {
        errorType = "BUCKET_NOT_FOUND";
        userFriendlyMessage = "S3 bucket not found";
      }

      return {
        success: false,
        deletedKey: s3Key,
        error: userFriendlyMessage,
        errorType: errorType,
        originalError: error.message,
      };
    }
  }

  /**
   * @description Extract text content from row data for embedding
   * @param {Object} rowData - Row data object
   * @returns {string} Concatenated text content
   */
  extractTextContent(rowData) {
    try {
      if (!rowData || typeof rowData !== "object") {
        console.warn(
          "ExcelProcessingService: Invalid rowData for text extraction:",
          typeof rowData
        );
        return "";
      }

      // Filter out empty/null values and create meaningful text
      const textParts = Object.entries(rowData)
        .filter(([key, value]) => {
          // Filter out null, undefined, empty strings, and common non-meaningful values
          return (
            value !== null &&
            value !== undefined &&
            value !== "" &&
            String(value).trim() !== "" &&
            String(value).toLowerCase() !== "null" &&
            String(value).toLowerCase() !== "undefined"
          );
        })
        .map(([key, value]) => {
          // Clean the value
          const cleanValue = String(value).trim();
          return `${key}: ${cleanValue}`;
        });

      const textContent = textParts.join(" | ");

      // DEBUG: Log text extraction for specific records
      const isAjmerRecord =
        textContent.toLowerCase().includes("ajmer") ||
        textContent.toLowerCase().includes("gupta decoration") ||
        textContent.toLowerCase().includes("raj kumar");

      if (isAjmerRecord) {
        console.log(`\n🔍 EXTRACTING TEXT for Ajmer record:`);
        console.log(`Raw rowData keys: ${Object.keys(rowData).join(", ")}`);
        console.log(`Non-empty values: ${textParts.length}`);
        console.log(`Extracted text: ${textContent.substring(0, 300)}...`);

        // Show specific field values
        ["Company", "Name", "City", "State"].forEach((field) => {
          if (rowData[field]) {
            console.log(`  ${field}: "${rowData[field]}"`);
          }
        });
      }

      return textContent;
    } catch (error) {
      console.error(
        "ExcelProcessingService: Error extracting text content:",
        error
      );
      return "";
    }
  }

  /**
   * @description Validate if file is a supported Excel file
   * @param {Buffer|string} input - File buffer or file path
   * @param {string} mimeType - MIME type of the file
   * @returns {boolean} True if file is a valid Excel file
   */
  validateExcelFile(input, mimeType) {
    try {
      // Check MIME type
      if (!this.supportedMimeTypes.includes(mimeType)) {
        console.log("Invalid MIME type:", mimeType);
        return false;
      }

      // If input is a file path, check extension
      if (typeof input === "string") {
        const ext = path.extname(input).toLowerCase();
        if (!this.supportedExtensions.includes(ext)) {
          console.log("Invalid file extension:", ext);
          return false;
        }
        return true;
      }

      // If input is a buffer, check file signature
      if (Buffer.isBuffer(input)) {
        const header = input.slice(0, 8);

        // XLSX signature (ZIP-based)
        if (header[0] === 0x50 && header[1] === 0x4b) {
          return true;
        }

        // XLS signature
        if (
          header[0] === 0xd0 &&
          header[1] === 0xcf &&
          header[2] === 0x11 &&
          header[3] === 0xe0
        ) {
          return true;
        }

        console.log("Invalid file signature");
        return false;
      }

      console.log("Invalid input type:", typeof input);
      return false;
    } catch (error) {
      console.error(
        "ExcelProcessingService: Error validating Excel file:",
        error
      );
      return false;
    }
  }

  /**
   * @description Get MIME type based on file extension
   * @param {string} fileName - File name
   * @returns {string} MIME type
   */
  getMimeType(fileName) {
    const extension = fileName.split(".").pop().toLowerCase();
    switch (extension) {
      case "xlsx":
        return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      case "xls":
        return "application/vnd.ms-excel";
      default:
        return "application/octet-stream";
    }
  }

  /**
   * @description Get supported file extensions
   * @returns {Array<string>} Array of supported extensions
   */
  getSupportedExtensions() {
    return [".xlsx", ".xls"];
  }

  /**
   * @description Get maximum file size limit (in bytes)
   * @returns {number} Maximum file size in bytes (25MB)
   */
  getMaxFileSize() {
    return 25 * 1024 * 1024; // 25MB
  }

  /**
   * @description Clean and preprocess row data
   * @param {Array} rows - Array of row objects
   * @returns {Array} Cleaned rows
   */
  cleanRowData(rows) {
    try {
      return rows.map((row, index) => {
        // Clean text content
        const cleanedTextContent = row.textContent
          .replace(/\s+/g, " ") // Replace multiple spaces with single space
          .replace(/\n\s*\n/g, "\n") // Replace multiple newlines with single newline
          .replace(/\r/g, "") // Remove carriage returns
          .trim();

        return {
          ...row,
          textContent: cleanedTextContent,
          wordCount: this.countWords(cleanedTextContent),
          characterCount: cleanedTextContent.length,
        };
      });
    } catch (error) {
      console.error("ExcelProcessingService: Error cleaning row data:", error);
      return rows;
    }
  }

  /**
   * @description Count words in text
   * @param {string} text - Text to count words in
   * @returns {number} Word count
   */
  countWords(text) {
    if (!text || typeof text !== "string") return 0;
    return text
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0).length;
  }

  /**
   * @description Test S3 connectivity and permissions
   * @returns {Promise<Object>} Health check result
   */
  async healthCheck() {
    const healthResult = {
      s3Connection: false,
      bucketAccess: false,
      uploadPermission: false,
      deletePermission: false,
      errors: [],
    };

    try {
      // Test basic S3 connection
      await this.s3.headBucket({ Bucket: this.bucketName }).promise();
      healthResult.s3Connection = true;
      healthResult.bucketAccess = true;

      // Test upload permission by creating a small test file
      const testKey = `health-check/test-${Date.now()}.txt`;
      const testContent = "Health check test file";

      try {
        await this.s3
          .putObject({
            Bucket: this.bucketName,
            Key: testKey,
            Body: testContent,
            ContentType: "text/plain",
          })
          .promise();
        healthResult.uploadPermission = true;

        // Test delete permission
        try {
          await this.s3
            .deleteObject({
              Bucket: this.bucketName,
              Key: testKey,
            })
            .promise();
          healthResult.deletePermission = true;
        } catch (deleteError) {
          healthResult.errors.push(
            `Delete permission test failed: ${deleteError.message}`
          );
        }
      } catch (uploadError) {
        healthResult.errors.push(
          `Upload permission test failed: ${uploadError.message}`
        );
      }
    } catch (connectionError) {
      healthResult.errors.push(
        `S3 connection test failed: ${connectionError.message}`
      );
    }

    return healthResult;
  }
}

module.exports = ExcelProcessingService;
