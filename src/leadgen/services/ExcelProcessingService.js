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
        let batchToYield = null;

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

            currentBatch.push(processedRow);
            rowIndex++;

            // Mark batch for yielding when it reaches the batch size
            if (currentBatch.length >= this.batchSize) {
              batchToYield = [...currentBatch];
              currentBatch = [];
            }
          }
        });

        // Yield any batches that were marked for yielding
        if (batchToYield) {
          yield batchToYield;
          batchToYield = null;
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
   * @description Delete Excel file from S3
   * @param {string} s3Key - S3 object key
   * @returns {Promise<Object>} Deletion result
   */
  async deleteExcelFromS3(s3Key) {
    try {
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
      throw error;
    }
  }

  /**
   * @description Extract text content from row data for embedding
   * @param {Object} rowData - Row data object
   * @returns {string} Concatenated text content
   */
  extractTextContent(rowData) {
    try {
      return Object.entries(rowData)
        .map(([key, value]) => `${key}: ${value}`)
        .join(" | ")
        .trim();
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
}

module.exports = ExcelProcessingService;
