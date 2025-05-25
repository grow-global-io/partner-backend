const OpenAI = require("openai");

/**
 * @description Deepseek service for embeddings and chat completions
 * @class DeepseekService
 */
class DeepseekService {
  constructor() {
    // Deepseek API configuration
    console.log("DeepseekService: Initializing Deepseek API");

    // For chat completions, use Deepseek
    this.chatClient = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: "https://api.deepseek.com/v1",
    });

    // No external API needed for embeddings - using local implementation
    console.log(
      "DeepseekService: Using local text-based embeddings (no external API required)"
    );
  }

  /**
   * @description Generate embeddings for text chunks (using OpenRouter/text similarity)
   * @param {Array<string>} textChunks - Array of text chunks to embed
   * @returns {Promise<Array>} Array of embeddings
   */
  async generateEmbeddings(textChunks) {
    try {
      console.log(
        `DeepseekService: Generating embeddings for ${textChunks.length} chunks`
      );
      const embeddings = [];

      // Since we don't have OpenAI, let's use simple text-based embeddings
      // This will create basic vector representations based on text features
      for (let i = 0; i < textChunks.length; i++) {
        const chunk = textChunks[i];
        const embedding = this.createSimpleEmbedding(chunk);

        embeddings.push({
          text: chunk,
          embedding: embedding,
          metadata: {
            chunkIndex: i,
            tokenCount: this.estimateTokenCount(chunk),
          },
        });
      }

      console.log(
        `DeepseekService: Generated ${embeddings.length} embeddings successfully`
      );
      return embeddings;
    } catch (error) {
      console.error("DeepseekService: Error generating embeddings:", error);
      throw error;
    }
  }

  /**
   * @description Generate embedding for a single query (using simple text-based method)
   * @param {string} query - Query text
   * @returns {Promise<Array>} Embedding vector
   */
  async generateEmbedding(query) {
    try {
      console.log("DeepseekService: Generating query embedding");
      return this.createSimpleEmbedding(query);
    } catch (error) {
      console.error(
        "DeepseekService: Error generating query embedding:",
        error
      );
      throw error;
    }
  }

  /**
   * @description Create simple text-based embedding vector
   * @param {string} text - Text to embed
   * @returns {Array<number>} Simple embedding vector
   */
  createSimpleEmbedding(text) {
    // Create a simple embedding based on text characteristics
    const words = text.toLowerCase().split(/\s+/);
    const chars = text.toLowerCase();

    // Create a 384-dimensional vector (common embedding size)
    const embedding = new Array(384).fill(0);

    // Basic features based on text content
    embedding[0] = words.length / 100; // Normalized word count
    embedding[1] = chars.length / 1000; // Normalized character count
    embedding[2] = (text.match(/[A-Z]/g) || []).length / text.length; // Uppercase ratio
    embedding[3] = (text.match(/\d/g) || []).length / text.length; // Digit ratio
    embedding[4] = (text.match(/[.!?]/g) || []).length / text.length; // Punctuation ratio

    // Word frequency features (simple bag of words approach)
    const wordCounts = {};
    words.forEach((word) => {
      if (word.length > 2) {
        // Ignore very short words
        wordCounts[word] = (wordCounts[word] || 0) + 1;
      }
    });

    // Fill embedding with word hash values
    let index = 5;
    for (const word in wordCounts) {
      if (index >= embedding.length) break;
      const hashValue = this.simpleHash(word) / 1000000; // Normalize hash
      embedding[index] = wordCounts[word] * hashValue;
      index++;
    }

    // Character n-grams for better text representation
    for (let i = 0; i < chars.length - 2 && index < embedding.length; i++) {
      const trigram = chars.substring(i, i + 3);
      const hashValue = this.simpleHash(trigram) / 1000000;
      embedding[index] = hashValue;
      index++;
    }

    // Normalize the embedding vector
    const magnitude = Math.sqrt(
      embedding.reduce((sum, val) => sum + val * val, 0)
    );
    if (magnitude > 0) {
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] /= magnitude;
      }
    }

    return embedding;
  }

  /**
   * @description Simple hash function for text
   * @param {string} str - String to hash
   * @returns {number} Hash value
   */
  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * @description Generate chat completion with context and conversation history (using Deepseek)
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

      // Build conversation messages including history for chain of thought
      const messages = [{ role: "system", content: systemMessage }];

      // Add conversation history (excluding system messages to avoid confusion)
      conversationContext
        .filter((msg) => msg.role !== "system")
        .slice(-6) // Keep last 6 messages for context
        .forEach((msg) => {
          messages.push({
            role: msg.role,
            content: msg.content,
          });
        });

      // Add current query
      messages.push({ role: "user", content: query });

      const response = await this.chatClient.chat.completions.create({
        model: "deepseek-chat", // Latest Deepseek chat model
        messages,
        max_tokens: 2000,
        temperature: 0.7,
        stream: false,
      });

      return {
        answer: response.choices[0].message.content,
        usage: response.usage,
        model: response.model,
        relevantChunks: relevantChunks.length,
        conversationLength: conversationContext.length,
        sources: relevantChunks.map((chunk, index) => ({
          chunkIndex: chunk.metadata?.chunkIndex || index,
          similarity: chunk.similarity || 0,
          preview: chunk.text.substring(0, 100) + "...",
        })),
      };
    } catch (error) {
      console.error(
        "DeepseekService: Error generating chat response with context:",
        error
      );
      throw error;
    }
  }

  /**
   * @description Generate chat completion with context (using Deepseek)
   * @param {string} query - User query
   * @param {Array} relevantChunks - Relevant document chunks
   * @param {string} documentName - Name of the document
   * @returns {Promise<Object>} Chat completion response
   */
  async generateChatResponse(query, relevantChunks, documentName = "document") {
    try {
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

      const response = await this.chatClient.chat.completions.create({
        model: "deepseek-chat", // Latest Deepseek chat model
        messages: [
          { role: "system", content: systemMessage },
          { role: "user", content: query },
        ],
        max_tokens: 2000,
        temperature: 0.7,
        stream: false,
      });

      return {
        answer: response.choices[0].message.content,
        usage: response.usage,
        model: response.model,
        relevantChunks: relevantChunks.length,
        sources: relevantChunks.map((chunk, index) => ({
          chunkIndex: chunk.metadata?.chunkIndex || index,
          similarity: chunk.similarity || 0,
          preview: chunk.text.substring(0, 100) + "...",
        })),
      };
    } catch (error) {
      console.error("DeepseekService: Error generating chat response:", error);
      throw error;
    }
  }

  /**
   * @description Generate streaming chat response (using Deepseek)
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
      const context = relevantChunks
        .map((chunk, index) => `[Context ${index + 1}]: ${chunk.text}`)
        .join("\n\n");

      const systemMessage = `You are a helpful AI assistant that answers questions based on the provided document content. 
            Use the context provided to answer the user's question accurately and comprehensively.
            If the answer cannot be found in the context, clearly state that the information is not available in the document.
            
            Document: ${documentName}
            
            Context:
            ${context}`;

      return await this.chatClient.chat.completions.create({
        model: "deepseek-chat", // Latest Deepseek chat model
        messages: [
          { role: "system", content: systemMessage },
          { role: "user", content: query },
        ],
        max_tokens: 2000,
        temperature: 0.7,
        stream: true,
      });
    } catch (error) {
      console.error(
        "DeepseekService: Error generating streaming response:",
        error
      );
      throw error;
    }
  }

  /**
   * @description Estimate token count for text (rough approximation)
   * @param {string} text - Text to count tokens for
   * @returns {number} Estimated token count
   */
  estimateTokenCount(text) {
    // Rough approximation: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }

  /**
   * @description Split text into chunks for processing
   * @param {string} text - Text to split
   * @param {number} maxChunkSize - Maximum chunk size in characters
   * @param {number} overlap - Overlap between chunks
   * @returns {Array<string>} Array of text chunks
   */
  splitTextIntoChunks(text, maxChunkSize = 1000, overlap = 100) {
    const chunks = [];
    let start = 0;

    while (start < text.length) {
      let end = start + maxChunkSize;

      // Try to split at sentence boundaries
      if (end < text.length) {
        const lastPeriod = text.lastIndexOf(".", end);
        const lastNewline = text.lastIndexOf("\n", end);
        const lastSpace = text.lastIndexOf(" ", end);

        const splitPoint = Math.max(lastPeriod, lastNewline, lastSpace);
        if (splitPoint > start + maxChunkSize * 0.5) {
          end = splitPoint + 1;
        }
      }

      const chunk = text.substring(start, end).trim();
      if (chunk.length > 0) {
        chunks.push(chunk);
      }

      start = end - overlap;
    }

    return chunks;
  }

  /**
   * @description Validate Deepseek API key
   * @returns {Promise<boolean>} True if valid, false otherwise
   */
  async validateApiKey() {
    try {
      await this.chatClient.models.list();
      return true;
    } catch (error) {
      console.error("DeepseekService: Invalid API key:", error.message);
      return false;
    }
  }
}

module.exports = DeepseekService;
