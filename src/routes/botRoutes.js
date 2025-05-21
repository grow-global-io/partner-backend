const express = require('express');
const prisma = require('../config/db');
const { encryptJSON } = require('../config/encrypt');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const router = express.Router();

// Initialize bot with your token
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// OpenRouter API configuration
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = process.env.OPENROUTER_URL;

// Function to get AI response
async function getAIResponse(message) {
    // Check for appreciation messages
    const appreciationKeywords = /(?:good|great|nice|awesome|amazing|excellent|wonderful|fantastic|brilliant|perfect)\s*(?:job|work|bot|helper|assistant|done|going|help)|(?:thank|thanks|thx|ty|thankyou)/i;
    
    if (appreciationKeywords.test(message)) {
        return `🦆 No not me, The Duck did the best part!\n\nI am just following it, You can Also Follow the Duck.🦆`;
    }

    // Check if message is asking about products
    const productKeywords = /products?|services|offerings|solutions|what.*(?:offer|provide|have|sell|make)/i;
    
    if (productKeywords.test(message)) {
        return `🚀 Here are our innovative products at GLL:\n\n` +
               `1. GrowGlobal.asia\n` +
               `2. GrowPay\n` +
               `3. Grow4Sass\n` +
               `4. GrowInvoice\n` +
               `5. Blokzen\n` +
               `6. GrowUrja\n` +
               `7. Drutasign\n` +
               `8. Grow4Ai\n\n` +
               `Would you like to know more about any specific product? Use our commands to explore further!\n\n` +
               `Visit Our Website: https://gll.one for more information`;
    }

    try {
        const response = await axios.post(OPENROUTER_URL, {
            model: 'mistralai/mistral-7b-instruct',
            messages: [
                {
                    role: 'system',
                    content: 'You are a helpful assistant for GLL (Grow Global). Keep responses concise, friendly, and professional. Our products include GrowGlobal.asia, GrowPay, Grow4Sass, GrowInvoice, Blokzen, GrowUrja, Drutasign, and Grow4Ai. If asked about products, list these specifically. If you don\'t know something specific about the company, recommend contacting support or using the bot commands.'
                },
                {
                    role: 'user',
                    content: message
                }
            ]
        }, {
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'HTTP-Referer': 'https://gll.one',
                'X-Title': 'Grow Global Partners Bot'
            }
        });

        return response.data.choices[0].message.content;
    } catch (error) {
        console.error('AI Response Error:', error);
        return 'I apologize, but I\'m having trouble processing your request right now. Please try using one of our commands instead:\n\n/balance - Check GLL Balance\n/surprise - Get a random duck\n/help - See all commands' +
        `\n\n` +
        `Visit Our Website: https://gll.one for more information`;
    }
}

// Track users waiting to provide email
const usersAwaitingEmail = new Set();

// Track users in linking process
const usersLinking = new Set();

// Track messages per chat
const chatMessages = new Map();

// Keyboard layout
const mainKeyboard = {
    keyboard: [
        ['Balance'],
        ['Surprise', 'Clear'],
        ['Help']
    ],
    resize_keyboard: true
};

