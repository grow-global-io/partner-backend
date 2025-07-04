const prisma = require('../config/db');
const AWS = require('aws-sdk');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');

let botInstance;

const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || 'eu-north-1'
});

// State Management
const usersAwaitingEmail = new Set();
const usersLinking = new Set();
const chatMessages = new Map();
const manufacturerRegistration = new Map();
const verificationProcess = new Map();
const storeCreation = new Map();
const storyCreation = new Map();
const weeklyProductRegistration = new Map();
const registrationProcess = new Map();
const productBrowsing = new Map();

// Constants: Keyboards
const productTypeKeyboard = {
    keyboard: [
        ['Clothing', 'Shoes', 'Jewelry'],
        ['Beauty Products', 'Electronics'],
        ['Food & Beverages', 'Handcrafted Products'],
        ['Books', 'Home Decor & Furniture'],
        ['Pet Supplies']
    ],
    resize_keyboard: true,
    one_time_keyboard: true
};

const verificationOptionsKeyboard = {
    keyboard: [
        ['✅ Verify Business'],
        ['🏠 Back to Home']
    ],
    resize_keyboard: true
};

const trustBuildingKeyboard = {
    keyboard: [
        ['Build Trust with Story & Sample'],
        ['🏠 Back to Home']
    ],
    resize_keyboard: true
};

const weeklyMissionsKeyboard = {
    keyboard: [
        ['✅ Add another product'],
        ['✅ Invite 2 friends to join'],
        ['✅ Share your store on WhatsApp'],
        ['🏠 Back to Home']
    ],
    resize_keyboard: true
};

const registrationConfirmKeyboard = {
    keyboard: [
        ['✅ Yes, Register Now'],
        ['❌ No, I\'ll Register Later']
    ],
    resize_keyboard: true,
    one_time_keyboard: true
};

const mainKeyboard = {
    keyboard: [
        ['Balance', 'Register Seller'],
        ['Create Store', 'Weekly Missions'],
        ['🌍 Explore India', 'Surprise'],
        ['Clear', 'Help']
    ],
    resize_keyboard: true
};

const sellerTypeKeyboard = {
    keyboard: [
        ['Trader', 'Manufacturer'],
        ['Back to Main Menu']
    ],
    resize_keyboard: true
};

const productCategoryKeyboard = {
    keyboard: [
        ['👕 Clothing', '👠 Shoes', '💍 Jewelry'],
        ['💄 Beauty Products', '📱 Electronics'],
        ['🍲 Food & Beverages', '🎨 Handcrafted'],
        ['📚 Books', '🏠 Home Decor'],
        ['🐾 Pet Supplies'],
        ['🏠 Back to Home']
    ],
    resize_keyboard: true
};

const sellerActionKeyboard = { // This was defined later, ensure consistency
    keyboard: [
        ['📦 Request Sample', '💬 Chat', '📃 Start Deal'],
        ['🔙 Back to Categories']
    ],
    resize_keyboard: true
};


// Constants: Step Definitions & Validation
const VALID_PRODUCT_TYPES = [
    'Clothing', 'Shoes', 'Jewelry', 'Beauty Products', 'Electronics',
    'Food & Beverages', 'Handcrafted Products', 'Books', 'Home Decor & Furniture', 'Pet Supplies'
];

const MANUFACTURER_STEPS = {
    1: { message: '🧵 Step 1 of 6\n\nWhat is the name of your product?', field: 'productName' },
    2: { message: '📸 Step 2 of 6\n\nUpload a clear photo of your product.', field: 'productPhoto' },
    3: { message: '📝 Step 3 of 6\n\nGive a short 1–2 line description.', field: 'description' },
    4: { message: '🏷️ Step 4 of 6\n\nSelect your product type:', field: 'productType', keyboard: productTypeKeyboard },
    5: { message: '📍 Step 5 of 6\n\nWhere is this product made? (City, State)', field: 'location' },
    6: { message: '🛒 Step 6 of 6\n\nDo you sell this product online?', field: 'sellsOnline', keyboard: { keyboard: [['✅ Yes', '❌ No']], resize_keyboard: true, one_time_keyboard: true } }
};

const VERIFICATION_STEPS = {
    1: { message: '🪪 Step 1 of 3\n\nPlease upload your Aadhar Card or Passport.', field: 'aadharDoc', type: 'document' },
    2: { message: '🧾 Step 2 of 3\n\nPlease upload your UDYAM Registration or GST Certificate.', field: 'gstDoc', type: 'document' },
    3: { message: '📱 Step 3 of 3\n\nPlease share your WhatsApp number with country code.\nExample: +91 9400123456', field: 'whatsappNumber', type: 'text' }
};

const STORE_STEPS = {
    1: { message: '🛍️ Step 1 of 4\n\nWhat would you like to name your store?', field: 'storeName' },
    2: { message: '📍 Step 2 of 4\n\nTagline (e.g., "Handcrafted with love in Telangana")', field: 'storeTagline' },
    3: { message: '📸 Step 3 of 4\n\nUpload a store logo or banner:', field: 'storeLogo', type: 'photo' },
    4: { message: '🔗 Step 4 of 4\n\nAny social links to add? (Instagram, WhatsApp, YouTube)\nJust paste the URL:', field: 'socialLinks' }
};

const STORY_STEPS = {
    1: { message: '🎤 Buyers love to hear your story!\n\n' + 'Please record a short 60-sec voice or video intro about:\n' + '- What you make\n' + '- Why you started\n' + '- Your hometown\n\n' + 'Upload your voice note or video now.', field: 'storyMedia', type: 'media' },
    2: { message: '📦 Want to send a sample to our regional GLL Hub?\n' + 'We\'ll help ship it!', field: 'sampleRequested', keyboard: { keyboard: [['✅ Yes, send sample'], ['❌ No, maybe later']], resize_keyboard: true, one_time_keyboard: true } }
};

const WEEKLY_PRODUCT_STEPS = {
    1: { message: '🧵 Step 1 of 6\n\nWhat is the name of your product?', field: 'productName' },
    2: { message: '📸 Step 2 of 6\n\nUpload a clear photo of your product.', field: 'productPhoto' },
    3: { message: '📝 Step 3 of 6\n\nGive a short 1–2 line description.', field: 'description' },
    4: { message: '🏷️ Step 4 of 6\n\nSelect your product type:', field: 'productType', keyboard: productTypeKeyboard },
    5: { message: '📍 Step 5 of 6\n\nWhere is this product made? (City, State)', field: 'location' },
    6: { message: '🛒 Step 6 of 6\n\nDo you sell this product online?', field: 'sellsOnline', keyboard: { keyboard: [['✅ Yes', '❌ No']], resize_keyboard: true, one_time_keyboard: true } }
};

const REGISTRATION_STEPS = {
    1: { message: '👤 Please enter your full name:', field: 'name' },
    2: { message: '📱 Please enter your phone number with ISD code:\nExample: +91 9400123456', field: 'phone' }
};

// Core Utilities
function trackMessage(chatId, messageId) {
    if (!chatMessages.has(chatId)) {
        chatMessages.set(chatId, new Set());
    }
    chatMessages.get(chatId).add(messageId);
}

