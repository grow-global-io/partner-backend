const express = require("express");
const prisma = require("../config/db");
const { encryptJSON } = require("../config/encrypt");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const router = express.Router();
const AWS = require("aws-sdk");
const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");

// Initialize bot with your token
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// OpenRouter API configuration
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = process.env.OPENROUTER_URL;

// Initialize AWS S3
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || "eu-north-1",
});

// Function to upload file to S3
async function uploadToS3(fileId, chatId) {
  try {
    // Download file from Telegram
    const file = await bot.getFile(fileId);
    const filePath = file.file_path;
    const response = await axios({
      url: `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`,
      method: "GET",
      responseType: "stream",
    });

    // Generate unique filename
    const filename = `seller-products/${chatId}-${Date.now()}${path.extname(
      filePath
    )}`;

    // Upload to S3
    const uploadResult = await s3
      .upload({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: filename,
        Body: response.data,
        ContentType: "image/jpeg", // Adjust content type as needed
      })
      .promise();

    return uploadResult.Location;
  } catch (error) {
    console.error("Error uploading to S3:", error);
    throw error;
  }
}

// Track users waiting to provide email
const usersAwaitingEmail = new Set();

// Track users in linking process
const usersLinking = new Set();

// Track messages per chat
const chatMessages = new Map();

// Track manufacturer registration progress
const manufacturerRegistration = new Map();

// Track verification process
const verificationProcess = new Map();

// Track store creation process
const storeCreation = new Map();

// Track story creation process
const storyCreation = new Map();

// Add product type keyboard
const productTypeKeyboard = {
  keyboard: [
    ["Clothing", "Shoes", "Jewelry"],
    ["Beauty Products", "Electronics"],
    ["Food & Beverages", "Handcrafted Products"],
    ["Books", "Home Decor & Furniture"],
    ["Pet Supplies"],
  ],
  resize_keyboard: true,
  one_time_keyboard: true,
};

// Add product type validation constant
const VALID_PRODUCT_TYPES = [
  "Clothing",
  "Shoes",
  "Jewelry",
  "Beauty Products",
  "Electronics",
  "Food & Beverages",
  "Handcrafted Products",
  "Books",
  "Home Decor & Furniture",
  "Pet Supplies",
];

