const { MongoClient } = require("mongodb");

/**
 * @description Document model for storing PDF metadata and embeddings
 * @class DocumentModel
 */
class DocumentModel {
  constructor() {
    this.client = null;
    this.db = null;
    this.collection = null;
  }

  /**
   * @description Initialize database connection
   * @returns {Promise<void>}
   */
  async connect() {
    try {
      this.client = new MongoClient(process.env.DATABASE_URL);
      await this.client.connect();
      this.db = this.client.db("Partners");
      this.collection = this.db.collection("documents");

      // Create indexes for better performance
      await this.collection.createIndex({ walletId: 1 });
      await this.collection.createIndex({ documentId: 1 });
      await this.collection.createIndex({
        "embeddings.metadata.pageNumber": 1,
      });

      console.log("DocumentModel: Connected to MongoDB");
    } catch (error) {
      console.error("DocumentModel: Connection error:", error);
      throw error;
    }
  }

  /**
   * @description Store document with embeddings
   * @param {Object} documentData - Document data to store
   * @returns {Promise<Object>} Inserted document
   */
  async storeDocument(documentData) {
    try {
      const document = {
        documentId: documentData.documentId,
        walletId: documentData.walletId,
        fileName: documentData.fileName,
        s3Key: documentData.s3Key,
        s3Url: documentData.s3Url,
        fileSize: documentData.fileSize,
        mimeType: documentData.mimeType,
        embeddings: documentData.embeddings || [],
        metadata: {
          totalPages: documentData.totalPages || 0,
          totalChunks: documentData.embeddings?.length || 0,
          extractedText: documentData.extractedText || "",
          uploadedAt: new Date(),
          lastChatAt: null,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await this.collection.insertOne(document);
      return { ...document, _id: result.insertedId };
    } catch (error) {
      console.error("DocumentModel: Error storing document:", error);
      throw error;
    }
  }

  /**
   * @description Get documents by wallet ID
   * @param {string} walletId - User's wallet ID
   * @returns {Promise<Array>} Array of documents
   */
  async getDocumentsByWallet(walletId) {
    try {
      const documents = await this.collection
        .find({ walletId })
        .sort({ createdAt: -1 })
        .toArray();
      return documents;
    } catch (error) {
      console.error("DocumentModel: Error fetching documents:", error);
      throw error;
    }
  }

  /**
   * @description Get document by ID and wallet ID
   * @param {string} documentId - Document ID
   * @param {string} walletId - User's wallet ID
   * @returns {Promise<Object|null>} Document or null
   */
  async getDocument(documentId, walletId) {
    try {
      const document = await this.collection.findOne({
        documentId,
        walletId,
      });
      return document;
    } catch (error) {
      console.error("DocumentModel: Error fetching document:", error);
      throw error;
    }
  }

  /**
   * @description Search similar embeddings using vector similarity
   * @param {Array} queryEmbedding - Query embedding vector
   * @param {string} walletId - User's wallet ID
   * @param {string} documentId - Specific document ID (optional)
   * @param {number} limit - Number of results to return
   * @returns {Promise<Array>} Similar document chunks
   */
  async searchSimilarEmbeddings(
    queryEmbedding,
    walletId,
    documentId = null,
    limit = 5
  ) {
    try {
      const matchQuery = { walletId };
      if (documentId) {
        matchQuery.documentId = documentId;
      }

      // MongoDB vector search aggregation pipeline
      const pipeline = [
        { $match: matchQuery },
        { $unwind: "$embeddings" },
        {
          $addFields: {
            similarity: {
              $let: {
                vars: {
                  dotProduct: {
                    $sum: {
                      $map: {
                        input: {
                          $range: [0, { $size: "$embeddings.embedding" }],
                        },
                        as: "i",
                        in: {
                          $multiply: [
                            { $arrayElemAt: ["$embeddings.embedding", "$$i"] },
                            { $arrayElemAt: [queryEmbedding, "$$i"] },
                          ],
                        },
                      },
                    },
                  },
                },
                in: "$$dotProduct",
              },
            },
          },
        },
        { $sort: { similarity: -1 } },
        { $limit: limit },
        {
          $project: {
            documentId: 1,
            fileName: 1,
            text: "$embeddings.text",
            metadata: "$embeddings.metadata",
            similarity: 1,
          },
        },
      ];

      const results = await this.collection.aggregate(pipeline).toArray();
      return results;
    } catch (error) {
      console.error("DocumentModel: Error searching embeddings:", error);
      throw error;
    }
  }

  /**
   * @description Update last chat timestamp
   * @param {string} documentId - Document ID
   * @param {string} walletId - User's wallet ID
   * @returns {Promise<boolean>} Success status
   */
  async updateLastChatTime(documentId, walletId) {
    try {
      const result = await this.collection.updateOne(
        { documentId, walletId },
        {
          $set: {
            "metadata.lastChatAt": new Date(),
            updatedAt: new Date(),
          },
        }
      );
      return result.modifiedCount > 0;
    } catch (error) {
      console.error("DocumentModel: Error updating chat time:", error);
      throw error;
    }
  }

  /**
   * @description Delete document by ID and wallet ID
   * @param {string} documentId - Document ID
   * @param {string} walletId - User's wallet ID
   * @returns {Promise<boolean>} Success status
   */
  async deleteDocument(documentId, walletId) {
    try {
      const result = await this.collection.deleteOne({
        documentId,
        walletId,
      });
      return result.deletedCount > 0;
    } catch (error) {
      console.error("DocumentModel: Error deleting document:", error);
      throw error;
    }
  }

  /**
   * @description Close database connection
   * @returns {Promise<void>}
   */
  async close() {
    if (this.client) {
      await this.client.close();
      console.log("DocumentModel: Database connection closed");
    }
  }

  /**
   * @description Get document by ID only (without walletId requirement)
   * @param {string} documentId - Document ID
   * @returns {Promise<Object|null>} Document or null
   */
  async getDocumentById(documentId) {
    try {
      const document = await this.collection.findOne({
        documentId,
      });
      return document;
    } catch (error) {
      console.error("DocumentModel: Error fetching document by ID:", error);
      throw error;
    }
  }

  /**
   * @description Search similar embeddings by document only (without walletId requirement)
   * @param {Array} queryEmbedding - Query embedding vector
   * @param {string} documentId - Specific document ID
   * @param {number} limit - Number of results to return
   * @returns {Promise<Array>} Similar document chunks
   */
  async searchSimilarEmbeddingsByDocument(
    queryEmbedding,
    documentId,
    limit = 5
  ) {
    try {
      const matchQuery = { documentId };

      // MongoDB vector search aggregation pipeline
      const pipeline = [
        { $match: matchQuery },
        { $unwind: "$embeddings" },
        {
          $addFields: {
            similarity: {
              $let: {
                vars: {
                  dotProduct: {
                    $sum: {
                      $map: {
                        input: {
                          $range: [0, { $size: "$embeddings.embedding" }],
                        },
                        as: "i",
                        in: {
                          $multiply: [
                            { $arrayElemAt: ["$embeddings.embedding", "$$i"] },
                            { $arrayElemAt: [queryEmbedding, "$$i"] },
                          ],
                        },
                      },
                    },
                  },
                },
                in: "$$dotProduct",
              },
            },
          },
        },
        { $sort: { similarity: -1 } },
        { $limit: limit },
        {
          $project: {
            documentId: 1,
            fileName: 1,
            text: "$embeddings.text",
            metadata: "$embeddings.metadata",
            similarity: 1,
          },
        },
      ];

      const results = await this.collection.aggregate(pipeline).toArray();
      return results;
    } catch (error) {
      console.error(
        "DocumentModel: Error searching embeddings by document:",
        error
      );
      throw error;
    }
  }
}

module.exports = DocumentModel;
