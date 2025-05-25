const pdfParse = require("pdf-parse");

/**
 * @description PDF service for text extraction and processing
 * @class PDFService
 */
class PDFService {
  constructor() {
    this.supportedMimeTypes = ["application/pdf", "application/x-pdf"];
  }

  /**
   * @description Extract text from PDF buffer
   * @param {Buffer} pdfBuffer - PDF file buffer
   * @returns {Promise<Object>} Extracted text and metadata
   */
  async extractTextFromPDF(pdfBuffer) {
    try {
      const options = {
        // Custom page render function for better text extraction
        pagerender: this.customPageRender,
        // Maximum number of pages to process (for performance)
        max: 100,
      };

      const data = await pdfParse(pdfBuffer, options);

      return {
        text: data.text,
        totalPages: data.numpages,
        metadata: {
          title: data.info?.Title || "",
          author: data.info?.Author || "",
          subject: data.info?.Subject || "",
          creator: data.info?.Creator || "",
          producer: data.info?.Producer || "",
          creationDate: data.info?.CreationDate || null,
          modificationDate: data.info?.ModDate || null,
        },
        version: data.version,
        pages: await this.extractPageTexts(pdfBuffer),
      };
    } catch (error) {
      console.error("PDFService: Error extracting text from PDF:", error);
      throw new Error(`Failed to extract text from PDF: ${error.message}`);
    }
  }

  /**
   * @description Extract text from individual pages
   * @param {Buffer} pdfBuffer - PDF file buffer
   * @returns {Promise<Array>} Array of page texts
   */
  async extractPageTexts(pdfBuffer) {
    try {
      const pages = [];
      let currentPage = 1;

      // Extract text page by page for better organization
      const options = {
        pagerender: (pageData) => {
          return this.customPageRender(pageData, currentPage++);
        },
      };

      const data = await pdfParse(pdfBuffer, options);

      // Split text by page breaks if available
      const pageTexts = this.splitTextByPages(data.text, data.numpages);

      return pageTexts.map((text, index) => ({
        pageNumber: index + 1,
        text: text.trim(),
        wordCount: this.countWords(text),
        characterCount: text.length,
      }));
    } catch (error) {
      console.error("PDFService: Error extracting page texts:", error);
      return [];
    }
  }

  /**
   * @description Custom page render function for better text extraction
   * @param {Object} pageData - Page data from pdf-parse
   * @param {number} pageNumber - Current page number
   * @returns {string} Rendered page text
   */
  customPageRender(pageData, pageNumber = 1) {
    try {
      // Add page number marker for better text organization
      const pageMarker = `\n\n--- PAGE ${pageNumber} ---\n\n`;

      // Extract text items and join them properly
      let pageText = "";
      if (pageData && pageData.getTextContent) {
        pageData.getTextContent().then((textContent) => {
          pageText = textContent.items.map((item) => item.str).join(" ");
        });
      }

      return pageMarker + pageText;
    } catch (error) {
      console.error("PDFService: Error in custom page render:", error);
      return "";
    }
  }

  /**
   * @description Split text by pages using page markers
   * @param {string} text - Full extracted text
   * @param {number} totalPages - Total number of pages
   * @returns {Array<string>} Array of page texts
   */
  splitTextByPages(text, totalPages) {
    try {
      // Try to split by page markers first
      const pageMarkerRegex = /--- PAGE \d+ ---/g;
      let pages = text.split(pageMarkerRegex);

      // Remove empty first element if text starts with page marker
      if (pages[0].trim() === "") {
        pages = pages.slice(1);
      }

      // If page markers didn't work, split text evenly
      if (pages.length !== totalPages && totalPages > 1) {
        const textLength = text.length;
        const avgPageLength = Math.floor(textLength / totalPages);
        pages = [];

        for (let i = 0; i < totalPages; i++) {
          const start = i * avgPageLength;
          const end =
            i === totalPages - 1 ? textLength : (i + 1) * avgPageLength;
          pages.push(text.substring(start, end));
        }
      }

      return pages.map((page) => page.trim());
    } catch (error) {
      console.error("PDFService: Error splitting text by pages:", error);
      return [text]; // Return full text as single page if splitting fails
    }
  }