// Log all incoming messages
bot.on('message', (msg) => {
    console.log('\n🤖 New Telegram Message:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('From:', msg.from.first_name, msg.from.last_name || '');
    console.log('Username:', msg.from.username || 'No username');
    console.log('Chat ID:', msg.chat.id);
    console.log('Message:', msg.text);
    console.log('Time:', new Date(msg.date * 1000).toLocaleString());
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
});

// Log all errors
bot.on('polling_error', (error) => {
    console.log('\n❌ Telegram Bot Error:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error(error);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
});

// Middleware to verify Telegram webhook requests
const verifyTelegramWebhook = (req, res, next) => {
    if (req.body && req.body.message && req.body.message.chat) {
        next();
    } else {
        res.status(400).json({ error: 'Invalid Telegram webhook data' });
    }
};

// Handle start command
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    try {
        console.log('\n✨ Start Command Received:');
        console.log('From Chat ID:', chatId);

        // Check if user is already linked
        const user = await prisma.user.findFirst({
            where: {
                telegramId: chatId.toString()
            }
        });

        if (user) {
            // Show menu for logged in users
            await bot.sendMessage(chatId, 
                `Welcome back to Grow Global Partner Bot! 🌟\n\n` +
                `Logged in as: ${user.email}\n\n` +
                `Choose from these options:\n\n` +
                `🔷 /balance - Check GLL Balance\n` +
                `🎲 /surprise - Get a Random Duck\n` +
                `🧹 /clear - Clear Chat History\n` +
                `❓ /help - Show All Commands\n\n` +
                `Need anything else? Just use one of the commands above!` +
                `\n\n` +
                `Visit Our Website: https://gll.one for more information`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: mainKeyboard
                }
            );
        } else {
            // Add user to awaiting email set
            usersAwaitingEmail.add(chatId);
            
            await bot.sendMessage(chatId, 
                'Welcome to Grow Global Partner Bot! 🌟\n\n' +
                'To get started, please share your email address so I can link your account.\n\n' +
                'Just type your email address and send it to me.' +
                `\n\n` +
                `Visit Our Website: https://gll.one for more information`,
                {
                    reply_markup: {
                        remove_keyboard: true
                    }
                }
            );
        }
        console.log('Start message sent successfully\n');
    } catch (error) {
        console.error('Error in start command:', error);
        await bot.sendMessage(chatId, '❌ An error occurred. Please try again later.');
    }
});

// Handle link command
bot.onText(/\/link/, async (msg) => {
    const chatId = msg.chat.id;
    try {
        // Check if already linked
        const existingUser = await prisma.user.findFirst({
            where: {
                telegramId: chatId.toString()
            }
        });

        if (existingUser) {
            await bot.sendMessage(chatId, 
                'ℹ️  Your account is already linked!\n\n' +
                `Email: ${existingUser.email}\n\n` +
                'Use /balance to check your GLL balance or /help to see all commands.' +
                `\n\n` +
                `Visit Our Website: https://gll.one for more information`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: mainKeyboard
                }
            );
            return;
        }

        // Add user to linking process
        usersLinking.add(chatId);
        
        await bot.sendMessage(chatId,
            '📧 Please share your email address to link your account.\n\n' +
            'Just type and send your email address.'
        );

    } catch (error) {
        console.error('Error in link command:', error);
        await bot.sendMessage(chatId, '❌ An error occurred. Please try again later.');
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
        console.error('Error sending message:', error);
        throw error;
    }
};

