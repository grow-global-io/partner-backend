const OpenAI = require("openai");

/**
 * @description Deepseek service for embeddings and chat completions
 * @class DeepseekService
 */
class DeepseekService {
  constructor() {
    // Deepseek API configuration
    console.log("DeepseekService: Initializing Deepseek API");

    // For embeddings, we'll use OpenAI since Deepseek doesn't provide embeddings
    this.embeddingClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: "https://api.openai.com/v1",
    });

    // For chat completions, use Deepseek
    this.chatClient = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: "https://api.deepseek.com/v1",
    });
  }

  /**
   * @description Generate embeddings for text chunks (using OpenAI)
   * @param {Array<string>} textChunks - Array of text chunks to embed
   * @returns {Promise<Array>} Array of embeddings
   */
  async generateEmbeddings(textChunks) {
    try {
      const embeddings = [];

      // Process chunks in batches to avoid rate limits
      const batchSize = 10;
      for (let i = 0; i < textChunks.length; i += batchSize) {
        const batch = textChunks.slice(i, i + batchSize);

        const response = await this.embeddingClient.embeddings.create({
          model: "text-embedding-3-small",
          input: batch,
        });

        // Extract embeddings from response
        response.data.forEach((embeddingData, index) => {
          embeddings.push({
            text: batch[index],
            embedding: embeddingData.embedding,
            metadata: {
              chunkIndex: i + index,
              tokenCount: this.estimateTokenCount(batch[index]),
            },
          });
        });

        // Add delay to respect rate limits
        if (i + batchSize < textChunks.length) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      return embeddings;
    } catch (error) {
      console.error("DeepseekService: Error generating embeddings:", error);
      throw error;
    }
  }

  /**
   * @description Generate embedding for a single query (using OpenAI)
   * @param {string} query - Query text
   * @returns {Promise<Array>} Embedding vector
   */
  async generateEmbedding(query) {
    try {
      const response = await this.embeddingClient.embeddings.create({
        model: "text-embedding-3-small",
        input: query,
      });

      return response.data[0].embedding;
    } catch (error) {
      console.error(
        "DeepseekService: Error generating query embedding:",
        error
      );
      throw error;
    }
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