// Step definitions for manufacturer registration
const MANUFACTURER_STEPS = {
  1: {
    message: "🧵 Step 1 of 6\n\nWhat is the name of your product?",
    field: "productName",
  },
  2: {
    message: "📸 Step 2 of 6\n\nUpload a clear photo of your product.",
    field: "productPhoto",
  },
  3: {
    message: "📝 Step 3 of 6\n\nGive a short 1–2 line description.",
    field: "description",
  },
  4: {
    message: "🏷️ Step 4 of 6\n\nSelect your product type:",
    field: "productType",
    keyboard: productTypeKeyboard,
  },
  5: {
    message: "📍 Step 5 of 6\n\nWhere is this product made? (City, State)",
    field: "location",
  },
  6: {
    message: "🛒 Step 6 of 6\n\nDo you sell this product online?",
    field: "sellsOnline",
    keyboard: {
      keyboard: [["✅ Yes", "❌ No"]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  },
};

// Step definitions for business verification
const VERIFICATION_STEPS = {
  1: {
    message: "🪪 Step 1 of 3\n\nPlease upload your Aadhar Card or Passport.",
    field: "aadharDoc",
    type: "document",
  },
  2: {
    message:
      "🧾 Step 2 of 3\n\nPlease upload your UDYAM Registration or GST Certificate.",
    field: "gstDoc",
    type: "document",
  },
  3: {
    message:
      "📱 Step 3 of 3\n\nPlease share your WhatsApp number with country code.\nExample: +91 9400123456",
    field: "whatsappNumber",
    type: "text",
  },
};

// Step definitions for store creation
const STORE_STEPS = {
  1: {
    message: "🛍️ Step 1 of 4\n\nWhat would you like to name your store?",
    field: "storeName",
  },
  2: {
    message:
      '📍 Step 2 of 4\n\nTagline (e.g., "Handcrafted with love in Telangana")',
    field: "storeTagline",
  },
  3: {
    message: "📸 Step 3 of 4\n\nUpload a store logo or banner:",
    field: "storeLogo",
    type: "photo",
  },
  4: {
    message:
      "🔗 Step 4 of 4\n\nAny social links to add? (Instagram, WhatsApp, YouTube)\nJust paste the URL:",
    field: "socialLinks",
  },
};

// Step definitions for story creation
const STORY_STEPS = {
  1: {
    message:
      "🎤 Buyers love to hear your story!\n\n" +
      "Please record a short 60-sec voice or video intro about:\n" +
      "- What you make\n" +
      "- Why you started\n" +
      "- Your hometown\n\n" +
      "Upload your voice note or video now.",
    field: "storyMedia",
    type: "media",
  },
  2: {
    message:
      "📦 Want to send a sample to our regional GLL Hub?\n" +
      "We'll help ship it!",
    field: "sampleRequested",
    keyboard: {
      keyboard: [["✅ Yes, send sample"], ["❌ No, maybe later"]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  },
};

// Add new keyboard layout for verification options
const verificationOptionsKeyboard = {
  keyboard: [["✅ Verify Business"], ["🏠 Back to Home"]],
  resize_keyboard: true,
};

// Add new keyboard layout for trust building options
const trustBuildingKeyboard = {
  keyboard: [["Build Trust with Story & Sample"], ["🏠 Back to Home"]],
  resize_keyboard: true,
};

// Add Weekly Missions keyboard layout
const weeklyMissionsKeyboard = {
  keyboard: [
    ["✅ Add another product"],
    ["✅ Invite 2 friends to join"],
    ["✅ Share your store on WhatsApp"],
    ["🏠 Back to Home"],
  ],
  resize_keyboard: true,
};

// Add Weekly Mission Product Steps
const WEEKLY_PRODUCT_STEPS = {
  1: {
    message: "🧵 Step 1 of 6\n\nWhat is the name of your product?",
    field: "productName",
  },
  2: {
    message: "📸 Step 2 of 6\n\nUpload a clear photo of your product.",
    field: "productPhoto",
  },
  3: {
    message: "📝 Step 3 of 6\n\nGive a short 1–2 line description.",
    field: "description",
  },
  4: {
    message: "🏷️ Step 4 of 6\n\nSelect your product type:",
    field: "productType",
    keyboard: productTypeKeyboard,
  },
  5: {
    message: "📍 Step 5 of 6\n\nWhere is this product made? (City, State)",
    field: "location",
  },
  6: {
    message: "🛒 Step 6 of 6\n\nDo you sell this product online?",
    field: "sellsOnline",
    keyboard: {
      keyboard: [["✅ Yes", "❌ No"]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  },
};

// Track weekly mission product registration
const weeklyProductRegistration = new Map();

// Add registration confirmation keyboard
const registrationConfirmKeyboard = {
  keyboard: [["✅ Yes, Register Now"], ["❌ No, I'll Register Later"]],
  resize_keyboard: true,
  one_time_keyboard: true,
};

// Add registration steps definition
const REGISTRATION_STEPS = {
  1: {
    message: "👤 Please enter your full name:",
    field: "name",
  },
  2: {
    message:
      "📱 Please enter your phone number with ISD code:\nExample: +91 9400123456",
    field: "phone",
  },
};

// Track registration process
const registrationProcess = new Map();

// Function to handle manufacturer registration steps
async function handleManufacturerStep(chatId, input, currentStep = 1) {
  try {
    let registration = manufacturerRegistration.get(chatId) || {};

    // If this is the first step, get the user's email
    if (currentStep === 1 && !registration.email) {
      const user = await prisma.user.findFirst({
        where: {
          telegramId: chatId.toString(),
        },
      });

      if (!user) {
        await sendMessageWithTracking(
          chatId,
          "❌ Please link your account first!\n\n" +
            "Use /start command to link your GLL account before registering as a seller.",
          { reply_markup: mainKeyboard }
        );
        manufacturerRegistration.delete(chatId);
        return;
      }

      registration.email = user.email;
      manufacturerRegistration.set(chatId, registration);
    }

    // Handle current step input if not first step
    if (currentStep > 1) {
      const prevStep = MANUFACTURER_STEPS[currentStep - 1];

      // Special handling for photo upload (Step 2)
      if (currentStep - 1 === 2) {
        try {
          const imageUrl = await uploadToS3(input, chatId);
          registration[prevStep.field] = imageUrl;
        } catch (error) {
          console.error("Error uploading image:", error);
          await sendMessageWithTracking(
            chatId,
            "❌ Failed to upload image. Please try again.",
            { reply_markup: { remove_keyboard: true } }
          );
          return;
        }
      } else if (currentStep - 1 === 4) {
        // Validate product type selection
        if (!VALID_PRODUCT_TYPES.includes(input)) {
          await sendMessageWithTracking(
            chatId,
            "❌ Please select a valid product type from the menu.",
            { reply_markup: productTypeKeyboard }
          );
          return;
        }
        registration[prevStep.field] = input;
      } else if (currentStep - 1 === 6) {
        // Handle Yes/No in final step
        if (!["✅ Yes", "❌ No"].includes(input)) {
          await sendMessageWithTracking(
            chatId,
            "❌ Please select either Yes or No using the buttons provided.",
            { reply_markup: MANUFACTURER_STEPS[6].keyboard }
          );
          return;
        }
        input = input === "✅ Yes"; // Convert to boolean
        registration[prevStep.field] = input;
      } else {
        registration[prevStep.field] = input;
      }
      manufacturerRegistration.set(chatId, registration);
    }

    // If all steps are completed
    if (currentStep > 6) {
      try {
        // console.log('Registration data to save:', registration);

        // Create product object with proper typing
        const productData = {
          productName: registration.productName,
          productImage: registration.productPhoto,
          description: registration.description,
          productType: registration.productType,
          location: registration.location,
          sellsOnline: registration.sellsOnline,
          addedAt: new Date(),
          updatedAt: new Date(),
        };

        // console.log('Saving product with data:', productData);

        // Try to find existing seller
        let seller = await prisma.GGASeller.findUnique({
          where: {
            email: registration.email,
          },
          select: {
            email: true,
            products: true,
          },
        });

        if (seller) {
          // Update existing seller
          seller = await prisma.GGASeller.update({
            where: {
              email: registration.email,
            },
            data: {
              products: {
                push: productData,
              },
              updatedAt: new Date(),
            },
            select: {
              email: true,
              products: true,
            },
          });
          // console.log('Updated seller products:', seller.products);
        } else {
          // Create new seller
          seller = await prisma.GGASeller.create({
            data: {
              email: registration.email,
              sellerType: registration.sellerType,
              isVerified: false,
              products: [productData],
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            select: {
              email: true,
              products: true,
            },
          });
          // console.log('Created new seller with products:', seller.products);
        }

        // Update user's GLL balance
        await prisma.user.update({
          where: {
            email: registration.email,
          },
          data: {
            gllBalance: {
              increment: 10,
            },
          },
        });

        // Get user details for personalized message
        const user = await prisma.user.findUnique({
          where: {
            email: registration.email,
          },
        });

        // Extract name from email (before @) and capitalize first letter
        const sellerName = user?.name || registration.email.split("@")[0];
        const capitalizedName =
          sellerName.charAt(0).toUpperCase() + sellerName.slice(1);

        // Send completion message with new options
        await sendMessageWithTracking(
          chatId,
          `🎉 Thank you, ${capitalizedName}!\n\n` +
            `🛍️ Product: ${registration.productName}\n` +
            `🏷️ Type: ${registration.productType}\n` +
            `📍 Made in: ${registration.location}\n` +
            `${
              registration.sellsOnline
                ? "✅ Online seller"
                : "❌ Offline seller"
            }\n` +
            `👥 Type: ${registration.sellerType}\n\n` +
            `🎁 +10 GLL Ions added to your wallet.\n\n` +
            `What would you like to do next?\n` +
            `✅ Verify your business to become a certified exporter\n` +
            `🏠 Return to main menu`,
          {
            parse_mode: "Markdown",
            reply_markup: verificationOptionsKeyboard,
          }
        );

        // Clear registration data
        manufacturerRegistration.delete(chatId);
        return;
      } catch (error) {
        console.error("Error saving registration:", error);
        await sendMessageWithTracking(
          chatId,
          "❌ An error occurred while saving your registration. Please try again later.",
          { reply_markup: mainKeyboard }
        );
        manufacturerRegistration.delete(chatId);
        return;
      }
    }

    // Send current step message
    const step = MANUFACTURER_STEPS[currentStep];
    await sendMessageWithTracking(chatId, step.message, {
      reply_markup: step.keyboard || { remove_keyboard: true },
    });

    // Update registration object with new step
    registration.currentStep = currentStep;
    manufacturerRegistration.set(chatId, registration);
  } catch (error) {
    console.error("Error in manufacturer registration:", error);
    await sendMessageWithTracking(
      chatId,
      "❌ An error occurred. Please try again later.",
      { reply_markup: mainKeyboard }
    );
    manufacturerRegistration.delete(chatId);
  }
}

// Function to start verification process
async function startVerification(chatId) {
  try {
    // Get user's email
    const user = await prisma.user.findFirst({
      where: {
        telegramId: chatId.toString(),
      },
    });

    if (!user) {
      await sendMessageWithTracking(
        chatId,
        "❌ Please link your account first!",
        { reply_markup: mainKeyboard }
      );
      return;
    }

    // Initialize verification process
    verificationProcess.set(chatId, {
      email: user.email,
      currentStep: 1,
    });

    // Send welcome message
    await sendMessageWithTracking(
      chatId,
      "🪪 *Business Verification / KYC*\n\n" +
        "To verify your business, please upload the following:\n\n" +
        "📄 Aadhar / Passport\n" +
        "🧾 UDYAM / GST certificate\n" +
        "📱 WhatsApp Number\n" +
        `📧 Email (already saved: ${user.email})\n\n` +
        "Let's start with your first document 👇",
      {
        parse_mode: "Markdown",
        reply_markup: { remove_keyboard: true },
      }
    );

    // Start first step
    await handleVerificationStep(chatId, null, 1);
  } catch (error) {
    console.error("Error starting verification:", error);
    await sendMessageWithTracking(
      chatId,
      "❌ An error occurred. Please try again later.",
      { reply_markup: mainKeyboard }
    );
  }
}

// Function to handle verification steps
async function handleVerificationStep(chatId, input, currentStep = 1) {
  try {
    let verification = verificationProcess.get(chatId) || {};

    // Handle current step input if not first step
    if (currentStep > 1 && input) {
      const prevStep = VERIFICATION_STEPS[currentStep - 1];

      if (prevStep.type === "document") {
        try {
          const docUrl = await uploadToS3(input, `${chatId}-${prevStep.field}`);
          verification[prevStep.field] = docUrl;
        } catch (error) {
          console.error("Error uploading document:", error);
          await sendMessageWithTracking(
            chatId,
            "❌ Failed to upload document. Please try again.",
            { reply_markup: { remove_keyboard: true } }
          );
          return;
        }
      } else {
        // Validate WhatsApp number
        if (prevStep.field === "whatsappNumber") {
          // Remove all spaces and any other non-numeric characters except +
          const cleanNumber = input.replace(/[^\d+]/g, "");

          // Check if number starts with + and country code
          if (!cleanNumber.startsWith("+")) {
            await sendMessageWithTracking(
              chatId,
              "❌ Please include the country code starting with +\nExample: +91 9400123456",
              { reply_markup: { remove_keyboard: true } }
            );
            return;
          }

          // Validate Indian numbers (+91) specifically
          if (cleanNumber.startsWith("+91")) {
            // Should be +91 followed by 10 digits
            if (cleanNumber.length !== 13) {
              await sendMessageWithTracking(
                chatId,
                "❌ Invalid Indian phone number. Please enter 10 digits after +91\nExample: +91 9400123456",
                { reply_markup: { remove_keyboard: true } }
              );
              return;
            }
          } else {
            // For other country codes, ensure reasonable length (country code + 8-12 digits)
            if (cleanNumber.length < 10 || cleanNumber.length > 15) {
              await sendMessageWithTracking(
                chatId,
                "❌ Invalid phone number length. Please check your country code and number.\nExample format: +91 9400123456",
                { reply_markup: { remove_keyboard: true } }
              );
              return;
            }
          }

          // Format the number with proper spacing
          let formattedNumber;
          if (cleanNumber.startsWith("+91")) {
            formattedNumber = `${cleanNumber.slice(0, 3)} ${cleanNumber.slice(
              3
            )}`;
          } else {
            // For other country codes, add space after code
            const codeEnd = cleanNumber.indexOf("+") + 2;
            formattedNumber = `${cleanNumber.slice(
              0,
              codeEnd
            )} ${cleanNumber.slice(codeEnd)}`;
          }

          verification[prevStep.field] = formattedNumber;
        } else {
          verification[prevStep.field] = input;
        }
      }
      verificationProcess.set(chatId, verification);
    }

    // If all steps are completed
    if (currentStep > 3) {
      try {
        // Get user details
        const user = await prisma.user.findUnique({
          where: { email: verification.email },
        });

        // Get seller details
        const seller = await prisma.GGASeller.findUnique({
          where: { email: verification.email },
        });

        // console.log('Generating certificate for:', user.email);

        // Generate certificate
        const certificateUrl = await generateCertificate(seller, user);

        // console.log('Certificate generated:', certificateUrl);

        // Update seller record with verification details
        const updatedSeller = await prisma.GGASeller.update({
          where: {
            email: verification.email,
          },
          data: {
            aadharDoc: verification.aadharDoc,
            gstDoc: verification.gstDoc,
            whatsappNumber: verification.whatsappNumber,
            isVerified: true,
            verifiedAt: new Date(),
            certificateUrl: certificateUrl,
          },
        });

        // Update user's GLL balance
        await prisma.user.update({
          where: {
            email: verification.email,
          },
          data: {
            gllBalance: {
              increment: 25,
            },
          },
        });

        // Send completion message with store creation prompt
        await sendMessageWithTracking(
          chatId,
          "✅ Documents received and verified!\n\n" +
            "🎓 You are now a GLL Certified Exporter\n\n" +
            `📄 Download your certificate here: [Download Certificate](${certificateUrl})\n\n` +
            "🎁 +25 GLL Ions added.\n\n" +
            'Let\'s now create your storefront! Click "Create Store" to begin.',
          {
            parse_mode: "Markdown",
            reply_markup: {
              keyboard: [["Create Store"], ["🏠 Back to Home"]],
              resize_keyboard: true,
            },
          }
        );

        // Clear verification data
        verificationProcess.delete(chatId);
        return;
      } catch (error) {
        console.error("Error saving verification:", error);
        await sendMessageWithTracking(
          chatId,
          "❌ An error occurred while saving your verification. Please try again later.",
          { reply_markup: mainKeyboard }
        );
        verificationProcess.delete(chatId);
        return;
      }
    }

    // Send current step message
    const step = VERIFICATION_STEPS[currentStep];
    await sendMessageWithTracking(chatId, step.message, {
      reply_markup: { remove_keyboard: true },
    });

    // Update verification object with new step
    verification.currentStep = currentStep;
    verificationProcess.set(chatId, verification);
  } catch (error) {
    console.error("Error in verification step:", error);
    await sendMessageWithTracking(
      chatId,
      "❌ An error occurred. Please try again later.",
      { reply_markup: mainKeyboard }
    );
    verificationProcess.delete(chatId);
  }
}

// Update certificate generation function
async function generateCertificate(seller, user) {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        layout: "landscape",
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
      });

      // Create a write stream for S3
      const chunks = [];

      // Handle document events
      doc.on("data", (chunk) => chunks.push(chunk));

      doc.on("end", async () => {
        try {
          // Convert chunks to Buffer
          const pdfBuffer = Buffer.concat(chunks);

          // Upload to S3
          const certificateKey = `certificates/${user.email}-${Date.now()}.pdf`;
          const uploadResult = await s3
            .upload({
              Bucket: process.env.AWS_BUCKET_NAME,
              Key: certificateKey,
              Body: pdfBuffer,
              ContentType: "application/pdf",
              ContentDisposition: "inline",
              CacheControl: "public, max-age=31536000",
            })
            .promise();

          // console.log('Certificate uploaded successfully:', uploadResult.Location);
          resolve(uploadResult.Location);
        } catch (error) {
          console.error("Error uploading certificate:", error);
          reject(error);
        }
      });

      // Add a background color
      doc.rect(0, 0, doc.page.width, doc.page.height).fill("#f5f5f5");

      // Add a border
      const margin = 20;
      doc
        .rect(
          margin,
          margin,
          doc.page.width - margin * 2,
          doc.page.height - margin * 2
        )
        .lineWidth(2)
        .stroke("#000000");

      // Add GLL logo or header
      doc
        .fontSize(35)
        .font("Helvetica-Bold")
        .fillColor("#000000")
        .text("GLL", { align: "center" });

      doc.moveDown(0.5);

      doc
        .fontSize(30)
        .font("Helvetica-Bold")
        .text("Certificate of Verification", { align: "center" });

      doc.moveDown(2);

      doc
        .fontSize(16)
        .font("Helvetica")
        .text("This is to certify that", { align: "center" });

      doc.moveDown(0.5);

      // Add user email with some styling
      doc
        .fontSize(20)
        .font("Helvetica-Bold")
        .fillColor("#000066")
        .text(user.email, { align: "center" });

      doc.moveDown(1);

      // Add product details if available
      const product =
        seller.products && seller.products.length > 0
          ? seller.products[0]
          : null;
      if (product) {
        doc
          .fontSize(16)
          .font("Helvetica")
          .fillColor("#000000")
          .text("is verified for the following product:", { align: "center" });

        doc.moveDown(0.5);

        doc
          .fontSize(18)
          .font("Helvetica-Bold")
          .text(`${product.productName}`, { align: "center" });

        doc.moveDown(0.5);

        doc
          .fontSize(16)
          .font("Helvetica")
          .text(`Made in: ${product.location}`, { align: "center" });
      }

      doc.moveDown(2);

      // Add verification message with some styling
      doc
        .fontSize(18)
        .font("Helvetica-Bold")
        .fillColor("#008000")
        .text("✅ Documents received and verified!", { align: "center" });

      doc.moveDown(0.5);

      doc
        .fontSize(18)
        .text("🎓 You are now a GLL Certified Exporter", { align: "center" });

      // Add verification date
      doc.moveDown(2);
      doc
        .fontSize(14)
        .font("Helvetica")
        .fillColor("#000000")
        .text(`Verification Date: ${new Date().toLocaleDateString()}`, {
          align: "center",
        });

      // Add certificate ID
      const certificateId = `GLL-CERT-${Date.now()}`;
      doc.moveDown(0.5);
      doc
        .fontSize(12)
        .text(`Certificate ID: ${certificateId}`, { align: "center" });

      // Add footer
      doc
        .fontSize(10)
        .font("Helvetica")
        .text("This is an electronically generated certificate.", {
          align: "center",
          bottom: 30,
        });

      // Finalize the PDF
      doc.end();
    } catch (error) {
      console.error("Error generating certificate:", error);
      reject(error);
    }
  });
}

// Update main keyboard to include Weekly Missions
const mainKeyboard = {
  keyboard: [
    ["Balance", "Register Seller"],
    ["Create Store", "Weekly Missions"],
    ["🌍 Explore India", "Surprise"],
    ["Clear", "Help"],
  ],
  resize_keyboard: true,
};

// Add new keyboard for seller type selection
const sellerTypeKeyboard = {
  keyboard: [["Trader", "Manufacturer"], ["Back to Main Menu"]],
  resize_keyboard: true,
};

// Log all incoming messages
bot.on("message", (msg) => {
  // console.log('\n🤖 New Telegram Message:');
  // console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  // console.log('From:', msg.from.first_name, msg.from.last_name || '');
  // console.log('Username:', msg.from.username || 'No username');
  // console.log('Chat ID:', msg.chat.id);
  // console.log('Message:', msg.text);
  // console.log('Time:', new Date(msg.date * 1000).toLocaleString());
  // console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
});

// Log all errors
bot.on("polling_error", (error) => {
  //   console.log("\n❌ Telegram Bot Error:");
  //   console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  //   console.error(error);
  //   console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
});

// Middleware to verify Telegram webhook requests
const verifyTelegramWebhook = (req, res, next) => {
  if (req.body && req.body.message && req.body.message.chat) {
    next();
  } else {
    res.status(400).json({ error: "Invalid Telegram webhook data" });
  }
};

// Handle start command
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    // console.log('\n✨ Start Command Received:');
    // console.log('From Chat ID:', chatId);

    // Check if user is already linked
    const user = await prisma.user.findFirst({
      where: {
        telegramId: chatId.toString(),
      },
    });

    if (user) {
      // Show menu for logged in users
      await bot.sendMessage(
        chatId,
        `Welcome back to Grow Global Partner Bot! 🌟\n\n` +
          `Logged in as: ${user.email}\n\n` +
          `Choose from these options:\n\n` +
          `🔷 /balance - Check GLL Balance\n` +
          `🏪 /registerseller - Register as a Seller\n` +
          `🎯 /weekly-mission - Weekly Tasks & Rewards\n` +
          `🎲 /surprise - Get a Random Duck\n` +
          `🧹 /clear - Clear Chat History\n` +
          `❓ /help - Show All Commands\n\n` +
          `Need anything else? Just use one of the commands above!` +
          `\n\n` +
          `Visit Our Website: https://gll.one for more information`,
        {
          parse_mode: "Markdown",
          reply_markup: mainKeyboard,
        }
      );
    } else {
      // Add user to awaiting email set
      usersAwaitingEmail.add(chatId);

      await bot.sendMessage(
        chatId,
        "Welcome to Grow Global Partner Bot! 🌟\n\n" +
          "To get started, please share your email address so I can link your account.\n\n" +
          "Just type your email address and send it to me." +
          `\n\n` +
          `Visit Our Website: https://gll.one for more information`,
        {
          reply_markup: {
            remove_keyboard: true,
          },
        }
      );
    }
    console.log("Start message sent successfully\n");
  } catch (error) {
    console.error("Error in start command:", error);
    await bot.sendMessage(
      chatId,
      "❌ An error occurred. Please try again later."
    );
  }
});

