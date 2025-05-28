const express = require('express');
const prisma = require('../config/db'); // Retain for Express routes needing direct DB access
const { encryptJSON } = require('../config/encrypt'); // Retain for Express routes
const TelegramBot = require('node-telegram-bot-api');
const router = express.Router();

// Initialize bot with your token
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// Import and initialize Bot Service
const botService = require('../utils/botService');
botService.init(bot);

// --- Telegram Bot Event Handlers ---

// Basic Logging for incoming messages
bot.on('message', (msg) => {
    console.log('\n🤖 New Telegram Message:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('From:', msg.from.first_name, msg.from.last_name || '');
    console.log('Username:', msg.from.username || 'No username');
    console.log('Chat ID:', msg.chat.id);
    const messageType = msg.text ? 'Text' : msg.photo ? 'Photo' : msg.document ? 'Document' : msg.voice ? 'Voice' : msg.video ? 'Video' : 'Other';
    console.log('Type:', messageType);
    if (msg.text) console.log('Message:', msg.text);
    else if (messageType !== 'Other') console.log('Media Type:', messageType);
    console.log('Time:', new Date(msg.date * 1000).toLocaleString());
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
});

// Polling Error Logging
bot.on('polling_error', (error) => {
    console.log('\n❌ Telegram Bot Polling Error:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('Error Code:', error.code);
    if (error.message) console.error('Message:', error.message);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
});

// --- Command Handlers ---
bot.onText(/\/start$/, async (msg) => {
    await botService.handleStartCommand(msg.chat.id, msg.from);
});

bot.onText(/\/link$/, async (msg) => {
    const chatId = msg.chat.id;
    try {
        const user = await prisma.user.findFirst({ where: { telegramId: chatId.toString() } });
        if (user) {
            const kbd = await botService.getKeyboardForUser(chatId);
            await botService.sendMessageWithTracking(chatId, 
                `ℹ️ Your account is already linked as ${user.email}. Use /help for commands.`,
                { reply_markup: kbd }
            );
        } else {
            botService.addUserAwaitingEmail(chatId);
            await botService.sendMessageWithTracking(chatId, 
                '📧 Please share your email address to link your account.\n\nJust type and send your email address.',
                {reply_markup: { remove_keyboard: true } }
            );
        }
    } catch (e) {
        console.error("Error in /link command handler:", e);
        const kbdSafe = botService.mainKeyboard; // Fallback keyboard
        await botService.sendMessageWithTracking(chatId, '❌ Error processing link command.', {reply_markup: kbdSafe}).catch(se => console.error("Failed to send error for /link:", se));
    }
});

// Generic commands - these are often also buttons
const commandAndButtonTexts = [
    'Balance', 'Surprise', 'Help', 'Register Seller', 'Registerseller',
    'Create Store', 'Createstore', 'Trader', 'Manufacturer', 'Back to Main Menu',
    'Weekly Missions', 'Build Trust' // Build Trust may also be a button 'Build Trust with Story & Sample'
];
commandAndButtonTexts.forEach(commandText => {
    // Regex for command text, case insensitive, optional leading slash for commands
    const regex = new RegExp(`^\/?${commandText.replace(/ /g, '\\s*')}$`, 'i');
    bot.onText(regex, async (msg) => {
        let cleanCommand = msg.text.startsWith('/') ? msg.text.substring(1) : msg.text;
        await botService.handleCommand(msg, cleanCommand);
    });
});

// Specific command handlers that might have unique logic or no button equivalent
bot.onText(/\/verify$/, async (msg) => {
    await botService.startVerification(msg.chat.id);
});

// Combine exploreindia and matchme into one handler
bot.onText(/\/(exploreindia|matchme)$/i, async (msg) => {
    await botService.handleExploreCommand(msg.chat.id);
});

bot.onText(/\/clear$/, async (msg) => {
    await botService.handleClearCommand(msg.chat.id, msg.message_id, msg.from);
});

// --- Main Message Handler (for conversational flows, button clicks, non-command text) ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // Simple check to avoid re-processing commands handled by onText
    if (text && text.startsWith('/')) {
        const knownCommands = [ /\/start$/, /\/link$/, /\/verify$/, /\/(exploreindia|matchme)$/i, /\/clear$/,  
                                /\/balance$/i, /\/surprise$/i, /\/help$/i, /\/registerseller$/i, /\/createstore$/i, 
                                /\/trader$/i, /\/manufacturer$/i, /\/buildtrust$/i, /\/weeklymissions$/i];
        for (const cmdRegex of knownCommands) {
            if (cmdRegex.test(text)) return; // If it's a known command, onText handles it
        }
    }
    
    try {
        // --- State-based input handling ---
        const manufacturerReg = botService.getManufacturerRegData(chatId);
        if (manufacturerReg && manufacturerReg.currentStep) {
            if (manufacturerReg.currentStep === 2 && msg.photo) {
                await botService.handleManufacturerStep(chatId, msg.photo[0].file_id, 3);
            } else if (text) {
                await botService.handleManufacturerStep(chatId, text, manufacturerReg.currentStep + 1);
            } else if (manufacturerReg.currentStep === 2 && !msg.photo) {
                await botService.sendMessageWithTracking(chatId, '❌ Please upload a photo for Step 2.');
            }
            return;
        }

        const verification = botService.getVerificationProcessData(chatId);
        if (verification && verification.currentStep) {
            const stepDef = botService.VERIFICATION_STEPS[verification.currentStep];
            if (stepDef.type === 'document' && msg.document) {
                await botService.handleVerificationStep(chatId, msg.document.file_id, verification.currentStep + 1);
            } else if (stepDef.type === 'text' && text) {
                await botService.handleVerificationStep(chatId, text, verification.currentStep + 1);
            } else if (stepDef.type === 'document' && !msg.document) {
                await botService.sendMessageWithTracking(chatId, `❌ Please upload a ${stepDef.field} document.`);
            }
            return;
        }
        
        const store = botService.getStoreCreationData(chatId);
        if (store && store.currentStep) {
            const stepDef = botService.STORE_STEPS[store.currentStep];
            if (stepDef.type === 'photo' && msg.photo) {
                await botService.handleStoreStep(chatId, msg.photo[0].file_id, store.currentStep + 1);
            } else if ((!stepDef.type || stepDef.type === 'text') && text) {
                await botService.handleStoreStep(chatId, text, store.currentStep + 1);
            } else if (stepDef.type === 'photo' && !msg.photo) {
                await botService.sendMessageWithTracking(chatId, '❌ Please upload an image for the store.');
            }
            return;
        }

        const story = botService.getStoryCreationData(chatId);
        if (story && story.currentStep) {
            const stepDef = botService.STORY_STEPS[story.currentStep];
            if (stepDef.type === 'media' && (msg.voice || msg.video)) {
                await botService.handleStoryStep(chatId, msg, story.currentStep + 1);
            } else if (!stepDef.type && text) { // Assuming second step of story is text based for sample choice
                await botService.handleStoryStep(chatId, text, story.currentStep + 1);
            } else if (stepDef.type === 'media' && !msg.voice && !msg.video) {
                 await botService.sendMessageWithTracking(chatId, '❌ Please upload a voice note or video for your story.');
            }
            return;
        }
        
        const weeklyProdReg = botService.getWeeklyProductRegData(chatId);
        if (weeklyProdReg && weeklyProdReg.currentStep) {
            if (weeklyProdReg.currentStep === 2 && msg.photo) {
                await botService.handleWeeklyProductStep(chatId, msg.photo[0].file_id, 3);
            } else if (text) {
                await botService.handleWeeklyProductStep(chatId, text, weeklyProdReg.currentStep + 1);
            } else if (weeklyProdReg.currentStep === 2 && !msg.photo) {
                 await botService.sendMessageWithTracking(chatId, '❌ Please upload a photo for the weekly product.');
            }
            return;
        }

        if (botService.isUserAwaitingEmail(chatId) && text) {
            const emailRegex = /^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/;
            const email = text.trim();
            if (!emailRegex.test(email)) {
                await botService.sendMessageWithTracking(chatId, '❌ Invalid email format. Please try again.', { reply_markup: { remove_keyboard: true } });
                return;
            }
            const user = await prisma.user.findUnique({ where: { email } });
            if (!user) {
                await botService.sendMessageWithTracking(chatId, '❌ Email not registered.\nWould you like to register now?', { reply_markup: botService.registrationConfirmKeyboard });
                botService.setRegistrationProcessData(chatId, { email: email, currentStep: 1 }); // Start step 1 for reg
                botService.deleteUserAwaitingEmail(chatId);
            } else if (user.telegramId && user.telegramId !== chatId.toString()) {
                await botService.sendMessageWithTracking(chatId, '❌ This email is already linked to another Telegram account.', { reply_markup: { remove_keyboard: true } });
                botService.deleteUserAwaitingEmail(chatId);
            } else {
                await prisma.user.update({ where: { email }, data: { telegramId: chatId.toString() } });
                botService.deleteUserAwaitingEmail(chatId);
                const kbd = await botService.getKeyboardForUser(chatId);
                const userName = user.name || user.email.split('@')[0];
                await botService.sendMessageWithTracking(chatId, `✅ Account successfully linked! Welcome ${userName}!\n💰 Your GLL Balance: ${user.gllBalance || 0} GLL.\nUse /help for available commands.`, { parse_mode: 'Markdown', reply_markup: kbd });
            }
            return;
        }
        
        const regProc = botService.getRegistrationProcessData(chatId);
        if (regProc && regProc.currentStep >= 1) { // currentStep is 1-based for actual steps
            if (text === '✅ Yes, Register Now' && regProc.currentStep === 1 && regProc.email) {
                 await botService.handleRegistrationStep(chatId, null); // Will send Q for step 1
            } else if (text === '❌ No, I\'ll Register Later' && regProc.currentStep === 1) {
                await botService.sendMessageWithTracking(chatId, '👉 Okay! You can register at https://gll.one and link your account later using /link or /start.', { reply_markup: await botService.getKeyboardForUser(chatId) });
                botService.deleteRegistrationProcessData(chatId);
            } else if (text && regProc.currentStep > 0) { // Actual data input for steps after confirmation
                await botService.handleRegistrationStep(chatId, text);
            }
            return;
        }

        // --- Button Click Handling (Non-command text that matches button labels) ---
        if (text) {
            const currentKeyboard = await botService.getKeyboardForUser(chatId);
            // Using a direct mapping for clarity with button texts
            const buttonActions = {
                'Balance': async () => botService.handleCommand(msg, 'Balance'),
                'Register Seller': async () => botService.handleCommand(msg, 'Register Seller'),
                'Create Store': async () => botService.startStoreCreation(chatId),
                'Weekly Missions': async () => botService.handleWeeklyMissions(chatId),
                '🌍 Explore India': async () => {
                    // Only handle if not already handled as a command
                    if (!text.startsWith('/')) {
                        await botService.handleExploreCommand(chatId);
                    }
                },
                'Surprise': async () => botService.handleCommand(msg, 'Surprise'),
                'Clear': async () => botService.handleClearCommand(msg.chat.id, msg.message_id, msg.from),
                'Help': async () => botService.handleCommand(msg, 'Help'),
                'Trader': async () => botService.handleCommand(msg, 'Trader'),
                'Manufacturer': async () => botService.handleCommand(msg, 'Manufacturer'),
                'Back to Main Menu': async () => botService.handleCommand(msg, 'Back to Main Menu'),
                '✅ Verify Business': async () => botService.startVerification(chatId),
                'Build Trust': async () => botService.startStoryCreation(chatId), // Matches a keyboard option
                'Build Trust with Story & Sample': async () => {
                    await botService.sendMessageWithTracking(chatId, '🌟 Let\'s build trust! Share a 60s voice/video intro about what you make, why, and your hometown.');
                    await botService.startStoryCreation(chatId);
                },
                '✅ Add another product': async () => {
                    const user = await prisma.user.findFirst({ where: { telegramId: chatId.toString() } });
                    if (user && !(await botService.checkMissionCompletion(user.email, 'product'))) await botService.handleWeeklyProductStep(chatId);
                    else if (user) await botService.sendMessageWithTracking(chatId, '❌ You\'ve already completed this mission this week!', {reply_markup: botService.weeklyMissionsKeyboard});
                    else await botService.sendMessageWithTracking(chatId, '❌ Please link account first.', {reply_markup: currentKeyboard});
                },
                '✅ Invite 2 friends to join': async () => {
                    const user = await prisma.user.findFirst({ where: { telegramId: chatId.toString() } });
                    if (user && !(await botService.checkMissionCompletion(user.email, 'invite'))) {
                        const inviteLink = `https://t.me/share/url?url=Join%20me%20on%20GLL!%20I'm%20selling%20my%20products%20globally.%20Start%20your%20journey:%20https://gll.one/refer/${user.email}`;
                        await botService.sendMessageWithTracking(chatId, `🤝 *Grow Together*\nShare this link with your friends: ${inviteLink}\n\n💰 Rewards: +50 GLL when 2 friends join & more when they sell!\n❗ This mission can be completed once per week.`, { parse_mode: 'Markdown', reply_markup: botService.weeklyMissionsKeyboard });
                        await botService.recordMissionCompletion(user.email, 'invite');
                    } else if (user) await botService.sendMessageWithTracking(chatId, '❌ You\'ve already completed this mission this week!', {reply_markup: botService.weeklyMissionsKeyboard});
                    else await botService.sendMessageWithTracking(chatId, '❌ Please link account first.', {reply_markup: currentKeyboard});
                },
                '✅ Share your store on WhatsApp': async () => {
                    const user = await prisma.user.findFirst({ where: { telegramId: chatId.toString() } });
                    if (user && !(await botService.checkMissionCompletion(user.email, 'whatsapp'))) {
                        const seller = await prisma.GGASeller.findUnique({ where: { email: user.email } });
                        if (seller && seller.storeUrl) {
                            const whatsappLink = `https://wa.me/?text=Check%20out%20my%20store%20on%20GLL!%20${seller.storeUrl}%20-%20Quality%20products%20shipped%20worldwide%20🌍`;
                            await botService.sendMessageWithTracking(chatId, `📱 *Spread the Word*\nShare your store on WhatsApp: ${whatsappLink}\n\n💰 Rewards: +50 GLL for sharing & reach more customers!\n❗ This mission can be completed once per week.`, { parse_mode: 'Markdown', reply_markup: botService.weeklyMissionsKeyboard });
                            await botService.recordMissionCompletion(user.email, 'whatsapp');
                        } else await botService.sendMessageWithTracking(chatId, '❌ Please create your store first to get a shareable link!', {reply_markup: botService.weeklyMissionsKeyboard});
                    } else if (user) await botService.sendMessageWithTracking(chatId, '❌ You\'ve already completed this mission this week!', {reply_markup: botService.weeklyMissionsKeyboard});
                    else await botService.sendMessageWithTracking(chatId, '❌ Please link account first.', {reply_markup: currentKeyboard});
                },
                '🏠 Back to Home': async () => {
                    await botService.sendMessageWithTracking(chatId, '👋 Welcome back to the main menu!', { reply_markup: currentKeyboard });
                    botService.deleteManufacturerRegData(chatId); botService.deleteVerificationProcessData(chatId);
                    botService.deleteStoreCreationData(chatId); botService.deleteStoryCreationData(chatId);
                    botService.deleteWeeklyProductRegData(chatId); botService.deleteProductBrowsingData(chatId);
                    botService.deleteRegistrationProcessData(chatId); 
                }
            };
            if (buttonActions[text]) {
                await buttonActions[text]();
                return;
            }

            // Product Category Selection (if in browsing state)
            const browsingState = botService.getProductBrowsingData(chatId);
            if (browsingState?.state === 'category') {
                const flatCategories = botService.productCategoryKeyboard.keyboard.flat();
                if (flatCategories.includes(text)) {
                    await botService.handleCategorySelection(chatId, text);
                    return;
                }
            }
            if (text === '🔙 Back to Categories' && browsingState) {
                await botService.handleExploreCommand(chatId); // Re-shows category selection
                return;
            }
        }

        // --- Casual Greetings & Fallback ---
        if (text && /^(hi|hello|hey|hola|howdy|greetings|sup|yo|hii|hiii|hiiii)/i.test(text.trim())) {
            const username = msg.from.first_name || msg.from.username || "there";
            await botService.sendMessageWithTracking(chatId, `🤖 Hello, ${username}! Great to see you. Use /help for commands or the menu below.`, { parse_mode: 'Markdown', reply_markup: await botService.getKeyboardForUser(chatId) });
            return;
        }
        if (text && /^good\s*morning/i.test(text.trim())) {
            await botService.sendMessageWithTracking(chatId, `☀️ Good Morning! Hope you have a productive day!`, { reply_markup: await botService.getKeyboardForUser(chatId) });
            return;
        }
        if (text && /^good\s*evening/i.test(text.trim())) {
            await botService.sendMessageWithTracking(chatId, `🌙 Good Evening! Hope you had a great day!`, { reply_markup: await botService.getKeyboardForUser(chatId) });
            return;
        }

        // Default fallback for unhandled text if not in any known flow
        const isInFlow = botService.isUserAwaitingEmail(chatId) || 
                         botService.getManufacturerRegData(chatId) || 
                         botService.getVerificationProcessData(chatId) ||
                         botService.getStoreCreationData(chatId) ||
                         botService.getStoryCreationData(chatId) ||
                         botService.getWeeklyProductRegData(chatId) ||
                         botService.getRegistrationProcessData(chatId) ||
                         botService.getProductBrowsingData(chatId);

        if (text && !isInFlow) {
            await botService.sendMessageWithTracking(chatId, "🤔 I'm not sure how to respond to that. Please use the menu buttons or type a command like /help.", { reply_markup: await botService.getKeyboardForUser(chatId) });
        }
        // Non-text messages not handled by a specific flow are currently ignored by this point.

    } catch (e) {
        console.error("Error in main message handler:", e);
        const kbdSafe = botService.mainKeyboard; // Fallback
        await botService.sendMessageWithTracking(chatId, '❌ An unexpected error occurred. Please try again or use /start.', { reply_markup: kbdSafe }).catch(se => console.error("Failed to send error message in main handler:", se));
    }
});