async function sendMessageWithTracking(chatId, text, options = {}) {
    if (!botInstance) throw new Error("Bot not initialized in botService");
    try {
        const sentMsg = await botInstance.sendMessage(chatId, text, options);
        trackMessage(chatId, sentMsg.message_id);
        return sentMsg;
    } catch (error) {
        console.error('Error sending message:', error);
        // It's often better to let the caller handle UI feedback for errors
        // For now, just rethrow to maintain original behavior if botRoutes wasn't catching it specifically
        throw error;
    }
}

// Function to upload file to S3
async function uploadToS3(fileId, chatId) {
    if (!botInstance) throw new Error("Bot not initialized in botService");
    try {
        const file = await botInstance.getFile(fileId);
        const filePath = file.file_path;
        const response = await axios({
            url: `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`,
            method: 'GET',
            responseType: 'stream'
        });
        const filename = `seller-products/${chatId}-${Date.now()}${path.extname(filePath)}`;
        const uploadResult = await s3.upload({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: filename,
            Body: response.data,
            ContentType: 'image/jpeg' // Adjust as needed
        }).promise();
        return uploadResult.Location;
    } catch (error) {
        console.error('Error uploading to S3:', error);
        throw error;
    }
}

// Function to handle manufacturer registration steps
async function handleManufacturerStep(chatId, input, currentStep = 1) {
    try {
        let registration = manufacturerRegistration.get(chatId) || {};
        
        if (currentStep === 1 && !registration.email) {
            const user = await prisma.user.findFirst({ where: { telegramId: chatId.toString() } });
            if (!user) {
                await sendMessageWithTracking(chatId, '❌ Please link your account first!\n\nUse /start command to link your GLL account before registering as a seller.', { reply_markup: mainKeyboard });
                manufacturerRegistration.delete(chatId);
                return;
            }
            registration.email = user.email;
            // sellerType would have been set by handleCommand calling this
            // If called directly, ensure sellerType is present if needed earlier
             if (!registration.sellerType && manufacturerRegistration.has(chatId)) { // Preserve if already set
                registration.sellerType = manufacturerRegistration.get(chatId).sellerType;
            }
            manufacturerRegistration.set(chatId, registration);
        }

        if (currentStep > 1) {
            const prevStep = MANUFACTURER_STEPS[currentStep - 1];
            if (currentStep - 1 === 2) { // Photo upload
                try {
                    const imageUrl = await uploadToS3(input, chatId); // input is file_id
                    registration[prevStep.field] = imageUrl;
                } catch (error) {
                    console.error('Error uploading image:', error);
                    await sendMessageWithTracking(chatId, '❌ Failed to upload image. Please try again.', { reply_markup: { remove_keyboard: true } });
                    return;
                }
            } else if (currentStep - 1 === 4) { // Product type
                if (!VALID_PRODUCT_TYPES.includes(input)) {
                    await sendMessageWithTracking(chatId, '❌ Please select a valid product type from the menu.', { reply_markup: productTypeKeyboard });
                    return;
                }
                registration[prevStep.field] = input;
            } else if (currentStep - 1 === 6) { // Sells online
                if (!['✅ Yes', '❌ No'].includes(input)) {
                    await sendMessageWithTracking(chatId, '❌ Please select either Yes or No using the buttons provided.', { reply_markup: MANUFACTURER_STEPS[6].keyboard });
                    return;
                }
                registration[prevStep.field] = (input === '✅ Yes');
            } else {
                registration[prevStep.field] = input;
            }
            manufacturerRegistration.set(chatId, registration);
        }

        if (currentStep > 6) { // All steps completed
            try {
                const productData = {
                    productName: registration.productName,
                    productImage: registration.productPhoto,
                    description: registration.description,
                    productType: registration.productType,
                    location: registration.location,
                    sellsOnline: registration.sellsOnline,
                    addedAt: new Date(),
                    updatedAt: new Date()
                };
                let seller = await prisma.GGASeller.findUnique({ where: { email: registration.email }, select: { email: true, products: true } });
                if (seller) {
                    await prisma.GGASeller.update({ where: { email: registration.email }, data: { products: { push: productData }, updatedAt: new Date() } });
                } else {
                    await prisma.GGASeller.create({ data: { email: registration.email, sellerType: registration.sellerType || "Unknown", isVerified: false, products: [productData], createdAt: new Date(), updatedAt: new Date() } });
                }
                await prisma.user.update({ where: { email: registration.email }, data: { gllBalance: { increment: parseFloat(process.env.MANUFACTURER_BONUS) } } });
                const user = await prisma.user.findUnique({ where: { email: registration.email } });
                const sellerName = user?.name || registration.email.split('@')[0];
                const capitalizedName = sellerName.charAt(0).toUpperCase() + sellerName.slice(1);
                await sendMessageWithTracking(chatId, `🎉 Thank you, ${capitalizedName}!\n\n🛍️ Product: ${registration.productName}\n🏷️ Type: ${registration.productType}\n📍 Made in: ${registration.location}\n${registration.sellsOnline ? '✅ Online seller' : '❌ Offline seller'}\n👥 Type: ${registration.sellerType}\n\n🎁 +10 GLL Ions added to your wallet.\n\nWhat would you like to do next?\n✅ Verify your business to become a certified exporter\n🏠 Return to main menu`, { parse_mode: 'Markdown', reply_markup: verificationOptionsKeyboard });
                manufacturerRegistration.delete(chatId);
                return;
            } catch (error) {
                console.error('Error saving registration:', error);
                await sendMessageWithTracking(chatId, '❌ An error occurred while saving your registration. Please try again later.', { reply_markup: mainKeyboard });
                manufacturerRegistration.delete(chatId);
                return;
            }
        }

        const step = MANUFACTURER_STEPS[currentStep];
        await sendMessageWithTracking(chatId, step.message, { reply_markup: step.keyboard || { remove_keyboard: true } });
        registration.currentStep = currentStep;
        manufacturerRegistration.set(chatId, registration);
    } catch (error) {
        console.error('Error in manufacturer registration:', error);
        await sendMessageWithTracking(chatId, '❌ An error occurred. Please try again later.', { reply_markup: mainKeyboard });
        manufacturerRegistration.delete(chatId);
    }
}

// Function to start verification process
async function startVerification(chatId) {
    try {
        const user = await prisma.user.findFirst({ where: { telegramId: chatId.toString() } });
        if (!user) {
            await sendMessageWithTracking(chatId, '❌ Please link your account first!', { reply_markup: mainKeyboard });
            return;
        }
        verificationProcess.set(chatId, { email: user.email, currentStep: 1 });
        await sendMessageWithTracking(chatId, '🪪 *Business Verification / KYC*\n\nTo verify your business, please upload the following:\n\n📄 Aadhar / Passport\n🧾 UDYAM / GST certificate\n📱 WhatsApp Number\n' + `📧 Email (already saved: ${user.email})\n\nLet's start with your first document 👇`, { parse_mode: 'Markdown', reply_markup: { remove_keyboard: true } });
        await handleVerificationStep(chatId, null, 1);
    } catch (error) {
        console.error('Error starting verification:', error);
        await sendMessageWithTracking(chatId, '❌ An error occurred. Please try again later.', { reply_markup: mainKeyboard });
    }
}

