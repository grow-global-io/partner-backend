const OpenAI = require("openai");
const { OpenAIEmbeddings } = require("@langchain/openai");
const { ChatOpenAI } = require("@langchain/openai");

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

    // Langchain OpenAI Embeddings - using newer model with same dimensions
    this.embeddings = new OpenAIEmbeddings({
      openAIApiKey: process.env.OPENAI_API_KEY,
      model: "text-embedding-3-small", // Better model with 1536 dimensions (compatible with existing data)
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
   * @description Exponential backoff delay for retries
   * @param {number} attempt - Attempt number (0-based)
   * @returns {Promise<void>} Promise that resolves after delay
   * @private
   */
  async exponentialBackoff(attempt) {
    const delay = Math.min(1000 * Math.pow(2, attempt), 10000); // Max 10 seconds
    console.log(
      `OpenAIService: Backing off for ${delay}ms (attempt ${attempt + 1})`
    );
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  /**
   * @description Generate embeddings for text chunks with robust error handling
   * @param {Array<string>} textChunks - Array of text chunks to embed
   * @returns {Promise<Array>} Array of embeddings with metadata
   */
  async generateEmbeddings(textChunks) {
    try {
      this.checkRateLimit();

      console.log(
        `OpenAIService: Generating embeddings for ${textChunks.length} chunks`
      );

      const batchSize = 100; // OpenAI recommended batch size
      const embeddings = [];

      for (let i = 0; i < textChunks.length; i += batchSize) {
        const batch = textChunks.slice(i, i + batchSize);
        console.log(
          `OpenAIService: Processing batch ${
            Math.floor(i / batchSize) + 1
          }/${Math.ceil(textChunks.length / batchSize)}`
        );

        let attempts = 0;
        const maxAttempts = 3;

        while (attempts < maxAttempts) {
          try {
            // Use Langchain for robust embedding generation
            const batchEmbeddings = await this.embeddings.embedDocuments(batch);

            // Format results with metadata
            batch.forEach((text, idx) => {
              embeddings.push({
                text: text,
                embedding: batchEmbeddings[idx],
                metadata: {
                  chunkIndex: i + idx,
                  tokenCount: this.estimateTokenCount(text),
                  dimensions: batchEmbeddings[idx].length,
                  model: "text-embedding-3-small",
                },
              });
            });

            this.rateLimitConfig.requestCount++;
            this.rateLimitConfig.tokenCount += batch.reduce(
              (sum, text) => sum + this.estimateTokenCount(text),
              0
            );

            break; // Success, exit retry loop
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
                `OpenAIService: Embedding error, retrying ${attempts}/${maxAttempts}:`,
                error.message
              );
              await this.exponentialBackoff(attempts - 1);
            }
          }
        }

        // Small delay between batches to avoid overwhelming the API
        if (i + batchSize < textChunks.length) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      console.log(
        `OpenAIService: Generated ${embeddings.length} embeddings successfully`
      );
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
   * @description Estimate token count for text (improved approximation)
   * @param {string} text - Text to count tokens for
   * @returns {number} Estimated token count
   */
  estimateTokenCount(text) {
    // Improved approximation based on OpenAI's tokenization
    // Average: ~3.3 characters per token for English text
    return Math.ceil(text.length / 3.3);
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
   * @description Get masked API key for debugging (shows first 4 and last 4 characters)
   * @returns {Object} Masked API key info
   */
  getMaskedApiKey() {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return {
        masked: "NOT_SET",
        length: 0,
        isValid: false,
        error: "OPENAI_API_KEY environment variable is not set",
      };
    }

    if (apiKey.length < 8) {
      return {
        masked: "TOO_SHORT",
        length: apiKey.length,
        isValid: false,
        error: "API key is too short (should be at least 8 characters)",
      };
    }

    const first4 = apiKey.substring(0, 4);
    const last4 = apiKey.substring(apiKey.length - 4);
    const masked = `${first4}${"*".repeat(
      Math.max(0, apiKey.length - 8)
    )}${last4}`;

    return {
      masked,
      length: apiKey.length,
      isValid: apiKey.startsWith("sk-") && apiKey.length > 20,
      startsWithSk: apiKey.startsWith("sk-"),
      error: null,
    };
  }

  /**
   * @description Validate OpenAI API key with comprehensive checks
   * @returns {Promise<boolean>} True if valid and functional, false otherwise
   */
  async validateApiKey() {
    try {
      console.log("OpenAIService: Validating API key...");

      // First check the key format
      const keyInfo = this.getMaskedApiKey();
      console.log(
        `OpenAIService: API key info - ${keyInfo.masked} (length: ${keyInfo.length})`
      );

      if (!keyInfo.isValid) {
        console.error(
          `OpenAIService: API key format invalid - ${keyInfo.error}`
        );
        return false;
      }

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
      const keyInfo = this.getMaskedApiKey();
      console.error(`OpenAIService: Using API key: ${keyInfo.masked}`);
      return false;
    }
  }

  /**
   * @description Test API key with detailed validation result
   * @returns {Promise<Object>} Detailed validation result
   */
  async testApiKey() {
    try {
      const keyInfo = this.getMaskedApiKey();

      if (!keyInfo.isValid) {
        return {
          isValid: false,
          error: keyInfo.error || "API key format is invalid",
          keyInfo,
          details:
            "Check that your API key starts with 'sk-' and is the correct length",
        };
      }

      // Make a simple API call to test the key
      const response = await this.client.models.list();

      return {
        isValid: true,
        error: null,
        keyInfo,
        testResult: "API key is valid and working",
        modelCount: response.data.length,
        hasGPT4: response.data.some((model) => model.id.includes("gpt-4")),
      };
    } catch (error) {
      const keyInfo = this.getMaskedApiKey();

      return {
        isValid: false,
        error: error.message,
        keyInfo,
        testResult: "API key validation failed",
        details:
          error.status === 401
            ? "Invalid API key - check your key is correct"
            : error.status === 429
            ? "Rate limit exceeded - try again later"
            : "Network or API error",
      };
    }
  }

  /**
   * @description Get service health status
   * @returns {Promise<Object>} Health status information
   */
  async getHealthStatus() {
    try {
      const keyInfo = this.getMaskedApiKey();
      const isValid = await this.validateApiKey();

      return {
        status: isValid ? "healthy" : "unhealthy",
        apiKey: {
          configured: process.env.OPENAI_API_KEY ? true : false,
          masked: keyInfo.masked,
          length: keyInfo.length,
          validFormat: keyInfo.isValid,
          startsWithSk: keyInfo.startsWithSk,
        },
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
      const keyInfo = this.getMaskedApiKey();
      return {
        status: "error",
        error: error.message,
        apiKey: {
          configured: process.env.OPENAI_API_KEY ? true : false,
          masked: keyInfo.masked,
          length: keyInfo.length,
          validFormat: keyInfo.isValid,
          startsWithSk: keyInfo.startsWithSk,
        },
        lastValidation: new Date().toISOString(),
      };
    }
  }
}

module.exports = OpenAIService;