// Handle link command
bot.onText(/\/link/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    // Check if already linked
    const existingUser = await prisma.user.findFirst({
      where: {
        telegramId: chatId.toString(),
      },
    });

    if (existingUser) {
      await bot.sendMessage(
        chatId,
        "ℹ️  Your account is already linked!\n\n" +
          `Email: ${existingUser.email}\n\n` +
          "Use /balance to check your GLL balance or /help to see all commands." +
          `\n\n` +
          `Visit Our Website: https://gll.one for more information`,
        {
          parse_mode: "Markdown",
          reply_markup: mainKeyboard,
        }
      );
      return;
    }

    // Add user to linking process
    usersLinking.add(chatId);

    await bot.sendMessage(
      chatId,
      "📧 Please share your email address to link your account.\n\n" +
        "Just type and send your email address."
    );
  } catch (error) {
    console.error("Error in link command:", error);
    await bot.sendMessage(
      chatId,
      "❌ An error occurred. Please try again later."
    );
  }
});

// Add message tracking to all bot responses
const trackMessage = (chatId, messageId) => {
  if (!chatMessages.has(chatId)) {
    chatMessages.set(chatId, new Set());
  }
  chatMessages.get(chatId).add(messageId);
};

// Modify sendMessage to track bot messages
const sendMessageWithTracking = async (chatId, text, options = {}) => {
  try {
    const sentMsg = await bot.sendMessage(chatId, text, options);
    trackMessage(chatId, sentMsg.message_id);
    return sentMsg;
  } catch (error) {
    console.error("Error sending message:", error);
    throw error;
  }
};

