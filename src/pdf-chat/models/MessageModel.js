const { MongoClient } = require("mongodb");
const { v4: uuidv4 } = require("uuid");

/**
 * @description Message model for storing chat conversations
 * @class MessageModel
 */
class MessageModel {
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
      this.collection = this.db.collection("chat_messages");

      // Create indexes for better performance
      await this.collection.createIndex({ walletId: 1 });
      await this.collection.createIndex({ conversationId: 1 });
      await this.collection.createIndex({ documentId: 1 });
      await this.collection.createIndex({ timestamp: -1 });
      await this.collection.createIndex({
        walletId: 1,
        conversationId: 1,
        timestamp: 1,
      });

      console.log("MessageModel: Connected to MongoDB");
    } catch (error) {
      console.error("MessageModel: Connection error:", error);
      throw error;
    }
  }

  /**
   * @description Store a chat message
   * @param {Object} messageData - Message data to store
   * @returns {Promise<Object>} Stored message
   */
  async storeMessage(messageData) {
    try {
      const message = {
        messageId: messageData.messageId || uuidv4(),
        conversationId: messageData.conversationId || uuidv4(),
        walletId: messageData.walletId,
        documentId: messageData.documentId || null,
        documentName: messageData.documentName || null,
        message: messageData.message,
        sender: messageData.sender, // 'user', 'assistant', 'system'
        messageType: messageData.messageType, // 'query', 'response', 'system', 'error'
        timestamp: new Date(),
        metadata: {
          tokenUsage: messageData.tokenUsage || null,
          relevantSources: messageData.relevantSources || [],
          similarity: messageData.similarity || null,
          model: messageData.model || null,
          responseTime: messageData.responseTime || null,
          userAgent: messageData.userAgent || null,
          ipAddress: messageData.ipAddress || null,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await this.collection.insertOne(message);
      return { ...message, _id: result.insertedId };
    } catch (error) {
      console.error("MessageModel: Error storing message:", error);
      throw error;
    }
  }

  /**
   * @description Get messages by wallet ID with pagination
   * @param {string} walletId - User's wallet ID
   * @param {number} page - Page number (default: 1)
   * @param {number} limit - Number of messages per page (default: 50)
   * @param {string} documentId - Optional: filter by document ID
   * @returns {Promise<Object>} Messages with pagination info
   */
  async getMessagesByWallet(walletId, page = 1, limit = 50, documentId = null) {
    try {
      const skip = (page - 1) * limit;
      const query = { walletId };

      if (documentId) {
        query.documentId = documentId;
      }

      const messages = await this.collection
        .find(query)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      const totalCount = await this.collection.countDocuments(query);
      const totalPages = Math.ceil(totalCount / limit);

      return {
        messages: messages.reverse(), // Reverse to show chronological order
        pagination: {
          currentPage: page,
          totalPages,
          totalMessages: totalCount,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
          messagesPerPage: limit,
        },
      };
    } catch (error) {
      console.error("MessageModel: Error fetching messages:", error);
      throw error;
    }
  }

  /**
   * @description Get messages by conversation ID
   * @param {string} conversationId - Conversation ID
   * @param {string} walletId - User's wallet ID for security
   * @returns {Promise<Array>} Array of messages in conversation
   */
  async getConversationMessages(conversationId, walletId) {
    try {
      const messages = await this.collection
        .find({ conversationId, walletId })
        .sort({ timestamp: 1 })
        .toArray();

      return messages;
    } catch (error) {
      console.error("MessageModel: Error fetching conversation:", error);
      throw error;
    }
  }

  /**
   * @description Get all conversations for a wallet ID
   * @param {string} walletId - User's wallet ID
   * @param {number} page - Page number (default: 1)
   * @param {number} limit - Number of conversations per page (default: 20)
   * @returns {Promise<Object>} Conversations with pagination
   */
  async getConversationsByWallet(walletId, page = 1, limit = 20) {
    try {
      const skip = (page - 1) * limit;

      // Aggregate to get conversation summaries
      const pipeline = [
        { $match: { walletId } },
        {
          $group: {
            _id: "$conversationId",
            lastMessage: { $last: "$message" },
            lastSender: { $last: "$sender" },
            lastTimestamp: { $last: "$timestamp" },
            messageCount: { $sum: 1 },
            documentId: { $last: "$documentId" },
            documentName: { $last: "$documentName" },
            firstMessage: { $first: "$message" },
            firstTimestamp: { $first: "$timestamp" },
          },
        },
        { $sort: { lastTimestamp: -1 } },
        { $skip: skip },
        { $limit: limit },
      ];

      const conversations = await this.collection.aggregate(pipeline).toArray();

      // Get total count for pagination
      const totalCountPipeline = [
        { $match: { walletId } },
        { $group: { _id: "$conversationId" } },
        { $count: "total" },
      ];

      const totalCountResult = await this.collection
        .aggregate(totalCountPipeline)
        .toArray();
      const totalCount = totalCountResult[0]?.total || 0;
      const totalPages = Math.ceil(totalCount / limit);

      // Format conversations
      const formattedConversations = conversations.map((conv) => ({
        conversationId: conv._id,
        title: this.generateConversationTitle(conv.firstMessage),
        lastMessage: conv.lastMessage,
        lastSender: conv.lastSender,
        lastTimestamp: conv.lastTimestamp,
        messageCount: conv.messageCount,
        documentId: conv.documentId,
        documentName: conv.documentName,
        firstTimestamp: conv.firstTimestamp,
      }));

      return {
        conversations: formattedConversations,
        pagination: {
          currentPage: page,
          totalPages,
          totalConversations: totalCount,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
          conversationsPerPage: limit,
        },
      };
    } catch (error) {
      console.error("MessageModel: Error fetching conversations:", error);
      throw error;
    }
  }

  /**
   * @description Get message statistics for a wallet
   * @param {string} walletId - User's wallet ID
   * @returns {Promise<Object>} Message statistics
   */
  async getMessageStatistics(walletId) {
    try {
      const pipeline = [
        { $match: { walletId } },
        {
          $group: {
            _id: null,
            totalMessages: { $sum: 1 },
            totalConversations: { $addToSet: "$conversationId" },
            totalDocuments: { $addToSet: "$documentId" },
            userMessages: {
              $sum: { $cond: [{ $eq: ["$sender", "user"] }, 1, 0] },
            },
            assistantMessages: {
              $sum: { $cond: [{ $eq: ["$sender", "assistant"] }, 1, 0] },
            },
            firstMessageDate: { $min: "$timestamp" },
            lastMessageDate: { $max: "$timestamp" },
            totalTokens: { $sum: "$metadata.tokenUsage.total_tokens" },
          },
        },
        {
          $project: {
            totalMessages: 1,
            totalConversations: { $size: "$totalConversations" },
            totalDocuments: {
              $size: {
                $filter: {
                  input: "$totalDocuments",
                  cond: { $ne: ["$$this", null] },
                },
              },
            },
            userMessages: 1,
            assistantMessages: 1,
            firstMessageDate: 1,
            lastMessageDate: 1,
            totalTokens: 1,
          },
        },
      ];

      const result = await this.collection.aggregate(pipeline).toArray();
      return (
        result[0] || {
          totalMessages: 0,
          totalConversations: 0,
          totalDocuments: 0,
          userMessages: 0,
          assistantMessages: 0,
          firstMessageDate: null,
          lastMessageDate: null,
          totalTokens: 0,
        }
      );
    } catch (error) {
      console.error("MessageModel: Error getting statistics:", error);
      throw error;
    }
  }

  /**
   * @description Delete a conversation
   * @param {string} conversationId - Conversation ID
   * @param {string} walletId - User's wallet ID for security
   * @returns {Promise<boolean>} Success status
   */
  async deleteConversation(conversationId, walletId) {
    try {
      const result = await this.collection.deleteMany({
        conversationId,
        walletId,
      });
      return result.deletedCount > 0;
    } catch (error) {
      console.error("MessageModel: Error deleting conversation:", error);
      throw error;
    }
  }

  /**
   * @description Delete all messages for a wallet
   * @param {string} walletId - User's wallet ID
   * @returns {Promise<number>} Number of deleted messages
   */
  async deleteAllMessagesForWallet(walletId) {
    try {
      const result = await this.collection.deleteMany({ walletId });
      return result.deletedCount;
    } catch (error) {
      console.error("MessageModel: Error deleting wallet messages:", error);
      throw error;
    }
  }

  /**
   * @description Generate conversation title from first message
   * @private
   * @param {string} firstMessage - First message in conversation
   * @returns {string} Generated title
   */
  generateConversationTitle(firstMessage) {
    if (!firstMessage) return "New Conversation";

    // Truncate and clean the message for title
    const cleaned = firstMessage
      .replace(/[^\w\s]/g, "")
      .trim()
      .substring(0, 50);

    return cleaned || "New Conversation";
  }

  /**
   * @description Search messages by content
   * @param {string} walletId - User's wallet ID
   * @param {string} searchQuery - Search query
   * @param {number} page - Page number (default: 1)
   * @param {number} limit - Number of results per page (default: 20)
   * @returns {Promise<Object>} Search results with pagination
   */
  async searchMessages(walletId, searchQuery, page = 1, limit = 20) {
    try {
      const skip = (page - 1) * limit;

      const query = {
        walletId,
        message: { $regex: searchQuery, $options: "i" },
      };

      const messages = await this.collection
        .find(query)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      const totalCount = await this.collection.countDocuments(query);
      const totalPages = Math.ceil(totalCount / limit);

      return {
        messages,
        searchQuery,
        pagination: {
          currentPage: page,
          totalPages,
          totalResults: totalCount,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
          resultsPerPage: limit,
        },
      };
    } catch (error) {
      console.error("MessageModel: Error searching messages:", error);
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
      console.log("MessageModel: Database connection closed");
    }
  }

  /**
   * @description Get all messages for a specific document (document-centric conversation)
   * @param {string} walletId - User's wallet ID
   * @param {string} documentId - Document ID
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Messages for the document
   */
  static async getMessagesByDocumentId(walletId, documentId, options = {}) {
    try {
      const {
        page = 1,
        limit = 50,
        sortOrder = "asc", // For conversation order (oldest first)
      } = options;

      const skip = (page - 1) * limit;

      // Build query for document-specific messages
      const query = {
        walletId,
        documentId,
      };

      // Get messages with pagination
      const messages = await Message.find(query)
        .sort({ timestamp: sortOrder === "asc" ? 1 : -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      // Get total count for pagination
      const totalMessages = await Message.countDocuments(query);

      // Calculate pagination info
      const totalPages = Math.ceil(totalMessages / limit);
      const hasNextPage = page < totalPages;
      const hasPrevPage = page > 1;

      return {
        success: true,
        data: {
          messages: messages.map((msg) => ({
            messageId: msg.messageId,
            message: msg.message,
            sender: msg.sender,
            messageType: msg.messageType,
            timestamp: msg.timestamp,
            metadata: msg.metadata,
            relevantSources: msg.relevantSources,
          })),
          documentId,
          pagination: {
            currentPage: page,
            totalPages,
            totalMessages,
            hasNextPage,
            hasPrevPage,
            limit,
          },
        },
      };
    } catch (error) {
      console.error(
        "MessageModel: Error getting messages by document ID:",
        error
      );
      return {
        success: false,
        error: "Failed to retrieve document messages",
        details: error.message,
      };
    }
  }

  /**
   * @description Get conversation context for a document (for chain of thought)
   * @param {string} walletId - User's wallet ID
   * @param {string} documentId - Document ID
   * @param {number} contextLimit - Number of recent messages to include
   * @returns {Promise<Array>} Recent conversation messages for context
   */
  static async getDocumentConversationContext(
    walletId,
    documentId,
    contextLimit = 10
  ) {
    try {
      const query = {
        walletId,
        documentId,
      };

      // Get recent messages for conversation context
      const messages = await Message.find(query)
        .sort({ timestamp: -1 }) // Most recent first
        .limit(contextLimit)
        .select("message sender messageType timestamp")
        .lean();

      // Return in chronological order for context
      return messages.reverse().map((msg) => ({
        role: msg.sender === "user" ? "user" : "assistant",
        content: msg.message,
        timestamp: msg.timestamp,
      }));
    } catch (error) {
      console.error(
        "MessageModel: Error getting document conversation context:",
        error
      );
      return [];
    }
  }

  /**
   * @description Store a message for a specific document
   * @param {Object} messageData - Message data
   * @returns {Promise<Object>} Stored message result
   */
  static async storeDocumentMessage(messageData) {
    try {
      const {
        walletId,
        documentId,
        message,
        sender,
        messageType = "query",
        metadata = {},
        relevantSources = [],
      } = messageData;

      // Validate required fields
      if (!walletId || !documentId || !message || !sender) {
        return {
          success: false,
          error:
            "Missing required fields: walletId, documentId, message, sender",
        };
      }

      const messageId = uuidv4();
      const timestamp = new Date();

      const newMessage = new Message({
        messageId,
        walletId,
        documentId,
        message,
        sender,
        messageType,
        timestamp,
        metadata: {
          ...metadata,
          documentSpecific: true,
          conversationContext: true,
        },
        relevantSources,
      });

      await newMessage.save();

      return {
        success: true,
        data: {
          messageId,
          message,
          sender,
          messageType,
          timestamp,
          documentId,
          metadata: newMessage.metadata,
        },
      };
    } catch (error) {
      console.error("MessageModel: Error storing document message:", error);
      return {
        success: false,
        error: "Failed to store document message",
        details: error.message,
      };
    }
  }

  /**
   * @description Get document conversation summary/info
   * @param {string} walletId - User's wallet ID
   * @param {string} documentId - Document ID
   * @returns {Promise<Object>} Document conversation summary
   */
  static async getDocumentConversationSummary(walletId, documentId) {
    try {
      const query = { walletId, documentId };

      // Get conversation statistics
      const totalMessages = await Message.countDocuments(query);
      const userMessages = await Message.countDocuments({
        ...query,
        sender: "user",
      });
      const assistantMessages = await Message.countDocuments({
        ...query,
        sender: "assistant",
      });

      // Get first and last message timestamps
      const firstMessage = await Message.findOne(query)
        .sort({ timestamp: 1 })
        .select("timestamp")
        .lean();

      const lastMessage = await Message.findOne(query)
        .sort({ timestamp: -1 })
        .select("timestamp")
        .lean();

      return {
        success: true,
        data: {
          documentId,
          totalMessages,
          userMessages,
          assistantMessages,
          firstMessageAt: firstMessage?.timestamp || null,
          lastMessageAt: lastMessage?.timestamp || null,
          hasConversation: totalMessages > 0,
        },
      };
    } catch (error) {
      console.error(
        "MessageModel: Error getting document conversation summary:",
        error
      );
      return {
        success: false,
        error: "Failed to get document conversation summary",
        details: error.message,
      };
    }
  }

  /**
   * @description Get all documents with conversation summaries for a wallet
   * @param {string} walletId - User's wallet ID
   * @returns {Promise<Object>} Documents with conversation info
   */
  static async getDocumentsWithConversations(walletId) {
    try {
      // Get all unique documents for this wallet from messages
      const documentStats = await Message.aggregate([
        { $match: { walletId } },
        {
          $group: {
            _id: "$documentId",
            totalMessages: { $sum: 1 },
            userMessages: {
              $sum: { $cond: [{ $eq: ["$sender", "user"] }, 1, 0] },
            },
            assistantMessages: {
              $sum: { $cond: [{ $eq: ["$sender", "assistant"] }, 1, 0] },
            },
            firstMessage: { $min: "$timestamp" },
            lastMessage: { $max: "$timestamp" },
          },
        },
        {
          $project: {
            documentId: "$_id",
            totalMessages: 1,
            userMessages: 1,
            assistantMessages: 1,
            firstMessageAt: "$firstMessage",
            lastMessageAt: "$lastMessage",
            _id: 0,
          },
        },
        { $sort: { lastMessageAt: -1 } },
      ]);

      return {
        success: true,
        data: {
          walletId,
          documents: documentStats,
          totalDocuments: documentStats.length,
        },
      };
    } catch (error) {
      console.error(
        "MessageModel: Error getting documents with conversations:",
        error
      );
      return {
        success: false,
        error: "Failed to get documents with conversations",
        details: error.message,
      };
    }
  }

  /**
   * @description Get messages by document ID only (without walletId requirement) with pagination
   * @param {string} documentId - Document ID
   * @param {number} page - Page number (default: 1)
   * @param {number} limit - Number of messages per page (default: 50)
   * @returns {Promise<Object>} Messages with pagination info
   */
  async getMessagesByDocument(documentId, page = 1, limit = 50) {
    try {
      const skip = (page - 1) * limit;
      const query = { documentId };

      const messages = await this.collection
        .find(query)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      const totalCount = await this.collection.countDocuments(query);
      const totalPages = Math.ceil(totalCount / limit);

      return {
        messages: messages.reverse(), // Reverse to show chronological order
        pagination: {
          currentPage: page,
          totalPages,
          totalMessages: totalCount,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
          messagesPerPage: limit,
        },
      };
    } catch (error) {
      console.error(
        "MessageModel: Error fetching messages by document:",
        error
      );
      throw error;
    }
  }
}

module.exports = MessageModel;