// --- Callback Query Handler (for inline buttons) ---
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    const [action, entityId] = data.split('_'); 

    try { 
        await bot.answerCallbackQuery(callbackQuery.id); 
    } catch (e) { 
        console.error("Error answering callback query:", e); 
    }

    try {
        // Get seller information first
        const seller = await prisma.GGASeller.findUnique({ 
            where: { email: entityId }
        });

        if (!seller) {
            await botService.sendMessageWithTracking(chatId, '❌ Seller not found or no longer available.');
            return;
        }

        // Handle actions regardless of browsing state to prevent lost interactions
        switch (action) {
            case 'sample':
                await botService.handleSampleRequest(chatId, seller);
                break;
            case 'chat':
                await botService.handleChatRequest(chatId, seller);
                break;
            case 'deal':
                await botService.handleDealRequest(chatId, seller);
                break;
            default:
                console.log(`Unhandled callback_query action: ${action} for chat ${chatId}`);
                await botService.sendMessageWithTracking(chatId, '⚠️ This action is not currently available.');
        }

        // Maintain browsing state after handling action
        const browsingState = botService.getProductBrowsingData(chatId);
        if (!browsingState) {
            botService.setProductBrowsingData(chatId, { 
                state: 'seller_list',
                lastInteraction: Date.now()
            });
        }

    } catch (e) {
        console.error("Error in callback_query handler:", e);
        await botService.sendMessageWithTracking(chatId, '❌ Error processing this action. Please try exploring products again.');
        // Reset browsing state on error
        botService.deleteProductBrowsingData(chatId);
    }
});