// Handle both button clicks and commands
const handleCommand = async (msg, command) => {
  const chatId = msg.chat.id;
  // Remove the leading slash if present and convert to proper case
  const normalizedCommand =
    command.replace("/", "").charAt(0).toUpperCase() +
    command.replace("/", "").slice(1).toLowerCase();

  switch (normalizedCommand) {
    case "Balance":
      try {
        // Find user by Telegram ID
        const user = await prisma.user.findFirst({
          where: {
            telegramId: chatId.toString(),
          },
        });

        if (!user) {
          await sendMessageWithTracking(
            chatId,
            "ℹ️ Your Telegram account is not linked yet!\n\n" +
              "Please use /start command to link your account first."
          );
          return;
        }

        // Format balance with commas and 2 decimal places
        const formattedBalance = user.gllBalance
          ? new Intl.NumberFormat("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }).format(user.gllBalance)
          : "0.00";

        await sendMessageWithTracking(
          chatId,
          `💰 *GLL Balance*\n\n` +
            `Email: ${user.email}\n` +
            `Balance: ${formattedBalance} GLL\n\n` +
            `_Last updated: ${new Date().toLocaleString()}_`,
          {
            parse_mode: "Markdown",
            reply_markup: mainKeyboard,
          }
        );
      } catch (error) {
        console.error("Error in balance command:", error);
        await sendMessageWithTracking(
          chatId,
          "❌ An error occurred while fetching your balance. Please try again later."
        );
      }
      break;

    case "Surprise":
      try {
        const loadingMsg = await bot.sendMessage(
          chatId,
          "🦆 Finding a cute duck for you..."
        );
        const response = await axios.get("https://random-d.uk/api/v2/random");
        const duckImage = response.data.url;
        await bot.deleteMessage(chatId, loadingMsg.message_id);
        await bot.sendPhoto(chatId, duckImage, {
          caption:
            "🦆 Quack! Here's your random cute duck! " +
            `\n\n` +
            `This duck will lead you to our main website: https://gll.one, follow it.`,
          reply_markup: mainKeyboard,
        });
      } catch (error) {
        console.error("Error in surprise command:", error);
        await sendMessageWithTracking(
          chatId,
          "❌ Oops! The ducks are hiding right now. Try again later!",
          { reply_markup: mainKeyboard }
        );
      }
      break;

    case "Clear":
      bot.emit("clear_command", msg);
      break;

    case "Help":
      await sendMessageWithTracking(
        chatId,
        "🔹 *Available Commands*\n\n" +
          "🔸 /start - Start/Restart the bot\n" +
          "🔸 /balance - Check your GLL balance\n" +
          "🔸 /registerseller - Start seller registration\n" +
          "🔸 /createstore - Create your store\n" +
          "🔸 /surprise - Get a random duck image\n" +
          "🔸 /clear - Clear chat history\n" +
          "🔸 /help - Show this help message\n\n" +
          "💡 You can use either the menu buttons or type these commands.",
        {
          parse_mode: "Markdown",
          reply_markup: mainKeyboard,
        }
      );
      break;

    case "Link":
      // Trigger the start command for linking
      bot.emit("start_command", msg);
      break;

    case "Register seller":
    case "Registerseller":
      try {
        // Check if user is registered (has linked their email)
        const user = await prisma.user.findFirst({
          where: {
            telegramId: chatId.toString(),
          },
        });

        if (!user) {
          await sendMessageWithTracking(
            chatId,
            "❌ Please link your account first!\n\n" +
              "Use /start command to link your GLL account before accessing the seller journey.",
            { reply_markup: mainKeyboard }
          );
          return;
        }

        // User is registered, show seller type selection
        await sendMessageWithTracking(
          chatId,
          "🌟 *Welcome to the GLL Export Accelerator* 🇮🇳🌍\n\n" +
            "Here, you can create your store, get certified, and export authentic Indian products to buyers worldwide.\n\n" +
            "What best describes you?\n\n" +
            "🔘 I make my own products (/manufacturer)\n" +
            "🔘 I want to resell GI-tagged products (/trader)",
          {
            parse_mode: "Markdown",
            reply_markup: sellerTypeKeyboard,
          }
        );
      } catch (error) {
        console.error("Error in register seller command:", error);
        await sendMessageWithTracking(
          chatId,
          "❌ An error occurred. Please try again later.",
          { reply_markup: mainKeyboard }
        );
      }
      break;

    case "Trader":
      try {
        // Start the registration process with seller type
        const registration = {
          sellerType: "Trader",
        };
        manufacturerRegistration.set(chatId, registration);
        await handleManufacturerStep(chatId);
      } catch (error) {
        console.error("Error in trader selection:", error);
        await sendMessageWithTracking(
          chatId,
          "❌ An error occurred. Please try again later."
        );
      }
      break;

    case "Manufacturer":
      try {
        // Start the registration process with seller type
        const registration = {
          sellerType: "Manufacturer",
        };
        manufacturerRegistration.set(chatId, registration);
        await handleManufacturerStep(chatId);
      } catch (error) {
        console.error("Error in manufacturer selection:", error);
        await sendMessageWithTracking(
          chatId,
          "❌ An error occurred. Please try again later."
        );
      }
      break;

    case "Back to main menu":
      await sendMessageWithTracking(
        chatId,
        "🏠 Back to main menu. How can I help you?",
        { reply_markup: mainKeyboard }
      );
      break;
  }
};

// Update message handler
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;

  // Track user messages
  trackMessage(chatId, msg.message_id);

  // Check if user is in store creation process
  const store = storeCreation.get(chatId);
  if (store && store.currentStep) {
    const currentStep = store.currentStep;
    const step = STORE_STEPS[currentStep];

    if (step.type === "photo" && msg.photo) {
      await handleStoreStep(chatId, msg.photo[0].file_id, currentStep + 1);
      return;
    } else if (!step.type && msg.text) {
      await handleStoreStep(chatId, msg.text, currentStep + 1);
      return;
    } else if (step.type === "photo" && !msg.photo) {
      await sendMessageWithTracking(
        chatId,
        "❌ Please upload an image for your store logo/banner."
      );
      return;
    }
  }

  // Check if user is in registration process
  const registration = manufacturerRegistration.get(chatId);
  if (registration && registration.currentStep) {
    // Handle photo upload for step 2
    if (registration.currentStep === 2 && msg.photo) {
      await handleManufacturerStep(chatId, msg.photo[0].file_id, 3);
      return;
    }
    // Handle text input for other steps
    if (msg.text) {
      await handleManufacturerStep(
        chatId,
        msg.text,
        registration.currentStep + 1
      );
      return;
    }
    // If no valid input provided for step 2
    if (registration.currentStep === 2 && !msg.photo) {
      await sendMessageWithTracking(
        chatId,
        "❌ Please upload a photo of your product."
      );
      return;
    }
  }

  // Check if user is in verification process
  const verification = verificationProcess.get(chatId);
  if (verification && verification.currentStep) {
    const currentStep = verification.currentStep;
    const step = VERIFICATION_STEPS[currentStep];

    if (step.type === "document" && msg.document) {
      await handleVerificationStep(
        chatId,
        msg.document.file_id,
        currentStep + 1
      );
      return;
    } else if (step.type === "text" && msg.text) {
      await handleVerificationStep(chatId, msg.text, currentStep + 1);
      return;
    } else if (step.type === "document") {
      await sendMessageWithTracking(
        chatId,
        "❌ Please upload a document file."
      );
      return;
    }
  }

  // Check if user is in story creation process
  const story = storyCreation.get(chatId);
  if (story && story.currentStep) {
    const currentStep = story.currentStep;
    const step = STORY_STEPS[currentStep];

    // Handle media uploads for story
    if (step.type === "media" && (msg.voice || msg.video)) {
      await handleStoryStep(chatId, msg, currentStep + 1);
      return;
    } else if (!step.type && msg.text) {
      await handleStoryStep(chatId, msg.text, currentStep + 1);
      return;
    } else if (step.type === "media" && !msg.voice && !msg.video) {
      await sendMessageWithTracking(
        chatId,
        "❌ Please upload a voice note or video."
      );
      return;
    }
  }

  // Handle email input for account linking FIRST
  if (usersAwaitingEmail.has(chatId) && msg.text) {
    console.log("Processing email:", msg.text);
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const email = msg.text.trim();

    if (!emailRegex.test(email)) {
      await sendMessageWithTracking(
        chatId,
        "❌ Invalid email format. Please provide a valid email address.",
        { reply_markup: { remove_keyboard: true } }
      );
      return;
    }

    try {
      // Check if user exists in database
      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user) {
        // Ask if they want to register now
        await sendMessageWithTracking(
          chatId,
          "❌ This email is not registered with GLL site.\n\n" +
            "Would you like to register right now?",
          { reply_markup: registrationConfirmKeyboard }
        );

        // Store email for registration process
        registrationProcess.set(chatId, {
          email: email,
          currentStep: 0,
        });

        usersAwaitingEmail.delete(chatId);
        return;
      }

      // Check if already linked to another Telegram ID
      if (user.telegramId && user.telegramId !== chatId.toString()) {
        await sendMessageWithTracking(
          chatId,
          "❌ This email is already linked to another Telegram account.\n\n" +
            "Please contact support if you think this is an error.",
          { reply_markup: { remove_keyboard: true } }
        );
        usersAwaitingEmail.delete(chatId);
        return;
      }

      // Update user with Telegram ID
      await prisma.user.update({
        where: { email },
        data: { telegramId: chatId.toString() },
      });

      usersAwaitingEmail.delete(chatId);

      // Format balance with commas and 2 decimal places
      const formattedBalance = user.gllBalance
        ? new Intl.NumberFormat("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }).format(user.gllBalance)
        : "0.00";

      // Send welcome message with balance
      await sendMessageWithTracking(
        chatId,
        `✅ Account successfully linked!\n\n` +
          `Welcome ${user.name || "back"}!\n\n` +
          `💰 *Your GLL Balance*\n` +
          `${formattedBalance} GLL\n\n` +
          `Available Commands:\n` +
          `🔷 /balance - Check GLL Balance\n` +
          `🎲 /surprise - Get a Random Duck\n` +
          `🧹 /clear - Clear Chat History\n` +
          `❓ /help - Show All Commands\n\n` +
          `Visit Our Website: https://gll.one for more information`,
        {
          parse_mode: "Markdown",
          reply_markup: mainKeyboard,
        }
      );
      return;
    } catch (error) {
      console.error("Error linking account:", error);
      await sendMessageWithTracking(
        chatId,
        "❌ An error occurred while linking your account. Please try again later.",
        { reply_markup: { remove_keyboard: true } }
      );
      usersAwaitingEmail.delete(chatId);
      return;
    }
  }

  // Handle registration confirmation response
  if (
    registrationProcess.has(chatId) &&
    registrationProcess.get(chatId).currentStep === 0
  ) {
    if (msg.text === "✅ Yes, Register Now") {
      const registration = registrationProcess.get(chatId);
      registration.currentStep = 1;
      registrationProcess.set(chatId, registration);

      await sendMessageWithTracking(
        chatId,
        "📝 Great! Let's get you registered.\n\n" +
          "Provide the following information to complete your registration:",
        { reply_markup: { remove_keyboard: true } }
      );

      // Start first registration step
      await handleRegistrationStep(chatId);
      return;
    } else if (msg.text === "❌ No, I'll Register Later") {
      await sendMessageWithTracking(
        chatId,
        "👉 Please visit https://gll.one to register yourself.\n\n" +
          "Once registered, you can come back here to link your account!",
        { reply_markup: mainKeyboard }
      );
      registrationProcess.delete(chatId);
      return;
    }
  }

  // Handle registration steps
  if (
    registrationProcess.has(chatId) &&
    registrationProcess.get(chatId).currentStep > 0
  ) {
    await handleRegistrationStep(chatId, msg.text);
    return;
  }

  // Handle verification options
  if (msg.text === "✅ Verify Business") {
    await startVerification(chatId);
    return;
  }

  if (msg.text === "🏠 Back to Home") {
    await sendMessageWithTracking(
      chatId,
      "👋 Welcome back to the main menu! How can I help you today?",
      { reply_markup: mainKeyboard }
    );
    return;
  }

  // Handle store creation command
  if (msg.text === "Create Store" || msg.text === "/createstore") {
    await startStoreCreation(chatId);
    return;
  }

  // Handle story creation command
  if (msg.text === "Build Trust" || msg.text === "/buildtrust") {
    await startStoryCreation(chatId);
    return;
  }

  // Handle Build Trust button click
  if (msg.text === "Build Trust with Story & Sample") {
    await sendMessageWithTracking(
      chatId,
      "🌟 Let's build trust with your buyers!\n\n" +
        "📱 You can share:\n" +
        "• A 60-second voice note, or\n" +
        "• A short video introduction\n\n" +
        "This helps buyers:\n" +
        "• Know your story\n" +
        "• See your passion\n" +
        "• Trust your products\n\n" +
        "Ready? Let's begin! 🎯"
    );
    await startStoryCreation(chatId);
    return;
  }

  // Handle Weekly Missions button click
  if (msg.text === "Weekly Missions") {
    await handleWeeklyMissions(chatId);
    return;
  }

  // Handle Weekly Mission options
  if (msg.text === "✅ Add another product") {
    const user = await prisma.user.findFirst({
      where: { telegramId: chatId.toString() },
    });

    if (user) {
      const completed = await checkMissionCompletion(user.email, "product");
      if (completed) {
        await sendMessageWithTracking(
          chatId,
          "❌ You've already completed this mission this week!\n\n" +
            "⏰ Come back next Monday for new missions.",
          { reply_markup: weeklyMissionsKeyboard }
        );
        return;
      }

      // Start weekly product registration process
      await handleWeeklyProductStep(chatId);
    }
    return;
  }

  if (msg.text === "✅ Invite 2 friends to join") {
    const user = await prisma.user.findFirst({
      where: { telegramId: chatId.toString() },
    });

    if (user) {
      const completed = await checkMissionCompletion(user.email, "invite");
      if (completed) {
        await sendMessageWithTracking(
          chatId,
          "❌ You've already completed this mission this week!\n\n" +
            "⏰ Come back next Monday for new missions.",
          { reply_markup: weeklyMissionsKeyboard }
        );
        return;
      }

      const inviteLink = `https://t.me/share/url?url=Join%20me%20on%20GLL!%20I'm%20selling%20my%20products%20globally.%20Start%20your%20journey:%20https://gll.one/refer/${user.email}`;

      await sendMessageWithTracking(
        chatId,
        "🤝 *Grow Together*\n\n" +
          "Share this link with your friends:\n" +
          `${inviteLink}\n\n` +
          "💰 Rewards:\n" +
          "• +50 GLL when 2 friends join\n" +
          "• Extra bonus when they start selling!\n\n" +
          "❗ This mission can be completed once per week",
        {
          parse_mode: "Markdown",
          reply_markup: weeklyMissionsKeyboard,
        }
      );

      // Record mission completion
      await recordMissionCompletion(user.email, "invite");
    }
    return;
  }

  if (msg.text === "✅ Share your store on WhatsApp") {
    const user = await prisma.user.findFirst({
      where: { telegramId: chatId.toString() },
    });

    if (user) {
      const completed = await checkMissionCompletion(user.email, "whatsapp");
      if (completed) {
        await sendMessageWithTracking(
          chatId,
          "❌ You've already completed this mission this week!\n\n" +
            "⏰ Come back next Monday for new missions.",
          { reply_markup: weeklyMissionsKeyboard }
        );
        return;
      }

      const seller = await prisma.GGASeller.findUnique({
        where: { email: user.email },
      });

      if (seller && seller.storeUrl) {
        const whatsappLink = `https://wa.me/?text=Check%20out%20my%20store%20on%20GLL!%20${seller.storeUrl}%20-%20Quality%20products%20shipped%20worldwide%20🌍`;

        await sendMessageWithTracking(
          chatId,
          "📱 *Spread the Word*\n\n" +
            "Share your store on WhatsApp:\n" +
            `${whatsappLink}\n\n` +
            "💰 Rewards:\n" +
            "• +50 GLL for sharing\n" +
            "• Reach more customers globally!\n\n" +
            "❗ This mission can be completed once per week",
          {
            parse_mode: "Markdown",
            reply_markup: weeklyMissionsKeyboard,
          }
        );

        // Record mission completion
        await recordMissionCompletion(user.email, "whatsapp");
      }
    }
    return;
  }

  // Handle back to home option
  if (msg.text === "🏠 Back to Home") {
    await sendMessageWithTracking(
      chatId,
      "👋 Welcome back to the main menu! How can I help you today?",
      { reply_markup: mainKeyboard }
    );
    return;
  }

  // Handle both slash commands and menu buttons
  if (msg.text) {
    const text = msg.text;
    // Don't handle specific commands that have their own handlers
    if (text.startsWith("/")) {
      if (
        !["/trader", "/manufacturer", "/createstore"].includes(
          text.toLowerCase()
        )
      ) {
        await handleCommand(msg, text);
      }
      return;
    }
    // Handle button clicks
    if (
      [
        "Balance",
        "Surprise",
        "Clear",
        "Help",
        "Link",
        "Register Seller",
        "Create Store",
        "Trader",
        "Manufacturer",
        "Back to Main Menu",
      ].includes(text)
    ) {
      await handleCommand(msg, text);
      return;
    }
  }

  // Handle Good Morning/Evening
  if (msg.text && /^good\s*morning/i.test(msg.text.trim())) {
    await sendMessageWithTracking(
      chatId,
      `${getRandomFlowers(3)} Good Morning! ${getRandomFlowers(
        2
      )}\n\nI hope you have a wonderful day ahead!`,
      { reply_markup: mainKeyboard }
    );
    return;
  }

  if (msg.text && /^good\s*evening/i.test(msg.text.trim())) {
    await sendMessageWithTracking(
      chatId,
      `${getRandomFlowers(3)} Good Evening! ${getRandomFlowers(
        2
      )}\n\nHave a peaceful evening!`,
      { reply_markup: mainKeyboard }
    );
    return;
  }

  // Handle casual greetings
  if (
    msg.text &&
    /^(hi|hello|hey|hola|howdy|greetings|sup|yo|hii|hiii|hiiii)/i.test(
      msg.text.trim()
    )
  ) {
    const username = msg.from.first_name || msg.from.username || "there";
    await sendMessageWithTracking(
      chatId,
      `🤖 Hello, ${username}!\n\nHave a Wonderful Journey with us, and Have a Great Day!\n\n`,
      {
        parse_mode: "Markdown",
        reply_markup: mainKeyboard,
      }
    );
    return;
  }

  // Handle any other text with a default response
  if (msg.text && !usersAwaitingEmail.has(chatId)) {
    await sendMessageWithTracking(
      chatId,
      "Please use the menu buttons or type commands like /balance, /help to interact.",
      { reply_markup: mainKeyboard }
    );
  }

  // Remove any existing handlers
  bot.removeTextListener(/\/(exploreindia|matchme)/);

  // Single explore command handler
  bot.onText(/\/(exploreindia|matchme)/, async (msg) => {
    const chatId = msg.chat.id;
    productBrowsing.delete(chatId);
    try {
      await sendMessageWithTracking(
        chatId,
        "🌍 *Welcome to GLL Product Explorer*\n\n" +
          "Discover authentic Indian products from verified sellers.\n" +
          "Choose a category to explore:",
        {
          parse_mode: "Markdown",
          reply_markup: productCategoryKeyboard,
        }
      );

      // Initialize browsing state
      productBrowsing.set(chatId, { state: "category" });
    } catch (error) {
      console.error("Error in explore command:", error);
      await sendMessageWithTracking(
        chatId,
        "❌ An error occurred. Please try again later.",
        { reply_markup: mainKeyboard }
      );
    }
  });

  // Function to handle explore commands
  async function handleExploreCommand(msg) {
    const chatId = msg.chat.id;
    try {
      await sendMessageWithTracking(
        chatId,
        "🌍 *Welcome to GLL Product Explorer*\n\n" +
          "Discover authentic Indian products from verified sellers.\n" +
          "Choose a category to explore:",
        {
          parse_mode: "Markdown",
          reply_markup: productCategoryKeyboard,
        }
      );

      // Initialize browsing state
      productBrowsing.set(chatId, { state: "category" });
    } catch (error) {
      console.error("Error in explore command:", error);
      await sendMessageWithTracking(
        chatId,
        "❌ An error occurred. Please try again later.",
        { reply_markup: mainKeyboard }
      );
    }
  }

  // Function to format seller display
  function formatSellerDisplay(seller, product) {
    let message =
      `👤 *${seller.storeName || "Unnamed Store"}*\n` +
      `📍 ${product.location} ${
        seller.isVerified ? "| ✅ GI-tag Verified" : ""
      }\n` +
      `🧵 Product: ${product.productName}\n` +
      `📦 MOQ: 50 units | ₹180 each\n`;

    if (seller.storyMedia) {
      message += `🎤 [Meet the Maker](${seller.storyMedia})\n`;
    }

    message += `🌐 Store: ${seller.storeUrl}\n\n`;

    return message;
  }

  // Function to handle category selection
  async function handleCategorySelection(chatId, category) {
    try {
      // Remove emoji from category
      const cleanCategory = category
        .replace(/[\u{1F300}-\u{1F6FF}]/gu, "")
        .trim();

      // Find all sellers first
      const sellers = await prisma.GGASeller.findMany();

      // Filter sellers who have products in this category
      const sellersWithProducts = sellers.filter((seller) => {
        return seller.products.some(
          (product) => product.productType === cleanCategory
        );
      });

      if (sellersWithProducts.length === 0) {
        await sendMessageWithTracking(
          chatId,
          "😔 No sellers found in this category yet.\n" +
            "Please try another category or check back later!",
          { reply_markup: productCategoryKeyboard }
        );
        return;
      }

      // Display each seller's products
      for (const seller of sellersWithProducts) {
        // Filter products by category
        const categoryProducts = seller.products.filter(
          (p) => p.productType === cleanCategory
        );

        for (const product of categoryProducts) {
          // Send seller info
          const message = formatSellerDisplay(seller, product);

          if (product.productImage) {
            // Send image with caption
            await bot.sendPhoto(chatId, product.productImage, {
              caption: message,
              parse_mode: "Markdown",
            });
          } else {
            // Send just the message if no image
            await sendMessageWithTracking(chatId, message, {
              parse_mode: "Markdown",
            });
          }

          // Send action buttons for this seller
          await sendMessageWithTracking(chatId, "What would you like to do?", {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "📦 Request Sample",
                    callback_data: `sample_${seller.email}`,
                  },
                  { text: "💬 Chat", callback_data: `chat_${seller.email}` },
                  {
                    text: "📃 Start Deal",
                    callback_data: `deal_${seller.email}`,
                  },
                ],
              ],
            },
          });
        }
      }

      // Update browsing state
      productBrowsing.set(chatId, {
        state: "seller_list",
        category: cleanCategory,
      });
    } catch (error) {
      console.error("Error handling category selection:", error);
      await sendMessageWithTracking(
        chatId,
        "❌ An error occurred. Please try again later.",
        { reply_markup: mainKeyboard }
      );
    }
  }

  // Add callback query handler for seller actions
  bot.on("callback_query", async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    const [action, sellerEmail] = data.split("_");

    try {
      // Find the seller
      const seller = await prisma.GGASeller.findUnique({
        where: { email: sellerEmail },
      });

      if (!seller) {
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: "❌ Seller not found.",
          show_alert: true,
        });
        return;
      }

      switch (action) {
        case "sample":
          // Handle sample request
          await handleSampleRequest(chatId, seller);
          break;
        case "chat":
          // Handle chat request
          await handleChatRequest(chatId, seller);
          break;
        case "deal":
          // Handle deal request
          await handleDealRequest(chatId, seller);
          break;
      }

      await bot.answerCallbackQuery(callbackQuery.id);
    } catch (error) {
      console.error("Error handling callback query:", error);
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: "❌ An error occurred. Please try again.",
        show_alert: true,
      });
    }
  });

  // Function to handle sample request
  async function handleSampleRequest(chatId, seller) {
    await sendMessageWithTracking(
      chatId,
      `📦 *Sample Request*\n\n` +
        `You've requested a sample from ${seller.storeName}.\n` +
        `Our team will contact you shortly to process your request.\n\n` +
        `Meanwhile, you can:\n` +
        `• Browse more products\n` +
        `• Chat with the seller\n` +
        `• Start a deal`,
      {
        parse_mode: "Markdown",
        reply_markup: productCategoryKeyboard,
      }
    );
  }

  // Function to handle chat request
  async function handleChatRequest(chatId, seller) {
    await sendMessageWithTracking(
      chatId,
      `💬 *Chat Request*\n\n` +
        `You've requested to chat with ${seller.storeName}.\n` +
        `Our team will connect you with the seller shortly.\n\n` +
        `Please note:\n` +
        `• Business hours: 9 AM - 6 PM IST\n` +
        `• Response time: Within 24 hours\n` +
        `• Language: English/Hindi`,
      {
        parse_mode: "Markdown",
        reply_markup: productCategoryKeyboard,
      }
    );
  }

  // Function to handle deal request
  async function handleDealRequest(chatId, seller) {
    await sendMessageWithTracking(
      chatId,
      `📃 *Start Deal*\n\n` +
        `You've initiated a deal with ${seller.storeName}.\n` +
        `Our business team will contact you to:\n\n` +
        `• Discuss quantities\n` +
        `• Confirm pricing\n` +
        `• Arrange logistics\n` +
        `• Process payment\n\n` +
        `Expected response time: Within 24 hours`,
      {
        parse_mode: "Markdown",
        reply_markup: productCategoryKeyboard,
      }
    );
  }

  // Update message handler to handle product browsing
  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;

    // Track user messages
    trackMessage(chatId, msg.message_id);

    // Handle Explore India button click
    if (msg.text === "🌍 Explore India") {
      productBrowsing.delete(chatId);
      try {
        await sendMessageWithTracking(
          chatId,
          "🌍 *Welcome to GLL Product Explorer*\n\n" +
            "Discover authentic Indian products from verified sellers.\n" +
            "Choose a category to explore:",
          {
            parse_mode: "Markdown",
            reply_markup: productCategoryKeyboard,
          }
        );

        // Initialize browsing state
        productBrowsing.set(chatId, { state: "category" });
      } catch (error) {
        console.error("Error in explore command:", error);
        await sendMessageWithTracking(
          chatId,
          "❌ An error occurred. Please try again later.",
          { reply_markup: mainKeyboard }
        );
      }
      return;
    }

    // Handle category selection
    if (productBrowsing.has(chatId) && msg.text) {
      const browsing = productBrowsing.get(chatId);

      if (msg.text === "🏠 Back to Home") {
        productBrowsing.delete(chatId);
        await sendMessageWithTracking(
          chatId,
          "👋 Welcome back to the main menu!",
          { reply_markup: mainKeyboard }
        );
        return;
      }

      if (msg.text === "🔙 Back to Categories") {
        try {
          await sendMessageWithTracking(
            chatId,
            "🌍 *Welcome to GLL Product Explorer*\n\n" +
              "Discover authentic Indian products from verified sellers.\n" +
              "Choose a category to explore:",
            {
              parse_mode: "Markdown",
              reply_markup: productCategoryKeyboard,
            }
          );

          // Initialize browsing state
          productBrowsing.set(chatId, { state: "category" });
        } catch (error) {
          console.error("Error in explore command:", error);
          await sendMessageWithTracking(
            chatId,
            "❌ An error occurred. Please try again later.",
            { reply_markup: mainKeyboard }
          );
        }
        return;
      }

      // Check if the message is a category selection
      const categories = [
        "👕 Clothing",
        "👠 Shoes",
        "💍 Jewelry",
        "💄 Beauty Products",
        "📱 Electronics",
        "🍲 Food & Beverages",
        "🎨 Handcrafted",
        "📚 Books",
        "🏠 Home Decor",
        "🐾 Pet Supplies",
      ];

      if (categories.includes(msg.text)) {
        await handleCategorySelection(chatId, msg.text);
        return;
      }
    }

    // ... rest of the existing message handling code ...
  });
});