// Handle both button clicks and commands
const handleCommand = async (msg, command) => {
    const chatId = msg.chat.id;
    switch (command.toLowerCase()) {
        case 'balance':
        case '/balance':
            // Existing balance logic
            try {
                // Find user by Telegram ID
                const user = await prisma.user.findFirst({
                    where: {
                        telegramId: chatId.toString()
                    }
                });

                if (!user) {
                    await bot.sendMessage(chatId, 
                        'ℹ️ Your Telegram account is not linked yet!\n\n' +
                        'Please use /start command to link your account first.'
                    );
                    return;
                }

                // Format balance with commas and 2 decimal places
                const formattedBalance = user.gllBalance ? 
                    new Intl.NumberFormat('en-US', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                    }).format(user.gllBalance) : '0.00';

                await sendMessageWithTracking(chatId,
                    `💰 *GLL Balance*\n\n` +
                    `Email: ${user.email}\n` +
                    `Balance: ${formattedBalance} GLL\n\n` +
                    `_Last updated: ${new Date().toLocaleString()}_`,
                    { 
                        parse_mode: 'Markdown',
                        reply_markup: mainKeyboard
                    }
                );

                console.log(`Balance checked for user ${user.email}: ${formattedBalance} GLL`);
            } catch (error) {
                console.error('Error in balance command:', error);
                await sendMessageWithTracking(chatId, '❌ An error occurred while fetching your balance. Please try again later.');
            }
            break;

        case 'surprise':
        case '/surprise':
            try {
                // Send a "loading" message
                const loadingMsg = await bot.sendMessage(chatId, '🦆 Finding a cute duck for you...');

                // Fetch random duck image
                const response = await axios.get('https://random-d.uk/api/v2/random');
                const duckImage = response.data.url;

                // Delete loading message
                await bot.deleteMessage(chatId, loadingMsg.message_id);

                // Send the duck image with a fun message
                await bot.sendPhoto(chatId, duckImage, {
                    caption: '🦆 Quack! Here\'s your random cute duck! ' +
                    `\n\n` +
                    `This duck will lead you to our main website: https://gll.one, follow it.`,
                    reply_markup: mainKeyboard
                });

                console.log('Surprise duck sent successfully');
            } catch (error) {
                console.error('Error in surprise command:', error);
                await bot.sendMessage(chatId, 
                    '❌ Oops! The ducks are hiding right now. Try again later!',
                    { reply_markup: mainKeyboard }
                );
            }
            break;

        case 'clear':
        case '/clear':
            // Trigger the clear command
            bot.emit('clear_command', msg);
            break;

        case 'help':
        case '/help':
            try {
                await bot.sendMessage(chatId, 
                    'Available commands:\n\n' +
                    '/start - Start the bot\n' +
                    '/link <email> - Link your GLL account\n' +
                    '/balance - Check your GLL balance\n' +
                    '/surprise - Get a random duck image\n' +
                    '/clear - Clear chat history\n' +
                    '/help - Show this help message',
                    {
                        reply_markup: mainKeyboard
                    }
                );
            } catch (error) {
                console.error('Error in help command:', error);
            }
            break;
    }
};

// Update command handlers to use the common handler
bot.onText(/^\/balance$/i, async (msg) => {
    await handleCommand(msg, '/balance');
});

bot.onText(/^\/help$/i, async (msg) => {
    await handleCommand(msg, '/help');
});

// Update clear command to use event
bot.onText(/^\/clear$/i, (msg) => {
    bot.emit('clear_command', msg);
});

// Handle clear command via event
bot.on('clear_command', async (msg) => {
    const chatId = msg.chat.id;
    const currentMessageId = msg.message_id;
    
    try {
        console.log('\n🧹 Clear Command Received:');
        console.log('From Chat ID:', chatId);

        // Try to delete the previous message (current message ID - 1)
        try {
            await bot.deleteMessage(chatId, currentMessageId - 1);
            console.log(`Deleted message ${currentMessageId - 1} for chat ${chatId}`);

            // Send confirmation with menu that will stay
            await sendMessageWithTracking(chatId,
                '✨ Previous message deleted!\n\n' +
                'Choose a command from the menu below:',
                { 
                    parse_mode: 'Markdown',
                    reply_markup: mainKeyboard 
                }
            );

            // Delete the clear command message itself
            try {
                await bot.deleteMessage(chatId, currentMessageId);
            } catch (err) {
                console.log("Couldn't delete clear command message:", err.message);
            }

        } catch (err) {
            // If we couldn't delete the previous message
            await sendMessageWithTracking(chatId,
                "❌ Couldn't delete the previous message. It might be too old or already deleted.\n\n" +
                "Choose a command from the menu below:",
                { 
                    reply_markup: mainKeyboard,
                    parse_mode: 'Markdown' 
                }
            );
        }

    } catch (error) {
        console.error('Error in clear command:', error);
        await sendMessageWithTracking(chatId,
            '❌ Something went wrong while clearing messages.\n\n' +
            'Choose a command from the menu below:',
            { 
                reply_markup: mainKeyboard,
                parse_mode: 'Markdown' 
            }
        );
    }
});