// Function to handle verification steps
async function handleVerificationStep(chatId, input, currentStep = 1) {
    try {
        let verification = verificationProcess.get(chatId) || {};
        if (currentStep > 1 && input) {
            const prevStep = VERIFICATION_STEPS[currentStep - 1];
            if (prevStep.type === 'document') {
                try {
                    const docUrl = await uploadToS3(input, `${chatId}-${prevStep.field}`); // input is file_id
                    verification[prevStep.field] = docUrl;
                } catch (error) {
                    console.error('Error uploading document:', error);
                    await sendMessageWithTracking(chatId, '❌ Failed to upload document. Please try again.', { reply_markup: { remove_keyboard: true } });
                    return;
                }
            } else if (prevStep.field === 'whatsappNumber') {
                const cleanNumber = input.replace(/[^\d+]/g, '');
                if (!cleanNumber.startsWith('+')) {
                    await sendMessageWithTracking(chatId, '❌ Please include the country code starting with +\nExample: +91 9400123456', { reply_markup: { remove_keyboard: true } });
                    return;
                }
                // Basic length validation, can be enhanced
                if (cleanNumber.length < 10 || cleanNumber.length > 15) {
                     await sendMessageWithTracking(chatId, '❌ Invalid phone number length. Please check your country code and number.\nExample format: +91 9400123456', { reply_markup: { remove_keyboard: true } });
                    return;
                }
                verification[prevStep.field] = cleanNumber; // Store cleaned number
            } else {
                verification[prevStep.field] = input;
            }
            verificationProcess.set(chatId, verification);
        }

        if (currentStep > 3) { // All steps completed
            try {
                const user = await prisma.user.findUnique({ where: { email: verification.email } });
                const seller = await prisma.GGASeller.findUnique({ where: { email: verification.email } });
                if (!user || !seller) {
                    await sendMessageWithTracking(chatId, '❌ User or seller data not found. Cannot complete verification.', { reply_markup: mainKeyboard });
                    verificationProcess.delete(chatId);
                    return;
                }
                const certificateUrl = await generateCertificate(seller, user);
                await prisma.GGASeller.update({ where: { email: verification.email }, data: { aadharDoc: verification.aadharDoc, gstDoc: verification.gstDoc, whatsappNumber: verification.whatsappNumber, isVerified: true, verifiedAt: new Date(), certificateUrl: certificateUrl } });
                await prisma.user.update({ where: { email: verification.email }, data: { gllBalance: { increment: parseFloat(process.env.VERIFICATION_BONUS) } } });
                await sendMessageWithTracking(chatId, `✅ Documents received and verified!\n\n🎓 You are now a GLL Certified Exporter\n\n📄 Download your certificate here: [Download Certificate](${certificateUrl})\n\n🎁 +25 GLL Ions added.\n\nLet's now create your storefront! Click "Create Store" to begin.`, { parse_mode: 'Markdown', reply_markup: { keyboard: [['Create Store'], ['🏠 Back to Home']], resize_keyboard: true } });
                verificationProcess.delete(chatId);
                return;
            } catch (error) {
                console.error('Error saving verification:', error);
                await sendMessageWithTracking(chatId, '❌ An error occurred while saving your verification. Please try again later.', { reply_markup: mainKeyboard });
                verificationProcess.delete(chatId);
                return;
            }
        }
        const step = VERIFICATION_STEPS[currentStep];
        await sendMessageWithTracking(chatId, step.message, { reply_markup: { remove_keyboard: true } });
        verification.currentStep = currentStep;
        verificationProcess.set(chatId, verification);
    } catch (error) {
        console.error('Error in verification step:', error);
        await sendMessageWithTracking(chatId, '❌ An error occurred. Please try again later.', { reply_markup: mainKeyboard });
        verificationProcess.delete(chatId);
    }
}

async function generateCertificate(seller, user) {
    return new Promise(async (resolve, reject) => {
        try {
            const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margins: { top: 50, bottom: 50, left: 50, right: 50 } });
            const chunks = [];
            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', async () => {
                try {
                    const pdfBuffer = Buffer.concat(chunks);
                    const certificateKey = `certificates/${user.email}-${Date.now()}.pdf`;
                    const uploadResult = await s3.upload({ Bucket: process.env.AWS_BUCKET_NAME, Key: certificateKey, Body: pdfBuffer, ContentType: 'application/pdf', ContentDisposition: 'inline', CacheControl: 'public, max-age=31536000' }).promise();
                    resolve(uploadResult.Location);
                } catch (error) { reject(error); }
            });

            doc.rect(0, 0, doc.page.width, doc.page.height).fill('#f5f5f5');
            const margin = 20;
            doc.rect(margin, margin, doc.page.width - (margin * 2), doc.page.height - (margin * 2)).lineWidth(2).stroke('#000000');
            doc.fontSize(35).font('Helvetica-Bold').fillColor('#000000').text('GLL', { align: 'center' });
            doc.moveDown(0.5);
            doc.fontSize(30).font('Helvetica-Bold').text('Certificate of Verification', { align: 'center' });
            doc.moveDown(2);
            doc.fontSize(16).font('Helvetica').text('This is to certify that', { align: 'center' });
            doc.moveDown(0.5);
            doc.fontSize(20).font('Helvetica-Bold').fillColor('#000066').text(user.email, { align: 'center' });
            doc.moveDown(1);
            const product = seller.products && seller.products.length > 0 ? seller.products[0] : null;
            if (product) {
                doc.fontSize(16).font('Helvetica').fillColor('#000000').text('is verified for the following product:', { align: 'center' });
                doc.moveDown(0.5);
                doc.fontSize(18).font('Helvetica-Bold').text(`${product.productName}`, { align: 'center' });
                doc.moveDown(0.5);
                doc.fontSize(16).font('Helvetica').text(`Made in: ${product.location}`, { align: 'center' });
            }
            doc.moveDown(2);
            doc.fontSize(18).font('Helvetica-Bold').fillColor('#008000').text('✅ Documents received and verified!', { align: 'center' });
            doc.moveDown(0.5);
            doc.fontSize(18).text('🎓 You are now a GLL Certified Exporter', { align: 'center' });
            doc.moveDown(2);
            doc.fontSize(14).font('Helvetica').fillColor('#000000').text(`Verification Date: ${new Date().toLocaleDateString()}`, { align: 'center' });
            const certificateId = `GLL-CERT-${Date.now()}`;
            doc.moveDown(0.5);
            doc.fontSize(12).text(`Certificate ID: ${certificateId}`, { align: 'center' });
            doc.fontSize(10).font('Helvetica').text('This is an electronically generated certificate.', { align: 'center', bottom: 30 }); // This bottom might not work as expected.
            doc.end();
        } catch (error) {
            console.error('Error generating certificate:', error);
            reject(error);
        }
    });
}