// Add command handlers for /trader and /manufacturer
bot.onText(/\/trader/, async (msg) => {
  await handleCommand(msg, "Trader");
});

bot.onText(/\/manufacturer/, async (msg) => {
  await handleCommand(msg, "Manufacturer");
});

// Add verification command
bot.onText(/\/verify/, async (msg) => {
  await startVerification(msg.chat.id);
});

// Webhook endpoint for Telegram updates
router.post("/webhook", verifyTelegramWebhook, async (req, res) => {
  try {
    const { message } = req.body;
    const responseData = {
      status: "success",
      message: "Webhook received",
      chatId: message.chat.id,
    };
    res.send(encryptJSON(responseData));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Link Telegram account to user account
router.post("/link-account", async (req, res) => {
  try {
    const { email, telegramId } = req.body;

    if (!email || !telegramId) {
      return res
        .status(400)
        .json({ error: "Email and Telegram ID are required" });
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Update user with Telegram ID
    const updatedUser = await prisma.user.update({
      where: { email },
      data: {
        telegramId: telegramId,
      },
    });

    const responseData = {
      message: "Account linked successfully",
      telegramId: telegramId,
    };
    res.send(encryptJSON(responseData));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user's bot settings
router.get("/settings/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        telegramId: true,
        notificationPreferences: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const responseData = {
      telegramId: user.telegramId,
      notificationPreferences: user.notificationPreferences,
    };
    res.send(encryptJSON(responseData));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Function to start store creation
async function startStoreCreation(chatId) {
  try {
    // Get user's email
    const user = await prisma.user.findFirst({
      where: {
        telegramId: chatId.toString(),
      },
    });

    if (!user) {
      await sendMessageWithTracking(
        chatId,
        "❌ Please link your account first!",
        { reply_markup: mainKeyboard }
      );
      return;
    }

    // Check if seller exists and is verified
    const seller = await prisma.GGASeller.findUnique({
      where: {
        email: user.email,
      },
    });

    if (!seller) {
      await sendMessageWithTracking(
        chatId,
        "❌ Please register as a seller first!\n\n" +
          'Use the "Register Seller" option from the menu to get started.',
        { reply_markup: mainKeyboard }
      );
      return;
    }

    if (!seller.isVerified) {
      await sendMessageWithTracking(
        chatId,
        "❌ Please complete business verification first!\n\n" +
          'Use the "✅ Verify Business" option to get verified.',
        { reply_markup: mainKeyboard }
      );
      return;
    }

    // Initialize store creation process
    storeCreation.set(chatId, {
      email: user.email,
      currentStep: 1,
    });

    // Start first step
    await handleStoreStep(chatId, null, 1);
  } catch (error) {
    console.error("Error starting store creation:", error);
    await sendMessageWithTracking(
      chatId,
      "❌ An error occurred. Please try again later.",
      { reply_markup: mainKeyboard }
    );
  }
}

// Function to handle store creation steps
async function handleStoreStep(chatId, input, currentStep = 1) {
  try {
    let store = storeCreation.get(chatId) || {};

    // Handle current step input if not first step
    if (currentStep > 1 && input) {
      const prevStep = STORE_STEPS[currentStep - 1];

      if (prevStep.type === "photo") {
        try {
          const imageUrl = await uploadToS3(input, `${chatId}-store-logo`);
          store[prevStep.field] = imageUrl;
        } catch (error) {
          console.error("Error uploading image:", error);
          await sendMessageWithTracking(
            chatId,
            "❌ Failed to upload image. Please try again.",
            { reply_markup: { remove_keyboard: true } }
          );
          return;
        }
      } else if (prevStep.field === "socialLinks") {
        // Validate URL
        try {
          new URL(input);
          store[prevStep.field] = { url: input };
        } catch (error) {
          await sendMessageWithTracking(
            chatId,
            "❌ Please provide a valid URL starting with http:// or https://",
            { reply_markup: { remove_keyboard: true } }
          );
          return;
        }
      } else {
        store[prevStep.field] = input;
      }
      storeCreation.set(chatId, store);
    }

    // If all steps are completed
    if (currentStep > 4) {
      try {
        // Generate store URL from store name
        const storeUrl = store.storeName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");

        // Update seller record with store details
        const updatedSeller = await prisma.GGASeller.update({
          where: {
            email: store.email,
          },
          data: {
            storeName: store.storeName,
            storeTagline: store.storeTagline,
            storeLogo: store.storeLogo,
            socialLinks: store.socialLinks,
            storeUrl: `https://growglobal.asia/${storeUrl}`,
            updatedAt: new Date(),
          },
        });

        // Update user's GLL balance
        await prisma.user.update({
          where: {
            email: store.email,
          },
          data: {
            gllBalance: {
              increment: 25,
            },
          },
        });

        // Get product count
        const productCount = updatedSeller.products
          ? updatedSeller.products.length
          : 0;

        // Send completion message
        await sendMessageWithTracking(
          chatId,
          "🎉 Your store is now LIVE!\n\n" +
            `🌐 ${updatedSeller.storeUrl}\n\n` +
            `🏷️ Products added: ${productCount}\n` +
            "🎁 +25 GLL Ions awarded!\n\n" +
            "🌟 Next Step: Build trust with buyers by sharing your story and product samples.\n" +
            "This will help you:\n" +
            "• Get a Trusted Exporter Badge 🎖️\n" +
            "• Increase buyer confidence 📈\n" +
            "• Earn +25 GLL Ions 🎁",
          {
            parse_mode: "Markdown",
            reply_markup: trustBuildingKeyboard,
          }
        );

        // Clear store creation data
        storeCreation.delete(chatId);
        return;
      } catch (error) {
        console.error("Error saving store:", error);
        await sendMessageWithTracking(
          chatId,
          "❌ An error occurred while saving your store. Please try again later.",
          { reply_markup: mainKeyboard }
        );
        storeCreation.delete(chatId);
        return;
      }
    }

    // Send current step message
    const step = STORE_STEPS[currentStep];
    await sendMessageWithTracking(chatId, step.message, {
      reply_markup: { remove_keyboard: true },
    });

    // Update store object with new step
    store.currentStep = currentStep;
    storeCreation.set(chatId, store);
  } catch (error) {
    console.error("Error in store creation step:", error);
    await sendMessageWithTracking(
      chatId,
      "❌ An error occurred. Please try again later.",
      { reply_markup: mainKeyboard }
    );
    storeCreation.delete(chatId);
  }
}

// Add command handler for store creation
bot.onText(/^\/createstore$/i, async (msg) => {
  await startStoreCreation(msg.chat.id);
});

// Function to start story creation
async function startStoryCreation(chatId) {
  try {
    // Get user's email
    const user = await prisma.user.findFirst({
      where: {
        telegramId: chatId.toString(),
      },
    });

    if (!user) {
      await sendMessageWithTracking(
        chatId,
        "❌ Please link your account first!",
        { reply_markup: mainKeyboard }
      );
      return;
    }

    // Check if seller exists and has a store
    const seller = await prisma.GGASeller.findUnique({
      where: {
        email: user.email,
      },
    });

    if (!seller) {
      await sendMessageWithTracking(
        chatId,
        "❌ Please register as a seller first!\n\n" +
          'Use the "Create Store" option to set up your store.',
        { reply_markup: mainKeyboard }
      );
      return;
    }

    if (!seller.storeName) {
      await sendMessageWithTracking(
        chatId,
        "❌ Please create your store first!\n\n" +
          'Use the "Create Store" option to set up your store.',
        { reply_markup: mainKeyboard }
      );
      return;
    }

    // Initialize story creation process
    storyCreation.set(chatId, {
      email: user.email,
      currentStep: 1,
    });

    // Start first step
    await handleStoryStep(chatId, null, 1);
  } catch (error) {
    console.error("Error starting story creation:", error);
    await sendMessageWithTracking(
      chatId,
      "❌ An error occurred. Please try again later.",
      { reply_markup: mainKeyboard }
    );
  }
}

// Function to handle story creation steps
async function handleStoryStep(chatId, input, currentStep = 1) {
  try {
    let story = storyCreation.get(chatId) || {};

    // Handle current step input if not first step
    if (currentStep > 1 && input) {
      const prevStep = STORY_STEPS[currentStep - 1];

      if (prevStep.type === "media") {
        try {
          // Handle voice note
          if (input.voice) {
            const fileId = input.voice.file_id;
            const mediaUrl = await uploadToS3(fileId, `${chatId}-story-voice`);
            story.storyMedia = mediaUrl;
            story.storyMediaType = "voice";
          }
          // Handle video
          else if (input.video) {
            const fileId = input.video.file_id;
            const mediaUrl = await uploadToS3(fileId, `${chatId}-story-video`);
            story.storyMedia = mediaUrl;
            story.storyMediaType = "video";
          }
        } catch (error) {
          console.error("Error uploading media:", error);
          await sendMessageWithTracking(
            chatId,
            "❌ Failed to upload media. Please try again.",
            { reply_markup: { remove_keyboard: true } }
          );
          return;
        }
      } else if (prevStep.field === "sampleRequested") {
        story.sampleRequested = input === "✅ Yes, send sample";
      }
      storyCreation.set(chatId, story);
    }

    // If all steps are completed
    if (currentStep > 2) {
      try {
        // Get user details
        const user = await prisma.user.findUnique({
          where: { email: story.email },
        });

        if (!user) {
          throw new Error("User not found");
        }

        // Get seller details
        const seller = await prisma.GGASeller.findUnique({
          where: { email: story.email },
        });

        if (!seller) {
          throw new Error("Seller not found");
        }

        // Generate shipping label URL if sample requested
        let shippingLabel = null;
        if (story.sampleRequested) {
          try {
            shippingLabel = await generateShippingLabel(seller, user);
            console.log("Shipping label generated:", shippingLabel);
          } catch (error) {
            console.error("Error generating shipping label:", error);
          }
        }

        // Update seller record with story details
        const updatedSeller = await prisma.GGASeller.update({
          where: {
            email: story.email,
          },
          data: {
            storyMedia: story.storyMedia,
            storyMediaType: story.storyMediaType,
            sampleRequested: story.sampleRequested,
            shippingLabel: shippingLabel,
            trustBadge: true,
            updatedAt: new Date(),
          },
        });

        // Update user's GLL balance
        await prisma.user.update({
          where: {
            email: story.email,
          },
          data: {
            gllBalance: {
              increment: 25,
            },
          },
        });

        // Send completion message
        let completionMessage =
          "✅ Your story has been saved!\n\n" +
          "🎖️ You've earned the Trusted Exporter Badge\n" +
          "🎁 +25 GLL Ions added.\n\n" +
          "Buyers are more likely to order from you now!";

        if (story.sampleRequested && shippingLabel) {
          completionMessage +=
            "\n\n📦 Great! Here's your shipping label:\n" +
            `[Download Label](${shippingLabel})`;
        }

        await sendMessageWithTracking(chatId, completionMessage, {
          parse_mode: "Markdown",
          reply_markup: mainKeyboard,
        });

        // Clear story creation data
        storyCreation.delete(chatId);
        return;
      } catch (error) {
        console.error("Error saving story:", error);
        await sendMessageWithTracking(
          chatId,
          "❌ An error occurred while saving your story. Please try again later.",
          { reply_markup: mainKeyboard }
        );
        storyCreation.delete(chatId);
        return;
      }
    }

    // Send current step message
    const step = STORY_STEPS[currentStep];
    await sendMessageWithTracking(chatId, step.message, {
      reply_markup: step.keyboard || { remove_keyboard: true },
      parse_mode: "Markdown",
    });

    // Update story object with new step
    story.currentStep = currentStep;
    storyCreation.set(chatId, story);
  } catch (error) {
    console.error("Error in story creation step:", error);
    await sendMessageWithTracking(
      chatId,
      "❌ An error occurred. Please try again later.",
      { reply_markup: mainKeyboard }
    );
    storyCreation.delete(chatId);
  }
}

// Update main keyboard to include story creation (conditionally shown)
async function getKeyboardForUser(chatId) {
  try {
    const user = await prisma.user.findFirst({
      where: {
        telegramId: chatId.toString(),
      },
    });

    if (!user) {
      return mainKeyboard;
    }

    const seller = await prisma.GGASeller.findUnique({
      where: {
        email: user.email,
      },
    });

    // Show "Build Trust" option only if seller has created store
    if (seller && seller.storeName) {
      return {
        keyboard: [
          ["Balance", "Register Seller"],
          ["Create Store", "Build Trust"],
          ["🌍 Explore India", "Surprise"],
          ["Clear", "Help"],
        ],
        resize_keyboard: true,
      };
    }

    return mainKeyboard;
  } catch (error) {
    console.error("Error getting keyboard:", error);
    return mainKeyboard;
  }
}

// Add command handler for story creation
bot.onText(/^\/buildtrust$/i, async (msg) => {
  await startStoryCreation(msg.chat.id);
});

// Add function to generate unique shipping code
function generateShippingCode() {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 16; i++) {
    code += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  // Insert dashes for better readability
  return code.match(/.{1,4}/g).join("-");
}

// Add shipping label generation function
async function generateShippingLabel(seller, user) {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
      });

      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));

      doc.on("end", async () => {
        try {
          const pdfBuffer = Buffer.concat(chunks);
          const shippingLabelKey = `shipping-labels/${
            user.email
          }-${Date.now()}.pdf`;
          const uploadResult = await s3
            .upload({
              Bucket: process.env.AWS_BUCKET_NAME,
              Key: shippingLabelKey,
              Body: pdfBuffer,
              ContentType: "application/pdf",
              ContentDisposition: "inline",
              CacheControl: "public, max-age=31536000",
            })
            .promise();

          // console.log('Shipping label uploaded successfully:', uploadResult.Location);
          resolve(uploadResult.Location);
        } catch (error) {
          console.error("Error uploading shipping label:", error);
          reject(error);
        }
      });

      // Generate unique shipping code
      const shippingCode = generateShippingCode();

      // Add GLL header
      doc
        .fontSize(24)
        .font("Helvetica-Bold")
        .text("GLL Shipping Label", { align: "center" });

      doc.moveDown(2);

      // Add seller details
      doc
        .fontSize(14)
        .font("Helvetica-Bold")
        .text("Seller Details", { underline: true });

      doc.moveDown(0.5);

      doc
        .fontSize(12)
        .font("Helvetica")
        .text(`Store: ${seller.storeName || "N/A"}`);

      doc.moveDown(0.5);

      // Get the first product
      const product =
        seller.products && seller.products.length > 0
          ? seller.products[0]
          : null;
      if (product) {
        doc.text(`Product: ${product.productName}`);
        doc.moveDown(0.5);
        doc.text(`Made in: ${product.location}`);
      }

      doc.moveDown(0.5);
      doc.text(`Store URL: ${seller.storeUrl || "N/A"}`);

      doc.moveDown(2);

      // Add shipping code in a box
      doc.rect(50, doc.y, doc.page.width - 100, 80).stroke();

      doc.moveDown(0.5);
      doc
        .fontSize(16)
        .font("Helvetica-Bold")
        .text("Shipping Code:", { align: "center" });

      doc.moveDown(0.5);
      doc.fontSize(20).text(shippingCode, { align: "center" });

      doc.moveDown(2);

      // Add shipping instructions
      doc
        .fontSize(12)
        .font("Helvetica")
        .text("Shipping Instructions:", { underline: true });

      doc.moveDown(0.5);
      doc.text("1. Print this shipping label");
      doc.text("2. Attach it securely to your package");
      doc.text("3. Keep the shipping code for tracking");
      doc.text("4. Send to the nearest GLL hub");

      // Add footer
      doc.fontSize(10).text(`Here is your Shipping label ${shippingCode}`, {
        align: "center",
        bottom: 50,
      });

      // Finalize PDF
      doc.end();
    } catch (error) {
      console.error("Error generating shipping label:", error);
      reject(error);
    }
  });
}

// Add helper function to check mission completion
async function checkMissionCompletion(email, missionType) {
  const currentDate = new Date();
  const currentWeek = getWeekNumber(currentDate);
  const currentYear = currentDate.getFullYear();

  try {
    const completion = await prisma.weeklyMissionCompletion.findFirst({
      where: {
        userEmail: email,
        missionType: missionType,
        weekNumber: currentWeek,
        year: currentYear,
      },
    });

    return completion !== null;
  } catch (error) {
    console.error("Error checking mission completion:", error);
    return false;
  }
}

// Add helper function to get week number
function getWeekNumber(date) {
  const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
  const pastDaysOfYear = (date - firstDayOfYear) / 86400000;
  return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
}

// Add helper function to record mission completion
async function recordMissionCompletion(email, missionType) {
  const currentDate = new Date();
  const currentWeek = getWeekNumber(currentDate);
  const currentYear = currentDate.getFullYear();

  try {
    await prisma.weeklyMissionCompletion.create({
      data: {
        userEmail: email,
        missionType: missionType,
        weekNumber: currentWeek,
        year: currentYear,
      },
    });

    // Add GLL ions reward
    await prisma.user.update({
      where: { email },
      data: {
        gllBalance: {
          increment: 50,
        },
      },
    });

    return true;
  } catch (error) {
    console.error("Error recording mission completion:", error);
    return false;
  }
}

// Update Weekly Missions handler
async function handleWeeklyMissions(chatId) {
  try {
    const user = await prisma.user.findFirst({
      where: {
        telegramId: chatId.toString(),
      },
    });

    if (!user) {
      await sendMessageWithTracking(
        chatId,
        "❌ Please link your account first!",
        { reply_markup: mainKeyboard }
      );
      return;
    }

    const seller = await prisma.GGASeller.findUnique({
      where: {
        email: user.email,
      },
    });

    if (!seller || !seller.storeName) {
      await sendMessageWithTracking(
        chatId,
        "🏪 Create your store first!\n\n" +
          'Click on "Create Store" to start selling your products.',
        { reply_markup: mainKeyboard }
      );
      return;
    }

    // Check mission completions for this week
    const productCompleted = await checkMissionCompletion(
      user.email,
      "product"
    );
    const inviteCompleted = await checkMissionCompletion(user.email, "invite");
    const whatsappCompleted = await checkMissionCompletion(
      user.email,
      "whatsapp"
    );

    // Show Weekly Missions menu with completion status
    await sendMessageWithTracking(
      chatId,
      "🎯 *This Week's Growth Missions*\n\n" +
        "Complete missions to grow your business and earn rewards!\n\n" +
        `1️⃣ Add another product (+50 GLL) ${productCompleted ? "✅" : ""}\n` +
        "   More products = More sales\n\n" +
        `2️⃣ Invite 2 friends (+50 GLL) ${inviteCompleted ? "✅" : ""}\n` +
        "   Grow the GLL community\n\n" +
        `3️⃣ Share on WhatsApp (+50 GLL) ${whatsappCompleted ? "✅" : ""}\n` +
        "   Reach more customers\n\n" +
        "🎁 Complete all missions for +100 GLL bonus!\n\n" +
        "⏰ Missions refresh every Monday\n" +
        "❗ Each mission can only be completed once per week\n\n" +
        "Choose a mission to begin:",
      {
        parse_mode: "Markdown",
        reply_markup: weeklyMissionsKeyboard,
      }
    );
  } catch (error) {
    console.error("Error in weekly missions:", error);
    await sendMessageWithTracking(
      chatId,
      "❌ An error occurred. Please try again later.",
      { reply_markup: mainKeyboard }
    );
  }
}

// Function to handle weekly mission product steps
async function handleWeeklyProductStep(chatId, input, currentStep = 1) {
  try {
    let registration = weeklyProductRegistration.get(chatId) || {};

    // If this is the first step, get the user's email
    if (currentStep === 1 && !registration.email) {
      const user = await prisma.user.findFirst({
        where: {
          telegramId: chatId.toString(),
        },
      });

      if (!user) {
        await sendMessageWithTracking(
          chatId,
          "❌ Please link your account first!",
          { reply_markup: mainKeyboard }
        );
        weeklyProductRegistration.delete(chatId);
        return;
      }

      registration.email = user.email;
      weeklyProductRegistration.set(chatId, registration);
    }

    // Handle current step input if not first step
    if (currentStep > 1) {
      const prevStep = WEEKLY_PRODUCT_STEPS[currentStep - 1];

      // Special handling for photo upload (Step 2)
      if (currentStep - 1 === 2) {
        try {
          const imageUrl = await uploadToS3(input, chatId);
          registration[prevStep.field] = imageUrl;
        } catch (error) {
          console.error("Error uploading image:", error);
          await sendMessageWithTracking(
            chatId,
            "❌ Failed to upload image. Please try again.",
            { reply_markup: { remove_keyboard: true } }
          );
          return;
        }
      } else if (currentStep - 1 === 4) {
        // Validate product type selection
        if (!VALID_PRODUCT_TYPES.includes(input)) {
          await sendMessageWithTracking(
            chatId,
            "❌ Please select a valid product type from the menu.",
            { reply_markup: productTypeKeyboard }
          );
          return;
        }
        registration[prevStep.field] = input;
      } else if (currentStep - 1 === 6) {
        // Handle Yes/No in final step
        if (!["✅ Yes", "❌ No"].includes(input)) {
          await sendMessageWithTracking(
            chatId,
            "❌ Please select either Yes or No using the buttons provided.",
            { reply_markup: WEEKLY_PRODUCT_STEPS[6].keyboard }
          );
          return;
        }
        registration[prevStep.field] = input === "✅ Yes";
      } else {
        registration[prevStep.field] = input;
      }
      weeklyProductRegistration.set(chatId, registration);
    }

    // If all steps are completed
    if (currentStep > 6) {
      try {
        // Create product object
        const productData = {
          productName: registration.productName,
          productImage: registration.productPhoto,
          description: registration.description,
          productType: registration.productType,
          location: registration.location,
          sellsOnline: registration.sellsOnline,
          addedAt: new Date(),
          updatedAt: new Date(),
        };

        // Update seller's products array
        const updatedSeller = await prisma.GGASeller.update({
          where: {
            email: registration.email,
          },
          data: {
            products: {
              push: productData,
            },
            updatedAt: new Date(),
          },
        });

        // Record mission completion and award GLL ions
        await recordMissionCompletion(registration.email, "product");

        // Send completion message
        await sendMessageWithTracking(
          chatId,
          "✨ Product Added Successfully!\n\n" +
            `🏷️ Product: ${registration.productName}\n` +
            `📍 Made in: ${registration.location}\n` +
            `🎁 +50 GLL Ions added to your wallet\n\n` +
            "Returning to Weekly Missions...",
          { reply_markup: weeklyMissionsKeyboard }
        );

        // Clear registration data
        weeklyProductRegistration.delete(chatId);

        // Show weekly missions menu again
        setTimeout(async () => {
          await handleWeeklyMissions(chatId);
        }, 2000);

        return;
      } catch (error) {
        console.error("Error saving product:", error);
        await sendMessageWithTracking(
          chatId,
          "❌ An error occurred while saving your product. Please try again later.",
          { reply_markup: weeklyMissionsKeyboard }
        );
        weeklyProductRegistration.delete(chatId);
        return;
      }
    }

    // Send current step message
    const step = WEEKLY_PRODUCT_STEPS[currentStep];
    await sendMessageWithTracking(chatId, step.message, {
      reply_markup: step.keyboard || { remove_keyboard: true },
    });

    // Update registration object with new step
    registration.currentStep = currentStep;
    weeklyProductRegistration.set(chatId, registration);
  } catch (error) {
    console.error("Error in weekly product registration:", error);
    await sendMessageWithTracking(
      chatId,
      "❌ An error occurred. Please try again later.",
      { reply_markup: weeklyMissionsKeyboard }
    );
    weeklyProductRegistration.delete(chatId);
  }
}

// Update message handler for Weekly Mission product option
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;

  // Track user messages
  trackMessage(chatId, msg.message_id);

  // Check if user is in weekly product registration process
  const weeklyProduct = weeklyProductRegistration.get(chatId);
  if (weeklyProduct && weeklyProduct.currentStep) {
    // Handle photo upload for step 2
    if (weeklyProduct.currentStep === 2 && msg.photo) {
      await handleWeeklyProductStep(chatId, msg.photo[0].file_id, 3);
      return;
    }
    // Handle text input for other steps
    if (msg.text) {
      await handleWeeklyProductStep(
        chatId,
        msg.text,
        weeklyProduct.currentStep + 1
      );
      return;
    }
    // If no valid input provided for step 2
    if (weeklyProduct.currentStep === 2 && !msg.photo) {
      await sendMessageWithTracking(
        chatId,
        "❌ Please upload a photo of your product."
      );
      return;
    }
  }

  // Update the Weekly Missions product handler
  if (msg.text === "✅ Add another product") {
    const user = await prisma.user.findFirst({
      where: { telegramId: chatId.toString() },
    });

    if (user) {
      const completed = await checkMissionCompletion(user.email, "product");
      if (completed) {
        await sendMessageWithTracking(
          chatId,
          "❌ You've already completed this mission this week!\n\n" +
            "⏰ Come back next Monday for new missions.",
          { reply_markup: weeklyMissionsKeyboard }
        );
        return;
      }

      // Start weekly product registration process
      await handleWeeklyProductStep(chatId);
    }
    return;
  }

  // ... rest of the existing message handling code ...
});

