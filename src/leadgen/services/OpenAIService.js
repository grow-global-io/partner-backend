const { Configuration, OpenAIApi } = require("openai");

/**
 * @description OpenAI service for embeddings and chat completions
 * @class OpenAIService
 */
class OpenAIService {
  constructor() {
    const configuration = new Configuration({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.openai = new OpenAIApi(configuration);
    this.model = "gpt-3.5-turbo-16k";
    this.embeddingModel = "text-embedding-ada-002";
  }

  /**
   * @description Generate embedding for text
   * @param {string} text - Text to generate embedding for
   * @returns {Promise<Array<number>>} Embedding vector
   */
  async generateEmbedding(text) {
    try {
      const response = await this.openai.createEmbedding({
        model: this.embeddingModel,
        input: text,
      });
      return response.data.data[0].embedding;
    } catch (error) {
      console.error("OpenAIService: Error generating embedding:", error);
      throw error;
    }
  }

  /**
   * @description Generate embeddings for multiple texts
   * @param {Array<string>} texts - Array of texts
   * @returns {Promise<Array>} Array of embeddings
   */
  async generateEmbeddings(texts) {
    try {
      const embeddings = [];
      for (const text of texts) {
        const embedding = await this.generateEmbedding(text);
        embeddings.push({
          content: text,
          embedding: embedding,
          metadata: {
            textLength: text.length,
            timestamp: new Date(),
          },
        });
      }
      return embeddings;
    } catch (error) {
      console.error("OpenAIService: Error generating embeddings:", error);
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
      const completion = await this.openai.createChatCompletion({
        model: this.model,
        messages: messages,
        temperature: 0.7,
        max_tokens: 1000,
      });

      return {
        answer: completion.data.choices[0].message.content,
        model: this.model,
        relevantChunks: relevantChunks.length,
        sources: relevantChunks.map((chunk) => ({
          rowIndex: chunk.rowIndex,
          score: chunk.score,
          fileName: fileName,
        })),
        usage: completion.data.usage,
      };
    } catch (error) {
      console.error("OpenAIService: Error generating chat response:", error);
      throw error;
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