// Placeholder for handleCommand and other major handlers
async function handleCommand(msg, command) {
    const chatId = msg.chat.id;
    const normalizedCommand = command.replace('/', '').charAt(0).toUpperCase() + command.replace('/', '').slice(1).toLowerCase();
    
    switch (normalizedCommand) {
        case 'Balance':
            try {
                const user = await prisma.user.findFirst({ where: { telegramId: chatId.toString() } });
                if (!user) {
                    await sendMessageWithTracking(chatId, 'ℹ️ Your Telegram account is not linked yet!\n\nPlease use /start command to link your account first.');
                    return;
                }
                const formattedBalance = user.gllBalance ? new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(user.gllBalance) : '0.00';
                await sendMessageWithTracking(chatId, `💰 *GLL Balance*\n\nEmail: ${user.email}\nBalance: ${formattedBalance} GLL\n\n_Last updated: ${new Date().toLocaleString()}_`, { parse_mode: 'Markdown', reply_markup: mainKeyboard });
            } catch (error) {
                console.error('Error in balance command:', error);
                await sendMessageWithTracking(chatId, '❌ An error occurred while fetching your balance. Please try again later.');
            }
            break;

        case 'Surprise':
            try {
                const loadingMsg = await botInstance.sendMessage(chatId, '🦆 Finding a cute duck for you...');
                trackMessage(chatId, loadingMsg.message_id);
                const response = await axios.get('https://random-d.uk/api/v2/random');
                const duckImage = response.data.url;
                await botInstance.deleteMessage(chatId, loadingMsg.message_id);
                const sentPhoto = await botInstance.sendPhoto(chatId, duckImage, { caption: '🦆 Quack! Here\'s your random cute duck! \n\nThis duck will lead you to our main website: https://gll.one, follow it.', reply_markup: mainKeyboard });
                trackMessage(chatId, sentPhoto.message_id);
            } catch (error) {
                console.error('Error in surprise command:', error);
                await sendMessageWithTracking(chatId, '❌ Oops! The ducks are hiding right now. Try again later!', { reply_markup: mainKeyboard });
            }
            break;

        case 'Clear':
            // The 'clear' logic involving bot.emit might be tricky to move directly
            // botInstance.emit('clear_command', msg); // This won't work as 'emit' is on the original bot object for custom events.
            // For now, this part of 'Clear' might need to stay in botRoutes or be refactored.
            // Let's assume the direct message deletion part of clear is what's primarily needed.
            // Or, botRoutes can handle the emit and call a service function for actual deletion.
            // For now, I'll leave 'Clear' command's specific emit logic in botRoutes.
            // The simple message 'Clear' button handler in botRoutes calls a function that can be moved.
             await handleClearCommand(chatId, msg.message_id, msg.from); // We'll define this.
            break;


        case 'Help':
            await sendMessageWithTracking(chatId, '🔹 *Available Commands*\n\n🔸 /start - Start/Restart the bot\n🔸 /balance - Check your GLL balance\n🔸 /registerseller - Start seller registration\n🔸 /createstore - Create your store\n🔸 /surprise - Get a random duck image\n🔸 /clear - Clear chat history\n🔸 /help - Show this help message\n\n💡 You can use either the menu buttons or type these commands.', { parse_mode: 'Markdown', reply_markup: mainKeyboard });
            break;

        case 'Link':
            // This also used bot.emit('start_command', msg)
            // It's better to call the start command handler directly.
            await handleStartCommand(chatId, msg.from); // We'll define this.
            break;

        case 'Register seller':
        case 'Registerseller':
            try {
                const user = await prisma.user.findFirst({ where: { telegramId: chatId.toString() } });
                if (!user) {
                    await sendMessageWithTracking(chatId, '❌ Please link your account first!\n\nUse /start command to link your GLL account before accessing the seller journey.', { reply_markup: mainKeyboard });
                    return;
                }
                await sendMessageWithTracking(chatId, '🌟 *Welcome to the GLL Export Accelerator* 🇮🇳🌍\n\nHere, you can create your store, get certified, and export authentic Indian products to buyers worldwide.\n\nWhat best describes you?\n\n🔘 I make my own products (/manufacturer)\n🔘 I want to resell GI-tagged products (/trader)', { parse_mode: 'Markdown', reply_markup: sellerTypeKeyboard });
            } catch (error) {
                console.error('Error in register seller command:', error);
                await sendMessageWithTracking(chatId, '❌ An error occurred. Please try again later.', { reply_markup: mainKeyboard });
            }
            break;

        case 'Trader':
        case 'Manufacturer': // Combined logic as they both call handleManufacturerStep
            try {
                const registrationData = { sellerType: normalizedCommand }; // Trader or Manufacturer
                manufacturerRegistration.set(chatId, registrationData); // Initialize with sellerType
                await handleManufacturerStep(chatId); // Calls with currentStep = 1 by default
            } catch (error) {
                console.error(`Error in ${normalizedCommand} selection:`, error);
                await sendMessageWithTracking(chatId, '❌ An error occurred. Please try again later.');
            }
            break;

        case 'Back to main menu':
            await sendMessageWithTracking(chatId, '🏠 Back to main menu. How can I help you?', { reply_markup: mainKeyboard });
            break;
        
        // Default case was missing, good to have for unhandled commands if this dispatcher is used more broadly
        default:
            // This might be handled by the general message handler in botRoutes if no specific command matches
            // console.log(`Unhandled command in handleCommand: ${normalizedCommand}`);
            break;
    }
}

async function handleStartCommand(chatId, from) {
    try {
        console.log('\n✨ Start Command Received in Service:');
        console.log('From Chat ID:', chatId);

        const user = await prisma.user.findFirst({ where: { telegramId: chatId.toString() } });
        if (user) {
            await sendMessageWithTracking(chatId, `Welcome back to Grow Global Partner Bot! 🌟\n\nLogged in as: ${user.email}\n\nChoose from these options:\n\n🔷 /balance - Check GLL Balance\n🏪 /registerseller - Register as a Seller\n🎯 /weekly-mission - Weekly Tasks & Rewards\n🎲 /surprise - Get a Random Duck\n🧹 /clear - Clear Chat History\n❓ /help - Show All Commands\n\nNeed anything else? Just use one of the commands above!\n\nVisit Our Website: https://gll.one for more information`, { parse_mode: 'Markdown', reply_markup: mainKeyboard });
        } else {
            usersAwaitingEmail.add(chatId);
            await sendMessageWithTracking(chatId, 'Welcome to Grow Global Partner Bot! 🌟\n\nTo get started, please share your email address so I can link your account.\n\nJust type your email address and send it to me.\n\nVisit Our Website: https://gll.one for more information', { reply_markup: { remove_keyboard: true } });
        }
        console.log('Start message sent successfully from service\n');
    } catch (error) {
        console.error('Error in start command (service):', error);
        if (!error.message.includes("Bot not initialized") && !error.message.includes("Error sending message")) {
             await sendMessageWithTracking(chatId, '❌ An error occurred processing start. Please try again later.').catch(e => console.error("Failed to send error message for start command:", e));
        }
    }
}


async function handleClearCommand(chatId, currentMessageId, from) {
    let loadingMsg;
    try {
        loadingMsg = await sendMessageWithTracking(chatId, '🧹 Clearing chat history...');

        for (let i = 0; i < 100; i++) {
            try {
                if (botInstance) await botInstance.deleteMessage(chatId, currentMessageId - i);
                await new Promise(resolve => setTimeout(resolve, 30));
            } catch (err) { continue; }
        }
        if (loadingMsg && botInstance) {
            try { await botInstance.deleteMessage(chatId, loadingMsg.message_id); }
            catch (err) { console.log("Couldn't delete loading message for clear:", err.message); }
        }
        // Trigger start command logic
        await handleStartCommand(chatId, from);
    } catch (error) {
        console.error('Error in handleClearCommand (service):', error);
        if (loadingMsg && botInstance) {
            try { await botInstance.deleteMessage(chatId, loadingMsg.message_id); }
            catch (err) { console.log("Couldn't delete loading message for clear (error path):", err.message); }
        }
         await sendMessageWithTracking(chatId, '❌ An error occurred while clearing messages. Please try again later.', { reply_markup: mainKeyboard })
            .catch(e => console.error("Failed to send error message for clear command:", e));
    }
}