// Add registration step handler function
async function handleRegistrationStep(chatId, input = null) {
  try {
    let registration = registrationProcess.get(chatId);

    // Handle current step input if not first step
    if (registration.currentStep > 1 && input) {
      const prevStep = REGISTRATION_STEPS[registration.currentStep - 1];

      if (prevStep.field === "phone") {
        // Validate phone number
        const cleanNumber = input.replace(/[^\d+]/g, "");

        if (!cleanNumber.startsWith("+")) {
          await sendMessageWithTracking(
            chatId,
            "❌ Please include the country code starting with +\nExample: +91 9400123456",
            { reply_markup: { remove_keyboard: true } }
          );
          return;
        }

        // Validate Indian numbers (+91) specifically
        if (cleanNumber.startsWith("+91")) {
          if (cleanNumber.length !== 13) {
            await sendMessageWithTracking(
              chatId,
              "❌ Invalid Indian phone number. Please enter 10 digits after +91\nExample: +91 9400123456",
              { reply_markup: { remove_keyboard: true } }
            );
            return;
          }
        } else {
          // For other country codes, ensure reasonable length
          if (cleanNumber.length < 10 || cleanNumber.length > 15) {
            await sendMessageWithTracking(
              chatId,
              "❌ Invalid phone number length. Please check your country code and number.\nExample format: +91 9400123456",
              { reply_markup: { remove_keyboard: true } }
            );
            return;
          }
        }

        registration[prevStep.field] = cleanNumber;
      } else {
        registration[prevStep.field] = input;
      }
      registrationProcess.set(chatId, registration);
    }

    // If all steps are completed
    if (registration.currentStep > Object.keys(REGISTRATION_STEPS).length) {
      try {
        // Create new user in database
        const newUser = await prisma.user.create({
          data: {
            email: registration.email,
            name: registration.name,
            phone: registration.phone,
            telegramId: chatId.toString(),
            gllBalance: parseFloat(process.env.REGISTER_REWARD || "100.0"),
            companyType: "Individual",
            terms: true,
          },
        });

        // Send completion message
        await sendMessageWithTracking(
          chatId,
          "✅ Registration completed successfully!\n\n" +
            `Welcome ${registration.name}!\n\n` +
            `💰 *Your GLL Balance*\n` +
            `${process.env.REGISTER_REWARD || "100.0"} GLL\n\n` +
            `Available Commands:\n` +
            `🔷 /balance - Check GLL Balance\n` +
            `🎲 /surprise - Get a Random Duck\n` +
            `🧹 /clear - Clear Chat History\n` +
            `❓ /help - Show All Commands\n\n` +
            `Visit Our Website: https://gll.one for more information`,
          {
            parse_mode: "Markdown",
            reply_markup: mainKeyboard,
          }
        );

        // Clear registration data
        registrationProcess.delete(chatId);
        return;
      } catch (error) {
        console.error("Error saving registration:", error);
        await sendMessageWithTracking(
          chatId,
          "❌ An error occurred while saving your registration. Please try again later.",
          { reply_markup: mainKeyboard }
        );
        registrationProcess.delete(chatId);
        return;
      }
    }

    // Send current step message
    const step = REGISTRATION_STEPS[registration.currentStep];
    await sendMessageWithTracking(chatId, step.message, {
      reply_markup: { remove_keyboard: true },
    });

    // Update registration object with new step
    registration.currentStep = registration.currentStep + 1;
    registrationProcess.set(chatId, registration);
  } catch (error) {
    console.error("Error in registration step:", error);
    await sendMessageWithTracking(
      chatId,
      "❌ An error occurred. Please try again later.",
      { reply_markup: mainKeyboard }
    );
    registrationProcess.delete(chatId);
  }
}

