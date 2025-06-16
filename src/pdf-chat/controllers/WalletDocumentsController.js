const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

class WalletDocumentsController {
  async createOrUpdate(req, res) {
    try {
      const { walletId, noOfDocuments } = req.body;

      const walletDocs = await prisma.walletDocuments.upsert({
        where: { walletId },
        update: { noOfDocuments },
        create: { walletId, noOfDocuments },
      });

      return res.json({
        success: true,
        data: walletDocs,
      });
    } catch (error) {
      console.error("Error in createOrUpdate:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to create or update wallet documents",
      });
    }
  }

  async get(req, res) {
    try {
      const { walletId } = req.query;

      let walletDocs = await prisma.walletDocuments.findUnique({
        where: { walletId },
      });

      // If no document exists, create one with default value
      if (!walletDocs) {
        walletDocs = await prisma.walletDocuments.create({
          data: {
            walletId,
            noOfDocuments: 3, // Default value
          },
        });
      }

      return res.json({
        success: true,
        data: walletDocs,
      });
    } catch (error) {
      console.error("Error in get:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to get wallet documents",
      });
    }
  }

  async update(req, res) {
    try {
      const { walletId } = req.params;
      const { noOfDocuments } = req.body;

      const walletDocs = await prisma.walletDocuments.update({
        where: { walletId },
        data: { noOfDocuments },
      });

      return res.json({
        success: true,
        data: walletDocs,
      });
    } catch (error) {
      console.error("Error in update:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to update wallet documents",
      });
    }
  }
}

module.exports = new WalletDocumentsController();
