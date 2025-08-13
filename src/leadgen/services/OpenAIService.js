const OpenAI = require("openai");

/**
 * @description Optimized OpenAI service with batching and rate limiting
 * @class OpenAIService
 */
class OpenAIService {
  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.model = "gpt-4o";
    this.embeddingModel = "text-embedding-3-large";

    // Batching configuration
    this.batchConfig = {
      maxBatchSize: 100, // OpenAI allows up to 2048 inputs per batch
      maxConcurrentRequests: 5, // Limit concurrent requests to avoid rate limits
      batchTimeout: 1000, // Wait 1s to collect batch items
    };

    // Rate limiting
    this.rateLimiter = {
      requestsPerMinute: 3000, // Conservative limit
      tokensPerMinute: 1000000, // Conservative limit
      currentRequests: 0,
      currentTokens: 0,
      windowStart: Date.now(),
    };

    // Circuit breaker for resilience
    this.circuitBreaker = {
      failureThreshold: 5,
      resetTimeout: 30000, // 30 seconds
      state: "CLOSED", // CLOSED, OPEN, HALF_OPEN
      failures: 0,
      lastFailureTime: null,
    };

    // Pending batch requests
    this.pendingBatches = new Map();
    this.batchQueue = [];

    console.log("OpenAIService: Initializing OpenAI API with latest models");
    console.log("OpenAIService: Initialization complete with models:");
    console.log(`- Embeddings: ${this.embeddingModel} (1536 dimensions)`);
    console.log(`- Chat: ${this.model} (primary), gpt-4-turbo (backup)`);
  }

  /**
   * @description Generate embedding for text with circuit breaker protection
   * @param {string} text - Text to generate embedding for
   * @returns {Promise<Array<number>>} Embedding vector
   */
  async generateEmbedding(text) {
    // Check circuit breaker
    if (this.circuitBreaker.state === "OPEN") {
      if (
        Date.now() - this.circuitBreaker.lastFailureTime >
        this.circuitBreaker.resetTimeout
      ) {
        this.circuitBreaker.state = "HALF_OPEN";
        console.log("OpenAIService: Circuit breaker moving to HALF_OPEN state");
      } else {
        throw new Error(
          "OpenAI service temporarily unavailable (circuit breaker OPEN)"
        );
      }
    }

    try {
      // Check rate limits
      await this.checkRateLimit(1, this.estimateTokens(text));

      console.log("OpenAIService: Generating query embedding");
      const response = await this.client.embeddings.create({
        model: this.embeddingModel,
        input: text,
      });

      // Update rate limiter
      this.updateRateLimit(
        1,
        response.usage?.total_tokens || this.estimateTokens(text)
      );

      // Reset circuit breaker on success
      if (this.circuitBreaker.state === "HALF_OPEN") {
        this.circuitBreaker.state = "CLOSED";
        this.circuitBreaker.failures = 0;
        console.log("OpenAIService: Circuit breaker reset to CLOSED state");
      }

      console.log(
        `OpenAIService: Generated embedding with ${response.data[0].embedding.length} dimensions`
      );
      return response.data[0].embedding;
    } catch (error) {
      console.error("OpenAIService: Error generating embedding:", error);
      this.handleCircuitBreakerFailure(error);
      throw error;
    }
  }

  /**
   * @description Generate embeddings for multiple texts with intelligent batching
   * @param {Array<string>} texts - Array of texts
   * @param {Object} options - Options for batch processing
   * @returns {Promise<Array>} Array of embeddings with metadata
   */
  async generateEmbeddings(texts, options = {}) {
    if (!texts || texts.length === 0) {
      return [];
    }

    const {
      batchSize = this.batchConfig.maxBatchSize,
      maxConcurrent = this.batchConfig.maxConcurrentRequests,
      includeMetadata = true,
    } = options;

    try {
      console.log(
        `OpenAIService: Starting batch embedding generation for ${texts.length} texts`
      );

      // Check circuit breaker
      if (this.circuitBreaker.state === "OPEN") {
        if (
          Date.now() - this.circuitBreaker.lastFailureTime >
          this.circuitBreaker.resetTimeout
        ) {
          this.circuitBreaker.state = "HALF_OPEN";
        } else {
          throw new Error(
            "OpenAI service temporarily unavailable (circuit breaker OPEN)"
          );
        }
      }

      // Split texts into optimal batches
      const batches = this.createOptimalBatches(texts, batchSize);
      console.log(
        `OpenAIService: Created ${batches.length} batches for processing`
      );

      // Process batches with controlled concurrency
      const batchResults = await this.processBatchesConcurrently(
        batches,
        maxConcurrent
      );

      // Flatten and format results
      const embeddings = [];
      let textIndex = 0;

      for (const batchResult of batchResults) {
        if (batchResult.status === "fulfilled" && batchResult.value) {
          for (const embeddingData of batchResult.value.data) {
            embeddings.push({
              content: texts[textIndex],
              embedding: embeddingData.embedding,
              metadata: includeMetadata
                ? {
                    textLength: texts[textIndex].length,
                    timestamp: new Date(),
                    batchIndex: Math.floor(textIndex / batchSize),
                    embeddingIndex: embeddingData.index,
                  }
                : undefined,
            });
            textIndex++;
          }
        } else {
          // Handle failed batch - create placeholder entries
          const batchTexts = batches[Math.floor(textIndex / batchSize)];
          for (let i = 0; i < batchTexts.length; i++) {
            embeddings.push({
              content: texts[textIndex],
              embedding: null,
              error: batchResult.reason?.message || "Batch processing failed",
              metadata: includeMetadata
                ? {
                    textLength: texts[textIndex].length,
                    timestamp: new Date(),
                    failed: true,
                  }
                : undefined,
            });
            textIndex++;
          }
        }
      }

      const successCount = embeddings.filter(
        (e) => e.embedding !== null
      ).length;
      console.log(
        `OpenAIService: Batch processing complete. ${successCount}/${texts.length} embeddings generated successfully`
      );

      return embeddings;
    } catch (error) {
      console.error(
        "OpenAIService: Error in batch embedding generation:",
        error
      );
      this.handleCircuitBreakerFailure(error);
      throw error;
    }
  }

  /**
   * @description Generate chat response with context
   * @param {string} query - User query
   * @param {Array} relevantChunks - Relevant text chunks
   * @param {string} fileName - Excel file name
   * @param {Array} conversationContext - Previous conversation messages
   * @returns {Promise<Object>} Chat response with metadata
   */
  async generateChatResponseWithContext(
    query,
    relevantChunks,
    fileName,
    conversationContext = []
  ) {
    try {
      // Build context from relevant chunks
      const context = relevantChunks
        .map(
          (chunk, index) =>
            `[Row ${chunk.rowIndex}]: ${JSON.stringify(chunk.rowData)}`
        )
        .join("\n\n");

      // Build system message
      const systemMessage = {
        role: "system",
        content: `You are a helpful assistant analyzing Excel data from "${fileName}". 
                 Provide clear, accurate answers based on the data provided. 
                 If the data doesn't contain enough information to answer the question, say so.
                 Always cite specific rows when referencing data.`,
      };

      // Build messages array with context
      const messages = [
        systemMessage,
        ...conversationContext,
        {
          role: "user",
          content: `Based on this Excel data:\n\n${context}\n\nQuestion: ${query}\n\nAnswer:`,
        },
      ];

      // Get chat completion
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: messages,
        temperature: 0.7,
        max_tokens: 1000,
      });

      return {
        answer: completion.choices[0].message.content,
        model: this.model,
        relevantChunks: relevantChunks.length,
        sources: relevantChunks.map((chunk) => ({
          rowIndex: chunk.rowIndex,
          score: chunk.score,
          fileName: fileName,
        })),
        usage: completion.usage,
      };
    } catch (error) {
      console.error("OpenAIService: Error generating chat response:", error);
      throw error;
    }
  }

  /**
   * @description Create optimal batches for embedding generation
   * @param {Array<string>} texts - Array of texts to batch
   * @param {number} maxBatchSize - Maximum batch size
   * @returns {Array<Array<string>>} Array of text batches
   * @private
   */
  createOptimalBatches(texts, maxBatchSize) {
    const batches = [];

    for (let i = 0; i < texts.length; i += maxBatchSize) {
      const batch = texts.slice(i, i + maxBatchSize);
      batches.push(batch);
    }

    return batches;
  }

  /**
   * @description Process batches with controlled concurrency
   * @param {Array<Array<string>>} batches - Array of text batches
   * @param {number} maxConcurrent - Maximum concurrent requests
   * @returns {Promise<Array>} Array of batch results
   * @private
   */
  async processBatchesConcurrently(batches, maxConcurrent) {
    const results = [];

    // Process batches in chunks to control concurrency
    for (let i = 0; i < batches.length; i += maxConcurrent) {
      const batchChunk = batches.slice(i, i + maxConcurrent);

      const chunkPromises = batchChunk.map(async (batch, index) => {
        try {
          // Estimate tokens for rate limiting
          const estimatedTokens = batch.reduce(
            (sum, text) => sum + this.estimateTokens(text),
            0
          );

          // Check rate limits before processing
          await this.checkRateLimit(1, estimatedTokens);

          console.log(
            `OpenAIService: Processing batch ${i + index + 1}/${
              batches.length
            } with ${batch.length} texts`
          );

          const response = await this.client.embeddings.create({
            model: this.embeddingModel,
            input: batch,
          });

          // Update rate limiter
          this.updateRateLimit(
            1,
            response.usage?.total_tokens || estimatedTokens
          );

          return response;
        } catch (error) {
          console.error(
            `OpenAIService: Batch ${i + index + 1} failed:`,
            error.message
          );
          throw error;
        }
      });

      const chunkResults = await Promise.allSettled(chunkPromises);
      results.push(...chunkResults);
    }

    return results;
  }

  /**
   * @description Check rate limits and wait if necessary
   * @param {number} requests - Number of requests
   * @param {number} tokens - Number of tokens
   * @private
   */
  async checkRateLimit(requests, tokens) {
    const now = Date.now();
    const windowDuration = 60000; // 1 minute

    // Reset window if needed
    if (now - this.rateLimiter.windowStart > windowDuration) {
      this.rateLimiter.currentRequests = 0;
      this.rateLimiter.currentTokens = 0;
      this.rateLimiter.windowStart = now;
    }

    // Check if we would exceed limits
    if (
      this.rateLimiter.currentRequests + requests >
        this.rateLimiter.requestsPerMinute ||
      this.rateLimiter.currentTokens + tokens > this.rateLimiter.tokensPerMinute
    ) {
      const waitTime = windowDuration - (now - this.rateLimiter.windowStart);
      console.log(
        `OpenAIService: Rate limit approaching, waiting ${waitTime}ms`
      );
      await new Promise((resolve) => setTimeout(resolve, waitTime));

      // Reset after waiting
      this.rateLimiter.currentRequests = 0;
      this.rateLimiter.currentTokens = 0;
      this.rateLimiter.windowStart = Date.now();
    }
  }

  /**
   * @description Update rate limiter counters
   * @param {number} requests - Number of requests made
   * @param {number} tokens - Number of tokens used
   * @private
   */
  updateRateLimit(requests, tokens) {
    this.rateLimiter.currentRequests += requests;
    this.rateLimiter.currentTokens += tokens;
  }

  /**
   * @description Estimate token count for text
   * @param {string} text - Text to estimate
   * @returns {number} Estimated token count
   * @private
   */
  estimateTokens(text) {
    // Rough estimation: ~4 characters per token for English text
    return Math.ceil(text.length / 4);
  }

  /**
   * @description Handle circuit breaker failures
   * @param {Error} error - The error that occurred
   * @private
   */
  handleCircuitBreakerFailure(error) {
    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailureTime = Date.now();

    if (this.circuitBreaker.failures >= this.circuitBreaker.failureThreshold) {
      this.circuitBreaker.state = "OPEN";
      console.log(
        `OpenAIService: Circuit breaker OPEN after ${this.circuitBreaker.failures} failures`
      );
    }
  }

  /**
   * @description Validate API key and get model information
   * @returns {Promise<boolean>} True if API key is valid
   */
  async validateApiKey() {
    try {
      console.log("OpenAIService: Validating API key...");
      const apiKey = process.env.OPENAI_API_KEY;

      if (!apiKey) {
        console.error(
          "OpenAIService: No API key found in environment variables"
        );
        return false;
      }

      console.log(
        `OpenAIService: API key is present (length: ${apiKey.length})`
      );

      // Test with a simple embedding request
      const testResponse = await this.client.embeddings.create({
        model: this.embeddingModel,
        input: "test",
      });

      if (testResponse && testResponse.data && testResponse.data[0]) {
        console.log("OpenAIService: API key validation successful");
        console.log(`- Available models: ${testResponse.model || "Unknown"}`);
        console.log(
          `- Embedding dimensions: ${testResponse.data[0].embedding.length}`
        );
        console.log(`- Chat model: ${this.model}`);
        return true;
      }

      return false;
    } catch (error) {
      console.error("OpenAIService: API key validation failed:", error.message);
      return false;
    }
  }

  /**
   * @description Split text into chunks for processing
   * @param {string} text - Text to split
   * @param {number} maxChunkSize - Maximum chunk size
   * @returns {Array<string>} Array of text chunks
   */
  splitTextIntoChunks(text, maxChunkSize = 1000) {
    const words = text.split(/\s+/);
    const chunks = [];
    let currentChunk = [];
    let currentSize = 0;

    for (const word of words) {
      if (currentSize + word.length > maxChunkSize) {
        chunks.push(currentChunk.join(" "));
        currentChunk = [word];
        currentSize = word.length;
      } else {
        currentChunk.push(word);
        currentSize += word.length + 1; // +1 for space
      }
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join(" "));
    }

    return chunks;
  }
}

module.exports = OpenAIService;
