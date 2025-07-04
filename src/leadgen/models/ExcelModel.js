const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

/**
 * @description Excel model for managing Excel document and row data
 * @class ExcelModel
 */
class ExcelModel {
  constructor() {
    this.prisma = prisma;
  }

  /**
   * @description Create a new Excel document
   * @param {Object} data - Document data
   * @param {string} data.fileName - Original file name
   * @param {string} data.fileKey - S3 file key
   * @param {string} data.status - Processing status
   * @param {number} data.progress - Processing progress (0-100)
   * @returns {Promise<Object>} Created document
   */
  async createDocument(data) {
    try {
      return await this.prisma.excelDocument.create({
        data: {
          fileName: data.fileName,
          fileKey: data.fileKey,
          s3Url: data.s3Url,
          status: data.status,
          progress: data.progress,
          error: data.error,
        },
      });
    } catch (error) {
      console.error("ExcelModel: Error creating document:", error);
      throw error;
    }
  }

  /**
   * @description Update an Excel document
   * @param {string} id - Document ID
   * @param {Object} data - Update data
   * @returns {Promise<Object>} Updated document
   */
  async updateDocument(id, data) {
    try {
      return await this.prisma.excelDocument.update({
        where: { id },
        data,
      });
    } catch (error) {
      console.error("ExcelModel: Error updating document:", error);
      throw error;
    }
  }

  /**
   * @description Create Excel rows with embeddings
   * @param {string} documentId - Document ID
   * @param {Array<Object>} rows - Array of row data
   * @returns {Promise<Array>} Created rows
   */
  async createRows(documentId, rows) {
    try {
      return await this.prisma.excelRow.createMany({
        data: rows.map((row) => ({
          documentId,
          content: row.content,
          embedding: row.embedding,
          rowData: row.rowData,
          rowIndex: row.rowIndex,
          metadata: row.metadata,
        })),
      });
    } catch (error) {
      console.error("ExcelModel: Error creating rows:", error);
      throw error;
    }
  }

  /**
   * @description Search Excel rows by content similarity
   * @param {string} query - Search query
   * @param {number} limit - Maximum number of results
   * @returns {Promise<Array>} Matching rows
   */
  async searchRows(query, limit = 10) {
    try {
      // First, get the embedding for the search query
      const embedding = await this.generateEmbedding(query);

      // Then search using cosine similarity
      return await this.prisma.$queryRaw`
        SELECT 
          r.*,
          1 - (r.embedding <=> ${embedding}::vector) as similarity
        FROM "ExcelRow" r
        WHERE 1 - (r.embedding <=> ${embedding}::vector) > 0.7
        ORDER BY similarity DESC
        LIMIT ${limit}
      `;
    } catch (error) {
      console.error("ExcelModel: Error searching rows:", error);
      throw error;
    }
  }

  /**
   * @description Get all Excel documents
   * @returns {Promise<Array>} List of documents
   */
  async getAllDocuments() {
    try {
      return await this.prisma.excelDocument.findMany({
        orderBy: { createdAt: "desc" },
      });
    } catch (error) {
      console.error("ExcelModel: Error getting documents:", error);
      throw error;
    }
  }

  /**
   * @description Get a single Excel document by ID
   * @param {string} id - Document ID
   * @returns {Promise<Object>} Document data
   */
  async getDocument(id) {
    try {
      return await this.prisma.excelDocument.findUnique({
        where: { id },
      });
    } catch (error) {
      console.error("ExcelModel: Error getting document:", error);
      throw error;
    }
  }

  /**
   * @description Delete an Excel document and its rows
   * @param {string} id - Document ID
   * @returns {Promise<Object>} Deleted document
   */
  async deleteDocument(id) {
    try {
      // Delete all rows first
      await this.prisma.excelRow.deleteMany({
        where: { documentId: id },
      });

      // Then delete the document
      return await this.prisma.excelDocument.delete({
        where: { id },
      });
    } catch (error) {
      console.error("ExcelModel: Error deleting document:", error);
      throw error;
    }
  }

  /**
   * @description Search rows using vector similarity across all documents
   * @param {Array<number>} embedding - Query embedding vector
   * @param {string} fileKey - Optional file key to filter by specific document
   * @param {number} limit - Maximum number of results
   * @param {number} minScore - Minimum similarity score (0-1)
   * @returns {Promise<Array>} Similar rows with scores
   */
  async vectorSearch(embedding, fileKey = null, limit = 5, minScore = 0.2) {
    try {
      // Get all rows with their document info
      const whereClause = fileKey ? { document: { fileKey } } : {};

      const rows = await this.prisma.excelRow.findMany({
        where: whereClause,
        include: {
          document: {
            select: {
              fileName: true,
              fileKey: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: limit * 10, // Get more rows to filter from
      });

      // Calculate cosine similarity for each row
      const results = rows
        .map((row) => {
          const similarity = this.calculateCosineSimilarity(
            embedding,
            row.embedding
          );
          return {
            ...row,
            score: similarity,
            embedding: undefined, // Don't send embeddings to client
          };
        })
        .filter((row) => row.score > minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      return results;
    } catch (error) {
      console.error("ExcelModel: Error in vector search:", error);
      throw error;
    }
  }

  /**
   * @description Calculate cosine similarity between two vectors
   * @param {Array<number>} vecA - First vector
   * @param {Array<number>} vecB - Second vector
   * @returns {number} Cosine similarity score (0-1)
   */
  calculateCosineSimilarity(vecA, vecB) {
    try {
      if (!Array.isArray(vecA) || !Array.isArray(vecB)) {
        return 0;
      }

      if (vecA.length !== vecB.length) {
        return 0;
      }

      let dotProduct = 0;
      let normA = 0;
      let normB = 0;

      for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
      }

      if (normA === 0 || normB === 0) {
        return 0;
      }

      return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    } catch (error) {
      console.error("ExcelModel: Error calculating cosine similarity:", error);
      return 0;
    }
  }

  /**
   * @description Get document status and progress
   * @param {string} id - Document ID
   * @returns {Promise<Object>} Document status info
   */
  async getDocumentStatus(id) {
    try {
      const doc = await this.prisma.excelDocument.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          progress: true,
          error: true,
          fileName: true,
          s3Url: true,
        },
      });
      return doc;
    } catch (error) {
      console.error("ExcelModel: Error getting document status:", error);
      throw error;
    }
  }
}

module.exports = ExcelModel;