// Update message handler to track messages
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    
    // Track user messages
    trackMessage(chatId, msg.message_id);

    // Handle commands
    if (msg.text && ['Balance', 'Surprise', 'Clear', 'Help'].includes(msg.text)) {
        await handleCommand(msg, msg.text);
        return;
    }

    // Array of flower emojis
    const flowers = ['🌸', '🌺', '🌹', '🌷', '🌻', '🌼', '💐', '🌿', '🪷', '🌱'];
    // Get random flowers
    const getRandomFlowers = (count = 2) => {
        const selected = new Set();
        while(selected.size < count) {
            selected.add(flowers[Math.floor(Math.random() * flowers.length)]);
        }
        return Array.from(selected).join(' ');
    };

    // Handle Good Morning/Evening
    if (msg.text && /^good\s*morning/i.test(msg.text.trim())) {
        await sendMessageWithTracking(chatId, 
            `${getRandomFlowers(3)} Good Morning! ${getRandomFlowers(2)}\n\nI hope you have a wonderful day ahead!`,
            { reply_markup: mainKeyboard }
        );
        return;
    }

    if (msg.text && /^good\s*evening/i.test(msg.text.trim())) {
        await sendMessageWithTracking(chatId, 
            `${getRandomFlowers(3)} Good Evening! ${getRandomFlowers(2)}\n\nHave a peaceful evening!`,
            { reply_markup: mainKeyboard }
        );
        return;
    }

    // Handle casual greetings
    if (msg.text && /^(hi|hello|hey|hola|howdy|greetings|sup|yo|hii|hiii|hiiii)/i.test(msg.text.trim())) {
        const username = msg.from.first_name || msg.from.username || "there";
        await sendMessageWithTracking(chatId, 
            `🤖 Hello, ${username}!\n\nHave a Wonderful Journey with us, and Have a Great Day!\n\n`,
            { 
                parse_mode: 'Markdown',
                reply_markup: mainKeyboard 
            }
        );
        return;
    }

    // Handle general messages with AI
    if (msg.text && !msg.text.startsWith('/')) {
        // Send typing action
        await bot.sendChatAction(chatId, 'typing');

        try {
            // Get AI response
            const aiResponse = await getAIResponse(msg.text);

            // Send the response
            await sendMessageWithTracking(chatId,
                `${aiResponse}\n\n_Remember, you can always use our commands for specific actions:_`,
                { 
                    parse_mode: 'Markdown',
                    reply_markup: mainKeyboard 
                }
            );
        } catch (error) {
            console.error('Error in AI response:', error);
            await sendMessageWithTracking(chatId,
                "I apologize, but I'm having trouble understanding that. Please try using one of our commands instead.",
                { reply_markup: mainKeyboard }
            );
        }
        return;
    }

    // Handle any other text that doesn't start with a command
    if (msg.text && !msg.text.startsWith('/')) {
        await sendMessageWithTracking(chatId,
            "🤖 Beep Boop! I only understand commands.",
            { reply_markup: mainKeyboard }
        );
        return;
    }

    // Handle other message cases...
    // ... rest of your message handling code ...
});

// Webhook endpoint for Telegram updates
router.post('/webhook', verifyTelegramWebhook, async (req, res) => {
    try {
        const { message } = req.body;
        const responseData = {
            status: 'success',
            message: 'Webhook received',
            chatId: message.chat.id
        };
        res.send(encryptJSON(responseData));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Link Telegram account to user account
router.post('/link-account', async (req, res) => {
    try {
        const { email, telegramId } = req.body;

        if (!email || !telegramId) {
            return res.status(400).json({ error: 'Email and Telegram ID are required' });
        }

        const user = await prisma.user.findUnique({
            where: { email }
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Update user with Telegram ID
        const updatedUser = await prisma.user.update({
            where: { email },
            data: {
                telegramId: telegramId
            }
        });

        const responseData = {
            message: 'Account linked successfully',
            telegramId: telegramId
        };
        res.send(encryptJSON(responseData));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get user's bot settings
router.get('/settings/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                telegramId: true,
                notificationPreferences: true
            }
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const responseData = {
            telegramId: user.telegramId,
            notificationPreferences: user.notificationPreferences
        };
        res.send(encryptJSON(responseData));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;