async function startStoreCreation(chatId) {
    try {
        const user = await prisma.user.findFirst({ where: { telegramId: chatId.toString() } });
        if (!user) {
            await sendMessageWithTracking(chatId, '❌ Please link your account first!', { reply_markup: mainKeyboard });
            return;
        }
        const seller = await prisma.GGASeller.findUnique({ where: { email: user.email } });
        if (!seller) {
            await sendMessageWithTracking(chatId, '❌ Please register as a seller first!\n\nUse the "Register Seller" option from the menu to get started.', { reply_markup: mainKeyboard });
            return;
        }
        if (!seller.isVerified) {
            await sendMessageWithTracking(chatId, '❌ Please complete business verification first!\n\nUse the "✅ Verify Business" option to get verified.', { reply_markup: mainKeyboard });
            return;
        }
        storeCreation.set(chatId, { email: user.email, currentStep: 1 });
        await handleStoreStep(chatId, null, 1);
    } catch (error) {
        console.error('Error starting store creation:', error);
        await sendMessageWithTracking(chatId, '❌ An error occurred. Please try again later.', { reply_markup: mainKeyboard });
    }
}

async function handleStoreStep(chatId, input, currentStep = 1) {
    try {
        let store = storeCreation.get(chatId) || {};
        if (currentStep > 1 && input) {
            const prevStep = STORE_STEPS[currentStep - 1];
            if (prevStep.type === 'photo') {
                try {
                    const imageUrl = await uploadToS3(input, `${chatId}-store-logo`);
                    store[prevStep.field] = imageUrl;
                } catch (error) {
                    console.error('Error uploading image:', error);
                    await sendMessageWithTracking(chatId, '❌ Failed to upload image. Please try again.', { reply_markup: { remove_keyboard: true } });
                    return;
                }
            } else if (prevStep.field === 'socialLinks') {
                try {
                    new URL(input);
                    store[prevStep.field] = { url: input };
                } catch (error) {
                    await sendMessageWithTracking(chatId, '❌ Please provide a valid URL starting with http:// or https://', { reply_markup: { remove_keyboard: true } });
                    return;
                }
            } else {
                store[prevStep.field] = input;
            }
            storeCreation.set(chatId, store);
        }

        if (currentStep > 4) { // All steps completed
            try {
                const storeUrl = store.storeName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
                const updatedSeller = await prisma.GGASeller.update({
                    where: { email: store.email },
                    data: { storeName: store.storeName, storeTagline: store.storeTagline, storeLogo: store.storeLogo, socialLinks: store.socialLinks, storeUrl: `https://growglobal.asia/${storeUrl}`, updatedAt: new Date() }
                });
                await prisma.user.update({ where: { email: store.email }, data: { gllBalance: { increment: parseFloat(process.env.STORE_BONUS) } } });
                const productCount = updatedSeller.products ? updatedSeller.products.length : 0;
                await sendMessageWithTracking(chatId, `🎉 Your store is now LIVE!\n\n🌐 ${updatedSeller.storeUrl}\n\n🏷️ Products added: ${productCount}\n🎁 +25 GLL Ions awarded!\n\n🌟 Next Step: Build trust with buyers by sharing your story and product samples.\nThis will help you:\n• Get a Trusted Exporter Badge 🎖️\n• Increase buyer confidence 📈\n• Earn +25 GLL Ions 🎁`, { parse_mode: 'Markdown', reply_markup: trustBuildingKeyboard });
                storeCreation.delete(chatId);
                return;
            } catch (error) {
                console.error('Error saving store:', error);
                await sendMessageWithTracking(chatId, '❌ An error occurred while saving your store. Please try again later.', { reply_markup: mainKeyboard });
                storeCreation.delete(chatId);
                return;
            }
        }
        const step = STORE_STEPS[currentStep];
        await sendMessageWithTracking(chatId, step.message, { reply_markup: { remove_keyboard: true } });
        store.currentStep = currentStep;
        storeCreation.set(chatId, store);
    } catch (error) {
        console.error('Error in store creation step:', error);
        await sendMessageWithTracking(chatId, '❌ An error occurred. Please try again later.', { reply_markup: mainKeyboard });
        storeCreation.delete(chatId);
    }
}

async function startStoryCreation(chatId) {
    try {
        const user = await prisma.user.findFirst({ where: { telegramId: chatId.toString() } });
        if (!user) {
            await sendMessageWithTracking(chatId, '❌ Please link your account first!', { reply_markup: mainKeyboard });
            return;
        }
        const seller = await prisma.GGASeller.findUnique({ where: { email: user.email } });
        if (!seller) {
            await sendMessageWithTracking(chatId, '❌ Please register as a seller first!\n\nUse the "Create Store" option to set up your store.', { reply_markup: mainKeyboard });
            return;
        }
        if (!seller.storeName) {
            await sendMessageWithTracking(chatId, '❌ Please create your store first!\n\nUse the "Create Store" option to set up your store.', { reply_markup: mainKeyboard });
            return;
        }
        storyCreation.set(chatId, { email: user.email, currentStep: 1 });
        await handleStoryStep(chatId, null, 1);
    } catch (error) {
        console.error('Error starting story creation:', error);
        await sendMessageWithTracking(chatId, '❌ An error occurred. Please try again later.', { reply_markup: mainKeyboard });
    }
}

