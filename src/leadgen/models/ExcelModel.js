const { PrismaClient } = require("@prisma/client");
const _ = require("lodash");
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
      // DEBUG: Check for Ajmer data before saving
      console.log(`\n=== SAVING ${rows.length} ROWS TO DATABASE ===`);

      const ajmerRows = rows.filter((row) => {
        const content = row.content || "";
        const company = row.rowData?.Company || "";
        const city = row.rowData?.City || "";
        return (
          content.toLowerCase().includes("ajmer") ||
          company.toLowerCase().includes("gupta decoration") ||
          city.toLowerCase().includes("ajmer")
        );
      });

      console.log(`🎯 Found ${ajmerRows.length} Ajmer rows to save:`);
      ajmerRows.slice(0, 5).forEach((row, idx) => {
        const company = row.rowData?.Company || "Unknown";
        const name = row.rowData?.Name || "Unknown";
        const city = row.rowData?.City || "Unknown";
        console.log(`  [${idx + 1}] ${company} | ${name} | ${city}`);
        console.log(`      Content: ${row.content.substring(0, 200)}...`);
        console.log(`      Embedding dims: ${row.embedding?.length || 0}`);
      });

      const result = await this.prisma.excelRow.createMany({
        data: rows.map((row) => ({
          documentId,
          content: row.content,
          embedding: row.embedding,
          rowData: row.rowData,
          rowIndex: row.rowIndex,
          metadata: row.metadata,
        })),
      });

      console.log(`✅ Successfully saved ${result.count} rows to database`);
      console.log(`=== END DATABASE SAVE ===\n`);

      return result;
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
   * @description Get a single Excel document by fileKey
   * @param {string} fileKey - File key
   * @returns {Promise<Object>} Document data
   */
  async getDocumentByFileKey(fileKey) {
    try {
      return await this.prisma.excelDocument.findFirst({
        where: { fileKey },
      });
    } catch (error) {
      console.error("ExcelModel: Error getting document by fileKey:", error);
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
   * @description Optimized vector search using MongoDB Atlas Vector Search
   * @param {Array<number>} embedding - Query embedding vector
   * @param {string} fileKey - Optional file key to filter by specific document
   * @param {number} limit - Maximum number of results
   * @param {number} minScore - Minimum similarity score (0-1)
   * @returns {Promise<Array>} Similar rows with scores
   */
  async vectorSearchOptimized(
    embedding,
    fileKey = null,
    limit = 5,
    minScore = 0.2
  ) {
    try {
      console.log(`\n=== OPTIMIZED VECTOR SEARCH ===`);
      console.log(`FileKey filter: ${fileKey || "ALL FILES"}`);
      console.log(`Limit: ${limit}, MinScore: ${minScore}`);

      // Use MongoDB Atlas Vector Search if available, otherwise fallback to current method
      if (process.env.MONGODB_ATLAS_VECTOR_SEARCH === "true") {
        return await this.vectorSearchAtlas(
          embedding,
          fileKey,
          limit,
          minScore
        );
      } else {
        return await this.vectorSearchOptimizedInMemory(
          embedding,
          fileKey,
          limit,
          minScore
        );
      }
    } catch (error) {
      console.error("ExcelModel: Error in optimized vector search:", error);
      // Fallback to original method if optimization fails
      console.log("Falling back to original vector search method...");
      return await this.vectorSearch(embedding, fileKey, limit, minScore);
    }
  }

  /**
   * @description MongoDB Atlas Vector Search implementation
   * @param {Array<number>} embedding - Query embedding vector
   * @param {string} fileKey - Optional file key to filter by specific document
   * @param {number} limit - Maximum number of results
   * @param {number} minScore - Minimum similarity score (0-1)
   * @returns {Promise<Array>} Similar rows with scores
   */
  async vectorSearchAtlas(
    embedding,
    fileKey = null,
    limit = 5,
    minScore = 0.2
  ) {
    try {
      // Build the aggregation pipeline for Atlas Vector Search
      const pipeline = [
        {
          $vectorSearch: {
            index: "vector_search_index", // This needs to be created in Atlas
            path: "embedding",
            queryVector: embedding,
            numCandidates: Math.max(limit * 10, 100), // Search more candidates for better results
            limit: limit * 2, // Get more results to filter by minScore
          },
        },
        {
          $addFields: {
            score: { $meta: "vectorSearchScore" },
          },
        },
      ];

      // Add document filter if fileKey is specified
      if (fileKey) {
        pipeline.push({
          $lookup: {
            from: "ExcelDocument",
            localField: "documentId",
            foreignField: "_id",
            as: "document",
          },
        });
        pipeline.push({
          $match: {
            "document.fileKey": fileKey,
          },
        });
      } else {
        // Always include document info for response
        pipeline.push({
          $lookup: {
            from: "ExcelDocument",
            localField: "documentId",
            foreignField: "_id",
            as: "document",
          },
        });
      }

      // Filter by minimum score
      pipeline.push({
        $match: {
          score: { $gte: minScore },
        },
      });

      // Project the fields we need
      pipeline.push({
        $project: {
          content: 1,
          rowData: 1,
          rowIndex: 1,
          metadata: 1,
          score: 1,
          "document.fileName": 1,
          "document.fileKey": 1,
          createdAt: 1,
          updatedAt: 1,
        },
      });

      // Limit final results
      pipeline.push({
        $limit: limit,
      });

      console.log(
        `🚀 Using MongoDB Atlas Vector Search with ${pipeline.length} pipeline stages`
      );

      const startTime = Date.now();
      const results = await this.prisma.excelRow.aggregateRaw({
        pipeline: pipeline,
      });

      const searchTime = Date.now() - startTime;
      console.log(`⚡ Atlas Vector Search completed in ${searchTime}ms`);
      console.log(
        `📊 Found ${results.length} results above minScore ${minScore}`
      );

      // Transform results to match expected format
      const transformedResults = results.map((result) => ({
        id: result._id,
        documentId: result.documentId,
        content: result.content,
        rowData: result.rowData,
        rowIndex: result.rowIndex,
        metadata: result.metadata,
        score: result.score,
        document: result.document?.[0] || null,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
      }));

      console.log(`=== END OPTIMIZED ATLAS SEARCH ===\n`);
      return transformedResults;
    } catch (error) {
      console.error("ExcelModel: Error in Atlas vector search:", error);
      throw error;
    }
  }

  /**
   * @description Optimized in-memory vector search with database optimizations
   * @param {Array<number>} embedding - Query embedding vector
   * @param {string} fileKey - Optional file key to filter by specific document
   * @param {number} limit - Maximum number of results
   * @param {number} minScore - Minimum similarity score (0-1)
   * @returns {Promise<Array>} Similar rows with scores
   */
  async vectorSearchOptimizedInMemory(
    embedding,
    fileKey = null,
    limit = 5,
    minScore = 0.2
  ) {
    try {
      const startTime = Date.now();

      // Build optimized query with selective field loading
      const whereClause = fileKey ? { document: { fileKey } } : {};

      // Only load necessary fields to reduce memory usage
      const rows = await this.prisma.excelRow.findMany({
        where: whereClause,
        select: {
          id: true,
          documentId: true,
          content: true,
          embedding: true,
          rowData: true,
          rowIndex: true,
          metadata: true,
          createdAt: true,
          updatedAt: true,
          document: {
            select: {
              fileName: true,
              fileKey: true,
            },
          },
        },
        // Use database-level ordering to get more recent data first
        orderBy: { createdAt: "desc" },
        // Limit initial fetch to reduce memory usage
        take: Math.min(1000, limit * 50), // Reasonable upper bound
      });

      const fetchTime = Date.now() - startTime;
      console.log(`📊 Fetched ${rows.length} rows in ${fetchTime}ms`);

      if (rows.length === 0) {
        console.log(`❌ No rows found in database`);
        return [];
      }

      // Optimized similarity calculation with early termination
      const results = [];
      const similarityStartTime = Date.now();

      // Pre-calculate query vector norm for efficiency
      const queryNorm = Math.sqrt(
        embedding.reduce((sum, val) => sum + val * val, 0)
      );

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        // Validate and convert embedding
        let rowEmbedding = this.normalizeEmbedding(row.embedding);
        if (!rowEmbedding) continue;

        // Optimized cosine similarity calculation
        const similarity = this.calculateOptimizedCosineSimilarity(
          embedding,
          rowEmbedding,
          queryNorm
        );

        if (similarity > minScore) {
          results.push({
            ...row,
            score: similarity,
            embedding: undefined, // Don't send embeddings to client
          });

          // Early termination if we have enough high-quality results
          if (results.length >= limit * 3 && similarity > 0.8) {
            console.log(
              `⚡ Early termination at ${i + 1} rows with ${
                results.length
              } high-quality results`
            );
            break;
          }
        }
      }

      const similarityTime = Date.now() - similarityStartTime;
      console.log(`🔍 Similarity calculation completed in ${similarityTime}ms`);

      // Sort by similarity score (descending) and limit results
      results.sort((a, b) => b.score - a.score);
      const finalResults = results.slice(0, limit);

      const totalTime = Date.now() - startTime;
      console.log(
        `✅ Optimized search completed in ${totalTime}ms (${fetchTime}ms fetch + ${similarityTime}ms similarity)`
      );
      console.log(
        `📊 Final results: ${finalResults.length}/${results.length} results above minScore ${minScore}`
      );

      if (finalResults.length > 0) {
        console.log(`🏆 Top results:`);
        finalResults.slice(0, 3).forEach((result, idx) => {
          const company =
            result.rowData?.Company || result.rowData?.companyname || "Unknown";
          const city =
            result.rowData?.City || result.rowData?.city || "Unknown";
          console.log(
            `  [${idx + 1}] Score: ${result.score.toFixed(
              4
            )} - ${company} (${city})`
          );
        });
      }

      console.log(`=== END OPTIMIZED IN-MEMORY SEARCH ===\n`);
      return finalResults;
    } catch (error) {
      console.error(
        "ExcelModel: Error in optimized in-memory vector search:",
        error
      );
      throw error;
    }
  }

  /**
   * @description Normalize embedding from various storage formats
   * @param {*} embedding - Raw embedding data
   * @returns {Array<number>|null} Normalized embedding array or null if invalid
   */
  normalizeEmbedding(embedding) {
    if (!embedding) return null;

    if (Array.isArray(embedding)) {
      return embedding.every((val) => typeof val === "number")
        ? embedding
        : null;
    }

    if (typeof embedding === "object") {
      const keys = Object.keys(embedding);
      const isArrayLike = keys.every((key) => !isNaN(parseInt(key)));

      if (isArrayLike) {
        const converted = Object.values(embedding);
        return converted.every((val) => typeof val === "number")
          ? converted
          : null;
      }
    }

    return null;
  }

  /**
   * @description Optimized cosine similarity calculation with pre-computed query norm
   * @param {Array<number>} vecA - First vector
   * @param {Array<number>} vecB - Second vector
   * @param {number} normA - Pre-computed norm of vecA (optional)
   * @returns {number} Cosine similarity score (0-1)
   */
  calculateOptimizedCosineSimilarity(vecA, vecB, normA = null) {
    try {
      if (vecA.length !== vecB.length) return 0;

      let dotProduct = 0;
      let normBSquared = 0;

      // Single loop for both dot product and norm calculation
      for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normBSquared += vecB[i] * vecB[i];
      }

      const normAValue =
        normA || Math.sqrt(vecA.reduce((sum, val) => sum + val * val, 0));
      const normB = Math.sqrt(normBSquared);

      if (normAValue === 0 || normB === 0) return 0;

      const similarity = dotProduct / (normAValue * normB);

      // Normalize to 0-1 range
      return Math.max(0, Math.min(1, (similarity + 1) / 2));
    } catch (error) {
      return 0;
    }
  }

  /**
   * @description Legacy vector search method (kept for fallback)
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

      console.log(`\n=== VECTOR SEARCH ===`);
      console.log(`FileKey filter: ${fileKey || "ALL FILES"}`);
      console.log(`Limit: ${limit}, MinScore: ${minScore}`);

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

      // DEBUG: Check the structure of the first few rows
      console.log(`🔍 DATABASE STRUCTURE DEBUG:`);
      if (rows.length > 0) {
        const firstRow = rows[0];
        console.log(`  First row keys: ${Object.keys(firstRow).join(", ")}`);
        console.log(`  Embedding field type: ${typeof firstRow.embedding}`);
        console.log(
          `  Embedding is array: ${Array.isArray(firstRow.embedding)}`
        );
        console.log(
          `  Embedding length: ${firstRow.embedding?.length || "NULL"}`
        );

        if (firstRow.embedding && Array.isArray(firstRow.embedding)) {
          console.log(
            `  Embedding sample: [${firstRow.embedding
              .slice(0, 5)
              .join(", ")}...]`
          );
          console.log(
            `  Embedding data types: ${firstRow.embedding
              .slice(0, 5)
              .map((v) => typeof v)
              .join(", ")}`
          );
        } else {
          console.log(`  Embedding value: ${firstRow.embedding}`);
          console.log(
            `  Embedding JSON stringified: ${JSON.stringify(
              firstRow.embedding
            )}`
          );

          // Try to convert if it's a JSON object that should be an array
          if (firstRow.embedding && typeof firstRow.embedding === "object") {
            console.log(`  Attempting to convert embedding object to array...`);
            const keys = Object.keys(firstRow.embedding);
            console.log(
              `  Object keys sample: ${keys.slice(0, 10).join(", ")}`
            );

            // Check if it's an object with numeric keys (array-like)
            const isArrayLike = keys.every((key) => !isNaN(parseInt(key)));
            console.log(`  Is array-like object: ${isArrayLike}`);

            if (isArrayLike) {
              const convertedArray = Object.values(firstRow.embedding);
              console.log(`  Converted array length: ${convertedArray.length}`);
              console.log(
                `  Converted array sample: [${convertedArray
                  .slice(0, 5)
                  .join(", ")}...]`
              );
            }
          }
        }

        console.log(
          `  Content preview: ${(firstRow.content || "").substring(0, 100)}...`
        );
        console.log(
          `  RowData keys: ${Object.keys(firstRow.rowData || {}).join(", ")}`
        );
      } else {
        console.log(`  No rows found in database!`);
      }

      console.log(`📊 Retrieved ${rows.length} rows from database`);

      // DEBUG: Check for Ajmer data in retrieved rows
      const ajmerInDB = rows.filter((row) => {
        const content = row.content || "";
        const company = row.rowData?.Company || "";
        const city = row.rowData?.City || "";
        return (
          content.toLowerCase().includes("ajmer") ||
          company.toLowerCase().includes("gupta decoration") ||
          city.toLowerCase().includes("ajmer")
        );
      });

      console.log(`🎯 Found ${ajmerInDB.length} Ajmer records in database:`);
      if (ajmerInDB.length > 0) {
        ajmerInDB.slice(0, 3).forEach((row, idx) => {
          const company = row.rowData?.Company || "Unknown";
          const name = row.rowData?.Name || "Unknown";
          const city = row.rowData?.City || "Unknown";
          console.log(`  [${idx + 1}] DB Row: ${company} | ${name} | ${city}`);
          console.log(`      Content: ${row.content.substring(0, 200)}...`);
        });
      } else {
        console.log(`❌ NO AJMER DATA FOUND IN DATABASE!`);

        // Show sample of what IS in the database
        console.log(`📋 Sample of database content (first 3 rows):`);
        rows.slice(0, 3).forEach((row, idx) => {
          const company = row.rowData?.Company || "Unknown";
          const name = row.rowData?.Name || "Unknown";
          const city = row.rowData?.City || "Unknown";
          console.log(`  [${idx + 1}] ${company} | ${name} | ${city}`);
          console.log(`      Content: ${row.content.substring(0, 200)}...`);
        });
      }

      // Calculate cosine similarity for each row with detailed debugging
      console.log(`🔍 SIMILARITY CALCULATION DEBUG:`);
      console.log(`Query embedding length: ${embedding?.length || "NULL"}`);
      console.log(`Query embedding type: ${typeof embedding}`);
      console.log(
        `Query embedding sample: [${
          embedding?.slice(0, 5).join(", ") || "NULL"
        }...]`
      );

      const results = [];
      let validEmbeddingCount = 0;
      let nullEmbeddingCount = 0;
      let similarityScores = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        // Check if row has valid embedding and convert if necessary
        let rowEmbedding = row.embedding;

        if (!rowEmbedding) {
          nullEmbeddingCount++;
          if (i < 3) {
            console.log(
              `  Row ${i}: NULL embedding - ${
                row.rowData?.Company || "Unknown"
              }`
            );
          }
          continue;
        }

        // Convert object to array if needed (MongoDB JSON storage issue)
        if (!Array.isArray(rowEmbedding) && typeof rowEmbedding === "object") {
          const keys = Object.keys(rowEmbedding);
          const isArrayLike = keys.every((key) => !isNaN(parseInt(key)));

          if (isArrayLike) {
            rowEmbedding = Object.values(rowEmbedding);
            if (i < 3) {
              console.log(
                `  Row ${i}: Converted object to array (length: ${
                  rowEmbedding.length
                }) - ${row.rowData?.Company || "Unknown"}`
              );
            }
          } else {
            nullEmbeddingCount++;
            if (i < 3) {
              console.log(
                `  Row ${i}: Invalid embedding object - ${
                  row.rowData?.Company || "Unknown"
                }`
              );
            }
            continue;
          }
        } else if (!Array.isArray(rowEmbedding)) {
          nullEmbeddingCount++;
          if (i < 3) {
            console.log(
              `  Row ${i}: Invalid embedding type (${typeof rowEmbedding}) - ${
                row.rowData?.Company || "Unknown"
              }`
            );
          }
          continue;
        }

        validEmbeddingCount++;

        const similarity = this.calculateCosineSimilarity(
          embedding,
          rowEmbedding
        );
        similarityScores.push(similarity);

        if (i < 3) {
          console.log(
            `  Row ${i}: Similarity ${similarity.toFixed(4)} - ${
              row.rowData?.Company || "Unknown"
            }`
          );
          console.log(`    Row embedding length: ${rowEmbedding.length}`);
          console.log(
            `    Row embedding sample: [${rowEmbedding
              .slice(0, 5)
              .join(", ")}...]`
          );
        }

        if (similarity > minScore) {
          results.push({
            ...row,
            score: similarity,
            embedding: undefined, // Don't send embeddings to client
          });
        }
      }

      console.log(`📊 EMBEDDING STATISTICS:`);
      console.log(`  Total rows: ${rows.length}`);
      console.log(`  Valid embeddings: ${validEmbeddingCount}`);
      console.log(`  Null/Invalid embeddings: ${nullEmbeddingCount}`);
      console.log(
        `  Similarity scores range: ${Math.min(...similarityScores).toFixed(
          4
        )} - ${Math.max(...similarityScores).toFixed(4)}`
      );
      console.log(
        `  Average similarity: ${(
          similarityScores.reduce((a, b) => a + b, 0) / similarityScores.length
        ).toFixed(4)}`
      );
      console.log(
        `  Scores above minScore (${minScore}): ${
          similarityScores.filter((s) => s > minScore).length
        }`
      );

      // Sort by similarity score
      results.sort((a, b) => b.score - a.score);

      // Limit results
      const finalResults = results.slice(0, limit);

      console.log(
        `🎯 Final results: ${finalResults.length} rows after similarity filtering`
      );

      if (finalResults.length > 0) {
        console.log(`📋 Top results:`);
        finalResults.slice(0, 3).forEach((result, idx) => {
          const company = result.rowData?.Company || "Unknown";
          const city = result.rowData?.City || "Unknown";
          console.log(
            `  [${idx + 1}] Score: ${result.score.toFixed(
              4
            )} - ${company} (${city})`
          );
        });
      } else {
        console.log(`❌ NO RESULTS PASSED SIMILARITY THRESHOLD!`);
        console.log(
          `💡 Consider lowering minScore from ${minScore} to 0.0 for debugging`
        );
      }

      console.log(`=== END VECTOR SEARCH ===\n`);

      return finalResults;
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
      // Detailed validation and debugging
      if (!vecA || !vecB) {
        console.log(
          `❌ Cosine similarity: One or both vectors are null/undefined`
        );
        return 0;
      }

      if (!Array.isArray(vecA) || !Array.isArray(vecB)) {
        console.log(`❌ Cosine similarity: One or both inputs are not arrays`);
        console.log(
          `  vecA type: ${typeof vecA}, isArray: ${Array.isArray(vecA)}`
        );
        console.log(
          `  vecB type: ${typeof vecB}, isArray: ${Array.isArray(vecB)}`
        );
        return 0;
      }

      if (vecA.length !== vecB.length) {
        console.log(
          `❌ Cosine similarity: Vector length mismatch - ${vecA.length} vs ${vecB.length}`
        );
        return 0;
      }

      if (vecA.length === 0) {
        console.log(`❌ Cosine similarity: Empty vectors`);
        return 0;
      }

      let dotProduct = 0;
      let normA = 0;
      let normB = 0;

      // Check for non-numeric values
      for (let i = 0; i < vecA.length; i++) {
        if (typeof vecA[i] !== "number" || typeof vecB[i] !== "number") {
          console.log(`❌ Cosine similarity: Non-numeric values at index ${i}`);
          console.log(`  vecA[${i}]: ${vecA[i]} (${typeof vecA[i]})`);
          console.log(`  vecB[${i}]: ${vecB[i]} (${typeof vecB[i]})`);
          return 0;
        }

        if (isNaN(vecA[i]) || isNaN(vecB[i])) {
          console.log(`❌ Cosine similarity: NaN values at index ${i}`);
          return 0;
        }

        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
      }

      if (normA === 0 || normB === 0) {
        console.log(
          `❌ Cosine similarity: Zero norm - normA: ${normA}, normB: ${normB}`
        );
        return 0;
      }

      const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));

      // Validate result
      if (isNaN(similarity)) {
        console.log(`❌ Cosine similarity: Result is NaN`);
        console.log(
          `  dotProduct: ${dotProduct}, normA: ${normA}, normB: ${normB}`
        );
        return 0;
      }

      // Cosine similarity should be between -1 and 1, but we'll normalize to 0-1
      const normalizedSimilarity = Math.max(
        0,
        Math.min(1, (similarity + 1) / 2)
      );

      return normalizedSimilarity;
    } catch (error) {
      console.error("ExcelModel: Error calculating cosine similarity:", error);
      console.error("Error details:", error.stack);
      return 0;
    }
  }

  /**
   * @description Batch vector search for multiple embeddings (OPTIMIZED)
   * @param {Array<Array<number>>} embeddings - Array of query embedding vectors
   * @param {string} fileKey - Optional file key to filter by specific document
   * @param {number} limit - Maximum number of results per embedding
   * @param {number} minScore - Minimum similarity score (0-1)
   * @returns {Promise<Array<Array>>} Array of search results for each embedding
   */
  async batchVectorSearch(
    embeddings,
    fileKey = null,
    limit = 5,
    minScore = 0.2
  ) {
    try {
      console.log(`\n=== BATCH VECTOR SEARCH ===`);
      console.log(`Processing ${embeddings.length} embeddings in batch`);
      console.log(`FileKey filter: ${fileKey || "ALL FILES"}`);
      console.log(`Limit: ${limit}, MinScore: ${minScore}`);

      const startTime = Date.now();

      // For MongoDB Atlas Vector Search, we can potentially use $facet for true batch processing
      if (process.env.MONGODB_ATLAS_VECTOR_SEARCH === "true") {
        return await this.batchVectorSearchAtlas(
          embeddings,
          fileKey,
          limit,
          minScore
        );
      }

      // Optimized batch processing for in-memory calculation
      // Load data once and reuse for all embeddings
      const whereClause = fileKey ? { document: { fileKey } } : {};

      const rows = await this.prisma.excelRow.findMany({
        where: whereClause,
        select: {
          id: true,
          documentId: true,
          content: true,
          embedding: true,
          rowData: true,
          rowIndex: true,
          metadata: true,
          createdAt: true,
          updatedAt: true,
          document: {
            select: {
              fileName: true,
              fileKey: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: Math.min(1000, limit * 50),
      });

      const fetchTime = Date.now() - startTime;
      console.log(
        `📊 Fetched ${rows.length} rows once for batch processing in ${fetchTime}ms`
      );

      // Pre-process embeddings and normalize row embeddings once
      const normalizedRows = rows
        .map((row) => ({
          ...row,
          normalizedEmbedding: this.normalizeEmbedding(row.embedding),
          embedding: undefined, // Remove original to save memory
        }))
        .filter((row) => row.normalizedEmbedding !== null);

      console.log(
        `🔧 Normalized ${normalizedRows.length}/${rows.length} row embeddings`
      );

      // Process each query embedding
      const batchResults = [];
      const processingStartTime = Date.now();

      for (let embIndex = 0; embIndex < embeddings.length; embIndex++) {
        const queryEmbedding = embeddings[embIndex];
        const queryNorm = Math.sqrt(
          queryEmbedding.reduce((sum, val) => sum + val * val, 0)
        );

        const results = [];

        for (const row of normalizedRows) {
          const similarity = this.calculateOptimizedCosineSimilarity(
            queryEmbedding,
            row.normalizedEmbedding,
            queryNorm
          );

          if (similarity > minScore) {
            results.push({
              ...row,
              score: similarity,
              normalizedEmbedding: undefined, // Remove to save memory
            });
          }
        }

        // Sort and limit results for this embedding
        results.sort((a, b) => b.score - a.score);
        batchResults.push(results.slice(0, limit));
      }

      const processingTime = Date.now() - processingStartTime;
      const totalTime = Date.now() - startTime;

      console.log(`⚡ Batch processing completed in ${processingTime}ms`);
      console.log(
        `✅ Total batch search time: ${totalTime}ms (${fetchTime}ms fetch + ${processingTime}ms processing)`
      );
      console.log(
        `📊 Results per embedding: ${batchResults
          .map((r) => r.length)
          .join(", ")}`
      );
      console.log(
        `🚀 Performance gain: ~${
          Math.round(
            ((embeddings.length * fetchTime - totalTime) / 1000) * 100
          ) / 100
        }s saved vs individual searches`
      );
      console.log(`=== END BATCH VECTOR SEARCH ===\n`);

      return batchResults;
    } catch (error) {
      console.error("ExcelModel: Error in batch vector search:", error);
      throw error;
    }
  }

  /**
   * @description MongoDB Atlas batch vector search using $facet
   * @param {Array<Array<number>>} embeddings - Array of query embedding vectors
   * @param {string} fileKey - Optional file key to filter by specific document
   * @param {number} limit - Maximum number of results per embedding
   * @param {number} minScore - Minimum similarity score (0-1)
   * @returns {Promise<Array<Array>>} Array of search results for each embedding
   */
  async batchVectorSearchAtlas(
    embeddings,
    fileKey = null,
    limit = 5,
    minScore = 0.2
  ) {
    try {
      console.log(`🚀 Using MongoDB Atlas Batch Vector Search with $facet`);

      // Build facet stages for each embedding
      const facetStages = {};

      embeddings.forEach((embedding, index) => {
        facetStages[`search_${index}`] = [
          {
            $vectorSearch: {
              index: "vector_search_index",
              path: "embedding",
              queryVector: embedding,
              numCandidates: Math.max(limit * 10, 100),
              limit: limit * 2,
            },
          },
          {
            $addFields: {
              score: { $meta: "vectorSearchScore" },
            },
          },
          {
            $match: {
              score: { $gte: minScore },
            },
          },
          {
            $limit: limit,
          },
        ];
      });

      const pipeline = [
        {
          $facet: facetStages,
        },
      ];

      // Add document lookup if needed
      if (fileKey) {
        // This is more complex with $facet, so we'll fall back to individual searches
        console.log(
          `⚠️  FileKey filtering with Atlas batch search not yet optimized, using individual searches`
        );
        const results = [];
        for (const embedding of embeddings) {
          const result = await this.vectorSearchAtlas(
            embedding,
            fileKey,
            limit,
            minScore
          );
          results.push(result);
        }
        return results;
      }

      const startTime = Date.now();
      const results = await this.prisma.excelRow.aggregateRaw({
        pipeline: pipeline,
      });

      const searchTime = Date.now() - startTime;
      console.log(`⚡ Atlas Batch Vector Search completed in ${searchTime}ms`);

      // Transform results
      const batchResults = [];
      for (let i = 0; i < embeddings.length; i++) {
        const searchResults = results[0][`search_${i}`] || [];
        const transformedResults = searchResults.map((result) => ({
          id: result._id,
          documentId: result.documentId,
          content: result.content,
          rowData: result.rowData,
          rowIndex: result.rowIndex,
          metadata: result.metadata,
          score: result.score,
          createdAt: result.createdAt,
          updatedAt: result.updatedAt,
        }));
        batchResults.push(transformedResults);
      }

      console.log(
        `📊 Atlas batch results: ${batchResults
          .map((r) => r.length)
          .join(", ")}`
      );
      return batchResults;
    } catch (error) {
      console.error("ExcelModel: Error in Atlas batch vector search:", error);
      throw error;
    }
  }

  /**
   * @description Create database indexes for better performance
   * @returns {Promise<void>}
   */
  async createOptimizedIndexes() {
    try {
      console.log("🔧 Creating optimized database indexes...");

      // Note: These would need to be created manually in MongoDB Atlas
      // or through a migration script

      const indexCommands = [
        // Compound index for document filtering and date sorting
        'db.ExcelRow.createIndex({ "documentId": 1, "createdAt": -1 })',

        // Text index for content search (if needed)
        'db.ExcelRow.createIndex({ "content": "text" })',

        // Vector search index (Atlas only)
        'db.ExcelRow.createIndex({ "embedding": "vector" }, { name: "vector_search_index", vectorSearchOptions: { numDimensions: 1536 } })',

        // Compound index for rowData fields (adjust based on your data structure)
        'db.ExcelRow.createIndex({ "rowData.Company": 1, "rowData.City": 1 })',
        'db.ExcelRow.createIndex({ "rowData.companyname": 1, "rowData.city": 1 })',
      ];

      console.log("📋 Recommended MongoDB indexes to create manually:");
      indexCommands.forEach((cmd, index) => {
        console.log(`  ${index + 1}. ${cmd}`);
      });

      console.log(
        "💡 Run these commands in MongoDB Atlas or your MongoDB shell for optimal performance"
      );
    } catch (error) {
      console.error("ExcelModel: Error creating indexes:", error);
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

  /**
   * @description Get distinct categories from all Excel data
   * @returns {Promise<Array>} Array of unique categories
   */
  async getDistinctCategories() {
    try {
      console.log("ExcelModel: Getting distinct categories from embeddings...");

      // Use MongoDB aggregation to get distinct values from rowData
      const categories = await this.prisma.excelRow.aggregateRaw({
        pipeline: [
          {
            $match: {
              rowData: { $exists: true, $ne: null },
            },
          },
          {
            $project: {
              categories: {
                $objectToArray: "$rowData",
              },
            },
          },
          {
            $unwind: "$categories",
          },
          {
            $match: {
              $or: [
                {
                  "categories.k": {
                    $regex: "category|categories|type|industry|sector|domain",
                    $options: "i",
                  },
                },
              ],
            },
          },
          {
            $group: {
              _id: null,
              values: { $addToSet: "$categories.v" },
            },
          },
          {
            $project: {
              _id: 0,
              values: {
                $filter: {
                  input: "$values",
                  cond: {
                    $and: [
                      { $ne: ["$$this", ""] },
                      { $ne: ["$$this", null] },
                      { $eq: [{ $type: "$$this" }, "string"] },
                      { $gt: [{ $strLenCP: "$$this" }, 2] },
                    ],
                  },
                },
              },
            },
          },
        ],
      });

      const result = categories[0]?.values || [];
      console.log(`ExcelModel: Found ${result.length} distinct categories`);
      return result.slice(0, 20); // Limit to top 20 categories
    } catch (error) {
      console.error("ExcelModel: Error getting distinct categories:", error);
      return [];
    }
  }

  /**
   * @description Get distinct subcategories from all Excel data
   * @returns {Promise<Array>} Array of unique subcategories
   */
  async getDistinctSubcategories() {
    try {
      console.log(
        "ExcelModel: Getting distinct subcategories from embeddings..."
      );

      // Since the current dataset doesn't have explicit subcategory fields,
      // we'll extract potential subcategories from the category field by looking for patterns
      const subcategories = await this.prisma.excelRow.aggregateRaw({
        pipeline: [
          {
            $match: {
              "rowData.Category": {
                $exists: true,
                $ne: null,
                $ne: "NULL",
                $ne: "",
              },
            },
          },
          {
            $project: {
              category: "$rowData.Category",
              // Extract words after common delimiters that might indicate subcategories
              subcategoryParts: {
                $split: ["$rowData.Category", "-"],
              },
            },
          },
          {
            $unwind: "$subcategoryParts",
          },
          {
            $match: {
              $and: [
                { subcategoryParts: { $ne: "" } },
                {
                  subcategoryParts: {
                    $not: { $regex: "^(Computer|Apparel)$", $options: "i" },
                  },
                },
              ],
            },
          },
          {
            $group: {
              _id: null,
              values: { $addToSet: "$subcategoryParts" },
            },
          },
          {
            $project: {
              _id: 0,
              values: {
                $filter: {
                  input: "$values",
                  cond: {
                    $and: [
                      { $ne: ["$$this", ""] },
                      { $ne: ["$$this", null] },
                      { $eq: [{ $type: "$$this" }, "string"] },
                      { $gt: [{ $strLenCP: "$$this" }, 3] },
                    ],
                  },
                },
              },
            },
          },
        ],
      });

      const result = subcategories[0]?.values || [];
      console.log(`ExcelModel: Found ${result.length} distinct subcategories`);
      return result.slice(0, 20); // Limit to top 20 subcategories
    } catch (error) {
      console.error("ExcelModel: Error getting distinct subcategories:", error);
      return [];
    }
  }

  /**
   * @description Get distinct locations from all Excel data
   * @returns {Promise<Array>} Array of unique locations
   */
  async getDistinctLocations() {
    try {
      console.log("ExcelModel: Getting distinct locations from embeddings...");

      const locations = await this.prisma.excelRow.aggregateRaw({
        pipeline: [
          {
            $match: {
              rowData: { $exists: true, $ne: null },
            },
          },
          {
            $project: {
              locations: {
                $objectToArray: "$rowData",
              },
            },
          },
          {
            $unwind: "$locations",
          },
          {
            $match: {
              $or: [
                {
                  "locations.k": {
                    $regex: "city|cities|location|locations|place",
                    $options: "i",
                  },
                },
                {
                  "locations.k": {
                    $regex: "state|states|region|regions|area",
                    $options: "i",
                  },
                },
                {
                  "locations.k": {
                    $regex: "country|countries|nation|address",
                    $options: "i",
                  },
                },
                {
                  "locations.k": {
                    $regex: "district|zone|territory",
                    $options: "i",
                  },
                },
              ],
            },
          },
          {
            $group: {
              _id: null,
              values: { $addToSet: "$locations.v" },
            },
          },
          {
            $project: {
              _id: 0,
              values: {
                $filter: {
                  input: "$values",
                  cond: {
                    $and: [
                      { $ne: ["$$this", ""] },
                      { $ne: ["$$this", null] },
                      { $ne: ["$$this", "NULL"] },
                      { $eq: [{ $type: "$$this" }, "string"] },
                      { $gt: [{ $strLenCP: "$$this" }, 2] },
                    ],
                  },
                },
              },
            },
          },
        ],
      });

      const result = locations[0]?.values || [];
      console.log(`ExcelModel: Found ${result.length} distinct locations`);
      return result.slice(0, 30); // Limit to top 30 locations
    } catch (error) {
      console.error("ExcelModel: Error getting distinct locations:", error);
      return [];
    }
  }

  /**
   * @description Get category-subcategory relationships as key-value pairs
   * @returns {Promise<Object>} Object with categories as keys and subcategories as values
   */
  async getCategorySubcategoryMap() {
    try {
      console.log("ExcelModel: Getting category-subcategory relationships...");

      const categoryMap = await this.prisma.excelRow.aggregateRaw({
        pipeline: [
          {
            $match: {
              "rowData.Category": {
                $exists: true,
                $ne: null,
                $ne: "NULL",
                $ne: "",
              },
            },
          },
          {
            $project: {
              originalCategory: "$rowData.Category",
              categoryParts: {
                $split: ["$rowData.Category", "-"],
              },
            },
          },
          {
            $project: {
              originalCategory: 1,
              mainCategory: { $arrayElemAt: ["$categoryParts", 0] },
              subcategory: {
                $cond: {
                  if: { $gt: [{ $size: "$categoryParts" }, 1] },
                  then: { $arrayElemAt: ["$categoryParts", 1] },
                  else: null,
                },
              },
            },
          },
          {
            $match: {
              subcategory: { $ne: null, $ne: "" },
            },
          },
          {
            $group: {
              _id: "$mainCategory",
              subcategories: { $addToSet: "$subcategory" },
              categories: { $addToSet: "$originalCategory" },
            },
          },
          {
            $project: {
              _id: 0,
              mainCategory: "$_id",
              subcategories: {
                $filter: {
                  input: "$subcategories",
                  cond: {
                    $and: [
                      { $ne: ["$$this", ""] },
                      { $ne: ["$$this", null] },
                      { $eq: [{ $type: "$$this" }, "string"] },
                      { $gt: [{ $strLenCP: "$$this" }, 2] },
                    ],
                  },
                },
              },
              categories: "$categories",
            },
          },
        ],
      });

      // Convert array result to object
      const result = {};
      categoryMap.forEach((item) => {
        const mainCat = item.mainCategory?.trim();
        if (mainCat && item.subcategories.length > 0) {
          result[mainCat] = item.subcategories.map((sub) => sub.trim()).sort();
        }
      });

      console.log(
        `ExcelModel: Found ${
          Object.keys(result).length
        } main categories with subcategories`
      );
      return result;
    } catch (error) {
      console.error(
        "ExcelModel: Error getting category-subcategory map:",
        error
      );
      return {};
    }
  }

  /**
   * @description Get hierarchically structured filter options with categories, subcategories, and locations
   * @returns {Promise<Object>} Object with categories as keys, containing subcategories with locations
   */
  async getDistinctFilterOptions() {
    try {
      console.log("ExcelModel: Getting hierarchical filter options...");

      // Get all data we need with better category grouping
      const result = await this.prisma.excelRow.aggregateRaw({
        pipeline: [
          {
            $match: {
              "rowData.Category": {
                $exists: true,
                $ne: null,
                $ne: "NULL",
                $ne: "",
              },
              "rowData.City": {
                $exists: true,
                $ne: null,
                $ne: "NULL",
                $ne: "",
              },
            },
          },
          {
            $project: {
              originalCategory: "$rowData.Category",
              city: "$rowData.City",
              // Create main category by extracting key words
              mainCategory: {
                $cond: {
                  if: {
                    $regexMatch: {
                      input: "$rowData.Category",
                      regex: "Apparel|Clothing|Garment",
                      options: "i",
                    },
                  },
                  then: "Apparel & Clothing",
                  else: {
                    $cond: {
                      if: {
                        $regexMatch: {
                          input: "$rowData.Category",
                          regex: "Computer|Software|Hardware|IT",
                          options: "i",
                        },
                      },
                      then: "Computer & Technology",
                      else: {
                        $cond: {
                          if: {
                            $regexMatch: {
                              input: "$rowData.Category",
                              regex: "Export|Import|Trading",
                              options: "i",
                            },
                          },
                          then: "Trading & Export",
                          else: {
                            $cond: {
                              if: {
                                $regexMatch: {
                                  input: "$rowData.Category",
                                  regex: "Manufacturing|Industrial|Production",
                                  options: "i",
                                },
                              },
                              then: "Manufacturing & Industrial",
                              else: "Other Business Services",
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          {
            $group: {
              _id: {
                mainCategory: "$mainCategory",
                subcategory: "$originalCategory",
              },
              locations: { $addToSet: "$city" },
            },
          },
          {
            $group: {
              _id: "$_id.mainCategory",
              subcategories: {
                $push: {
                  name: "$_id.subcategory",
                  locations: "$locations",
                },
              },
            },
          },
          {
            $project: {
              _id: 0,
              category: "$_id",
              subcategories: {
                $slice: [
                  {
                    $map: {
                      input: "$subcategories",
                      as: "sub",
                      in: {
                        name: "$$sub.name",
                        locations: { $slice: ["$$sub.locations", 4] },
                      },
                    },
                  },
                  4,
                ],
              },
            },
          },
        ],
      });

      // Structure the data as requested - only include categories with at least 2 subcategories
      const structuredData = {};

      result.forEach((categoryGroup) => {
        const categoryName = categoryGroup.category?.trim();
        if (categoryName) {
          const tempCategoryData = {};

          categoryGroup.subcategories.forEach((subcat) => {
            const subcategoryName = subcat.name?.trim();
            if (subcategoryName && subcategoryName !== categoryName) {
              const filteredLocations = subcat.locations
                .filter((loc) => loc && loc.trim() !== "" && loc !== "NULL")
                .slice(0, 4);

              // Only include subcategories that have at least 1 location
              if (filteredLocations.length > 0) {
                tempCategoryData[subcategoryName] = filteredLocations;
              }
            }
          });

          // Only include categories that have at least 2 subcategories with locations
          if (Object.keys(tempCategoryData).length >= 2) {
            structuredData[categoryName] = tempCategoryData;
          }
        }
      });

      console.log(
        `ExcelModel: Structured ${
          Object.keys(structuredData).length
        } categories with at least 2 subcategories and locations`
      );
      return structuredData;
    } catch (error) {
      console.error(
        "ExcelModel: Error getting hierarchical filter options:",
        error
      );
      throw error;
    }
  }

  /**
   * @description Find rows by exact category and subcategory matches
   * @param {Array<string>} categories - Categories to match
   * @param {Array<string>} subcategories - Subcategories to match (optional)
   * @param {string} location - Location to match (optional)
   * @returns {Promise<Array>} Matching rows
   */
  async findRowsByCategories(categories, subcategories = [], location = null) {
    try {
      console.log(
        `🔍 ExcelModel: Searching for categories: [${categories.join(
          ", "
        )}], subcategories: [${subcategories.join(
          ", "
        )}], location: ${location}`
      );

      // Build the filter query
      let filter = {};

      if (categories.length > 0) {
        // Create regex patterns for case-insensitive matching
        const categoryRegexes = categories.map(
          (cat) => new RegExp(cat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
        );
        filter["rowData.Category"] = { $in: categoryRegexes };
      }

      // If subcategories are provided, add them to the filter
      if (subcategories.length > 0) {
        const subcategoryRegexes = subcategories.map(
          (subcat) =>
            new RegExp(subcat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
        );

        // Category should contain subcategory terms
        filter["rowData.Category"] = {
          $in: [
            ...(filter["rowData.Category"]?.$in || []),
            ...subcategoryRegexes,
          ],
        };
      }

      // Add location filter if provided
      if (location) {
        const locationRegex = new RegExp(
          location.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          "i"
        );
        filter["rowData.City"] = locationRegex;
      }

      console.log(
        `📊 ExcelModel: Filter query:`,
        JSON.stringify(filter, null, 2)
      );

      const rows = await this.prisma.excelRow.findMany({
        where: filter,
        orderBy: {
          createdAt: "desc",
        },
      });

      console.log(
        `✅ ExcelModel: Found ${rows.length} rows matching categories`
      );

      // Log sample results for debugging
      if (rows.length > 0) {
        const sample = rows.slice(0, 3);
        console.log(`📝 Sample results:`);
        sample.forEach((row, i) => {
          const company = row.rowData?.Company || "Unknown";
          const category = row.rowData?.Category || "Unknown";
          const city = row.rowData?.City || "Unknown";
          console.log(`  [${i + 1}] ${company} | ${category} | ${city}`);
        });
      }

      return rows;
    } catch (error) {
      console.error("ExcelModel: Error finding rows by categories:", error);
      throw error;
    }
  }

  /**
   * @description Find rows by fuzzy category matching
   * @param {string} category - Main category
   * @param {string} subcategory - Subcategory
   * @param {string} location - Location (optional)
   * @returns {Promise<Array>} Matching rows
   */
  async findRowsByCategoryFuzzy(category, subcategory, location = null) {
    try {
      console.log(
        `🔍 ExcelModel: Fuzzy search for category: ${category}, subcategory: ${subcategory}, location: ${location}`
      );

      // Create flexible regex patterns
      const categoryTerms = category
        .toLowerCase()
        .split(/[\s&-]+/)
        .filter((term) => term.length > 2);
      const subcategoryTerms = subcategory
        .toLowerCase()
        .split(/[\s&-]+/)
        .filter((term) => term.length > 2);

      console.log(`📝 Category terms: [${categoryTerms.join(", ")}]`);
      console.log(`📝 Subcategory terms: [${subcategoryTerms.join(", ")}]`);

      // Build fuzzy matching patterns
      const allTerms = [...categoryTerms, ...subcategoryTerms];
      const fuzzyPatterns = allTerms.map(
        (term) => new RegExp(_.escapeRegExp(term), "i")
      );

      let filter = {
        $or: [
          { "rowData.Category": { $in: fuzzyPatterns } },
          { content: { $in: fuzzyPatterns } },
        ],
      };

      // Add location filter if provided
      if (location) {
        const locationRegex = new RegExp(
          location.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          "i"
        );
        filter["rowData.City"] = locationRegex;
      }

      console.log(
        `📊 ExcelModel: Fuzzy filter query:`,
        JSON.stringify(filter, null, 2)
      );

      const rows = await this.prisma.excelRow.findMany({
        where: filter,
        orderBy: {
          createdAt: "desc",
        },
      });

      console.log(`✅ ExcelModel: Fuzzy search found ${rows.length} rows`);

      return rows;
    } catch (error) {
      console.error("ExcelModel: Error in fuzzy category search:", error);
      throw error;
    }
  }

  /**
   * @description Get all unique categories from the database
   * @returns {Promise<Array>} Array of unique categories
   */
  async getUniqueCategories() {
    try {
      const rows = await this.prisma.excelRow.findMany({
        select: {
          rowData: true,
        },
      });

      const categories = new Set();
      rows.forEach((row) => {
        const category = row.rowData?.Category;
        if (category && category !== "NULL" && category.trim()) {
          categories.add(category.trim());
        }
      });

      const uniqueCategories = Array.from(categories).sort();
      console.log(
        `📊 ExcelModel: Found ${uniqueCategories.length} unique categories`
      );

      return uniqueCategories;
    } catch (error) {
      console.error("ExcelModel: Error getting unique categories:", error);
      throw error;
    }
  }

  /**
   * @description Get category statistics
   * @returns {Promise<Object>} Category statistics
   */
  async getCategoryStats() {
    try {
      const rows = await this.prisma.excelRow.findMany({
        select: {
          rowData: true,
        },
      });

      const categoryStats = {};
      const locationStats = {};

      rows.forEach((row) => {
        const category = row.rowData?.Category;
        const city = row.rowData?.City;

        if (category && category !== "NULL" && category.trim()) {
          const cleanCategory = category.trim();
          categoryStats[cleanCategory] =
            (categoryStats[cleanCategory] || 0) + 1;
        }

        if (city && city !== "NULL" && city.trim()) {
          const cleanCity = city.trim();
          locationStats[cleanCity] = (locationStats[cleanCity] || 0) + 1;
        }
      });

      // Sort by count
      const sortedCategories = Object.entries(categoryStats)
        .sort(([, a], [, b]) => b - a)
        .reduce((acc, [key, value]) => {
          acc[key] = value;
          return acc;
        }, {});

      const sortedLocations = Object.entries(locationStats)
        .sort(([, a], [, b]) => b - a)
        .reduce((acc, [key, value]) => {
          acc[key] = value;
          return acc;
        }, {});

      const stats = {
        totalRows: rows.length,
        totalCategories: Object.keys(categoryStats).length,
        totalLocations: Object.keys(locationStats).length,
        topCategories: Object.fromEntries(
          Object.entries(sortedCategories).slice(0, 20)
        ),
        topLocations: Object.fromEntries(
          Object.entries(sortedLocations).slice(0, 20)
        ),
        categoryDistribution: sortedCategories,
        locationDistribution: sortedLocations,
      };

      console.log(
        `📊 ExcelModel: Category stats - ${stats.totalCategories} categories, ${stats.totalLocations} locations`
      );

      return stats;
    } catch (error) {
      console.error("ExcelModel: Error getting category stats:", error);
      throw error;
    }
  }

  /**
   * @description Get people from leads-campaign collection by campaign ID
   * @param {string} campaignId - Campaign ID to filter by
   * @param {Object} options - Query options
   * @param {number} options.page - Page number
   * @param {number} options.limit - Items per page
   * @param {string} options.sortBy - Field to sort by
   * @param {string} options.sortOrder - Sort order (asc/desc)
   * @returns {Promise<Object>} Campaign people data with pagination
   */
  async getCampaignPeople(campaignId, options = {}) {
    try {
      const {
        page = 1,
        limit = 50,
        sortBy = "createdAt",
        sortOrder = "desc",
      } = options;
      const skip = (page - 1) * limit;

      // Find documents with matching campaign_id
      // Handle nullable DateTime fields more defensively
      let whereClause = { campaignId: campaignId };
      let orderByClause = { id: sortOrder }; // Default fallback to id sorting

      // If sorting by a DateTime field, add a filter to exclude null values
      if (sortBy === "createdAt" || sortBy === "updatedAt") {
        whereClause[sortBy] = { not: null };
        orderByClause = { [sortBy]: sortOrder };
      } else if (sortBy !== "id") {
        orderByClause = { [sortBy]: sortOrder };
      }

      const campaigns = await this.prisma.leadsCampaign.findMany({
        where: whereClause,
        orderBy: orderByClause,
        skip: skip,
        take: limit,
      });

      // Get total count for pagination using the same where clause
      const totalCount = await this.prisma.leadsCampaign.count({
        where: whereClause,
      });

      // Extract all people from all matching campaigns
      let allPeople = [];
      campaigns.forEach((campaign) => {
        if (campaign.people && Array.isArray(campaign.people)) {
          allPeople = allPeople.concat(campaign.people);
        }
      });

      const totalPages = Math.ceil(totalCount / limit);
      const hasNext = page < totalPages;
      const hasPrev = page > 1;

      return {
        people: allPeople,
        pagination: {
          currentPage: page,
          totalPages,
          totalCount,
          hasNext,
          hasPrev,
        },
        metadata: {
          campaignId,
          totalPeople: allPeople.length,
          filters: {
            sortBy,
            sortOrder,
          },
        },
      };
    } catch (error) {
      console.error("ExcelModel: Error getting campaign people:", error);
      throw error;
    }
  }

  /**
   * Get all people from a campaign without pagination, filtering, or sorting
   * @param {string} campaignId - Campaign ID to get people for
   * @returns {Promise<Object>} All campaign people data
   */
  async getAllCampaignPeople(campaignId) {
    try {
      console.log(`📋 Getting all people for campaign: ${campaignId}`);

      // Find all documents with matching campaign_id
      const campaigns = await this.prisma.leadsCampaign.findMany({
        where: {
          campaignId: campaignId,
        },
      });

      // Extract all people from all matching campaigns
      let allPeople = [];
      campaigns.forEach((campaign) => {
        if (campaign.people && Array.isArray(campaign.people)) {
          allPeople = allPeople.concat(campaign.people);
        }
      });

      return {
        campaignId,
        people: allPeople,
        totalPeople: allPeople.length,
      };
    } catch (error) {
      console.error("ExcelModel: Error getting all campaign people:", error);
      throw error;
    }
  }
}

module.exports = ExcelModel;
