const OpenAI = require("openai");
const { OpenAIEmbeddings } = require("@langchain/openai");
const { ChatOpenAI } = require("@langchain/openai");
const pLimit = require("p-limit");

/**
 * @description Robust OpenAI service for embeddings and chat completions
 * @class OpenAIService
 */
class OpenAIService {
  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY environment variable is required");
    }

    console.log("OpenAIService: Initializing OpenAI API with latest models");

    // Direct OpenAI client for raw API access
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Langchain OpenAI Embeddings with best model
    this.embeddings = new OpenAIEmbeddings({
      openAIApiKey: process.env.OPENAI_API_KEY,
      model: "text-embedding-3-small", // Best embedding model from OpenAI
      dimensions: 1536, // Full dimensions for maximum quality
      maxRetries: 3,
      timeout: 30000, // 30 second timeout
    });

    // Langchain ChatOpenAI for robust chat completions
    this.chatModel = new ChatOpenAI({
      openAIApiKey: process.env.OPENAI_API_KEY,
      model: "gpt-4o", // Latest and best reasoning model
      temperature: 0.7,
      maxTokens: 4000,
      maxRetries: 3,
      timeout: 60000, // 60 second timeout for complex requests
    });

    // Backup chat model for fallback
    this.backupChatModel = new ChatOpenAI({
      openAIApiKey: process.env.OPENAI_API_KEY,
      model: "gpt-4-turbo", // Fallback model
      temperature: 0.7,
      maxTokens: 4000,
      maxRetries: 2,
      timeout: 45000,
    });

    // Rate limiting configuration
    this.rateLimitConfig = {
      maxRequestsPerMinute: 500, // Conservative limit for embeddings
      maxTokensPerMinute: 150000, // Conservative limit for chat
      requestCount: 0,
      tokenCount: 0,
      lastReset: Date.now(),
    };

    console.log("OpenAIService: Initialization complete with models:");
    console.log("  - Embeddings: text-embedding-3-small (1536 dimensions)");
    console.log("  - Chat: gpt-4o (primary), gpt-4-turbo (backup)");
  }

  /**
   * @description Reset rate limiting counters if needed
   * @private
   */
  resetRateLimitIfNeeded() {
    const now = Date.now();
    if (now - this.rateLimitConfig.lastReset > 60000) {
      // Reset every minute
      this.rateLimitConfig.requestCount = 0;
      this.rateLimitConfig.tokenCount = 0;
      this.rateLimitConfig.lastReset = now;
    }
  }

  /**
   * @description Check if we're approaching rate limits
   * @private
   */
  checkRateLimit() {
    this.resetRateLimitIfNeeded();

    if (
      this.rateLimitConfig.requestCount >=
      this.rateLimitConfig.maxRequestsPerMinute
    ) {
      throw new Error("Rate limit exceeded: too many requests per minute");
    }

    if (
      this.rateLimitConfig.tokenCount >= this.rateLimitConfig.maxTokensPerMinute
    ) {
      throw new Error("Rate limit exceeded: too many tokens per minute");
    }
  }

  /**
   * @description Add random jitter to backoff delay
   * @param {number} base - Base delay in ms
   * @returns {number} Delay with jitter
   * @private
   */
  addJitter(base) {
    const jitter = Math.random() * 0.3; // Add up to 30% jitter
    return Math.floor(base * (1 + jitter));
  }

  /**
   * @description Exponential backoff delay with jitter
   * @param {number} attempt - Attempt number (0-based)
   * @returns {Promise<void>} Promise that resolves after delay
   * @private
   */
  async exponentialBackoff(attempt) {
    const baseDelay = Math.min(1000 * Math.pow(2, attempt), 10000); // Max 10 seconds
    const delayWithJitter = this.addJitter(baseDelay);
    console.log(
      `OpenAIService: Backing off for ${delayWithJitter}ms (attempt ${
        attempt + 1
      })`
    );
    await new Promise((resolve) => setTimeout(resolve, delayWithJitter));
  }

  /**
   * @description Process a single batch with retries
   * @param {Object} batch - Batch object with texts and index
   * @param {number} batchIndex - Index of the batch
   * @param {number} totalBatches - Total number of batches
   * @returns {Promise<Object>} Processing result with status
   * @private
   */
  async processBatch(batch, batchIndex, totalBatches) {
    let attempts = 0;
    const maxAttempts = 3;
    const result = {
      success: false,
      embeddings: [],
      error: null,
      retries: 0,
      tokenCount: batch.texts.reduce(
        (sum, text) => sum + this.estimateTokenCount(text),
        0
      ),
    };

    while (attempts < maxAttempts && !result.success) {
      try {
        const batchEmbeddings = await this.embeddings.embedDocuments(
          batch.texts
        );

        result.success = true;
        result.embeddings = batch.texts.map((text, idx) => ({
          text: text,
          embedding: batchEmbeddings[idx],
          metadata: {
            chunkIndex: batch.index + idx,
            tokenCount: this.estimateTokenCount(text),
            dimensions: batchEmbeddings[idx].length,
            model: "text-embedding-3-small",
            processingTime: Date.now(),
          },
        }));

        // Update rate limits
        this.rateLimitConfig.requestCount++;
        this.rateLimitConfig.tokenCount += result.tokenCount;

        console.log(
          `OpenAIService: Batch ${
            batchIndex + 1
          }/${totalBatches} completed successfully` +
            ` (${result.embeddings.length} embeddings)`
        );
      } catch (error) {
        attempts++;
        result.retries = attempts;
        result.error = error;

        const isRateLimit =
          error.message.includes("rate limit") || error.status === 429;

        if (isRateLimit) {
          console.log(
            `OpenAIService: Rate limit hit on batch ${
              batchIndex + 1
            }, attempt ${attempts}/${maxAttempts}`
          );
          await this.exponentialBackoff(attempts - 1);
        } else if (attempts >= maxAttempts) {
          console.error(
            `OpenAIService: Batch ${
              batchIndex + 1
            } failed after ${maxAttempts} attempts:`,
            error.message
          );
          throw error;
        } else {
          console.log(
            `OpenAIService: Error on batch ${
              batchIndex + 1
            }, attempt ${attempts}/${maxAttempts}:`,
            error.message
          );
          await this.exponentialBackoff(attempts - 1);
        }
      }
    }

    return result;
  }

  /**
   * @description Generate embeddings for text chunks with parallel processing
   * @param {Array<string>} textChunks - Array of text chunks to embed
   * @returns {Promise<Array>} Array of embeddings with metadata
   */
  async generateEmbeddings(textChunks) {
    try {
      const startTime = Date.now();
      this.checkRateLimit();

      console.log(
        `OpenAIService: Generating embeddings for ${textChunks.length} chunks`
      );

      // Calculate optimal batch size based on token estimates
      const avgTokensPerChunk =
        textChunks.reduce(
          (sum, text) => sum + this.estimateTokenCount(text),
          0
        ) / textChunks.length;

      const batchSize = Math.min(
        100, // OpenAI max batch size
        Math.floor(8000 / avgTokensPerChunk) // Keep total tokens under 8k per batch
      );

      console.log(
        `OpenAIService: Using batch size of ${batchSize} based on avg token length`
      );

      const concurrency = 5; // Process 5 batches in parallel
      const limit = pLimit(concurrency);

      // Create batches with token count tracking
      const batches = [];
      for (let i = 0; i < textChunks.length; i += batchSize) {
        const batchTexts = textChunks.slice(i, i + batchSize);
        batches.push({
          index: i,
          texts: batchTexts,
          estimatedTokens: batchTexts.reduce(
            (sum, text) => sum + this.estimateTokenCount(text),
            0
          ),
        });
      }

      console.log(
        `OpenAIService: Created ${batches.length} batches for processing`
      );

      // Process batches in parallel with detailed tracking
      const batchResults = await Promise.all(
        batches.map((batch, idx) =>
          limit(() => this.processBatch(batch, idx, batches.length))
        )
      );

      // Aggregate results and stats
      const stats = {
        totalProcessed: 0,
        totalRetries: 0,
        totalTokens: 0,
        failedBatches: 0,
        processingTime: Date.now() - startTime,
        chunksPerSecond: 0,
        tokensPerSecond: 0,
        avgProcessingTimePerChunk: 0,
        totalBatches: batches.length,
        concurrentBatches: concurrency,
        batchSize: batchSize,
      };

      const embeddings = batchResults.reduce((acc, result) => {
        if (result.success) {
          stats.totalProcessed += result.embeddings.length;
          stats.totalRetries += result.retries;
          stats.totalTokens += result.tokenCount;
          return acc.concat(result.embeddings);
        } else {
          stats.failedBatches++;
          return acc;
        }
      }, []);

      // Calculate performance metrics
      stats.chunksPerSecond = (
        stats.totalProcessed /
        (stats.processingTime / 1000)
      ).toFixed(2);
      stats.tokensPerSecond = (
        stats.totalTokens /
        (stats.processingTime / 1000)
      ).toFixed(2);
      stats.avgProcessingTimePerChunk = (
        stats.processingTime / stats.totalProcessed
      ).toFixed(2);

      console.log("OpenAIService: Embedding generation completed", {
        totalEmbeddings: embeddings.length,
        processingTimeMs: stats.processingTime,
        chunksPerSecond: stats.chunksPerSecond,
        tokensPerSecond: stats.tokensPerSecond,
        avgMsPerChunk: stats.avgProcessingTimePerChunk,
        averageRetries: (stats.totalRetries / batches.length).toFixed(2),
        failedBatches: stats.failedBatches,
        totalTokensProcessed: stats.totalTokens,
        configuration: {
          batchSize: stats.batchSize,
          concurrency: stats.concurrentBatches,
          totalBatches: stats.totalBatches,
        },
      });

      return embeddings;
    } catch (error) {
      console.error("OpenAIService: Error generating embeddings:", error);
      throw new Error(`Failed to generate embeddings: ${error.message}`);
    }
  }

  /**
   * @description Generate embedding for a single query with robust error handling
   * @param {string} query - Query text
   * @returns {Promise<Array>} Embedding vector
   */
  async generateEmbedding(query) {
    try {
      this.checkRateLimit();

      console.log("OpenAIService: Generating query embedding");

      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts) {
        try {
          // Use Langchain for robust single embedding
          const embedding = await this.embeddings.embedQuery(query);

          this.rateLimitConfig.requestCount++;
          this.rateLimitConfig.tokenCount += this.estimateTokenCount(query);

          console.log(
            `OpenAIService: Generated embedding with ${embedding.length} dimensions`
          );
          return embedding;
        } catch (error) {
          attempts++;

          if (error.message.includes("rate limit") || error.status === 429) {
            console.log(
              `OpenAIService: Rate limit hit, waiting before retry ${attempts}/${maxAttempts}`
            );
            await this.exponentialBackoff(attempts - 1);
          } else if (attempts >= maxAttempts) {
            throw error;
          } else {
            console.log(
              `OpenAIService: Query embedding error, retrying ${attempts}/${maxAttempts}:`,
              error.message
            );
            await this.exponentialBackoff(attempts - 1);
          }
        }
      }
    } catch (error) {
      console.error("OpenAIService: Error generating query embedding:", error);
      throw new Error(`Failed to generate query embedding: ${error.message}`);
    }
  }

  /**
   * @description Generate chat completion with context and conversation history
   * @param {string} query - User query
   * @param {Array} relevantChunks - Relevant document chunks
   * @param {string} documentName - Name of the document
   * @param {Array} conversationContext - Previous conversation messages
   * @returns {Promise<Object>} Chat completion response
   */
  async generateChatResponseWithContext(
    query,
    relevantChunks,
    documentName = "document",
    conversationContext = []
  ) {
    try {
      this.checkRateLimit();

      console.log(
        `OpenAIService: Generating chat response with ${relevantChunks.length} chunks`
      );

      // Build context from relevant chunks
      const documentContext = relevantChunks
        .map((chunk, index) => `[Context ${index + 1}]: ${chunk.text}`)
        .join("\n\n");

      const systemMessage = `You are a helpful AI assistant that answers questions based on the provided document content. 
Use the context provided to answer the user's question accurately and comprehensively.
If the answer cannot be found in the context, clearly state that the information is not available in the document.

Consider the conversation history to maintain context and provide coherent responses.

Document: ${documentName}

Document Context:
${documentContext}`;

      // Build conversation messages
      const messages = [{ role: "system", content: systemMessage }];

      // Add conversation history (limit to last 6 messages for context)
      conversationContext
        .filter((msg) => msg.role !== "system")
        .slice(-6)
        .forEach((msg) => {
          messages.push({
            role: msg.role,
            content: msg.content,
          });
        });

      // Add current query
      messages.push({ role: "user", content: query });

      return await this.generateChatWithRetry(
        messages,
        relevantChunks,
        "context"
      );
    } catch (error) {
      console.error(
        "OpenAIService: Error generating chat response with context:",
        error
      );
      throw new Error(
        `Failed to generate chat response with context: ${error.message}`
      );
    }
  }

  /**
   * @description Generate chat completion with context (simplified version)
   * @param {string} query - User query
   * @param {Array} relevantChunks - Relevant document chunks
   * @param {string} documentName - Name of the document
   * @returns {Promise<Object>} Chat completion response
   */
  async generateChatResponse(query, relevantChunks, documentName = "document") {
    try {
      this.checkRateLimit();

      console.log(
        `OpenAIService: Generating chat response for query: "${query.substring(
          0,
          50
        )}..."`
      );

      // Build context from relevant chunks
      const context = relevantChunks
        .map((chunk, index) => `[Context ${index + 1}]: ${chunk.text}`)
        .join("\n\n");

      const systemMessage = `You are a helpful AI assistant that answers questions based on the provided document content. 
Use the context provided to answer the user's question accurately and comprehensively.
If the answer cannot be found in the context, clearly state that the information is not available in the document.

Document: ${documentName}

Context:
${context}`;

      const messages = [
        { role: "system", content: systemMessage },
        { role: "user", content: query },
      ];

      return await this.generateChatWithRetry(
        messages,
        relevantChunks,
        "simple"
      );
    } catch (error) {
      console.error("OpenAIService: Error generating chat response:", error);
      throw new Error(`Failed to generate chat response: ${error.message}`);
    }
  }

  /**
   * @description Generate chat with retry logic and fallback models
   * @param {Array} messages - Chat messages
   * @param {Array} relevantChunks - Relevant chunks for response metadata
   * @param {string} type - Type of chat (context/simple)
   * @returns {Promise<Object>} Chat completion response
   * @private
   */
  async generateChatWithRetry(messages, relevantChunks, type) {
    let attempts = 0;
    const maxAttempts = 3;
    const models = [this.chatModel, this.backupChatModel];

    for (const model of models) {
      attempts = 0;

      while (attempts < maxAttempts) {
        try {
          console.log(
            `OpenAIService: Using model ${model.model} (attempt ${
              attempts + 1
            })`
          );

          const response = await this.client.chat.completions.create({
            model: model.model,
            messages: messages,
            max_tokens: model.maxTokens || 4000,
            temperature: model.temperature || 0.7,
          });

          this.rateLimitConfig.requestCount++;
          this.rateLimitConfig.tokenCount += response.usage?.total_tokens || 0;

          console.log(
            `OpenAIService: Chat completion successful with ${model.model}`
          );

          return {
            answer: response.choices[0].message.content,
            usage: response.usage,
            model: response.model,
            relevantChunks: relevantChunks.length,
            type: type,
            sources: relevantChunks.map((chunk, index) => ({
              chunkIndex: chunk.metadata?.chunkIndex || index,
              similarity: chunk.similarity || 0,
              preview: chunk.text.substring(0, 100) + "...",
            })),
          };
        } catch (error) {
          attempts++;

          if (error.message.includes("rate limit") || error.status === 429) {
            console.log(
              `OpenAIService: Rate limit hit with ${model.model}, waiting before retry ${attempts}/${maxAttempts}`
            );
            await this.exponentialBackoff(attempts - 1);
          } else if (attempts >= maxAttempts) {
            console.log(
              `OpenAIService: Max attempts reached with ${model.model}, trying next model`
            );
            break; // Try next model
          } else {
            console.log(
              `OpenAIService: Chat error with ${model.model}, retrying ${attempts}/${maxAttempts}:`,
              error.message
            );
            await this.exponentialBackoff(attempts - 1);
          }
        }
      }
    }

    throw new Error("All chat models failed after multiple attempts");
  }

  /**
   * @description Generate streaming chat response (using raw OpenAI API)
   * @param {string} query - User query
   * @param {Array} relevantChunks - Relevant document chunks
   * @param {string} documentName - Name of the document
   * @returns {Promise<ReadableStream>} Streaming response
   */
  async generateStreamingResponse(
    query,
    relevantChunks,
    documentName = "document"
  ) {
    try {
      this.checkRateLimit();

      console.log("OpenAIService: Generating streaming response");

      const context = relevantChunks
        .map((chunk, index) => `[Context ${index + 1}]: ${chunk.text}`)
        .join("\n\n");

      const systemMessage = `You are a helpful AI assistant that answers questions based on the provided document content. 
Use the context provided to answer the user's question accurately and comprehensively.
If the answer cannot be found in the context, clearly state that the information is not available in the document.

Document: ${documentName}

Context:
${context}`;

      return await this.client.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemMessage },
          { role: "user", content: query },
        ],
        max_tokens: 4000,
        temperature: 0.7,
        stream: true,
      });
    } catch (error) {
      console.error(
        "OpenAIService: Error generating streaming response:",
        error
      );
      throw new Error(
        `Failed to generate streaming response: ${error.message}`
      );
    }
  }

  /**
   * @description Split text into chunks for processing with overlap
   * @param {string} text - Text to split
   * @param {number} maxChunkSize - Maximum chunk size in characters
   * @param {number} overlap - Overlap between chunks
   * @returns {Array<string>} Array of text chunks
   */
  splitTextIntoChunks(text, maxChunkSize = 1500, overlap = 150) {
    const chunks = [];
    let start = 0;

    while (start < text.length) {
      let end = start + maxChunkSize;

      // Try to split at natural boundaries (sentences, paragraphs, spaces)
      if (end < text.length) {
        const boundaries = [
          text.lastIndexOf("\n\n", end), // Paragraph
          text.lastIndexOf(". ", end), // Sentence
          text.lastIndexOf("\n", end), // Line
          text.lastIndexOf(" ", end), // Word
        ];

        const splitPoint = boundaries.find(
          (boundary) => boundary > start + maxChunkSize * 0.5
        );
        if (splitPoint) {
          end = splitPoint + 1;
        }
      }

      const chunk = text.substring(start, end).trim();
      if (chunk.length > 0) {
        chunks.push(chunk);
      }

      start = end - overlap;
      if (start >= text.length) break;
    }

    return chunks;
  }

  /**
   * @description Validate OpenAI API key with comprehensive checks
   * @returns {Promise<boolean>} True if valid and functional, false otherwise
   */
  async validateApiKey() {
    try {
      console.log("OpenAIService: Validating API key...");

      // Test 1: List models (quick check)
      const models = await this.client.models.list();
      const hasGPT4 = models.data.some((model) => model.id.includes("gpt-4"));

      if (!hasGPT4) {
        console.error(
          "OpenAIService: API key doesn't have access to GPT-4 models"
        );
        return false;
      }

      // Test 2: Simple embedding test
      const testEmbedding = await this.embeddings.embedQuery("test");
      if (!testEmbedding || testEmbedding.length === 0) {
        console.error("OpenAIService: Embedding generation failed");
        return false;
      }

      // Test 3: Simple chat completion test
      const testResponse = await this.client.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 10,
      });

      if (!testResponse.choices || testResponse.choices.length === 0) {
        console.error("OpenAIService: Chat completion failed");
        return false;
      }

      console.log("OpenAIService: API key validation successful");
      console.log(`  - Available models: ${models.data.length}`);
      console.log(`  - Embedding dimensions: ${testEmbedding.length}`);
      console.log(`  - Chat model: ${testResponse.model}`);

      return true;
    } catch (error) {
      console.error("OpenAIService: API key validation failed:", error.message);
      return false;
    }
  }

  /**
   * @description Get service health status
   * @returns {Promise<Object>} Health status information
   */
  async getHealthStatus() {
    try {
      const isValid = await this.validateApiKey();

      return {
        status: isValid ? "healthy" : "unhealthy",
        apiKey: process.env.OPENAI_API_KEY ? "configured" : "missing",
        models: {
          embedding: "text-embedding-3-small",
          chatPrimary: "gpt-4o",
          chatBackup: "gpt-4-turbo",
        },
        rateLimits: {
          requestsThisMinute: this.rateLimitConfig.requestCount,
          tokensThisMinute: this.rateLimitConfig.tokenCount,
          maxRequestsPerMinute: this.rateLimitConfig.maxRequestsPerMinute,
          maxTokensPerMinute: this.rateLimitConfig.maxTokensPerMinute,
        },
        lastValidation: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: "error",
        error: error.message,
        lastValidation: new Date().toISOString(),
      };
    }
  }
}

module.exports = OpenAIService;