async function handleStoryStep(chatId, input, currentStep = 1) {
    try {
        let story = storyCreation.get(chatId) || {};
        if (currentStep > 1 && input) {
            const prevStep = STORY_STEPS[currentStep - 1];
            if (prevStep.type === 'media') {
                try {
                    let fileId, mediaType;
                    if (input.voice) { fileId = input.voice.file_id; mediaType = 'voice'; }
                    else if (input.video) { fileId = input.video.file_id; mediaType = 'video'; }
                    else { throw new Error('No media found in input'); }
                    const mediaUrl = await uploadToS3(fileId, `${chatId}-story-${mediaType}`);
                    story.storyMedia = mediaUrl;
                    story.storyMediaType = mediaType;
                } catch (error) {
                    console.error('Error uploading media:', error);
                    await sendMessageWithTracking(chatId, '❌ Failed to upload media. Please try again.', { reply_markup: { remove_keyboard: true } });
                    return;
                }
            } else if (prevStep.field === 'sampleRequested') {
                story.sampleRequested = (input === '✅ Yes, send sample');
            }
            storyCreation.set(chatId, story);
        }

        if (currentStep > 2) { // All steps completed
            try {
                const user = await prisma.user.findUnique({ where: { email: story.email } });
                const seller = await prisma.GGASeller.findUnique({ where: { email: story.email } });
                if(!user || !seller) throw new Error('User or Seller not found during story save');

                let shippingLabel = null;
                if (story.sampleRequested) {
                    try { shippingLabel = await generateShippingLabel(seller, user); } 
                    catch (error) { console.error('Error generating shipping label:', error); }
                }
                await prisma.GGASeller.update({
                    where: { email: story.email },
                    data: { storyMedia: story.storyMedia, storyMediaType: story.storyMediaType, sampleRequested: story.sampleRequested, shippingLabel: shippingLabel, trustBadge: true, updatedAt: new Date() }
                });
                await prisma.user.update({ where: { email: story.email }, data: { gllBalance: { increment: parseFloat(process.env.TRUST_BADGE_BONUS) } } });
                let completionMessage = '✅ Your story has been saved!\n\n🎖️ You\'ve earned the Trusted Exporter Badge\n🎁 +25 GLL Ions added.\n\nBuyers are more likely to order from you now!';
                if (story.sampleRequested && shippingLabel) {
                    completionMessage += '\n\n📦 Great! Here\'s your shipping label:\n' + `[Download Label](${shippingLabel})`;
                }
                await sendMessageWithTracking(chatId, completionMessage, { parse_mode: 'Markdown', reply_markup: mainKeyboard });
                storyCreation.delete(chatId);
                return;
            } catch (error) {
                console.error('Error saving story:', error);
                await sendMessageWithTracking(chatId, '❌ An error occurred while saving your story. Please try again later.', { reply_markup: mainKeyboard });
                storyCreation.delete(chatId);
                return;
            }
        }
        const step = STORY_STEPS[currentStep];
        await sendMessageWithTracking(chatId, step.message, { reply_markup: step.keyboard || { remove_keyboard: true }, parse_mode: 'Markdown' });
        story.currentStep = currentStep;
        storyCreation.set(chatId, story);
    } catch (error) {
        console.error('Error in story creation step:', error);
        await sendMessageWithTracking(chatId, '❌ An error occurred. Please try again later.', { reply_markup: mainKeyboard });
        storyCreation.delete(chatId);
    }
}

function generateShippingCode() {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 16; i++) {
        code += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return code.match(/.{1,4}/g).join('-');
}

async function generateShippingLabel(seller, user) {
    return new Promise(async (resolve, reject) => {
        try {
            const doc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 50, left: 50, right: 50 } });
            const chunks = [];
            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', async () => {
                try {
                    const pdfBuffer = Buffer.concat(chunks);
                    const shippingLabelKey = `shipping-labels/${user.email}-${Date.now()}.pdf`;
                    const uploadResult = await s3.upload({ Bucket: process.env.AWS_BUCKET_NAME, Key: shippingLabelKey, Body: pdfBuffer, ContentType: 'application/pdf', ContentDisposition: 'inline', CacheControl: 'public, max-age=31536000' }).promise();
                    resolve(uploadResult.Location);
                } catch (error) { reject(error); }
            });
            const shippingCode = generateShippingCode();
            doc.fontSize(24).font('Helvetica-Bold').text('GLL Shipping Label', { align: 'center' });
            doc.moveDown(2);
            doc.fontSize(14).font('Helvetica-Bold').text('Seller Details', { underline: true });
            doc.moveDown(0.5);
            doc.fontSize(12).font('Helvetica').text(`Store: ${seller.storeName || 'N/A'}`);
            doc.moveDown(0.5);
            const product = seller.products && seller.products.length > 0 ? seller.products[0] : null;
            if (product) {
                doc.text(`Product: ${product.productName}`);
                doc.moveDown(0.5);
                doc.text(`Made in: ${product.location}`);
            }
            doc.moveDown(0.5);
            doc.text(`Store URL: ${seller.storeUrl || 'N/A'}`);
            doc.moveDown(2);
            doc.rect(50, doc.y, doc.page.width - 100, 80).stroke();
            doc.moveDown(0.5);
            doc.fontSize(16).font('Helvetica-Bold').text('Shipping Code:', { align: 'center' });
            doc.moveDown(0.5);
            doc.fontSize(20).text(shippingCode, { align: 'center' });
            doc.moveDown(2);
            doc.fontSize(12).font('Helvetica').text('Shipping Instructions:', { underline: true });
            doc.moveDown(0.5);
            doc.text('1. Print this shipping label');
            doc.text('2. Attach it securely to your package');
            doc.text('3. Keep the shipping code for tracking');
            doc.text('4. Send to the nearest GLL hub');
            doc.fontSize(10).text(`Here is your Shipping label ${shippingCode}`, { align: 'center', y: doc.page.height - 70 }); // Position footer better
            doc.end();
        } catch (error) { reject(error); }
    });
}

async function checkMissionCompletion(email, missionType) {
    const currentDate = new Date();
    const currentWeek = getWeekNumber(currentDate);
    const currentYear = currentDate.getFullYear();
    try {
        const completion = await prisma.weeklyMissionCompletion.findFirst({ where: { userEmail: email, missionType: missionType, weekNumber: currentWeek, year: currentYear } });
        return completion !== null;
    } catch (error) { console.error('Error checking mission completion:', error); return false; }
}

function getWeekNumber(date) {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
}

async function recordMissionCompletion(email, missionType) {
    const currentDate = new Date();
    const currentWeek = getWeekNumber(currentDate);
    const currentYear = currentDate.getFullYear();
    try {
        await prisma.weeklyMissionCompletion.create({ data: { userEmail: email, missionType: missionType, weekNumber: currentWeek, year: currentYear } });
        await prisma.user.update({ where: { email }, data: { gllBalance: { increment: parseFloat(process.env.WEEKLY_MISSION_BONUS) } } });
        return true;
    } catch (error) { console.error('Error recording mission completion:', error); return false; }
}

async function handleWeeklyMissions(chatId) {
    try {
        const user = await prisma.user.findFirst({ where: { telegramId: chatId.toString() } });
        if (!user) { await sendMessageWithTracking(chatId, '❌ Please link your account first!', { reply_markup: mainKeyboard }); return; }
        const seller = await prisma.GGASeller.findUnique({ where: { email: user.email } });
        if (!seller || !seller.storeName) { await sendMessageWithTracking(chatId, '🏪 Create your store first!\n\nClick on "Create Store" to start selling your products.', { reply_markup: mainKeyboard }); return; }
        const productCompleted = await checkMissionCompletion(user.email, 'product');
        const inviteCompleted = await checkMissionCompletion(user.email, 'invite');
        const whatsappCompleted = await checkMissionCompletion(user.email, 'whatsapp');
        await sendMessageWithTracking(chatId, `🎯 *This Week\'s Growth Missions*\n\nComplete missions to grow your business and earn rewards!\n\n1️⃣ Add another product (+50 GLL) ${productCompleted ? '✅' : ''}\n   More products = More sales\n\n2️⃣ Invite 2 friends (+50 GLL) ${inviteCompleted ? '✅' : ''}\n   Grow the GLL community\n\n3️⃣ Share on WhatsApp (+50 GLL) ${whatsappCompleted ? '✅' : ''}\n   Reach more customers\n\n🎁 Complete all missions for +100 GLL bonus!\n\n⏰ Missions refresh every Monday\n❗ Each mission can only be completed once per week\n\nChoose a mission to begin:`, { parse_mode: 'Markdown', reply_markup: weeklyMissionsKeyboard });
    } catch (error) {
        console.error('Error in weekly missions:', error);
        await sendMessageWithTracking(chatId, '❌ An error occurred. Please try again later.', { reply_markup: mainKeyboard });
    }
}