// Add product category keyboard
const productCategoryKeyboard = {
  keyboard: [
    ["👕 Clothing", "👠 Shoes", "💍 Jewelry"],
    ["💄 Beauty Products", "📱 Electronics"],
    ["🍲 Food & Beverages", "🎨 Handcrafted"],
    ["📚 Books", "🏠 Home Decor"],
    ["🐾 Pet Supplies"],
    ["🏠 Back to Home"],
  ],
  resize_keyboard: true,
};

// Add seller action keyboard
const sellerActionKeyboard = {
  keyboard: [
    ["📦 Request Sample", "💬 Chat", "📃 Start Deal"],
    ["🔙 Back to Categories"],
  ],
  resize_keyboard: true,
};

// Track product browsing state
const productBrowsing = new Map();

bot.onText(/^\/clear$/, async (msg) => {
  const chatId = msg.chat.id;
  let loadingMsg;

  try {
    // Send a loading message
    loadingMsg = await bot.sendMessage(chatId, "🧹 Clearing chat history...");

    // Get the current message ID
    const currentMessageId = msg.message_id;

    // Delete last 100 messages
    for (let i = 0; i < 100; i++) {
      try {
        await bot.deleteMessage(chatId, currentMessageId - i);
        // Small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 30));
      } catch (err) {
        // Ignore errors for messages that can't be deleted
        continue;
      }
    }

    // Delete the loading message
    if (loadingMsg) {
      try {
        await bot.deleteMessage(chatId, loadingMsg.message_id);
      } catch (err) {
        // console.log("Couldn't delete loading message:", err.message);
      }
    }

    // Trigger the start command
    bot.emit("text", {
      text: "/start",
      chat: { id: chatId },
      from: msg.from,
    });
  } catch (error) {
    console.error("Error in clear command:", error);

    // Try to delete loading message if it exists
    if (loadingMsg) {
      try {
        await bot.deleteMessage(chatId, loadingMsg.message_id);
      } catch (err) {
        // console.log("Couldn't delete loading message:", err.message);
      }
    }

    // Send error message
    await sendMessageWithTracking(
      chatId,
      "❌ An error occurred while clearing messages. Please try again later.",
      { reply_markup: mainKeyboard }
    );
  }
});

// Update the Clear button handler
bot.on("message", async (msg) => {
  if (msg.text === "Clear") {
    const chatId = msg.chat.id;
    try {
      // Get the current message ID
      const currentMessageId = msg.message_id;

      // Delete last 100 messages
      for (let i = 0; i < 100; i++) {
        try {
          await bot.deleteMessage(chatId, currentMessageId - i);
          // Small delay to avoid rate limiting
          await new Promise((resolve) => setTimeout(resolve, 30));
        } catch (err) {
          // Ignore errors for messages that can't be deleted
          continue;
        }
      }

      // Trigger the start command
      bot.emit("text", {
        text: "/start",
        chat: { id: chatId },
        from: msg.from,
      });
    } catch (error) {
      console.error("Error in clear command:", error);
      await sendMessageWithTracking(
        chatId,
        "❌ An error occurred while clearing messages. Please try again later.",
        { reply_markup: mainKeyboard }
      );
    }
  }
});

module.exports = router;