  /**
   * @description Clean and preprocess extracted text
   * @param {string} text - Raw extracted text
   * @returns {string} Cleaned text
   */
  cleanText(text) {
    try {
      // Remove excessive whitespace and line breaks
      let cleanedText = text
        .replace(/\s+/g, " ") // Replace multiple spaces with single space
        .replace(/\n\s*\n/g, "\n") // Replace multiple newlines with single newline
        .replace(/\r/g, "") // Remove carriage returns
        .trim();

      // Remove page markers if any
      cleanedText = cleanedText.replace(/--- PAGE \d+ ---/g, "");

      // Remove common PDF artifacts
      cleanedText = cleanedText
        .replace(/\f/g, "") // Remove form feed characters
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") // Remove control characters
        .replace(/[^\x20-\x7E\u00A0-\uFFFF]/g, ""); // Keep only printable characters

      return cleanedText.trim();
    } catch (error) {
      console.error("PDFService: Error cleaning text:", error);
      return text;
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
   * @description Validate if file is a supported PDF
   * @param {Buffer} fileBuffer - File buffer to validate
   * @param {string} mimeType - MIME type of the file
   * @returns {boolean} True if file is a valid PDF
   */
  validatePDF(fileBuffer, mimeType) {
    try {
      // Check MIME type
      if (!this.supportedMimeTypes.includes(mimeType)) {
        return false;
      }

      // Check PDF header
      const header = fileBuffer.slice(0, 4).toString();
      if (!header.startsWith("%PDF")) {
        return false;
      }

      // Check PDF footer (should contain %%EOF)
      const footer = fileBuffer.slice(-1024).toString();
      if (!footer.includes("%%EOF")) {
        return false;
      }

      return true;
    } catch (error) {
      console.error("PDFService: Error validating PDF:", error);
      return false;
    }
  }

  /**
   * @description Get PDF metadata without full text extraction
   * @param {Buffer} pdfBuffer - PDF file buffer
   * @returns {Promise<Object>} PDF metadata
   */
  async getPDFMetadata(pdfBuffer) {
    try {
      const options = {
        pagerender: () => "", // Don't render pages for metadata only
        max: 1, // Only process first page for metadata
      };

      const data = await pdfParse(pdfBuffer, options);

      return {
        totalPages: data.numpages,
        version: data.version,
        info: {
          title: data.info?.Title || "",
          author: data.info?.Author || "",
          subject: data.info?.Subject || "",
          creator: data.info?.Creator || "",
          producer: data.info?.Producer || "",
          creationDate: data.info?.CreationDate || null,
          modificationDate: data.info?.ModDate || null,
        },
      };
    } catch (error) {
      console.error("PDFService: Error getting PDF metadata:", error);
      throw error;
    }
  }

  /**
   * @description Check if PDF is password protected
   * @param {Buffer} pdfBuffer - PDF file buffer
   * @returns {Promise<boolean>} True if password protected
   */
  async isPasswordProtected(pdfBuffer) {
    try {
      await pdfParse(pdfBuffer, { max: 1 });
      return false; // If parsing succeeds, it's not password protected
    } catch (error) {
      if (error.message && error.message.includes("password")) {
        return true;
      }
      throw error; // Re-throw if it's a different error
    }
  }

  /**
   * @description Get supported file extensions
   * @returns {Array<string>} Array of supported extensions
   */
  getSupportedExtensions() {
    return [".pdf"];
  }

  /**
   * @description Get maximum file size limit (in bytes)
   * @returns {number} Maximum file size in bytes (50MB)
   */
  getMaxFileSize() {
    return 50 * 1024 * 1024; // 50MB
  }
}

module.exports = PDFService;