async function handleWeeklyProductStep(chatId, input, currentStep = 1) {
    try {
        let registration = weeklyProductRegistration.get(chatId) || {};
        if (currentStep === 1 && !registration.email) {
            const user = await prisma.user.findFirst({ where: { telegramId: chatId.toString() } });
            if (!user) { await sendMessageWithTracking(chatId, '❌ Please link your account first!', { reply_markup: mainKeyboard }); weeklyProductRegistration.delete(chatId); return; }
            registration.email = user.email;
            weeklyProductRegistration.set(chatId, registration);
        }
        if (currentStep > 1) {
            const prevStep = WEEKLY_PRODUCT_STEPS[currentStep - 1];
            if (currentStep - 1 === 2) { // Photo
                try { registration[prevStep.field] = await uploadToS3(input, chatId); } 
                catch (error) { await sendMessageWithTracking(chatId, '❌ Failed to upload image.'); return; }
            } else if (currentStep - 1 === 4) { // Product Type
                if (!VALID_PRODUCT_TYPES.includes(input)) { await sendMessageWithTracking(chatId, '❌ Invalid product type.', {reply_markup: productTypeKeyboard}); return; }
                registration[prevStep.field] = input;
            } else if (currentStep - 1 === 6) { // Sells Online
                if (!['✅ Yes', '❌ No'].includes(input)) { await sendMessageWithTracking(chatId, '❌ Invalid choice.', {reply_markup: WEEKLY_PRODUCT_STEPS[6].keyboard}); return; }
                registration[prevStep.field] = (input === '✅ Yes');
            } else { registration[prevStep.field] = input; }
            weeklyProductRegistration.set(chatId, registration);
        }
        if (currentStep > 6) {
            try {
                const productData = { productName: registration.productName, productImage: registration.productPhoto, description: registration.description, productType: registration.productType, location: registration.location, sellsOnline: registration.sellsOnline, addedAt: new Date(), updatedAt: new Date() };
                await prisma.GGASeller.update({ where: { email: registration.email }, data: { products: { push: productData }, updatedAt: new Date() } });
                await recordMissionCompletion(registration.email, 'product');
                await sendMessageWithTracking(chatId, `✨ Product Added Successfully!\n\n🏷️ Product: ${registration.productName}\n📍 Made in: ${registration.location}\n🎁 +50 GLL Ions added\n\nReturning to Weekly Missions...`, { reply_markup: weeklyMissionsKeyboard });
                weeklyProductRegistration.delete(chatId);
                setTimeout(async () => { await handleWeeklyMissions(chatId); }, 2000);
                return;
            } catch (error) { await sendMessageWithTracking(chatId, '❌ Error saving product.', { reply_markup: weeklyMissionsKeyboard }); weeklyProductRegistration.delete(chatId); return; }
        }
        const step = WEEKLY_PRODUCT_STEPS[currentStep];
        await sendMessageWithTracking(chatId, step.message, { reply_markup: step.keyboard || { remove_keyboard: true } });
        registration.currentStep = currentStep;
        weeklyProductRegistration.set(chatId, registration);
    } catch (error) {
        console.error('Error in weekly product registration:', error);
        await sendMessageWithTracking(chatId, '❌ An error occurred.', { reply_markup: weeklyMissionsKeyboard });
        weeklyProductRegistration.delete(chatId);
    }
}

async function handleRegistrationStep(chatId, input = null) {
    try {
        let registration = registrationProcess.get(chatId);
        if (!registration) { // Should be initialized by message handler before calling this
             console.error('Registration process not found for chat ID:', chatId);
             await sendMessageWithTracking(chatId, '❌ Registration process error. Please try /start again.', { reply_markup: mainKeyboard });
             return;
        }

        if (registration.currentStep > 1 && input) { // currentStep is advanced *after* processing previous
            const prevStepField = REGISTRATION_STEPS[registration.currentStep -1].field;
            if (prevStepField === 'phone') {
                const cleanNumber = input.replace(/[^\d+]/g, '');
                if (!cleanNumber.startsWith('+') || cleanNumber.length < 10 || cleanNumber.length > 15) {
                    await sendMessageWithTracking(chatId, '❌ Invalid phone number. Please include country code (+XX) and check length.', { reply_markup: { remove_keyboard: true } });
                    return; // Don't advance step
                }
                registration[prevStepField] = cleanNumber;
            } else {
                registration[prevStepField] = input;
            }
            registrationProcess.set(chatId, registration);
        }

        if (registration.currentStep > Object.keys(REGISTRATION_STEPS).length) {
            try {
                await prisma.user.create({
                    data: { email: registration.email, name: registration.name, phone: registration.phone, telegramId: chatId.toString(), gllBalance: parseFloat(process.env.REGISTER_REWARD ), companyType: "Individual", terms: true }
                });
                await sendMessageWithTracking(chatId, `✅ Registration completed! Welcome ${registration.name}!\n\n💰 Your GLL Balance: ${process.env.REGISTER_REWARD || "100.0"} GLL\n\nUse the menu or commands like /balance, /help.`, { parse_mode: 'Markdown', reply_markup: mainKeyboard });
                registrationProcess.delete(chatId);
                return;
            } catch (error) { 
                console.error('Error saving new user registration:', error);
                await sendMessageWithTracking(chatId, '❌ Error saving registration.', { reply_markup: mainKeyboard }); 
                registrationProcess.delete(chatId);
                return; 
            }
        }
        const step = REGISTRATION_STEPS[registration.currentStep];
        await sendMessageWithTracking(chatId, step.message, { reply_markup: { remove_keyboard: true } });
        registration.currentStep += 1; // Advance step for next interaction
        registrationProcess.set(chatId, registration);
    } catch (error) {
        console.error('Error in registration step:', error);
        await sendMessageWithTracking(chatId, '❌ An error occurred during registration.', { reply_markup: mainKeyboard });
        registrationProcess.delete(chatId);
    }
}

async function handleExploreCommand(chatId) { // msg object not needed if only chatId is used
    productBrowsing.delete(chatId);
    try {
        await sendMessageWithTracking(chatId, '🌍 *Welcome to GLL Product Explorer*\n\nDiscover authentic Indian products from verified sellers.\nChoose a category to explore:', { parse_mode: 'Markdown', reply_markup: productCategoryKeyboard });
        productBrowsing.set(chatId, { state: 'category' });
    } catch (error) {
        console.error('Error in explore command:', error);
        await sendMessageWithTracking(chatId, '❌ An error occurred. Please try again later.', { reply_markup: mainKeyboard });
    }
}

function formatSellerDisplay(seller, product) {
    let message = `👤 *${seller.storeName || 'Unnamed Store'}*\n📍 ${product.location} ${seller.isVerified ? '| ✅ GI-tag Verified' : ''}\n🧵 Product: ${product.productName}\n📦 MOQ: 50 units | ₹180 each\n`;
    if (seller.storyMedia) { message += `🎤 [Meet the Maker](${seller.storyMedia})\n`; }
    message += `🌐 Store: ${seller.storeUrl}\n\n`;
    return message;
}