// --- Express Routes (Largely Unchanged - For external API functionality) ---
const verifyTelegramWebhook = (req, res, next) => {
    if (req.body && req.body.message && req.body.message.chat) {
        next();
    } else {
        res.status(400).json({ error: 'Invalid Telegram webhook data' });
    }
};

router.post('/webhook', verifyTelegramWebhook, async (req, res) => {
    try {
        // If using webhooks instead of polling, you'd typically use: 
        // bot.processUpdate(req.body);
        // And ensure bot polling is set to false.
        console.log("Webhook received (if configured):", req.body);
        res.sendStatus(200); // Always respond quickly to Telegram webhooks
    } catch (error) {
        console.error("Error in /webhook route:", error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/link-account', async (req, res) => {
    try {
        const { email, telegramId } = req.body;
        if (!email || !telegramId) {
            return res.status(400).json({ error: 'Email and Telegram ID are required' });
        }
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        // Consider logic if user.telegramId already exists and is different
        const updatedUser = await prisma.user.update({
            where: { email },
            data: { telegramId: telegramId.toString() } // Ensure telegramId is stored as string
        });
        res.send(encryptJSON({ message: 'Account linked successfully', telegramId: updatedUser.telegramId }));
    } catch (error) {
        console.error("Error in /link-account route:", error);
        res.status(500).json({ error: error.message }); // Avoid sending raw error message to client if sensitive
    }
});

router.get('/settings/:userId', async (req, res) => {
    try {
        const { userId } = req.params; // This is DB User ID (e.g., UUID or Int)
        const user = await prisma.user.findUnique({
            where: { id: userId }, 
            select: { telegramId: true, notificationPreferences: true, email: true }
        });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.send(encryptJSON({ telegramId: user.telegramId, notificationPreferences: user.notificationPreferences, email: user.email }));
    } catch (error) {
        console.error("Error in /settings/:userId route:", error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router; 