async function handleCategorySelection(chatId, category) {
    try {
        const cleanCategory = category.replace(/[\u{1F300}-\u{1F6FF}]/gu, '').trim();
        const sellers = await prisma.GGASeller.findMany(); // products is a scalar field, already included
        const sellersWithProductsInCategory = sellers.filter(s => s.products && s.products.some(p => p.productType === cleanCategory));

        if (sellersWithProductsInCategory.length === 0) {
            await sendMessageWithTracking(chatId, '😔 No sellers found in this category yet.\nPlease try another category or check back later!', { reply_markup: productCategoryKeyboard });
            return;
        }
        for (const seller of sellersWithProductsInCategory) {
            const categoryProducts = seller.products.filter(p => p.productType === cleanCategory);
            for (const product of categoryProducts) {
                const messageText = formatSellerDisplay(seller, product);
                const options = { parse_mode: 'Markdown' };
                let sentMessage;
                if (product.productImage) {
                    sentMessage = await botInstance.sendPhoto(chatId, product.productImage, { caption: messageText, ...options });
                } else {
                    sentMessage = await sendMessageWithTracking(chatId, messageText, options);
                }
                if(sentMessage) trackMessage(chatId, sentMessage.message_id);
                
                await sendMessageWithTracking(chatId, 'What would you like to do?', { reply_markup: { inline_keyboard: [[{ text: '📦 Request Sample', callback_data: `sample_${seller.email}` }, { text: '💬 Chat', callback_data: `chat_${seller.email}` }, { text: '📃 Start Deal', callback_data: `deal_${seller.email}` }]] } });
            }
        }
        productBrowsing.set(chatId, { state: 'seller_list', category: cleanCategory });
    } catch (error) {
        console.error('Error handling category selection:', error);
        await sendMessageWithTracking(chatId, '❌ An error occurred.', { reply_markup: mainKeyboard });
    }
}

async function handleSampleRequest(chatId, seller) {
    await sendMessageWithTracking(chatId, `📦 *Sample Request*\n\nYou\'ve requested a sample from ${seller.storeName}.\nOur team will contact you shortly to process your request.\n\nMeanwhile, you can:\n• Browse more products\n• Chat with the seller\n• Start a deal`, { parse_mode: 'Markdown', reply_markup: productCategoryKeyboard });
}

async function handleChatRequest(chatId, seller) {
    await sendMessageWithTracking(chatId, `💬 *Chat Request*\n\nYou\'ve requested to chat with ${seller.storeName}.\nOur team will connect you with the seller shortly.\n\nPlease note:\n• Business hours: 9 AM - 6 PM IST\n• Response time: Within 24 hours\n• Language: English/Hindi`, { parse_mode: 'Markdown', reply_markup: productCategoryKeyboard });
}

async function handleDealRequest(chatId, seller) {
    await sendMessageWithTracking(chatId, `📃 *Start Deal*\n\nYou\'ve initiated a deal with ${seller.storeName}.\nOur business team will contact you to:\n\n• Discuss quantities\n• Confirm pricing\n• Arrange logistics\n• Process payment\n\nExpected response time: Within 24 hours`, { parse_mode: 'Markdown', reply_markup: productCategoryKeyboard });
}

async function getKeyboardForUser(chatId) {
    try {
        const user = await prisma.user.findFirst({ where: { telegramId: chatId.toString() } });
        if (!user) return mainKeyboard;
        const seller = await prisma.GGASeller.findUnique({ where: { email: user.email } });
        if (seller && seller.storeName) {
            // This keyboard was slightly different in the original botRoutes, ensuring consistency if it matters.
            // Original had 'Build Trust' as one of the main options if store exists.
            return { keyboard: [['Balance', 'Register Seller'], ['Create Store', 'Build Trust'], ['🌍 Explore India', 'Surprise'], ['Clear', 'Help']], resize_keyboard: true };
        }
        return mainKeyboard;
    } catch (error) {
        console.error('Error getting keyboard:', error);
        return mainKeyboard;
    }
}


// Initializer
function init(bot) {
    botInstance = bot;
    console.log("BotService initialized.");
}

module.exports = {
    init,
    // State accessors/mutators (example)
    isUserAwaitingEmail: (chatId) => usersAwaitingEmail.has(chatId),
    addUserAwaitingEmail: (chatId) => usersAwaitingEmail.add(chatId),
    deleteUserAwaitingEmail: (chatId) => usersAwaitingEmail.delete(chatId),
    
    getManufacturerRegData: (chatId) => manufacturerRegistration.get(chatId),
    setManufacturerRegData: (chatId, data) => manufacturerRegistration.set(chatId, data), // Should ideally be internal
    deleteManufacturerRegData: (chatId) => manufacturerRegistration.delete(chatId),

    getVerificationProcessData: (chatId) => verificationProcess.get(chatId),
    deleteVerificationProcessData: (chatId) => verificationProcess.delete(chatId),
    
    getStoreCreationData: (chatId) => storeCreation.get(chatId),
    deleteStoreCreationData: (chatId) => storeCreation.delete(chatId),

    getStoryCreationData: (chatId) => storyCreation.get(chatId),
    deleteStoryCreationData: (chatId) => storyCreation.delete(chatId),

    getWeeklyProductRegData: (chatId) => weeklyProductRegistration.get(chatId),
    deleteWeeklyProductRegData: (chatId) => weeklyProductRegistration.delete(chatId),

    getRegistrationProcessData: (chatId) => registrationProcess.get(chatId),
    setRegistrationProcessData: (chatId, data) => registrationProcess.set(chatId, data),
    deleteRegistrationProcessData: (chatId) => registrationProcess.delete(chatId),
    
    getProductBrowsingData: (chatId) => productBrowsing.get(chatId),
    setProductBrowsingData: (chatId, data) => productBrowsing.set(chatId, data),
    deleteProductBrowsingData: (chatId) => productBrowsing.delete(chatId),


    // Exported functions
    sendMessageWithTracking, // Export if botRoutes needs to send simple messages directly
    uploadToS3,
    handleManufacturerStep,
    startVerification,
    handleVerificationStep,
    generateCertificate,
    handleCommand,
    handleStartCommand,
    handleClearCommand,
    startStoreCreation,
    handleStoreStep,
    startStoryCreation,
    handleStoryStep,
    generateShippingCode,
    generateShippingLabel,
    checkMissionCompletion,
    getWeekNumber,
    recordMissionCompletion,
    handleWeeklyMissions,
    handleWeeklyProductStep,
    handleRegistrationStep,
    handleExploreCommand,
    formatSellerDisplay,
    handleCategorySelection,
    handleSampleRequest,
    handleChatRequest,
    handleDealRequest,
    getKeyboardForUser,

    // Constants (Exporting all for now, can be refined later if some are purely internal)
    mainKeyboard, 
    productTypeKeyboard,
    productCategoryKeyboard,
    sellerTypeKeyboard,
    verificationOptionsKeyboard,
    trustBuildingKeyboard,
    weeklyMissionsKeyboard,
    registrationConfirmKeyboard,
    sellerActionKeyboard,
    MANUFACTURER_STEPS, 
    VERIFICATION_STEPS,
    STORE_STEPS,
    STORY_STEPS,
    WEEKLY_PRODUCT_STEPS,
    REGISTRATION_STEPS,
    VALID_PRODUCT_TYPES
}; 