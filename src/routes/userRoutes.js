const express = require('express');
const prisma = require('../config/db');
const multer = require('multer');
const AWS = require('aws-sdk');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const { phoneLinkContract, tokenContract, convertToEtherAmount, getMyBalance } = require('../config/blockchain');
const { encryptJSON} = require('../config/encrypt')
const { Wallet } = require("ethers");

const router = express.Router();

// Rate limiters for creator posts endpoints
const createPostLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // limit each IP to 10 requests per windowMs
    message: {
        success: false,
        message: "Too many post creation requests, please try again later."
    },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

const likeCommentLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 50, // limit each IP to 50 requests per windowMs
    message: {
        success: false,
        message: "Too many like/comment requests, please try again later."
    },
    standardHeaders: true,
    legacyHeaders: false,
});

const generalPostLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100, // limit each IP to 100 requests per windowMs
    message: {
        success: false,
        message: "Too many requests, please try again later."
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Rate limiter for file uploads
const uploadLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 10, // limit each IP to 10 upload requests per minute
    message: {
        success: false,
        message: "Too many upload requests, please try again later."
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Rate limiter for creator task rewards (financial operations)
const creatorTaskLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 3, // limit each IP to 3 task reward attempts per 5 minutes
    message: {
        success: false,
        message: "Too many task reward requests, please try again later."
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Function to read airdrop data from Google Sheets
async function readAirdropData() {
    try {
        // Google Sheets CSV export URL
        const sheetId = process.env.GOOGLE_SHEETS_AIRDROP_ID;
        
        if (!sheetId) {
            console.error('GOOGLE_SHEETS_AIRDROP_ID environment variable not set');
            return {};
        }
        
        const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
        
        // console.log('Fetching airdrop data from Google Sheets...');
        
        const response = await axios.get(csvUrl);
        const csvData = response.data;
        
        // Parse CSV data
        const lines = csvData.split('\n');
        const airdropData = {};
        
        // Skip header row and process data
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue; // Skip empty lines
            
            // Split CSV line, handling commas within quotes
            const columns = line.split(',').map(col => col.replace(/^"|"$/g, '').trim());
            
            if (columns.length >= 16) { // Ensure we have enough columns
                const email = columns[0]; // Column A - Email
                const gllAmount = columns[15]; // Column P - gll_ions
                
                if (email && gllAmount && !isNaN(parseFloat(gllAmount))) {
                    airdropData[email.toLowerCase().trim()] = parseFloat(gllAmount);
                }
            }
        }
        
        // console.log('Airdrop data loaded from Google Sheets:', Object.keys(airdropData).length, 'entries');
        return airdropData;
    } catch (error) {
        console.error('Error reading airdrop data from Google Sheets:', error);
        // Return empty object if Google Sheets fails, so the system can still work with default rewards
        return {};
    }
}

// Health check endpoint
router.get('/healths', (req, res) => {
    res.json({
        success: true,
        message: 'User API is working',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        switch: process.env.SWITCH || 'Not set',
        card4Reward: process.env.CARD4_REWARD || 'Not set'
    });
});

// AWS S3 configuration 
const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || 'eu-north-1'
});

// Set up multer for file uploads
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Set up multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `${uniqueSuffix}-${file.originalname}`);
    }
});

const upload = multer({
    dest: 'uploads/',
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // Increased to 50MB for video files
    fileFilter: (req, file, cb) => {
        // Allow images, videos, and audio files
        const allowedMimes = [
            'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
            'video/mp4', 'video/avi', 'video/mov', 'video/wmv', 'video/flv', 'video/webm', 'video/quicktime',
            'audio/mp3', 'audio/wav', 'audio/mpeg', 'audio/ogg', 'audio/m4a', 'audio/aac', 'audio/wma',
            'audio/mp4', 'audio/x-m4a', 'audio/mp4a-latm', 'audio/x-wav', 'audio/wave'
        ];
        
        // console.log('File upload attempt - MIME type:', file.mimetype, 'Original name:', file.originalname);
        
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            // console.log('Rejected file type:', file.mimetype);
            cb(new Error(`Invalid file type: ${file.mimetype}. Only images, videos, and audio files are allowed.`), false);
        }
    }
});

// Security helper function to validate file paths
function validateFilePath(filePath) {
    try {
        // Get the absolute path of the upload directory (same as multer storage)
        const uploadDir = path.join(__dirname, '../uploads');
        
        // Get the absolute canonical path of the file
        const fileAbsolutePath = path.resolve(filePath);
        
        // Check if the file path starts with the upload directory
        if (!fileAbsolutePath.startsWith(uploadDir)) {
            throw new Error('Invalid file path: file is outside the allowed upload directory');
        }
        
        // Additional check: ensure the file exists and is a file (not a directory)
        if (!fs.existsSync(fileAbsolutePath) || !fs.statSync(fileAbsolutePath).isFile()) {
            throw new Error('Invalid file path: file does not exist or is not a regular file');
        }
        
        return fileAbsolutePath;
    } catch (error) {
        throw new Error(`File path validation failed: ${error.message}`);
    }
}

// Function to synchronize GLL balance between User and Creator tables
async function syncGLLBalance(email) {
    try {
        // Find user by email
        const user = await prisma.user.findUnique({
            where: { email }
        });
        
        // Find creator by email
        const creator = await prisma.creator.findUnique({
            where: { email }
        });
        
        if (user && creator) {
            // If both exist, update creator's balance to match user's balance
            await prisma.creator.update({
                where: { email },
                data: {
                    gllBalance: user.gllBalance
                }
            });
        }
    } catch (error) {
        console.error(`Error syncing GLL balance for email ${email}:`, error);
        throw error;
    }
}

router.post('/save-connect-wallet-creator', async (req, res) => {
    const { name, email, walletAddress, glltag } = req.body;

    const tempCreator = await prisma.creator.findUnique({
        where: { email }
    });
    try {
        if (!tempCreator) {
            const creator = await prisma.creator.create({
                data: {
                    name: name,
                    email: email,
                    walletAddress: walletAddress,
                    glltag: glltag
                }
            });
            const responseData = {
                message: "Creator added successfully"
            };
            res.send(encryptJSON(responseData));
        } else {
            const updatedCreator = await prisma.creator.update({
                where: { id: tempCreator.id },
                data: {
                    name: name,
                    email: email,
                    walletAddress: walletAddress,
                    glltag: glltag
                }
            });
            const responseData = {
                message: "Creator details updated successfully"
            };
            res.send(encryptJSON(responseData));
        }
    } catch (error) {
        // console.log("Error completing registration:", error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/save-connect-wallet', async (req, res) => {
    const { name, email, walletAddress, glltag } = req.body;

    const tempUser = await prisma.user.findUnique({
        where: { email }
    });
    try {
        if (!tempUser) {
            const user = await prisma.user.create({
                data: {
                    name: name,
                    email: email,
                    walletAddress: walletAddress,
                    glltag: glltag
                }
            });
            const responseData = {
                message: "User added successfully"
            };
            res.send(encryptJSON(responseData));
        } else {
            const updatedUser = await prisma.user.update({
                where: { id: tempUser.id },
                data: {
                    name: name,
                    email: email,
                    walletAddress: walletAddress,
                    glltag: glltag
                }
            });
            const responseData = {
                message: "Details updated successfully"
            };
            res.send(encryptJSON(responseData));
        }
    } catch (error) {
        // console.log("Error completing registration:", error);
        res.status(500).json({ error: error.message });
    }
});

// Save personal details from step 1 registration
router.post('/personal-details', async (req, res) => {
    const { name, email, designation, phone, international, businessDescription, businessPhotos, businessVideo } = req.body;


    const tempUser = await prisma.user.findUnique({
        where: { email }
    });
    try {
        if (!tempUser) {
            const user = await prisma.user.create({
                data: {
                    name: name,
                    email: email,
                    designation: designation,
                    phone: phone,
                    international: international,
                    description: businessDescription || "",
                    userPhotos: businessPhotos || [],
                    userVideos: businessVideo ? (Array.isArray(businessVideo) ? businessVideo : [businessVideo]) : [],
                    gllBalance: 0, // Initially set to 0, will be updated in the final step
                    accountName: "",
                    accountNumber: "",
                    ifscCode: "",
                    gstNumber: "",
                    companyAddress: "",
                    companyType: "",
                    companyName: "",
                    terms: true
                }
            });
            // console.log('User created with media:', {
            //     userPhotos: user.userPhotos,
            //     userVideos: user.userVideos,
            //     description: user.description
            // });
            const responseData = {
                message: "Email added successfully"
            };
            res.send(encryptJSON(responseData));
        } else {
            // Don't update GLL balance if the user already exists
            const updatedUser = await prisma.user.update({
                where: { id: tempUser.id },
                data: {
                    name: name,
                    email: email,
                    designation: designation,
                    phone: phone,
                    international: international,
                    description: businessDescription || tempUser.description || "",
                    userPhotos: businessPhotos || tempUser.userPhotos || [],
                    userVideos: businessVideo ? (Array.isArray(businessVideo) ? businessVideo : [businessVideo]) : (tempUser.userVideos || [])
                    // Don't update gllBalance here
                }
            });
            // console.log('User updated with media:', {
            //     userPhotos: updatedUser.userPhotos,
            //     userVideos: updatedUser.userVideos,
            //     description: updatedUser.description
            // });
            const responseData = {
                message: "Details updated successfully"
            };
            res.send(encryptJSON(responseData));
        }
    } catch (error) {
        // console.log("Error completing registration:", error);
        res.status(500).json({ error: error.message });
    }
});

// Save personal details from step 1 registration for creator
router.post('/personal-details-creator', async (req, res) => {
    const { name, username, email, phone, nationality, profilePicture, passion, existingOnlineStoreLink, paymentPreference, businessDescription, businessPhotos, businessVideo, connectedSocials, creatorName, firstName, lastName, customCategory, customWorkType, hasBrandColors, hasLogo, selectedCategories, selectedWorkTypes, userType, userData, platform, connectedAt, logoUrl } = req.body;
    
    // Log all data received from frontend
    
    // Use creatorName as username if provided, otherwise fall back to username
    const finalUsername = creatorName || username;
    
    // Use logoUrl as profilePicture if provided, otherwise fall back to profilePicture
    const finalProfilePicture = logoUrl || profilePicture;

    const tempCreator = await prisma.creator.findUnique({
        where: { email }
    });
    try {
        if (!tempCreator) {
            const creator = await prisma.creator.create({
                data: {
                    name: name,
                    username: finalUsername,
                    email: email,
                    phone: phone,
                    nationality: nationality,
                    profilePicture: finalProfilePicture || null,
                    passion: passion || "",
                    existingOnlineStoreLink: existingOnlineStoreLink || "",
                    paymentPreference: paymentPreference || "",
                    aboutMe: businessDescription || "",
                    userPhotos: businessPhotos || [],
                    userVideos: businessVideo ? (Array.isArray(businessVideo) ? businessVideo : [businessVideo]) : [],
                    firstName: firstName || null,
                    lastName: lastName || null,
                    customCategory: customCategory || null,
                    customWorkType: customWorkType || null,
                    hasBrandColors: typeof hasBrandColors === 'boolean' ? hasBrandColors : false,
                    hasLogo: typeof hasLogo === 'boolean' ? hasLogo : false,
                    selectedCategories: Array.isArray(selectedCategories) ? selectedCategories : [],
                    selectedWorkTypes: Array.isArray(selectedWorkTypes) ? selectedWorkTypes : [],
                    userType: userType || "creator",
                    connectedSocials: connectedSocials ? {
                        platform: platform || null,
                        connectedAt: connectedAt || new Date().toISOString(),
                        list: Array.isArray(connectedSocials) ? connectedSocials : [],
                        userData: userData || null
                    } : undefined,
                    gllBalance: 0, // Initially set to 0, will be updated in the final step
                    isKycComplete: false,
                    isRegistrationComplete: false,
                    terms: true
                }
            });
            const responseData = {
                message: "Email added successfully"
            };
            res.send(encryptJSON(responseData));
        } else {
            // Don't update GLL balance if the creator already exists
            const updatedCreator = await prisma.creator.update({
                where: { id: tempCreator.id },
                data: {
                    name: name,
                    username: finalUsername,
                    email: email,
                    phone: phone,
                    nationality: nationality,
                    profilePicture: finalProfilePicture || tempCreator.profilePicture,
                    passion: passion || tempCreator.passion || "",
                    existingOnlineStoreLink: existingOnlineStoreLink || tempCreator.existingOnlineStoreLink || "",
                    paymentPreference: paymentPreference || tempCreator.paymentPreference || "",
                    aboutMe: businessDescription || tempCreator.aboutMe || "",
                    userPhotos: businessPhotos || tempCreator.userPhotos || [],
                    userVideos: businessVideo ? (Array.isArray(businessVideo) ? businessVideo : [businessVideo]) : (tempCreator.userVideos || []),
                    firstName: firstName || tempCreator.firstName || null,
                    lastName: lastName || tempCreator.lastName || null,
                    customCategory: customCategory || tempCreator.customCategory || null,
                    customWorkType: customWorkType || tempCreator.customWorkType || null,
                    hasBrandColors: typeof hasBrandColors === 'boolean' ? hasBrandColors : (tempCreator.hasBrandColors ?? false),
                    hasLogo: typeof hasLogo === 'boolean' ? hasLogo : (tempCreator.hasLogo ?? false),
                    selectedCategories: Array.isArray(selectedCategories) ? selectedCategories : (tempCreator.selectedCategories || []),
                    selectedWorkTypes: Array.isArray(selectedWorkTypes) ? selectedWorkTypes : (tempCreator.selectedWorkTypes || []),
                    userType: userType || tempCreator.userType || "creator",
                    connectedSocials: connectedSocials ? {
                        platform: platform || null,
                        connectedAt: connectedAt || new Date().toISOString(),
                        list: Array.isArray(connectedSocials) ? connectedSocials : [],
                        userData: userData || null
                    } : tempCreator.connectedSocials,
                    // Don't update gllBalance here
                }
            });
            const responseData = {
                message: "Details updated successfully"
            };
            res.send(encryptJSON(responseData));
        }
    } catch (error) {
        // console.log("Error completing registration:", error);
        res.status(500).json({ error: error.message });
    }
});

// Step 3: Complete registration after email verification
router.post('/register', async (req, res) => {
    try {
        const {
            name,
            designation,
            email,
            phone,
            accountName,
            accountNumber,
            ifscCode,
            gstNumber,
            companyName,
            companyAddress,
            companyType,
            international,
            terms,
            msmeCertificate,
            oemCertificate,
            fy2324Data,
            fy2425Data,
            apiKey,
            bankName,
            bankBranch,
            businessDescription,
            businessPhotos,
            businessVideo,
            // New fields for enhanced user profile
            socialMediaLink,
            passion,
            existingOnlineStoreLink,
            profilePicture,
            paymentPreference,
        } = req.body;

        // console.log('=== REGISTER ENDPOINT DEBUG ===');
        // console.log('Received data:', {
        //     name,
        //     email,
        //     businessDescription: businessDescription || 'NOT PROVIDED',
        //     businessPhotos: businessPhotos ? `Array with ${businessPhotos.length} items: ${JSON.stringify(businessPhotos)}` : 'NOT PROVIDED',
        //     businessVideo: businessVideo ? `${Array.isArray(businessVideo) ? 'Array' : 'String'} with value: ${JSON.stringify(businessVideo)}` : 'NOT PROVIDED'
        // });

        if (!email) {
            return res.status(400).json({ error: "Email is required" });
        }
        
        // Find the temporary user record
        const tempUser = await prisma.user.findUnique({
            where: { email }
        });

        // console.log('Existing user data:', {
        //     email: tempUser?.email,
        //     description: tempUser?.description || 'NOT SET',
        //     userPhotos: tempUser?.userPhotos || 'NOT SET',
        //     userVideos: tempUser?.userVideos || 'NOT SET'
        // });

        if (!tempUser) {
            return res.status(400).json({ error: "Email not found. Please request verification first." });
        }
        
        // Update the user with complete registration information
        // Set GLL balance to 100.0 only when all steps are completed
        const updatedUser = await prisma.user.update({
            where: { id: tempUser.id },
            data: {
                name: name || tempUser.name,
                designation: designation || tempUser.designation,
                phone: phone || tempUser.phone,
                accountName: accountName || tempUser.accountName,
                accountNumber: accountNumber || tempUser.accountNumber,
                ifscCode: ifscCode || tempUser.ifscCode,
                gstNumber: gstNumber || tempUser.gstNumber,
                companyAddress: companyAddress || tempUser.companyAddress,
                companyType: companyType || tempUser.companyType,
                companyName: companyName || tempUser.companyName,
                international: international !== undefined ? international : tempUser.international,
                terms: terms !== undefined ? terms : tempUser.terms,
                verificationOTP: null,
                otpExpiry: null,
                msmeCertificate: msmeCertificate || tempUser.msmeCertificate,
                oemCertificate: oemCertificate || tempUser.oemCertificate,
                fy2324Data: fy2324Data || tempUser.fy2324Data,
                fy2425Data: fy2425Data || tempUser.fy2425Data,
                apiKey: apiKey || tempUser.apiKey,
                bankName: bankName || tempUser.bankName,
                bankBranch: bankBranch || tempUser.bankBranch,
                description: businessDescription || tempUser.description || "",
                userPhotos: businessPhotos || tempUser.userPhotos || [],
                userVideos: businessVideo ? (Array.isArray(businessVideo) ? businessVideo : [businessVideo]) : (tempUser.userVideos || []),
                // New fields for enhanced user profile
                socialMediaLink: socialMediaLink || tempUser.socialMediaLink || "",
                passion: passion || tempUser.passion || "",
                existingOnlineStoreLink: existingOnlineStoreLink || tempUser.existingOnlineStoreLink || "",
                profilePicture: profilePicture || tempUser.profilePicture || "",
                businessPhotos: businessPhotos || tempUser.businessPhotos || [],
                businessVideo: businessVideo || tempUser.businessVideo || "",
                businessDescription: businessDescription || tempUser.businessDescription || "",
                paymentPreference: paymentPreference || tempUser.paymentPreference || "",
                // Set GLL balance to 100.0 upon successful completion of all steps
                gllBalance: {
                    increment: parseFloat(process.env.REGISTER_REWARD)
                }
            }
        });

        // console.log('Final user data saved:', {
        //     email: updatedUser.email,
        //     description: updatedUser.description,
        //     userPhotos: updatedUser.userPhotos,
        //     userVideos: updatedUser.userVideos
        // });
        // console.log('=== END REGISTER DEBUG ===');

        /** Code to send GLL to email wallet *******/
        
        amount = process.env.REGISTER_REWARD
        if (process.env.SWITCH === 'true') {
            try {
                if (!tempUser.walletAddress) {
                    // console.log("⚠️ User registration skipped blockchain transaction - no wallet address found for email:", tempUser.email);
                } else {
                    const sendTx = await phoneLinkContract.getGLL(convertToEtherAmount(amount.toString()), tempUser.walletAddress);
                    await sendTx.wait();
                    // console.log("✅ User registration GLL transaction completed for wallet:", tempUser.walletAddress);
                }
            } catch (blockchainError) {
                console.error("❌ User registration blockchain transaction failed:", blockchainError.message);
                // Don't crash the endpoint, just log the error
            }
        }
        // } else {
        //     // console.log("SWITCH is not 'true' or user has no wallet address, skipping blockchain transaction");
        // }
        // await syncGLLBalance(email);
        /** Code to get GLL balance from email wallet ***** */
        // console.log("About to get balance for email:", email);
        // const myBalance = await getMyBalance(email);
        // console.log("My Balance:", myBalance);
        // console.log("Balance retrieved successfully");
        /** *********** */

        const responseData = {
            message: "Registration completed successfully."
        };
        res.send(encryptJSON(responseData));
    } catch (error) {
        // console.log("Error completing registration:", error);
        res.status(500).json({ error: error.message });
    }
});

// Check if username is available for creators
router.post('/check-username-availability', async (req, res) => {
    try {
        const { username } = req.body;

        // Log the request
        // console.log('=== CHECK USERNAME AVAILABILITY ===');
        // console.log('Checking username:', username);

        // Validation
        if (!username) {
            return res.status(400).json({ 
                success: false,
                message: "Username is required" 
            });
        }

        if (typeof username !== 'string') {
            return res.status(400).json({ 
                success: false,
                message: "Username must be a string" 
            });
        }

        // Trim and validate username
        const trimmedUsername = username.trim();
        
        if (trimmedUsername.length < 4) {
            return res.status(400).json({ 
                success: false,
                message: "Username must be at least 4 characters long" 
            });
        }

        if (trimmedUsername.length > 30) {
            return res.status(400).json({ 
                success: false,
                message: "Username must be less than 30 characters" 
            });
        }

        // Check if username exists in creator database
        const existingCreator = await prisma.creator.findUnique({
            where: { username: trimmedUsername }
        });

        if (existingCreator) {
            // console.log('Username already exists:', trimmedUsername);
            return res.json({
                success: true,
                available: false,
                message: "This username already exists",
                username: trimmedUsername
            });
        } else {
            // console.log('Username is available:', trimmedUsername);
            return res.json({
                success: true,
                available: true,
                message: "This username is available",
                username: trimmedUsername
            });
        }

    } catch (error) {
        console.error("Error checking username availability:", error);
        res.status(500).json({
            success: false,
            message: "Something went wrong while checking username availability",
            error: error.message
        });
    }
});

// Get all creator activities (services, posts, courses, products) with transaction data
router.get('/creator-activities', async (req, res) => {
    try {
        // console.log('=== FETCHING CREATOR ACTIVITIES ===');

        // Fetch data from all four creator tables
        const [services, posts, courses, products] = await Promise.all([
            // Creator Services
            prisma.creatorService.findMany({
                select: {
                    email: true,
                    title: true,
                    transactionHash: true,
                    createdAt: true,
                    rewardAmount: true
                },
                orderBy: {
                    createdAt: 'desc'
                }
            }),
            
            // Creator Posts
            prisma.creatorPost.findMany({
                select: {
                    userEmail: true,
                    content: true,
                    transactionHash: true,
                    timestamp: true,
                    rewardAmount: true
                },
                orderBy: {
                    timestamp: 'desc'
                }
            }),
            
            // Creator Courses
            prisma.creatorCourse.findMany({
                select: {
                    email: true,
                    title: true,
                    transactionHash: true,
                    createdAt: true,
                    rewardAmount: true
                },
                orderBy: {
                    createdAt: 'desc'
                }
            }),
            
            // Creator Products
            prisma.creatorProduct.findMany({
                select: {
                    email: true,
                    title: true,
                    transactionHash: true,
                    createdAt: true,
                    rewardAmount: true
                },
                orderBy: {
                    createdAt: 'desc'
                }
            })
        ]);

        // Transform the data to have consistent structure
        const transformedServices = services.map(item => ({
            type: 'service',
            email: item.email,
            title: item.title,
            transactionHash: item.transactionHash,
            timestamp: item.createdAt,
            rewardAmount: item.rewardAmount
        }));

        const transformedPosts = posts.map(item => ({
            type: 'post',
            email: item.userEmail,
            title: item.content.length > 50 ? item.content.substring(0, 50) + '...' : item.content,
            transactionHash: item.transactionHash,
            timestamp: item.timestamp,
            rewardAmount: item.rewardAmount
        }));

        const transformedCourses = courses.map(item => ({
            type: 'course',
            email: item.email,
            title: item.title,
            transactionHash: item.transactionHash,
            timestamp: item.createdAt,
            rewardAmount: item.rewardAmount
        }));

        const transformedProducts = products.map(item => ({
            type: 'product',
            email: item.email,
            title: item.title,
            transactionHash: item.transactionHash,
            timestamp: item.createdAt,
            rewardAmount: item.rewardAmount
        }));

        // Combine all activities
        const allActivities = [
            ...transformedServices,
            ...transformedPosts,
            ...transformedCourses,
            ...transformedProducts
        ];

        // Sort by timestamp (newest first)
        allActivities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        // Calculate statistics
        const stats = {
            totalActivities: allActivities.length,
            services: services.length,
            posts: posts.length,
            courses: courses.length,
            products: products.length,
            totalRewardAmount: allActivities.reduce((sum, activity) => sum + (activity.rewardAmount || 0), 0),
            activitiesWithTransactions: allActivities.filter(activity => activity.transactionHash).length
        };

        

        const responseData = {
            success: true,
            message: "Creator activities fetched successfully",
            data: {
                activities: allActivities,
                statistics: stats
            }
        };

        res.send(encryptJSON(responseData));

    } catch (error) {
        console.error("Error fetching creator activities:", error);
        res.status(500).json({
            success: false,
            message: "Something went wrong while fetching creator activities",
            error: error.message
        });
    }
});

// Get all creators with basic info (username, email, createdAt, name)
router.get('/creators-all', async (req, res) => {
    try {
        // console.log('=== FETCHING CREATORS ===');

        // Fetch all creators with selected fields
        const creators = await prisma.creator.findMany({
            select: {
                username: true,
                email: true,
                createdAt: true,
                name: true
            },
            orderBy: {
                createdAt: 'desc' // Newest creators first
            }
        });

        // Calculate statistics
        const stats = {
            totalCreators: creators.length,
            creatorsWithUsernames: creators.filter(creator => creator.username).length,
            creatorsWithoutUsernames: creators.filter(creator => !creator.username).length
        };

        const responseData = {
            success: true,
            message: "Creators fetched successfully",
            data: {
                creators: creators,
                statistics: stats
            }
        };

        res.send(encryptJSON(responseData));

    } catch (error) {
        console.error("Error fetching creators:", error);
        res.status(500).json({
            success: false,
            message: "Something went wrong while fetching creators",
            error: error.message
        });
    }
});

// Creator Task3 Reward - One time reward per email
router.post('/creator-task3-reward', creatorTaskLimiter, async (req, res) => {
    try {
        const { email } = req.body;
        // Validation
        if (!email) {
            return res.status(400).json({
                success: false,
                message: 'Email is required'
            });
        }

        // Check if this email has already completed the task
        const existingTask = await prisma.userCompletedTask.findUnique({
            where: {
                userEmail_taskId: {
                    userEmail: email,
                    taskId: 'creator_task3'
                }
            }
        });

        if (existingTask) {
            // console.log('❌ Email has already completed Task3:', email);
            return res.status(400).json({
                success: false,
                message: 'This email has already completed Task3',
                data: {
                    email: email,
                    alreadyCompleted: true,
                    completedAt: existingTask.completedAt,
                    taskId: 'creator_task3'
                }
            });
        }

        // Find user/creator and get wallet address
        let user = null;
        let creator = null;
        let walletAddress = null;

        // Try to find user by email first
        user = await prisma.user.findFirst({
            where: { 
                OR: [
                    { email: email },
                    { name: email }
                ]
            }
        });

        // If user not found, try to find creator
        if (!user) {
            creator = await prisma.creator.findFirst({
                where: { 
                    OR: [
                        { email: email },
                        { name: email },
                        { username: email }
                    ]
                }
            });
        }

        // Get wallet address
        if (user && user.walletAddress) {
            walletAddress = user.walletAddress;
        } else if (creator && creator.walletAddress) {
            walletAddress = creator.walletAddress;
        }

        const rewardAmount = process.env.CREATOR_TASK3_REWARD || '0';
        let transactionHash = null;

        // Process blockchain transaction if wallet address exists and SWITCH is enabled
        if (walletAddress && process.env.SWITCH === 'true' && parseFloat(rewardAmount) > 0) {
            // console.log("🚀 Starting Task3 Reward blockchain transaction...");
            try {
                // Update database balance (only if user/creator found)
                if (user) {
                    await prisma.user.update({
                        where: { id: user.id },
                        data: {
                            gllBalance: {
                                increment: parseFloat(rewardAmount)
                            }
                        }
                    });
                    // console.log("✅ Updated user database balance for Task3 reward");
                } else if (creator) {
                    await prisma.creator.update({
                        where: { id: creator.id },
                        data: {
                            gllBalance: {
                                increment: parseFloat(rewardAmount)
                            }
                        }
                    });
                    // console.log("✅ Updated creator database balance for Task3 reward");
                }

                // Send blockchain transaction
                const sendTx = await phoneLinkContract.getGLL(convertToEtherAmount(rewardAmount.toString()), walletAddress);
                await sendTx.wait();
                transactionHash = sendTx.hash;
                
            } catch (blockchainError) {
                console.error("❌ Task3 Reward blockchain transaction failed:", blockchainError.message);
                // Don't crash the endpoint, just log the error
            }
        }

        // Record the task completion
        const taskCompletion = await prisma.userCompletedTask.create({
            data: {
                userEmail: email,
                taskId: 'creator_task3',
                completedAt: new Date()
            }
        });

        // console.log("✅ Task3 completion recorded for email:", email);

        const responseData = {
            success: true,
            message: "Task3 reward claimed successfully",
            data: {
                email: email,
                rewardAmount: parseFloat(rewardAmount),
                transactionHash: transactionHash,
                walletAddress: walletAddress,
                completedAt: taskCompletion.completedAt,
                taskId: 'creator_task3',
                alreadyCompleted: false
            }
        };

        res.send(encryptJSON(responseData));

    } catch (error) {
        console.error("Error processing Task3 reward:", error);
        res.status(500).json({
            success: false,
            message: 'Failed to process Task3 reward',
            error: error.message
        });
    }
});

// Check if email has already claimed Task3 reward
router.post('/check-task3-reward-status', async (req, res) => {
    try {
        const { email } = req.body;

        // console.log('=== CHECK TASK3 REWARD STATUS ===');
        // console.log('Email:', email);

        if (!email) {
            return res.status(400).json({
                success: false,
                message: 'Email is required'
            });
        }

        const existingTask = await prisma.userCompletedTask.findUnique({
            where: {
                userEmail_taskId: {
                    userEmail: email,
                    taskId: 'creator_task3'
                }
            }
        });

        if (existingTask) {
            // console.log('✅ Email has already completed Task3:', email);
            return res.json({
                success: true,
                message: "Task3 already completed",
                data: {
                    email: email,
                    alreadyCompleted: true,
                    completedAt: existingTask.completedAt,
                    taskId: 'creator_task3',
                    rewardAmount: process.env.CREATOR_TASK3_REWARD
                }
            });
        } else {
            // console.log('❌ Email has not completed Task3 yet:', email);
            return res.json({
                success: true,
                message: "Task3 not completed yet",
                data: {
                    email: email,
                    alreadyCompleted: false,
                    taskId: 'creator_task3',
                    rewardAmount: process.env.CREATOR_TASK3_REWARD
                }
            });
        }

    } catch (error) {
        console.error("Error checking Task3 reward status:", error);
        res.status(500).json({
            success: false,
            message: 'Failed to check Task3 reward status',
            error: error.message
        });
    }
});

// Creator Task4 Reward - One time reward per email
router.post('/creator-task4-reward', creatorTaskLimiter, upload.single('file'), async (req, res) => {
    try {
        const { email, type, customerClient } = req.body;
        // Validation
        if (!email) {
            return res.status(400).json({
                success: false,
                message: 'Email is required'
            });
        }

        if (!type) {
            return res.status(400).json({
                success: false,
                message: 'Type is required'
            });
        }

        if (!customerClient) {
            return res.status(400).json({
                success: false,
                message: 'Customer/Client is required'
            });
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'File upload is required'
            });
        }

        // Check if this email has already completed the task
        const existingTask = await prisma.userCompletedTask.findUnique({
            where: {
                userEmail_taskId: {
                    userEmail: email,
                    taskId: 'creator_task4'
                }
            }
        });

        if (existingTask) {
            // console.log('❌ Email has already completed Task4:', email);
            return res.status(400).json({
                success: false,
                message: 'This email has already completed Task4',
                data: {
                    email: email,
                    alreadyCompleted: true,
                    completedAt: existingTask.completedAt,
                    taskId: 'creator_task4'
                }
            });
        }

        // Upload file to S3
        let fileUrl = null;
        try {
            // Validate file path for security
            const validatedFilePath = validateFilePath(req.file.path);
            const fileContent = fs.readFileSync(validatedFilePath);
            
            const params = {
                Bucket: process.env.AWS_BUCKET_NAME,
                Key: `creator-task4/${Date.now()}-${Math.round(Math.random() * 1E9)}-${req.file.originalname}`,
                Body: fileContent,
                ContentType: req.file.mimetype,
            };

            const uploadResult = await s3.upload(params).promise();
            fileUrl = uploadResult.Location;
            // console.log("✅ File uploaded to S3:", fileUrl);

            // Delete the temporary file
            try {
                if (fs.existsSync(validatedFilePath)) {
                    fs.unlinkSync(validatedFilePath);
                }
            } catch (unlinkError) {
                // console.log("Warning: Could not delete temporary file:", unlinkError);
            }
        } catch (uploadError) {
            console.error("❌ File upload failed:", uploadError);
            return res.status(500).json({
                success: false,
                message: 'Failed to upload file',
                error: uploadError.message
            });
        }

        // Find user/creator and get wallet address
        let user = null;
        let creator = null;
        let walletAddress = null;

        // Try to find user by email first
        user = await prisma.user.findFirst({
            where: { 
                OR: [
                    { email: email },
                    { name: email }
                ]
            }
        });

        // If user not found, try to find creator
        if (!user) {
            creator = await prisma.creator.findFirst({
                where: { 
                    OR: [
                        { email: email },
                        { name: email },
                        { username: email }
                    ]
                }
            });
        }

        // Get wallet address
        if (user && user.walletAddress) {
            walletAddress = user.walletAddress;
        } else if (creator && creator.walletAddress) {
            walletAddress = creator.walletAddress;
        }


        const rewardAmount = process.env.CREATOR_TASK4_REWARD;
        let transactionHash = null;

        // Process blockchain transaction if wallet address exists and SWITCH is enabled
        if (walletAddress && process.env.SWITCH === 'true' && parseFloat(rewardAmount) > 0) {
            // console.log("🚀 Starting Task4 Reward blockchain transaction...");
            try {
                // Update database balance (only if user/creator found)
                if (user) {
                    await prisma.user.update({
                        where: { id: user.id },
                        data: {
                            gllBalance: {
                                increment: parseFloat(rewardAmount)
                            }
                        }
                    });
                    // console.log("✅ Updated user database balance for Task4 reward");
                } else if (creator) {
                    await prisma.creator.update({
                        where: { id: creator.id },
                        data: {
                            gllBalance: {
                                increment: parseFloat(rewardAmount)
                            }
                        }
                    });
                    // console.log("✅ Updated creator database balance for Task4 reward");
                }

                // Send blockchain transaction
                const sendTx = await phoneLinkContract.getGLL(convertToEtherAmount(rewardAmount.toString()), walletAddress);
                await sendTx.wait();
                transactionHash = sendTx.hash;
                // console.log("✅ Task4 Reward GLL transaction completed successfully");
                // console.log("📝 Transaction Hash:", transactionHash);
                
            } catch (blockchainError) {
                console.error("❌ Task4 Reward blockchain transaction failed:", blockchainError.message);
                // Don't crash the endpoint, just log the error
            }
        }

        // Record the task completion
        const taskCompletion = await prisma.userCompletedTask.create({
            data: {
                userEmail: email,
                taskId: 'creator_task4',
                completedAt: new Date()
            }
        });

        // Record the Task4 data
        const task4Data = await prisma.creatorTask4Data.create({
            data: {
                email: email,
                type: type,
                customerClient: customerClient,
                fileUrl: fileUrl,
                rewardAmount: parseFloat(rewardAmount),
                transactionHash: transactionHash,
                walletAddress: walletAddress,
                completedAt: new Date()
            }
        });

        // console.log("✅ Task4 completion and data recorded for email:", email);

        const responseData = {
            success: true,
            message: "Task4 reward claimed successfully",
            data: {
                email: email,
                type: type,
                customerClient: customerClient,
                fileUrl: fileUrl,
                rewardAmount: parseFloat(rewardAmount),
                transactionHash: transactionHash,
                walletAddress: walletAddress,
                completedAt: taskCompletion.completedAt,
                taskId: 'creator_task4',
                alreadyCompleted: false
            }
        };

        res.send(encryptJSON(responseData));

    } catch (error) {
        // Clean up temporary file if it exists and there was an error
        if (req.file && validatedFilePath && fs.existsSync(validatedFilePath)) {
            try {
                fs.unlinkSync(validatedFilePath);
            } catch (unlinkError) {
                // console.log("Warning: Could not delete temporary file:", unlinkError);
            }
        }
        
        console.error("Error processing Task4 reward:", error);
        res.status(500).json({
            success: false,
            message: 'Failed to process Task4 reward',
            error: error.message
        });
    }
});

// Check if email has already completed Task4
router.post('/check-task4-reward-status', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({
                success: false,
                message: 'Email is required'
            });
        }

        const existingTask = await prisma.userCompletedTask.findUnique({
            where: {
                userEmail_taskId: {
                    userEmail: email,
                    taskId: 'creator_task4'
                }
            }
        });

        if (existingTask) {
            // console.log('✅ Email has already completed Task4:', email);
            return res.json({
                success: true,
                message: "Task4 already completed",
                data: {
                    email: email,
                    alreadyCompleted: true,
                    completedAt: existingTask.completedAt,
                    taskId: 'creator_task4',
                    rewardAmount: process.env.CREATOR_TASK4_REWARD
                }
            });
        } else {
            // console.log('❌ Email has not completed Task4 yet:', email);
            return res.json({
                success: true,
                message: "Task4 not completed yet",
                data: {
                    email: email,
                    alreadyCompleted: false,
                    taskId: 'creator_task4',
                    rewardAmount: process.env.CREATOR_TASK4_REWARD
                }
            });
        }

    } catch (error) {
        console.error("Error checking Task4 reward status:", error);
        res.status(500).json({
            success: false,
            message: 'Failed to check Task4 reward status',
            error: error.message
        });
    }
});

// Creator Task5 Reward - One time reward per email
router.post('/creator-task5-reward', creatorTaskLimiter, upload.single('testimonialFile'), async (req, res) => {
    try {
        let email, customerName, format, testimonial, testimonialFileUrl = null;
        
        // Check if request is JSON (text format) or FormData (video/audio format)
        if (req.headers['content-type']?.includes('application/json')) {
            // Handle text testimonial
            ({ email, customerName, format, testimonial } = req.body);
        } else {
            // Handle video/audio testimonial
            ({ email, customerName, format } = req.body);
            testimonial = null; // No text for video/audio
            
            // Handle file upload
            if (req.file) {
                // Upload file to S3 (similar to your Task4 implementation)
                try {
                    // Validate file path for security
                    const validatedFilePath = validateFilePath(req.file.path);
                    const fileContent = fs.readFileSync(validatedFilePath);
                    
                    const params = {
                        Bucket: process.env.AWS_BUCKET_NAME,
                        Key: `creator-task5/${Date.now()}-${Math.round(Math.random() * 1E9)}-${req.file.originalname}`,
                        Body: fileContent,
                        ContentType: req.file.mimetype,
                    };

                    const uploadResult = await s3.upload(params).promise();
                    testimonialFileUrl = uploadResult.Location;
                    // console.log("✅ Testimonial file uploaded to S3:", testimonialFileUrl);

                    // Delete the temporary file
                    try {
                        if (fs.existsSync(validatedFilePath)) {
                            fs.unlinkSync(validatedFilePath);
                        }
                    } catch (unlinkError) {
                        // console.log("Warning: Could not delete temporary file:", unlinkError);
                    }
                } catch (uploadError) {
                    console.error("❌ File upload failed:", uploadError);
                    return res.status(500).json({
                        success: false,
                        message: 'Failed to upload testimonial file',
                        error: uploadError.message
                    });
                }
            }
        }
        
        // Validation
        if (!email) {
            return res.status(400).json({
                success: false,
                message: 'Email is required'
            });
        }

        if (!customerName) {
            return res.status(400).json({
                success: false,
                message: 'Customer Name is required'
            });
        }

        if (!format) {
            return res.status(400).json({
                success: false,
                message: 'Format is required'
            });
        }

        // Validate based on format
        if (format === 'Text') {
            if (!testimonial) {
                return res.status(400).json({
                    success: false,
                    message: 'Testimonial is required for text format'
                });
            }
            if (testimonial.length < 40) {
                return res.status(400).json({
                    success: false,
                    message: 'Testimonial must be at least 40 characters long'
                });
            }
        } else if (format === 'Video' || format === 'Audio') {
            if (!testimonialFileUrl) {
                return res.status(400).json({
                    success: false,
                    message: `${format} file is required`
                });
            }
        }

        // Check if this email has already completed the task
        const existingTask = await prisma.userCompletedTask.findUnique({
            where: {
                userEmail_taskId: {
                    userEmail: email,
                    taskId: 'creator_task5'
                }
            }
        });

        if (existingTask) {
            // console.log('❌ Email has already completed Task5:', email);
            return res.status(400).json({
                success: false,
                message: 'This email has already completed Task5',
                data: {
                    email: email,
                    alreadyCompleted: true,
                    completedAt: existingTask.completedAt,
                    taskId: 'creator_task5'
                }
            });
        }

        // Find user/creator and get wallet address
        let user = null;
        let creator = null;
        let walletAddress = null;

        // Try to find user by email first
        user = await prisma.user.findFirst({
            where: { 
                OR: [
                    { email: email },
                    { name: email }
                ]
            }
        });

        // If user not found, try to find creator
        if (!user) {
            creator = await prisma.creator.findFirst({
                where: { 
                    OR: [
                        { email: email },
                        { name: email },
                        { username: email }
                    ]
                }
            });
        }

        // Get wallet address
        if (user && user.walletAddress) {
            walletAddress = user.walletAddress;
        } else if (creator && creator.walletAddress) {
            walletAddress = creator.walletAddress;
        }

        const rewardAmount = process.env.CREATOR_TASK5_REWARD;
        let transactionHash = null;

        // Process blockchain transaction if wallet address exists and SWITCH is enabled
        if (walletAddress && process.env.SWITCH === 'true' && parseFloat(rewardAmount) > 0) {
            // console.log("🚀 Starting Task5 Reward blockchain transaction...");
            try {
                // Update database balance (only if user/creator found)
                if (user) {
                    await prisma.user.update({
                        where: { id: user.id },
                        data: {
                            gllBalance: {
                                increment: parseFloat(rewardAmount)
                            }
                        }
                    });
                    // console.log("✅ Updated user database balance for Task5 reward");
                } else if (creator) {
                    await prisma.creator.update({
                        where: { id: creator.id },
                        data: {
                            gllBalance: {
                                increment: parseFloat(rewardAmount)
                            }
                        }
                    });
                    // console.log("✅ Updated creator database balance for Task5 reward");
                }

                // Send blockchain transaction
                const sendTx = await phoneLinkContract.getGLL(convertToEtherAmount(rewardAmount.toString()), walletAddress);
                await sendTx.wait();
                transactionHash = sendTx.hash;
                // console.log("✅ Task5 Reward GLL transaction completed successfully");
                // console.log("📝 Transaction Hash:", transactionHash);
                
            } catch (blockchainError) {
                console.error("❌ Task5 Reward blockchain transaction failed:", blockchainError.message);
                // Don't crash the endpoint, just log the error
            }
        }

        // Record the task completion
        const taskCompletion = await prisma.userCompletedTask.create({
            data: {
                userEmail: email,
                taskId: 'creator_task5',
                completedAt: new Date()
            }
        });

        // Record the Task5 data
        const task5Data = await prisma.creatorTask5Data.create({
            data: {
                email: email,
                customerName: customerName,
                format: format,
                testimonial: testimonial, // null for video/audio
                testimonialFileUrl: testimonialFileUrl, // null for text
                rewardAmount: parseFloat(rewardAmount),
                transactionHash: transactionHash,
                walletAddress: walletAddress,
                completedAt: new Date()
            }
        });

        // console.log("✅ Task5 completion and data recorded for email:", email);

        const responseData = {
            success: true,
            message: "Task5 reward claimed successfully",
            data: {
                email: email,
                customerName: customerName,
                format: format,
                testimonial: testimonial,
                testimonialFileUrl: testimonialFileUrl,
                rewardAmount: parseFloat(rewardAmount),
                transactionHash: transactionHash,
                walletAddress: walletAddress,
                completedAt: taskCompletion.completedAt,
                taskId: 'creator_task5',
                alreadyCompleted: false
            }
        };

        res.send(encryptJSON(responseData));

    } catch (error) {
        console.error("Error processing Task5 reward:", error);
        res.status(500).json({
            success: false,
            message: 'Failed to process Task5 reward',
            error: error.message
        });
    }
});

// Check if email has already completed Task5
router.post('/check-task5-reward-status', async (req, res) => {
    try {
        const { email } = req.body;

        // console.log('=== CHECK TASK5 REWARD STATUS ===');
        // console.log('Email:', email);

        if (!email) {
            return res.status(400).json({
                success: false,
                message: 'Email is required'
            });
        }

        const existingTask = await prisma.userCompletedTask.findUnique({
            where: {
                userEmail_taskId: {
                    userEmail: email,
                    taskId: 'creator_task5'
                }
            }
        });

        if (existingTask) {
            // console.log('✅ Email has already completed Task5:', email);
            return res.json({
                success: true,
                message: "Task5 already completed",
                data: {
                    email: email,
                    alreadyCompleted: true,
                    completedAt: existingTask.completedAt,
                    taskId: 'creator_task5',
                    rewardAmount: process.env.CREATOR_TASK5_REWARD
                }
            });
        } else {
            // console.log('❌ Email has not completed Task5 yet:', email);
            return res.json({
                success: true,
                message: "Task5 not completed yet",
                data: {
                    email: email,
                    alreadyCompleted: false,
                    taskId: 'creator_task5',
                    rewardAmount: process.env.CREATOR_TASK5_REWARD
                }
            });
        }

    } catch (error) {
        console.error("Error checking Task5 reward status:", error);
        res.status(500).json({
            success: false,
            message: 'Failed to check Task5 reward status',
            error: error.message
        });
    }
});


router.post('/register-creator', async (req, res) => {
    try {
        const {
            name,
            username,
            email,
            phone,
            nationality,
            profilePicture,
            passion,
            existingOnlineStoreLink,
            paymentPreference,
            instagramId,
            instagramUsername,
            terms,
            apiKey,
            aboutMe,
            businessDescription,
            businessPhotos,
            businessVideo,
            connectedSocials,
            creatorName,
            firstName,
            lastName,
            customCategory,
            customWorkType,
            hasBrandColors,
            hasLogo,
            selectedCategories,
            selectedWorkTypes,
            userType,
            userData,
            platform,
            connectedAt,
            logoUrl
        } = req.body;

        // Use creatorName as username if provided, otherwise fall back to username
        const finalUsername = creatorName || username;
        
        // Use logoUrl as profilePicture if provided, otherwise fall back to profilePicture
        const finalProfilePicture = logoUrl || profilePicture;

        // Log all data received from frontend
        // console.log('=== CREATOR REGISTER DEBUG ===');
        // console.log('Received data:', {
        //     name,
        //     email,
        //     aboutMe: aboutMe || 'NOT PROVIDED',
        //     businessDescription: businessDescription || 'NOT PROVIDED',
        //     businessPhotos: businessPhotos ? `Array with ${businessPhotos.length} items: ${JSON.stringify(businessPhotos)}` : 'NOT PROVIDED',
        //     businessVideo: businessVideo ? `${Array.isArray(businessVideo) ? 'Array' : 'String'} with value: ${JSON.stringify(businessVideo)}` : 'NOT PROVIDED'
        // });

        if (!email) {
            return res.status(400).json({ error: "Email is required" });
        }
        
        // Find the temporary creator record
        const tempCreator = await prisma.creator.findUnique({
            where: { email }
        });

        // console.log('Existing creator data:', {
        //     email: tempCreator?.email,
        //     aboutMe: tempCreator?.aboutMe || 'NOT SET',
        //     description: tempCreator?.description || 'NOT SET',
        //     userPhotos: tempCreator?.userPhotos || 'NOT SET',
        //     userVideos: tempCreator?.userVideos || 'NOT SET'
        // });

        if (!tempCreator) {
            return res.status(400).json({ error: "Email not found. Please request verification first." });
        }
        
        // Update the creator with complete registration information
        // Set GLL balance to 100.0 only when all steps are completed
        const updatedCreator = await prisma.creator.update({
            where: { id: tempCreator.id },
            data: {
                name: name || tempCreator.name,
                username: finalUsername || tempCreator.username,
                phone: phone || tempCreator.phone,
                nationality: nationality || tempCreator.nationality,
                profilePicture: finalProfilePicture || tempCreator.profilePicture,
                passion: passion || tempCreator.passion || "",
                existingOnlineStoreLink: existingOnlineStoreLink || tempCreator.existingOnlineStoreLink || "",
                paymentPreference: paymentPreference || tempCreator.paymentPreference || "",
                instagramId: instagramId || tempCreator.instagramId,
                instagramUsername: instagramUsername || tempCreator.instagramUsername,
                terms: terms !== undefined ? terms : tempCreator.terms,
                apiKey: apiKey || tempCreator.apiKey,
                aboutMe: aboutMe ? aboutMe.trim() : tempCreator.aboutMe || '', // Add aboutMe field
                userPhotos: businessPhotos || tempCreator.userPhotos || [],
                userVideos: businessVideo ? (Array.isArray(businessVideo) ? businessVideo : [businessVideo]) : (tempCreator.userVideos || []),
                // New fields
                firstName: firstName || tempCreator.firstName || null,
                lastName: lastName || tempCreator.lastName || null,
                customCategory: customCategory || tempCreator.customCategory || null,
                customWorkType: customWorkType || tempCreator.customWorkType || null,
                hasBrandColors: typeof hasBrandColors === 'boolean' ? hasBrandColors : (tempCreator.hasBrandColors ?? false),
                hasLogo: typeof hasLogo === 'boolean' ? hasLogo : (tempCreator.hasLogo ?? false),
                selectedCategories: Array.isArray(selectedCategories) ? selectedCategories : (tempCreator.selectedCategories || []),
                selectedWorkTypes: Array.isArray(selectedWorkTypes) ? selectedWorkTypes : (tempCreator.selectedWorkTypes || []),
                userType: userType || tempCreator.userType || "creator",
                connectedSocials: connectedSocials ? {
                    platform: platform || null,
                    connectedAt: connectedAt || new Date().toISOString(),
                    list: Array.isArray(connectedSocials) ? connectedSocials : [],
                    userData: userData || null
                } : tempCreator.connectedSocials,
                // Set GLL balance to 100.0 upon successful completion of all steps
                gllBalance: {
                    increment: parseFloat(process.env.REGISTER_REWARD)
                },
                isRegistrationComplete: true,
                isKycComplete: true,
                kycCompletedAt: new Date()
            }
        });

        // console.log('Final creator data saved:', {
        //     email: updatedCreator.email,
        //     aboutMe: updatedCreator.aboutMe,
        //     description: updatedCreator.description,
        //     userPhotos: updatedCreator.userPhotos,
        //     userVideos: updatedCreator.userVideos
        // });
        // console.log('=== END CREATOR DEBUG ===');

        /** Code to send GLL to email wallet *******/
        
        amount = process.env.REGISTER_REWARD
        if(process.env.SWITCH === 'true'){
            try {
                // Get wallet address for creator
                const creatorWalletAddress = await getCreatorWalletAddress(tempCreator.email);
                
                if (!creatorWalletAddress) {
                    // console.log("⚠️ Creator registration skipped blockchain transaction - no wallet address found for email:", tempCreator.email);
                } else {
                    const sendTx = await phoneLinkContract.getGLL(convertToEtherAmount(amount.toString()), creatorWalletAddress);
                    await sendTx.wait();
                    // console.log("✅ Creator registration GLL transaction completed for wallet:", creatorWalletAddress);
                }
            } catch (blockchainError) {
                console.error("❌ Creator registration blockchain transaction failed:", blockchainError.message);
                // Don't crash the endpoint, just log the error
            }
        }
        
        // await syncGLLBalance(email);
        /** Code to get GLL balance from email wallet ***** */
        // console.log("About to get balance for email:", email);
        // const myBalance = await getMyBalance(email);
        // console.log("My Balance:", myBalance);
        // console.log("Balance retrieved successfully");
        /** *********** */

        

        // console.log(`Creator registration completed. Synced GLL balance: ${updatedCreator.gllBalance}`);
        
        const responseData = {
            message: "Registration completed successfully."
        };
        res.send(encryptJSON(responseData));
        
    } catch (error) {
        // console.log("Error completing registration:", error);
        res.status(500).json({ error: error.message });
    }
});

// AWS bucket code for uploading files to S3
router.post('/uploads', uploadLimiter, upload.single('file'), async (req, res) => {

    
    let documentUrl = null;
    try {
        // console.log("Request body:", req.body);
        const { file } = req.body;
        // console.log("File:", file);


        if (req.file) {
            // Validate file path for security
            const validatedFilePath = validateFilePath(req.file.path);
            const fileContent = fs.readFileSync(validatedFilePath);
            const params = {
                Bucket: process.env.AWS_BUCKET_NAME,
                Key: `documents/${Date.now()}-${req.file.originalname}`,
                Body: fileContent,
                ContentType: req.file.mimetype,
                // ACL: 'public-read'
            };

            const uploadResult = await s3.upload(params).promise();
            documentUrl = uploadResult.Location;

            // Delete the temporary file
            fs.unlinkSync(validatedFilePath);
        }

        const responseData = {
            message: "File uploaded successfully",
            url: documentUrl
        };
        res.send(encryptJSON(responseData));

    }
    catch (error) {
        // console.log("Error uploading file:", error);
        const errorResponse = {
            error: error.message || "Error uploading file"
        };
        res.status(500).send(encryptJSON(errorResponse));
    }
})

// Helper function to get user by ID or email
async function getUserByIdOrEmail(userId, email) {
    let user = null;
    let userEmail = null;

    // If userId is provided and looks like a valid ObjectId, try to find the user by ID
    if (userId && /^[0-9a-fA-F]{24}$/.test(userId)) {
        user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                name: true,
                gllBalance: true,
                walletAddress: true
            }
        });
        
        // If user found by ID, use email from database
        if (user) {
            userEmail = user.email;
            // console.log("User found by ID. Using email from database:", userEmail);
        }
    }
    
    // If user not found by ID but email is provided, try to find by email
    if (!user && email) {
        user = await prisma.user.findUnique({
            where: { email },
            select: {
                id: true,
                email: true,
                name: true,
                gllBalance: true,
                walletAddress: true
            }
        });
    }
    
    return { user, userEmail };
}

// Save-Data From Reward Card1
router.post('/save-reward-card1', upload.single('document'), async (req, res) => {
    try {
        // console.log("Request body:", req.body);
        const { 
            companyName, 
            financialYear, 
            documentType, 
            notes, 
            userId, 
            email 
        } = req.body;
        
        let documentUrl = null;

        // Get user and email information
        const { user, userEmail } = await getUserByIdOrEmail(userId, email);
        
        // Get actual user info including email
        const userInfo = user || { email: email };

        // Make sure uploads directory exists
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        if (req.file) {
            const fileContent = fs.readFileSync(req.file.path);
            const params = {
                Bucket: process.env.AWS_BUCKET_NAME,
                Key: `documents/${Date.now()}-${req.file.originalname}`,
                Body: fileContent,
                ContentType: req.file.mimetype,
                // ACL: 'public-read'
            };

            const uploadResult = await s3.upload(params).promise();
            documentUrl = uploadResult.Location;

            // Delete the temporary file - handle missing file gracefully
            try {
                if (fs.existsSync(req.file.path)) {
                    fs.unlinkSync(req.file.path);
                }
            } catch (unlinkError) {
                // console.log("Warning: Could not delete temporary file:", unlinkError);
            }
        }

        const reward = await prisma.rewards.create({
            data: {
                companyName: companyName || "",
                financialYear: financialYear || "",
                documentType: documentType || "",
                document: documentUrl, // Store the S3 URL instead of the file
                notes: notes || "",
                // userEmail: userInfo.email, // Always use the email from userInfo
                ...(user && { user: { connect: { id: user.id } } })
            }
        });
        
        // console.log("Data saved with document URL:", documentUrl);
        // console.log("User info email:", userInfo.email);
        
        // If user exists, update GLL balance
        if (user) {
            await prisma.user.update({
                where: { id: user.id },
                data: {
                    gllBalance: {
                        increment: parseFloat(process.env.CARD1_REWARD)  // Add 100 GLL Ions to the user's balance as reward
                    }
                }
            });

             /** Code to send GLL to email wallet *******/
        
        amount = process.env.CARD1_REWARD
        if(process.env.SWITCH === 'true'){
            try {
                const sendTx = await phoneLinkContract.getGLL(convertToEtherAmount(amount.toString()), user.walletAddress);
                await sendTx.wait();
                // console.log("✅ Card 1 GLL transaction completed");
            } catch (blockchainError) {
                console.error("❌ Card 1 blockchain transaction failed:", blockchainError.message);
                // Don't crash the endpoint, just log the error
            }
        }

        // await syncGLLBalance(email);
        /** Code to get GLL balance from email wallet ***** */
        // console.log("About to get balance for email:", email);
        // const myBalance = await getMyBalance(email);
        // console.log("My Balance:", myBalance);
        // console.log("Balance retrieved successfully");
        /** *********** */
        }
        
        const responseData = {
            message: "Data saved successfully",
            documentUrl,
            rewardId: reward.id,
            userEmail: reward.userEmail,
            user: user
        };
        res.send(encryptJSON(responseData));
    } catch (error) {
        // console.log("Error saving data:", error);
        // Clean up temporary file if it exists and there was an error
        try {
            if (req.file && req.file.path && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
        } catch (unlinkError) {
            // console.log("Warning: Could not delete temporary file:", unlinkError);
        }
        res.status(500).json({ error: error.message });
    }
});

// Save data from Reward Card2 - Store Connection
router.post('/save-reward-card2', upload.none(), async (req, res) => {
    try {
        // console.log("Request body:", req.body);
        const { 
            platform, 
            storeUrl, 
            storeId, 
            consented, 
            rewardId, 
            userId, 
            email 
        } = req.body;
        
        // Validate required fields
        if (!platform || !storeUrl || consented !== 'true') {
            return res.status(400).json({ 
                error: "Missing required fields. Platform, store URL, and consent are required." 
            });
        }

        // Get user and email
        const { user, userEmail } = await getUserByIdOrEmail(userId, email);
        
        // Get actual user info including email
        const userInfo = user || { email: email };

        let reward;
        
        // If rewardId is provided, update existing reward
        if (rewardId) {
            reward = await prisma.rewards.update({
                where: {
                    id: rewardId
                },
                data: {
                    platform: platform || "",
                    storeUrl: storeUrl || "",
                    storeId: storeId || null,
                    consented: consented === 'true',
                    // userEmail: userInfo.email // Update email from userInfo
                    ...(user && { user: { connect: { id: user.id } } })
                }
            });
        } else {
            // Otherwise create a new reward
            reward = await prisma.rewards.create({
                data: {
                    platform: platform || "",
                    storeUrl: storeUrl || "",
                    storeId: storeId || null,
                    consented: consented === 'true',
                    // userEmail: userInfo.email, // Use email from userInfo
                    ...(user && { user: { connect: { id: user.id } } })
                }
            });
        }
        
        // console.log("Store connection saved:", reward);
        
        // If user exists, update GLL balance
        if (user) {
            await prisma.user.update({
                where: { id: user.id },
                data: {
                    gllBalance: {
                        increment: parseFloat(process.env.CARD2_REWARD) // Add 500 GLL Ions to the user's balance as reward
                    }
                }
            });

             /** Code to send GLL to email wallet *******/
        
        amount = process.env.CARD2_REWARD
        if(process.env.SWITCH === 'true'){
            try {
                const sendTx = await phoneLinkContract.getGLL(convertToEtherAmount(amount.toString()), user.walletAddress);
                await sendTx.wait();
                // console.log("✅ Card 2 GLL transaction completed");
            } catch (blockchainError) {
                console.error("❌ Card 2 blockchain transaction failed:", blockchainError.message);
                // Don't crash the endpoint, just log the error
            }
        }

        // await syncGLLBalance(email);
        /** Code to get GLL balance from email wallet ***** */
        // console.log("About to get balance for email:", email);
        // const myBalance = await getMyBalance(email);
        // console.log("My Balance:", myBalance);
        // console.log("Balance retrieved successfully");
        /** *********** */
        }
        
        // Create response object
        const responseData = {
            message: "Store connected successfully",
            reward: "500 GLL Ions",
            gllBalance: user ? user.gllBalance : 0,
            rewardId: reward.id,
            userEmail: reward.userEmail,
            user: user
        };

        // Send encrypted response
        res.send(encryptJSON(responseData));
    } catch (error) {
        // console.log("Error connecting store:", error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint to delete all users (Use with extreme caution!)
router.delete('/all-users', async (req, res) => {
    try {
        // Verify a specific query parameter or header for safety
        // Example: require a specific header like 'X-Confirm-Delete: YES'
        // if (req.headers['x-confirm-delete'] !== 'YES') {
        //     return res.status(403).json({ error: "Deletion not confirmed. Missing or invalid confirmation header." });
        // }
        const deleteResult = await prisma.user.deleteMany({});

        res.status(200).json({
            message: `Successfully deleted ${deleteResult.count} users.`,
            count: deleteResult.count
        });
    } catch (error) {
        console.error("Error deleting all users:", error);
        res.status(500).json({ error: "Something went wrong while deleting users.", details: error.message });
    }
});

// Get user data by email
router.post('/user-by-email', async (req, res) => {
    try {
        
        const { email } = req.body;
        

        if (!email) {
            return res.status(400).json({ error: "Email is required" });
        }

        const user = await prisma.user.findUnique({
            where: { email }
        });

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        
        // res.send(user);
        res.send(encryptJSON(user));
        // console.log("user.gllBalance", user.gllBalance)
    } catch (error) {
        console.error("Error fetching user data:", error);
        res.status(500).json({
            success: false,
            error: "Something went wrong while fetching user data",
            details: error.message
        });
    }
});

// Save data from Reward Card3 - Certificate Upload
router.post('/save-reward-card3', upload.single('certificate'), async (req, res) => {
    try {
        // console.log("Request body:", req.body);
        const { 
            certificateType, 
            expiryDate, 
            issueAuthority, 
            notes, 
            userId, 
            email 
        } = req.body;
        
        let certificateUrl = null;

        // Validate required fields
        if (!certificateType || !expiryDate || !issueAuthority) {
            return res.status(400).json({ 
                error: "Missing required fields. Certificate type, expiry date, and issuing authority are required." 
            });
        }

        if (!req.file) {
            return res.status(400).json({ error: "Certificate file is required" });
        }

        // Get user and email information
        const { user, userEmail } = await getUserByIdOrEmail(userId, email);
        
        // Get actual user info including email
        const userInfo = user || { email: email };

        // Make sure uploads directory exists
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        // Upload certificate to S3
        const fileContent = fs.readFileSync(req.file.path);
        const params = {
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: `certificates/${Date.now()}-${req.file.originalname}`,
            Body: fileContent,
            ContentType: req.file.mimetype,
        };

        const uploadResult = await s3.upload(params).promise();
        certificateUrl = uploadResult.Location;

        // Delete the temporary file - handle missing file gracefully
        try {
            if (fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
        } catch (unlinkError) {
            // console.log("Warning: Could not delete temporary file:", unlinkError);
        }

        // Create certificate record in database
        const reward = await prisma.rewards.create({
            data: {
                certificateType: certificateType || "",
                certificateUrl: certificateUrl || "",
                expiryDate: expiryDate ? new Date(expiryDate) : null,
                issueAuthority: issueAuthority || "",
                notes: notes || "",
                ...(user && { user: { connect: { id: user.id } } })
            }
        });
        
        // console.log("Certificate saved:", reward);
        
        // If user exists, update GLL balance
        if (user) {
            await prisma.user.update({
                where: { id: user.id },
                data: {
                    gllBalance: {
                        increment: parseFloat(process.env.CARD3_REWARD) // Add 800 GLL Ions to the user's balance as reward
                    }
                }
            });

             /** Code to send GLL to email wallet *******/
        
        amount = process.env.CARD3_REWARD
        if(process.env.SWITCH === 'true'){
            try {
                const sendTx = await phoneLinkContract.getGLL(convertToEtherAmount(amount.toString()), user.walletAddress);
                await sendTx.wait();
                // console.log("✅ Card 3 GLL transaction completed");
            } catch (blockchainError) {
                console.error("❌ Card 3 blockchain transaction failed:", blockchainError.message);
                // Don't crash the endpoint, just log the error
            }
        }

        // await syncGLLBalance(email);
        /** Code to get GLL balance from email wallet ***** */
        // console.log("About to get balance for email:", email);
        // const myBalance = await getMyBalance(email);
        // console.log("My Balance:", myBalance);
        // console.log("Balance retrieved successfully");
        /** *********** */
        }
        
        // Create response object
        const responseData = {
            message: "Certificate uploaded successfully",
            reward: "800 GLL Ions",
            rewardId: reward.id,
            certificateUrl: certificateUrl,
            userEmail: userInfo.email,
            user: user
        };

        // Send encrypted response
        res.send(encryptJSON(responseData));
    } catch (error) {
        // console.log("Error uploading certificate:", error);
        // Clean up temporary file if it exists and there was an error
        try {
            if (req.file && req.file.path && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
        } catch (unlinkError) {
            // console.log("Warning: Could not delete temporary file:", unlinkError);
        }
        res.status(500).json({ error: error.message });
    }
});

// GSTIN Verification endpoint
router.post('/verify-gstin', async (req, res) => {
    const { gstin } = req.body;

    if (!gstin) {
        return res.status(400).json({ error: "GSTIN is required" });
    }

    try {
        const response = await axios.post(
            'https://api.bulkpe.in/client/verifyGstin',
            { gstin },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.BULKPE_API_KEY}` // Store your API key in .env
                }
            }
        );

        const responseData = {
            message: "GSTIN verified successfully",
            data: response.data
        };
        res.send(encryptJSON(responseData));

    } catch (error) {
        console.error("Error verifying GSTIN:", error.response?.data || error.message);
        return res.status(500).json({
            error: "Failed to verify GSTIN",
            details: error.response?.data || error.message
        });
    }
});

// GST Verification route
router.post('/gst-verify', async (req, res) => {
    try {
        const { gstNumber } = req.body;

        if (!gstNumber) {
            return res.send(encryptJSON({ 
                success: false,
                message: "GST number is required" 
            }));
        }

        // Validate GST number format (basic validation)
        const gstRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
        if (!gstRegex.test(gstNumber)) {
            return res.send(encryptJSON({ 
                success: false,
                message: "Invalid GST number format" 
            }));
        }

        // Get GST verification URL from environment or use fallback
        const gstVerifyUrl = process.env.GST_VERIFY_URL;

        // Make request to GST verification service
        const response = await axios.get(`${gstVerifyUrl}/${gstNumber}`, {
            timeout: 10000, // 10 second timeout
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        // Check if response is valid
        if (!response.data) {
            throw new Error('Invalid response from GST verification service');
        }

        // Prepare success response
        const responseData = {
            success: true,
            data: response.data,
            message: "GST verification completed successfully"
        };

        // Send encrypted response
        res.send(encryptJSON(responseData));

    } catch (error) {
        console.error('GST Verification Error:', error);
        
        // Handle specific error cases
        if (error.response?.data) {
            // API returned an error response
            return res.status(error.response.status || 400).send(encryptJSON({
                success: false,
                message: error.response.data.message || "GST verification failed",
                error: error.response.data
            }));
        }

        if (error.code === 'ECONNABORTED') {
            // Timeout error
            return res.status(408).send(encryptJSON({
                success: false,
                message: "GST verification service timed out",
                error: "Request timeout"
            }));
        }

        if (error.code === 'ENOTFOUND' || error.code === 'ERR_BAD_REQUEST') {
            // Service not available
            return res.status(503).send(encryptJSON({
                success: false,
                message: "GST verification service is currently unavailable",
                error: "Service unavailable"
            }));
        }

        // Generic error response
        res.status(500).send(encryptJSON({
            success: false,
            message: "Error verifying GST number",
            error: error.message
        }));
    }
});

// User Task Completion Endpoints
// Check if a user has completed a specific task
router.get('/check-task-completion', async (req, res) => {
    try {
        const { email, taskId, task } = req.query;
        
        // Use taskId if provided, otherwise fall back to task parameter
        const actualTaskId = taskId || task;

        if (!email || !actualTaskId) {
            return res.status(400).json({ error: "Email and task identifier are required" });
        }

        const completedTask = await prisma.userCompletedTask.findUnique({
            where: {
                userEmail_taskId: {
                    userEmail: email,
                    taskId: actualTaskId
                }
            }
        });

        const responseData = {
            completed: !!completedTask,
            completedAt: completedTask ? completedTask.completedAt : null
        };
        res.send(encryptJSON(responseData));
    } catch (error) {
        console.error("Error checking task completion:", error);
        res.status(500).json({ error: error.message });
    }
});

// Mark a task as completed for a user
router.post('/mark-task-completed', async (req, res) => {
    try {
        // console.log("Received mark-task-completed request:", req.body);
        const { email, taskId, task } = req.body;
        
        // Use taskId if provided, otherwise fall back to task parameter
        const actualTaskId = taskId || task;

        // console.log("Processing task completion for:", { email, actualTaskId });

        if (!email || !actualTaskId) {
            // console.log("Missing required fields:", { email, actualTaskId });
            return res.status(400).json({ error: "Email and task identifier are required" });
        }

        // Check if user exists
        const user = await prisma.user.findUnique({
            where: { email }
        });

        if (!user) {
            // console.log("User not found for email:", email);
            return res.status(404).json({ error: "User not found" });
        }

        // console.log("Found user:", user.id);

        // Create or update task completion record
        const completedTask = await prisma.userCompletedTask.upsert({
            where: {
                userEmail_taskId: {
                    userEmail: email,
                    taskId: actualTaskId
                }
            },
            update: {
                completedAt: new Date()
            },
            create: {
                userEmail: email,
                taskId: actualTaskId,
                completedAt: new Date()
            }
        });

        // console.log("Task marked as completed:", completedTask);

        const responseData = {
            message: "Task marked as completed",
            taskId: completedTask.taskId,
            completedAt: completedTask.completedAt
        };
        res.send(encryptJSON(responseData));
    } catch (error) {
        console.error("Error marking task as completed:", error);
        res.status(500).json({ error: error.message });
    }
});

// Get all completed tasks for a user
router.get('/get-completed-tasks', async (req, res) => {
    try {
        const { email } = req.query;

        if (!email) {
            return res.status(400).json({ error: "Email is required" });
        }

        const completedTasks = await prisma.userCompletedTask.findMany({
            where: {
                userEmail: email
            },
            orderBy: {
                completedAt: 'desc'
            }
        });

        const responseData = {
            completedTasks: completedTasks.map(task => ({
                taskId: task.taskId,
                completedAt: task.completedAt
            }))
        };
        res.send(encryptJSON(responseData));
    } catch (error) {
        console.error("Error fetching completed tasks:", error);
        res.status(500).json({ error: error.message });
    }
});

// Save data from Reward Card4 - MSME Registration
router.post('/save-reward-card4', upload.single('certificate'), async (req, res) => {
    try {
        // console.log("Request body:", req.body);
        const { businessName, gstin, businessType, city, state, certificateUrl, userId, email } = req.body;
        let msmeCertificateUrl = certificateUrl || null;

        // Validate required fields
        if (!businessName || !gstin || !businessType || !city || !state) {
            return res.status(400).json({ 
                error: "Missing required fields. Business details are required." 
            });
        }

        // Get user and email information
        const { user, userEmail } = await getUserByIdOrEmail(userId, email);
        
        // Get actual user info including email
        const userInfo = user || { email: email };

        // Make sure uploads directory exists
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        // If certificate file was uploaded directly (not pre-uploaded)
        if (req.file) {
            const fileContent = fs.readFileSync(req.file.path);
            const params = {
                Bucket: process.env.AWS_BUCKET_NAME,
                Key: `msme-certificates-reward-card/${Date.now()}-${req.file.originalname}`,
                Body: fileContent,
                ContentType: req.file.mimetype,
            };

            const uploadResult = await s3.upload(params).promise();
            msmeCertificateUrl = uploadResult.Location;

            // Delete the temporary file - handle missing file gracefully
            try {
                if (fs.existsSync(req.file.path)) {
                    fs.unlinkSync(req.file.path);
                }
            } catch (unlinkError) {
                // console.log("Warning: Could not delete temporary file:", unlinkError);
            }
        }

        // Check if we have a certificate URL
        if (!msmeCertificateUrl) {
            return res.status(400).json({ error: "MSME Certificate is required" });
        }

        // Create MSME registration record in database using Rewards model
        const reward = await prisma.rewards.create({
            data: {
                businessName,
                gstin,
                businessType,
                city,
                state,
                certificate: msmeCertificateUrl,
                userEmail: userInfo.email,
                ...(user && { user: { connect: { id: user.id } } })
            }
        });
        
        // console.log("MSME Registration saved:", reward);
        
        // If user exists, update GLL balance
        if (user) {
            // console.log('Current GLL Balance:', user.gllBalance);
            // console.log('CARD4_REWARD value:', process.env.CARD4_REWARD);
            
            const rewardAmount = process.env.CARD4_REWARD ? parseFloat(process.env.CARD4_REWARD) : 100;
            // console.log('Reward amount to be added:', rewardAmount);

            const updatedUser = await prisma.user.update({
                where: { id: user.id },
                data: {
                    gllBalance: {
                        increment: rewardAmount // Add 100 GLL Ions to the user's balance as reward
                    }
                }
            });

             /** Code to send GLL to email wallet *******/
        
        amount = process.env.CARD4_REWARD
        if(process.env.SWITCH === 'true'){
            try {
                const sendTx = await phoneLinkContract.getGLL(convertToEtherAmount(amount.toString()), user.walletAddress);
                await sendTx.wait();
                // console.log("✅ Card 4 GLL transaction completed");
            } catch (blockchainError) {
                console.error("❌ Card 4 blockchain transaction failed:", blockchainError.message);
                // Don't crash the endpoint, just log the error
            }
        }

        // await syncGLLBalance(email);
        /** Code to get GLL balance from email wallet ***** */
        // console.log("About to get balance for email:", email);
        // const myBalance = await getMyBalance(email);
        // console.log("My Balance:", myBalance);
        // console.log("Balance retrieved successfully");
        /** *********** */
            }
        
        // Create response object
        const responseData = {
            message: "MSME Registration completed successfully",
            reward: "100 GLL Ions",
            registrationId: reward.id,
            certificateUrl: msmeCertificateUrl,
            userEmail: userInfo.email,
            user: user
        };

        // Send encrypted response
        res.send(encryptJSON(responseData));
    } catch (error) {
        // console.log("Error completing MSME registration:", error);
        // Clean up temporary file if it exists and there was an error
        try {
            if (req.file && req.file.path && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
        } catch (unlinkError) {
            // console.log("Warning: Could not delete temporary file:", unlinkError);
        }
        res.status(500).json({ error: error.message });
    }
});


router.post('/ifscCode-verify', async (req, res) => {
    try {
        const { ifscCode } = req.body;

        if (!ifscCode) {
            return res.send(encryptJSON({ 
                success: false,
                message: "IFSC code is required" 
            }));
        }

        // Validate IFSC code format (basic validation)
        const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
        if (!ifscRegex.test(ifscCode)) {
            return res.send(encryptJSON({ 
                success: false,
                message: "Invalid IFSC code format" 
            }));
        }

        // Make request to Razorpay IFSC API
        const response = await axios.get(`${process.env.IFSC_VERIFY_URL}/${ifscCode}`, {
            timeout: 10000, // 10 second timeout
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        // Check if response is valid
        if (!response.data) {
            throw new Error('Invalid response from IFSC verification service');
        }

        // Prepare success response
        const responseData = {
            success: true,
            data: response.data,
            message: "IFSC code verification completed successfully"
        };

        // Send encrypted response
        res.send(encryptJSON(responseData));

    } catch (error) {
        console.error('IFSC Verification Error:', error);
        
        // Handle specific error cases
        if (error.response?.status === 404) {
            return res.status(404).send(encryptJSON({
                success: false,
                message: "IFSC code not found",
                error: "Invalid IFSC code"
            }));
        }

        if (error.code === 'ECONNABORTED') {
            return res.status(408).send(encryptJSON({
                success: false,
                message: "IFSC verification service timed out",
                error: "Request timeout"
            }));
        }

        if (error.code === 'ENOTFOUND' || error.code === 'ERR_BAD_REQUEST') {
            return res.status(503).send(encryptJSON({
                success: false,
                message: "IFSC verification service is currently unavailable",
                error: "Service unavailable"
            }));
        }

        // Generic error response
        res.status(500).send(encryptJSON({
            success: false,
            message: "Error verifying IFSC code",
            error: error.message
        }));
    }
});


router.put('/creator-profile/:email', async (req, res) => {
    try {
        const { email } = req.params;
        const { aboutMe, passion, existingOnlineStoreLink, paymentPreference, creatorName, firstName, lastName, customCategory, customWorkType, hasBrandColors, hasLogo, selectedCategories, selectedWorkTypes, userType, connectedSocials, userData, platform, connectedAt, logoUrl } = req.body;
        
        // Log all data received from frontend
        // console.log('=== CREATOR PROFILE UPDATE - FRONTEND DATA ===');
        // console.log('Email from params:', email);
        // console.log('Received data:', {
        //     aboutMe,
        //     passion,
        //     existingOnlineStoreLink,
        //     paymentPreference,
        //     creatorName,
        //     firstName,
        //     lastName,
        //     customCategory,
        //     customWorkType,
        //     hasBrandColors,
        //     hasLogo,
        //     selectedCategories,
        //     selectedWorkTypes,
        //     userType,
        //     connectedSocials,
        //     userData,
        //     platform,
        //     connectedAt,
        //     logoUrl
        // });
        // console.log('=== END FRONTEND DATA ===');
        
        // Decode URL-encoded email
        const decodedEmail = decodeURIComponent(email);
        
        // console.log('Updating creator profile for email:', decodedEmail);
        
        // Validation
        if (!decodedEmail) {
            return res.status(400).json({ 
                success: false,
                message: "Email is required" 
            });
        }

        // Check if creator exists
        const existingCreator = await prisma.creator.findUnique({
            where: { email: decodedEmail }
        });

        if (!existingCreator) {
            return res.status(404).json({ 
                success: false,
                message: "User not found" 
            });
        }

        // Prepare update data
        const updateData = {};
        
        if (aboutMe !== undefined && aboutMe !== null) {
            if (typeof aboutMe !== 'string') {
                return res.status(400).json({ 
                    success: false,
                    message: "aboutMe must be a string" 
                });
            }
            if (aboutMe.length > 500) {
                return res.status(400).json({ 
                    success: false,
                    message: "About me cannot exceed 500 characters" 
                });
            }
            updateData.aboutMe = aboutMe.trim();
        }
        
        if (passion !== undefined) {
            updateData.passion = passion.trim();
        }
        
        if (existingOnlineStoreLink !== undefined) {
            updateData.existingOnlineStoreLink = existingOnlineStoreLink.trim();
        }
        
        if (paymentPreference !== undefined) {
            updateData.paymentPreference = paymentPreference.trim();
        }

        if (creatorName !== undefined) updateData.username = creatorName;
        if (logoUrl !== undefined) updateData.profilePicture = logoUrl;
        if (firstName !== undefined) updateData.firstName = firstName;
        if (lastName !== undefined) updateData.lastName = lastName;
        if (customCategory !== undefined) updateData.customCategory = customCategory;
        if (customWorkType !== undefined) updateData.customWorkType = customWorkType;
        if (typeof hasBrandColors === 'boolean') updateData.hasBrandColors = hasBrandColors;
        if (typeof hasLogo === 'boolean') updateData.hasLogo = hasLogo;
        if (Array.isArray(selectedCategories)) updateData.selectedCategories = selectedCategories;
        if (Array.isArray(selectedWorkTypes)) updateData.selectedWorkTypes = selectedWorkTypes;
        if (userType !== undefined) updateData.userType = userType;
        if (connectedSocials !== undefined) {
            updateData.connectedSocials = {
                platform: platform || null,
                connectedAt: connectedAt || new Date().toISOString(),
                list: Array.isArray(connectedSocials) ? connectedSocials : [],
                userData: userData || null
            };
        }

        // Update the creator profile
        const updatedCreator = await prisma.creator.update({
            where: { email: decodedEmail },
            data: updateData
        });

        // Format response to match frontend expectations
        const profileData = {
            email: updatedCreator.email,
            name: updatedCreator.name || 'User',
            username: updatedCreator.username || 'user',
            instagramUsername: updatedCreator.instagramUsername || '',
            profilePicture: updatedCreator.profilePicture || '',
            aboutMe: updatedCreator.aboutMe || '',
            passion: updatedCreator.passion || '',
            existingOnlineStoreLink: updatedCreator.existingOnlineStoreLink || '',
            paymentPreference: updatedCreator.paymentPreference || '',
            phone: updatedCreator.phone || '',
            nationality: updatedCreator.nationality || '',
            instagramId: updatedCreator.instagramId || '',
            isKycComplete: updatedCreator.isKycComplete || false,
            kycCompletedAt: updatedCreator.kycCompletedAt || null,
            isRegistrationComplete: updatedCreator.isRegistrationComplete || false,
            registrationTimestamp: updatedCreator.createdAt,
            apiKey: updatedCreator.apiKey || '',
            gllBalance: updatedCreator.gllBalance || 0,
            terms: updatedCreator.terms || false
        };

        // console.log(`Creator profile updated successfully for ${decodedEmail}`);

        const responseData = {
            success: true,
            message: "Creator profile updated successfully",
            data: profileData
        };

        // Send encrypted response
        res.send(encryptJSON(responseData));
    } catch (error) {
        console.error("Error updating creator profile:", error);
        res.status(500).json({
            success: false,
            message: "Something went wrong while updating creator profile",
            error: error.message
        });
    }
});

// GET route for fetching creator profile data
router.get('/creator-profile/:email', async (req, res) => {
    try {
        const { email } = req.params;
        
        // Decode URL-encoded email
        const decodedEmail = decodeURIComponent(email);
        
        // console.log('Fetching creator profile for email:', decodedEmail);
        
        if (!decodedEmail) {
            return res.status(400).json({ 
                success: false,
                message: "Email is required" 
            });
        }

        const creator = await prisma.creator.findUnique({
            where: { email: decodedEmail }
        });

        if (!creator) {
            return res.status(404).json({ 
                success: false,
                message: "User not found" 
            });
        }

        // Check if IFSC code exists to determine KYC completion status
        const hasIfscCode = creator.ifscCode && creator.ifscCode.trim() !== '';
        const isKycComplete = hasIfscCode;

        // Format response to match frontend expectations
        const profileData = {
            email: creator.email,
            name: creator.name || 'User',
            username: creator.username || 'user',
            instagramUsername: creator.instagramUsername || '',
            profilePicture: creator.profilePicture || '',
            aboutMe: creator.aboutMe || '',
            passion: creator.passion || '',
            existingOnlineStoreLink: creator.existingOnlineStoreLink || '',
            paymentPreference: creator.paymentPreference || '',
            phone: creator.phone || '',
            nationality: creator.nationality || '',
            instagramId: creator.instagramId || '',
            isKycComplete: creator.isKycComplete || false,
            kycCompletedAt: creator.kycCompletedAt || null,
            isRegistrationComplete: creator.isRegistrationComplete || false,
            registrationTimestamp: creator.createdAt,
            apiKey: creator.apiKey || '',
            gllBalance: creator.gllBalance || 0,
            terms: creator.terms || false
        };

        // console.log(`Creator profile for ${decodedEmail}:`, {
        //     hasIfscCode,
        //     isKycComplete,
        //     gllBalance: creator.gllBalance
        // });

        // Send encrypted response
        res.send(encryptJSON(profileData));
        
    } catch (error) {
        console.error("Error fetching creator data:", error);
        res.status(500).json({
            success: false,
            message: "Something went wrong while fetching creator data",
            error: error.message
        });
    }
});

// AWS bucket code for uploading user media (photos and videos) to S3
router.post('/upload-user-media', upload.array('media', 8), async (req, res) => {
    let photoUrls = [];
    let videoUrls = [];
    try {
        const { userId, email } = req.body;
        
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: "No media files uploaded" });
        }

        // Process each uploaded file
        for (const file of req.files) {
            const fileContent = fs.readFileSync(file.path);
            let folderName = '';
            let urlArray = null;

            // Determine file type and folder
            if (file.mimetype.startsWith('image/')) {
                folderName = 'user-photos';
                urlArray = photoUrls;
            } else if (file.mimetype.startsWith('video/')) {
                folderName = 'user-videos';
                urlArray = videoUrls;
            } else {
                return res.status(400).json({ 
                    error: `Invalid file type: ${file.originalname}. Only images and videos are allowed.` 
                });
            }

            const params = {
                Bucket: process.env.AWS_BUCKET_NAME,
                Key: `${folderName}/${Date.now()}-${file.originalname}`,
                Body: fileContent,
                ContentType: file.mimetype,
                // ACL: 'public-read'
            };

            const uploadResult = await s3.upload(params).promise();
            urlArray.push(uploadResult.Location);

            // Delete the temporary file
            try {
                if (fs.existsSync(file.path)) {
                    fs.unlinkSync(file.path);
                }
            } catch (unlinkError) {
                // console.log("Warning: Could not delete temporary file:", unlinkError);
            }
        }

        const responseData = {
            message: "Media uploaded successfully",
            photoUrls: photoUrls,
            videoUrls: videoUrls,
            totalCount: photoUrls.length + videoUrls.length
        };
        res.send(encryptJSON(responseData));

    } catch (error) {
        // console.log("Error uploading media:", error);
        
        // Clean up temporary files if they exist and there was an error
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                try {
                    if (fs.existsSync(file.path)) {
                        fs.unlinkSync(file.path);
                    }
                } catch (unlinkError) {
                    // console.log("Warning: Could not delete temporary file:", unlinkError);
                }
            }
        }
        
        const errorResponse = {
            error: error.message || "Error uploading media"
        };
        res.status(500).send(encryptJSON(errorResponse));
    }
});

// Claim route for assigning GLL rewards
router.post('/claim', async (req, res) => {
    try {
        const { walletAddress, email } = req.body;

        // console.log('=== CLAIM ROUTE DEBUG ===');
        // console.log('Received request:', { walletAddress, email });
        // console.log('SWITCH value:', process.env.SWITCH);
        // console.log('REGISTER_REWARD value:', process.env.REGISTER_REWARD);

        // Validate that at least one identifier is provided
        if (!walletAddress && !email) {
            // console.log('Error: No wallet address or email provided');
            return res.status(400).json({ 
                success: false,
                error: "Either wallet address or email is required" 
            });
        }

        // Check if this wallet or email has already claimed airdrop
        let existingClaim = null;
        if (walletAddress) {
            existingClaim = await prisma.airdropClaim.findUnique({
                where: { walletAddress }
            });
        }
        
        if (!existingClaim && email) {
            existingClaim = await prisma.airdropClaim.findUnique({
                where: { email }
            });
        }

        if (existingClaim) {
            // console.log('Duplicate claim attempt detected:', {
            //     walletAddress,
            //     email,
            //     existingClaimDate: existingClaim.claimedAt
            // });
            return res.status(409).json({ 
                success: false,
                error: "Airdrop has already been claimed for this wallet address or email",
                claimedAt: existingClaim.claimedAt,
                previousAmount: existingClaim.rewardAmount
            });
        }

        let user = null;
        let creator = null;

        // Try to find user by email first
        if (email) {
            // console.log('Searching for user by email:', email);
            user = await prisma.user.findUnique({
                where: { email }
            });
            
            if (!user) {
                // console.log('User not found, searching creator table');
                // If not found in user table, try creator table
                creator = await prisma.creator.findUnique({
                    where: { email }
                });
            }
        }

        // If email not found but wallet address provided, try to find by wallet address
        if (!user && !creator && walletAddress) {   
            // console.log('Searching for user by wallet address:', walletAddress);
            user = await prisma.user.findFirst({
                where: { walletAddress }
            });
            
            if (!user) {
                // console.log('User not found, searching creator table by wallet address');
                creator = await prisma.creator.findFirst({
                    where: { walletAddress }
                });
            }
        }

        // If still not found, return error
        if (!user && !creator) {
            // console.log('Error: No user or creator found');
            return res.status(404).json({ 
                success: false,
                error: "User not found with provided email or wallet address" 
            });
        }

        // Read airdrop data from Google Sheets
        const airdropData = await readAirdropData();
        // console.log('Airdrop data loaded with', Object.keys(airdropData).length, 'entries');

        // Determine which record to update and get the wallet address
        let targetRecord = user || creator;
        let targetWalletAddress = targetRecord.walletAddress;
        let targetEmail = targetRecord.email;
        
        // console.log('Target record found:', {
        //     id: targetRecord.id,
        //     email: targetEmail,
        //     walletAddress: targetWalletAddress,
        //     currentGllBalance: targetRecord.gllBalance,
        //     userType: user ? 'user' : 'creator'
        // });

        // Check if user has a wallet address for blockchain transaction
        if (!targetWalletAddress) {
            // console.log('Error: No wallet address configured for user');
            return res.status(400).json({ 
                success: false,
                error: "User does not have a wallet address configured" 
            });
        }

        // Determine reward amount based on Excel data
        let rewardAmount = 0;
        let rewardSource = 'default';
        
        if (targetEmail && airdropData[targetEmail.toLowerCase().trim()]) {
            // User found in Google Sheets - use the amount from Google Sheets
            rewardAmount = airdropData[targetEmail.toLowerCase().trim()];
            rewardSource = 'excel_airdrop';
            // console.log(`User found in airdrop Google Sheets with amount: ${rewardAmount} GLL`);
        } else {
            // User not found in Google Sheets - use default reward amount
            rewardAmount = process.env.REGISTER_REWARD ? parseFloat(process.env.REGISTER_REWARD) : 100;
            rewardSource = 'default_reward';
            // console.log(`User not found in Google Sheets, using default reward: ${rewardAmount} GLL`);
        }

        // console.log('Final reward amount to be added:', rewardAmount, 'from source:', rewardSource);

        // Update GLL balance in the database
        if (user) {
            // console.log('Updating user GLL balance...');
            await prisma.user.update({
                where: { id: user.id },
                data: {
                    gllBalance: {
                        increment: rewardAmount
                    }
                }
            });
            // console.log('User GLL balance updated successfully');
        } else if (creator) {
            // console.log('Updating creator GLL balance...');
            await prisma.creator.update({
                where: { id: creator.id },
                data: {
                    gllBalance: {
                        increment: rewardAmount
                    }
                }
            });
            // console.log('Creator GLL balance updated successfully');
        }

        // Perform blockchain transaction if SWITCH is enabled
        let blockchainSuccess = false;
        let blockchainError = null;

        // console.log('Checking if blockchain transaction should be performed...');
        // console.log('SWITCH === "true":', process.env.SWITCH === 'true');
        
        if (process.env.SWITCH === 'true') {
            // console.log('SWITCH is true, attempting blockchain transaction...');
            // console.log('Target wallet address:', targetWalletAddress);
            // console.log('Reward amount:', rewardAmount);
            // console.log('Converted amount:', convertToEtherAmount(rewardAmount.toString()));
            
            try {
                // console.log('Calling phoneLinkContract.getGLL...');
                const sendTx = await phoneLinkContract.getGLL(
                    convertToEtherAmount(rewardAmount.toString()), 
                    targetWalletAddress
                );
                console.log('📝 Transaction Hash:', sendTx.hash);
                // console.log('Transaction sent, waiting for confirmation...');
                await sendTx.wait();
                blockchainSuccess = true;
                // console.log("✅ Claim GLL transaction completed successfully");
            } catch (blockchainError) {
                blockchainError = blockchainError.message;
                console.error("❌ Claim blockchain transaction failed:", blockchainError);
                console.error("Full error object:", blockchainError);
                // Don't crash the endpoint, just log the error
            }
        }

        // Sync GLL balance between User and Creator tables if both exist
        if (targetEmail) {
            try {
                // console.log('Syncing GLL balance...');
                // Only sync if we updated a user record and there's also a creator record
                if (user) {
                    const creator = await prisma.creator.findUnique({
                        where: { email: targetEmail }
                    });
                    if (creator) {
                        // Update creator's balance to match the updated user's balance
                        await prisma.creator.update({
                            where: { email: targetEmail },
                            data: {
                                gllBalance: targetRecord.gllBalance + rewardAmount
                            }
                        });
                        // console.log('Creator GLL balance synced with user balance');
                    }
                } else if (creator) {
                    const userRecord = await prisma.user.findUnique({
                        where: { email: targetEmail }
                    });
                    if (userRecord) {
                        // Update user's balance to match the updated creator's balance
                        await prisma.user.update({
                            where: { email: targetEmail },
                            data: {
                                gllBalance: targetRecord.gllBalance + rewardAmount
                            }
                        });
                        // console.log('User GLL balance synced with creator balance');
                    }
                }
                // console.log('GLL balance synced successfully');
            } catch (syncError) {
                console.error("Warning: Could not sync GLL balance:", syncError.message);
            }
        }

        // Check blockchain balance directly using tokenContract
        let blockchainBalance = null;
        try {
            // console.log('Checking blockchain balance for wallet:', targetWalletAddress);
            const { formatUnits } = require('ethers');
            const balance = await tokenContract.balanceOf(targetWalletAddress);
            blockchainBalance = formatUnits(balance, 'ether');
            // console.log('Blockchain balance retrieved:', blockchainBalance);
        } catch (balanceError) {
            console.error('Error checking blockchain balance:', balanceError.message);
            blockchainBalance = 'Error retrieving balance';
        }

        
        // Prepare response data
        const responseData = {
            success: true,
            message: "Claim processed successfully",
            rewardAmount: rewardAmount,
            rewardSource: rewardSource,
            gllBalance: targetRecord.gllBalance + rewardAmount,
            blockchainBalance: blockchainBalance,
            walletAddress: targetWalletAddress,
            email: targetEmail,
            blockchainSuccess: blockchainSuccess,
            blockchainError: blockchainError,
            userType: user ? 'user' : 'creator',
            foundInAirdrop: targetEmail && airdropData[targetEmail.toLowerCase().trim()] ? true : false
        };

        // console.log('Final response data:', responseData);
        // console.log('=== END CLAIM DEBUG ===');

        // Create AirdropClaim record to track this claim and prevent duplicates
        try {
            await prisma.airdropClaim.create({
                data: {
                    email: targetEmail,
                    walletAddress: targetWalletAddress,
                    rewardAmount: rewardAmount,
                    rewardSource: rewardSource,
                    foundInAirdrop: targetEmail && airdropData[targetEmail.toLowerCase().trim()] ? true : false,
                    userType: user ? 'user' : 'creator',
                    blockchainSuccess: blockchainSuccess,
                    blockchainTxHash: null, // Could be extracted from blockchain transaction if needed
                    excelRowData: targetEmail && airdropData[targetEmail.toLowerCase().trim()] ? {
                        email: targetEmail,
                        amount: airdropData[targetEmail.toLowerCase().trim()]
                    } : null // Store Google Sheets row data if found
                }
            });
            // console.log('Airdrop claim recorded successfully for:', targetWalletAddress);
        } catch (claimRecordError) {
            console.error('Error recording airdrop claim:', claimRecordError.message);
            // Don't fail the entire request if just recording fails
        }

        // Send encrypted response
        res.send(encryptJSON(responseData));

    } catch (error) {
        console.error("Error processing claim:", error);
        console.error("Full error stack:", error.stack);
        res.status(500).json({
            success: false,
            error: "Something went wrong while processing the claim",
            details: error.message
        });
    }
});

// Get airdrop claim statistics
router.get('/airdrop-stats', async (req, res) => {
    try {
        const totalClaims = await prisma.airdropClaim.count();
        const totalAmountClaimed = await prisma.airdropClaim.aggregate({
            _sum: {
                rewardAmount: true
            }
        });
        
        const claimsBySource = await prisma.airdropClaim.groupBy({
            by: ['rewardSource'],
            _count: {
                rewardSource: true
            },
            _sum: {
                rewardAmount: true
            }
        });

        const claimsByUserType = await prisma.airdropClaim.groupBy({
            by: ['userType'],
            _count: {
                userType: true
            }
        });

        const recentClaims = await prisma.airdropClaim.findMany({
            take: 10,
            orderBy: {
                claimedAt: 'desc'
            },
            select: {
                email: true,
                walletAddress: true,
                rewardAmount: true,
                rewardSource: true,
                claimedAt: true,
                userType: true
            }
        });

        const responseData = {
            success: true,
            statistics: {
                totalClaims,
                totalAmountClaimed: totalAmountClaimed._sum.rewardAmount || 0,
                claimsBySource,
                claimsByUserType,
                recentClaims
            }
        };

        res.send(encryptJSON(responseData));
    } catch (error) {
        console.error("Error fetching airdrop statistics:", error);
        res.status(500).json({
            success: false,
            error: "Failed to fetch airdrop statistics"
        });
    }
});

// Check if a specific wallet or email has claimed
router.post('/check-claim-status', async (req, res) => {
    try {
        const { walletAddress, email } = req.body;

        if (!walletAddress && !email) {
            return res.status(400).json({
                success: false,
                error: "Either wallet address or email is required"
            });
        }

        let existingClaim = null;
        if (walletAddress) {
            existingClaim = await prisma.airdropClaim.findUnique({
                where: { walletAddress }
            });
        }
        
        if (!existingClaim && email) {
            existingClaim = await prisma.airdropClaim.findUnique({
                where: { email }
            });
        }

        const responseData = {
            success: true,
            hasClaimed: !!existingClaim,
            claimData: existingClaim || null
        };

        res.send(encryptJSON(responseData));
    } catch (error) {
        console.error("Error checking claim status:", error);
        res.status(500).json({
            success: false,
            error: "Failed to check claim status"
        });
    }
});

// Get all airdrop claims (admin route)
router.get('/airdrop-claims', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const skip = (page - 1) * limit;

        const claims = await prisma.airdropClaim.findMany({
            skip,
            take: limit,
            orderBy: {
                claimedAt: 'desc'
            }
        });

        const totalClaims = await prisma.airdropClaim.count();

        const responseData = {
            success: true,
            claims,
            pagination: {
                page,
                limit,
                total: totalClaims,
                pages: Math.ceil(totalClaims / limit)
            }
        };

        res.send(encryptJSON(responseData));
    } catch (error) {
        console.error("Error fetching airdrop claims:", error);
        res.status(500).json({
            success: false,
            error: "Failed to fetch airdrop claims"
        });
    }
});

// POST endpoint for creator posts with media upload support
router.post('/creator-posts', createPostLimiter, upload.array('media', 10), async (req, res) => {
    try {
        const { id, content, username, user_username, profilePicture, timestamp, userId, email } = req.body;

        // Validation: Check all fields are present
        if (!id || !content || !username || !timestamp) {
            return res.status(400).json({
                success: false,
                message: "Missing required fields: id, content, username, and timestamp are required"
            });
        }

        // Content validation: Max 1000 characters
        if (content.length > 1000) {
            return res.status(400).json({
                success: false,
                message: "Content exceeds maximum length of 1000 characters"
            });
        }

        // User username validation: Max 50 characters if provided
        if (user_username && user_username.length > 50) {
            return res.status(400).json({
                success: false,
                message: "User username exceeds maximum length of 50 characters"
            });
        }

        // Validate timestamp format
        const parsedTimestamp = new Date(timestamp);
        if (isNaN(parsedTimestamp.getTime())) {
            return res.status(400).json({
                success: false,
                message: "Invalid timestamp format"
            });
        }

        // Check for duplicate post ID
        const existingPost = await prisma.creatorPost.findUnique({
            where: { postId: id }
        });

        if (existingPost) {
            return res.status(409).json({
                success: false,
                message: "Post with this ID already exists"
            });
        }

        // Handle media file uploads
        let imageUrls = [];
        let videoUrls = [];

        if (req.files && req.files.length > 0) {
            // Process each uploaded file
            for (const file of req.files) {
                const fileContent = fs.readFileSync(file.path);
                let folderName = '';
                let urlArray = null;

                // Determine file type and folder
                if (file.mimetype.startsWith('image/')) {
                    folderName = 'creator-posts/images';
                    urlArray = imageUrls;
                } else if (file.mimetype.startsWith('video/')) {
                    folderName = 'creator-posts/videos';
                    urlArray = videoUrls;
                } else {
                    return res.status(400).json({ 
                        success: false,
                        message: `Invalid file type: ${file.originalname}. Only images and videos are allowed.` 
                    });
                }

                const params = {
                    Bucket: process.env.AWS_BUCKET_NAME,
                    Key: `${folderName}/${Date.now()}-${file.originalname}`,
                    Body: fileContent,
                    ContentType: file.mimetype,
                };

                const uploadResult = await s3.upload(params).promise();
                urlArray.push(uploadResult.Location);

                // Delete the temporary file
                try {
                    if (fs.existsSync(file.path)) {
                        fs.unlinkSync(file.path);
                    }
                } catch (unlinkError) {
                    // console.log("Warning: Could not delete temporary file:", unlinkError);
                }
            }
        }

        // Create the post with media URLs (initially without transaction data)
        const newPost = await prisma.creatorPost.create({
            data: {
                postId: id,
                content: content,
                username: username,
                user_username: user_username || null,
                userEmail: email || null, // Store user email for easier querying
                profilePicture: profilePicture || null,
                timestamp: parsedTimestamp,
                images: imageUrls,
                videos: videoUrls,
                transactionHash: null, // Will be updated after blockchain transaction
                rewardAmount: null     // Will be updated after blockchain transaction
            }
        });

        // Find user/creator and process blockchain reward
        let user = null;
        let creator = null;
        let walletAddress = null;

        // Try to find user by multiple methods - prioritize email field
        if (email) {
            // Try to find user by email first (most reliable)
            user = await prisma.user.findFirst({
                where: { 
                    OR: [
                        { email: email },
                        { name: email }
                    ]
                }
            });
            
            if (!user) {
                creator = await prisma.creator.findFirst({
                    where: { 
                        OR: [
                            { email: email },
                            { username: email },
                            { name: email }
                        ]
                    }
                });
            }
        }
        
        // If email lookup didn't work, try by user_username
        if (!user && !creator && user_username) {
            user = await prisma.user.findFirst({
                where: { 
                    OR: [
                        { email: user_username },
                        { name: user_username }
                    ]
                }
            });
            
            if (!user) {
                creator = await prisma.creator.findFirst({
                    where: { 
                        OR: [
                            { email: user_username },
                            { username: user_username },
                            { name: user_username }
                        ]
                    }
                });
            }
        }

        // Also try to find by username field if user_username didn't work
        if (!user && !creator && username) {
            user = await prisma.user.findFirst({
                where: { 
                    OR: [
                        { email: username },
                        { name: username }
                    ]
                }
            });
            
            if (!user) {
                creator = await prisma.creator.findFirst({
                    where: { 
                        OR: [
                            { email: username },
                            { username: username },
                            { name: username }
                        ]
                    }
                });
            }
        }

        // Get wallet address if user/creator found
        if (user && user.walletAddress) {
            walletAddress = user.walletAddress;
            // console.log("✅ Found user with wallet address:", walletAddress);
        } else if (creator && creator.walletAddress) {
            walletAddress = creator.walletAddress;
            // console.log("✅ Found creator with wallet address:", walletAddress);
        }

        // Debug logging
        // console.log("🔍 Blockchain Debug Info:");
        // console.log("- walletAddress:", walletAddress);
        // console.log("- SWITCH env var:", process.env.SWITCH);
        // console.log("- CREATOR_POST_REWARD:", process.env.CREATOR_POST_REWARD);

        // Process blockchain reward if wallet address found and SWITCH is enabled
        if (walletAddress && process.env.SWITCH === 'true') {
            // console.log("🚀 Starting blockchain transaction...");
            try {
                const rewardAmount = process.env.CREATOR_POST_REWARD || '0'; // Default 0 GLL if not set
                
                // Update database balance (only if user/creator found)
                if (user) {
                    await prisma.user.update({
                        where: { id: user.id },
                        data: {
                            gllBalance: {
                                increment: parseFloat(rewardAmount)
                            }
                        }
                    });
                    // console.log("✅ Updated user database balance");
                } else if (creator) {
                    await prisma.creator.update({
                        where: { id: creator.id },
                        data: {
                            gllBalance: {
                                increment: parseFloat(rewardAmount)
                            }
                        }
                    });
                    // console.log("✅ Updated creator database balance");
                }

                // Send blockchain transaction using the walletAddress variable (not user.walletAddress)
                const sendTx = await phoneLinkContract.getGLL(convertToEtherAmount(rewardAmount.toString()), walletAddress);
                await sendTx.wait();
                // console.log("✅ Creator Post GLL transaction completed successfully");
                // console.log("📝 Transaction Hash:", sendTx.hash);

                // Update the post with transaction hash and reward amount
                await prisma.creatorPost.update({
                    where: { id: newPost.id },
                    data: {
                        transactionHash: sendTx.hash,
                        rewardAmount: parseFloat(rewardAmount)
                    }
                });
                // console.log("✅ Updated post with transaction hash and reward amount");
                
            } catch (blockchainError) {
                console.error("❌ Creator Post blockchain transaction failed:", blockchainError.message);
                // Don't crash the endpoint, just log the error
            }
        }

        // Return success response
        res.status(201).json({
            success: true,
            message: "Post created successfully",
            data: {
                id: newPost.postId,
                content: newPost.content,
                username: newPost.username,
                user_username: newPost.user_username,
                profilePicture: newPost.profilePicture,
                timestamp: newPost.timestamp,
                images: newPost.images,
                videos: newPost.videos,
                createdAt: newPost.createdAt
            }
        });

    } catch (error) {
        console.error("Error creating creator post:", error);
        
        // Clean up temporary files if they exist and there was an error
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                try {
                    if (fs.existsSync(file.path)) {
                        fs.unlinkSync(file.path);
                    }
                } catch (unlinkError) {
                    // console.log("Warning: Could not delete temporary file:", unlinkError);
                }
            }
        }
        
        res.status(500).json({
            success: false,
            message: "Internal server error while creating post"
        });
    }
});

// GET endpoint for fetching all creator posts (social media feed)
router.get('/creator-posts', generalPostLimiter, async (req, res) => {
    try {
        const { 
            page = 1, 
            limit = 10, 
            sort = 'timestamp', 
            order = 'desc',
            username 
        } = req.query;


        // Validate pagination parameters
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        
        if (pageNum < 1 || limitNum < 1 || limitNum > 50) {
            return res.status(400).json({
                success: false,
                message: "Invalid pagination parameters. Page must be >= 1, limit must be between 1-50"
            });
        }

        // Validate sort parameters
        const allowedSortFields = ['timestamp', 'createdAt', 'username'];
        const allowedOrderValues = ['asc', 'desc'];
        
        if (!allowedSortFields.includes(sort)) {
            return res.status(400).json({
                success: false,
                message: "Invalid sort field. Allowed values: timestamp, createdAt, username"
            });
        }

        if (!allowedOrderValues.includes(order)) {
            return res.status(400).json({
                success: false,
                message: "Invalid order. Allowed values: asc, desc"
            });
        }

        // Calculate skip value for pagination
        const skip = (pageNum - 1) * limitNum;

        // Build where clause for filtering
        const whereClause = {};
        if (username) {
            whereClause.username = {
                contains: username,
                mode: 'insensitive' // Case-insensitive search
            };
        }

        // Fetch posts with pagination and sorting
        const posts = await prisma.creatorPost.findMany({
            where: whereClause,
            orderBy: {
                [sort]: order
            },
            skip: skip,
            take: limitNum,
            select: {
                id: true,
                postId: true,
                content: true,
                username: true,
                user_username: true,
                userEmail: true,
                profilePicture: true,
                timestamp: true,
                createdAt: true,
                updatedAt: true,
                images: true,
                videos: true,
                _count: {
                    select: {
                        likes: true,
                        comments: true
                    }
                }
            }
        });

        // Get total count for pagination
        const totalPosts = await prisma.creatorPost.count({
            where: whereClause
        });

        // Calculate pagination metadata
        const totalPages = Math.ceil(totalPosts / limitNum);
        const hasNextPage = pageNum < totalPages;
        const hasPrevPage = pageNum > 1;

        // Format response data
        const formattedPosts = posts.map(post => ({
            id: post.postId,
            content: post.content,
            username: post.username,
            user_username: post.user_username,
            userEmail: post.userEmail,
            profilePicture: post.profilePicture,
            timestamp: post.timestamp,
            createdAt: post.createdAt,
            updatedAt: post.updatedAt,
            images: post.images,
            videos: post.videos,
            likes: post._count.likes,
            comments: post._count.comments
        }));

        // Return success response
        res.status(200).json({
            success: true,
            message: "Posts retrieved successfully",
            data: {
                posts: formattedPosts,
                pagination: {
                    currentPage: pageNum,
                    totalPages: totalPages,
                    totalPosts: totalPosts,
                    postsPerPage: limitNum,
                    hasNextPage: hasNextPage,
                    hasPrevPage: hasPrevPage
                },
                filters: {
                    sort: sort,
                    order: order,
                    username: username || null
                }
            }
        });

    } catch (error) {
        console.error("Error fetching creator posts:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error while fetching posts"
        });
    }
});

// GET endpoint for fetching a single creator post by ID
router.get('/creator-posts/:postId', generalPostLimiter, async (req, res) => {
    try {
        const { postId } = req.params;

        if (!postId) {
            return res.status(400).json({
                success: false,
                message: "Post ID is required"
            });
        }

        const post = await prisma.creatorPost.findUnique({
            where: { postId: postId },
            select: {
                id: true,
                postId: true,
                content: true,
                username: true,
                user_username: true,
                profilePicture: true,
                timestamp: true,
                createdAt: true,
                updatedAt: true,
                images: true,
                videos: true,
                _count: {
                    select: {
                        likes: true,
                        comments: true
                    }
                }
            }
        });

        if (!post) {
            return res.status(404).json({
                success: false,
                message: "Post not found"
            });
        }

        // Format response data
        const formattedPost = {
            id: post.postId,
            content: post.content,
            username: post.username,
            user_username: post.user_username,
            profilePicture: post.profilePicture,
            timestamp: post.timestamp,
            createdAt: post.createdAt,
            updatedAt: post.updatedAt,
            images: post.images,
            videos: post.videos,
            likes: post._count.likes,
            comments: post._count.comments
        };

        res.status(200).json({
            success: true,
            message: "Post retrieved successfully",
            data: formattedPost
        });

    } catch (error) {
        console.error("Error fetching creator post:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error while fetching post"
        });
    }
});

// GET endpoint for fetching creator posts by email (creator profile feed)
router.get('/creator-posts/by-email/:email', generalPostLimiter, async (req, res) => {
    try {
        const { email } = req.params;
        const { 
            page = 1, 
            limit = 10, 
            sort = 'timestamp', 
            order = 'desc'
        } = req.query;

        // Decode URL-encoded email
        const decodedEmail = decodeURIComponent(email);

        if (!decodedEmail) {
            return res.status(400).json({
                success: false,
                message: "Email is required"
            });
        }

        // Validate pagination parameters
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        
        if (pageNum < 1 || limitNum < 1 || limitNum > 50) {
            return res.status(400).json({
                success: false,
                message: "Invalid pagination parameters. Page must be >= 1, limit must be between 1-50"
            });
        }

        // Validate sort parameters
        const allowedSortFields = ['timestamp', 'createdAt'];
        const allowedOrderValues = ['asc', 'desc'];
        
        if (!allowedSortFields.includes(sort)) {
            return res.status(400).json({
                success: false,
                message: "Invalid sort field. Allowed values: timestamp, createdAt"
            });
        }

        if (!allowedOrderValues.includes(order)) {
            return res.status(400).json({
                success: false,
                message: "Invalid order. Allowed values: asc, desc"
            });
        }

        // Calculate skip value for pagination
        const skip = (pageNum - 1) * limitNum;

        // First, find the creator by email to get their username
        const creator = await prisma.creator.findUnique({
            where: { email: decodedEmail },
            select: {
                username: true,
                name: true,
                profilePicture: true
            }
        });

        if (!creator) {
            return res.status(404).json({
                success: false,
                message: "Creator not found with this email"
            });
        }

        // Fetch posts by username OR name (since posts might be stored with either)
        const posts = await prisma.creatorPost.findMany({
            where: {
                OR: [
                    { username: creator.username },
                    { username: creator.name }
                ]
            },
            orderBy: {
                [sort]: order
            },
            skip: skip,
            take: limitNum,
            select: {
                id: true,
                postId: true,
                content: true,
                username: true,
                user_username: true,
                profilePicture: true,
                timestamp: true,
                createdAt: true,
                updatedAt: true,
                images: true,
                videos: true,
                _count: {
                    select: {
                        likes: true,
                        comments: true
                    }
                }
            }
        });

        // Get total count for pagination
        const totalPosts = await prisma.creatorPost.count({
            where: {
                OR: [
                    { username: creator.username },
                    { username: creator.name }
                ]
            }
        });

        // Calculate pagination metadata
        const totalPages = Math.ceil(totalPosts / limitNum);
        const hasNextPage = pageNum < totalPages;
        const hasPrevPage = pageNum > 1;

        // Format response data
        const formattedPosts = posts.map(post => ({
            id: post.postId,
            content: post.content,
            username: post.username,
            user_username: post.user_username,
            profilePicture: post.profilePicture || creator.profilePicture, // Use creator's profile picture as fallback
            timestamp: post.timestamp,
            createdAt: post.createdAt,
            updatedAt: post.updatedAt,
            images: post.images,
            videos: post.videos
        }));

        // Return success response
        res.status(200).json({
            success: true,
            message: "Creator posts retrieved successfully",
            data: {
                creator: {
                    email: decodedEmail,
                    username: creator.username,
                    name: creator.name,
                    profilePicture: creator.profilePicture
                },
                posts: formattedPosts,
                pagination: {
                    currentPage: pageNum,
                    totalPages: totalPages,
                    totalPosts: totalPosts,
                    postsPerPage: limitNum,
                    hasNextPage: hasNextPage,
                    hasPrevPage: hasPrevPage
                },
                filters: {
                    sort: sort,
                    order: order
                }
            }
        });

    } catch (error) {
        console.error("Error fetching creator posts by email:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error while fetching creator posts"
        });
    }
});

// GET endpoint for fetching creator profile by username
router.get('/creator-profile/by-username/:username', generalPostLimiter, async (req, res) => {
    try {
        const { username } = req.params;
        
        // Decode URL-encoded username
        const decodedUsername = decodeURIComponent(username);
        
        if (!decodedUsername) {
            return res.status(400).json({
                success: false,
                message: "Username is required"
            });
        }

        // Find creator by username
        const creator = await prisma.creator.findUnique({
            where: { username: decodedUsername },
            select: {
                email: true,
                name: true,
                username: true,
                instagramUsername: true,
                profilePicture: true,
                aboutMe: true,
                passion: true,
                existingOnlineStoreLink: true,
                paymentPreference: true,
                isKycComplete: true,
                kycCompletedAt: true,
                isRegistrationComplete: true,
                createdAt: true,
                updatedAt: true
            }
        });

        if (!creator) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        // Format response data
        const profileData = {
            email: creator.email,
            name: creator.name,
            username: creator.username,
            instagramUsername: creator.instagramUsername || '',
            profilePicture: creator.profilePicture || '',
            aboutMe: creator.aboutMe || '',
            passion: creator.passion || '',
            existingOnlineStoreLink: creator.existingOnlineStoreLink || '',
            paymentPreference: creator.paymentPreference || '',
            isKycComplete: creator.isKycComplete || false,
            kycCompletedAt: creator.kycCompletedAt || null,
            isRegistrationComplete: creator.isRegistrationComplete || false
        };

        // console.log(`Creator profile for ${decodedUsername}:`, {
        //     hasIfscCode,
        //     isKycComplete,
        //     gllBalance: creator.gllBalance
        // });

        // Send encrypted response
        res.send(encryptJSON(profileData));
        
    } catch (error) {
        console.error("Error fetching creator profile by username:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error while fetching user profile"
        });
    }
});

// GET endpoint for fetching creator posts by username
router.get('/creator-posts/by-username/:username', generalPostLimiter, async (req, res) => {
    try {
        const { username } = req.params;
        const { 
            page = 1, 
            limit = 10, 
            sort = 'timestamp', 
            order = 'desc'
        } = req.query;

        // Decode URL-encoded username
        const decodedUsername = decodeURIComponent(username);

        if (!decodedUsername) {
            return res.status(400).json({
                success: false,
                message: "Username is required"
            });
        }

        // Validate pagination parameters
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        
        if (pageNum < 1 || limitNum < 1 || limitNum > 50) {
            return res.status(400).json({
                success: false,
                message: "Invalid pagination parameters. Page must be >= 1, limit must be between 1-50"
            });
        }

        // Validate sort parameters
        const allowedSortFields = ['timestamp', 'createdAt'];
        const allowedOrderValues = ['asc', 'desc'];
        
        if (!allowedSortFields.includes(sort)) {
            return res.status(400).json({
                success: false,
                message: "Invalid sort field. Allowed values: timestamp, createdAt"
            });
        }

        if (!allowedOrderValues.includes(order)) {
            return res.status(400).json({
                success: false,
                message: "Invalid order. Allowed values: asc, desc"
            });
        }

        // Calculate skip value for pagination
        const skip = (pageNum - 1) * limitNum;

        // First, find the creator by username to get their details
        const creator = await prisma.creator.findUnique({
            where: { username: decodedUsername },
            select: {
                email: true,
                username: true,
                name: true,
                profilePicture: true
            }
        });

        if (!creator) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        // Fetch posts by username OR name (since posts might be stored with either)
        const posts = await prisma.creatorPost.findMany({
            where: {
                OR: [
                    { username: creator.username },
                    { username: creator.name }
                ]
            },
            orderBy: {
                [sort]: order
            },
            skip: skip,
            take: limitNum,
            select: {
                id: true,
                postId: true,
                content: true,
                username: true,
                user_username: true,
                profilePicture: true,
                timestamp: true,
                createdAt: true,
                updatedAt: true,
                images: true,
                videos: true,
                _count: {
                    select: {
                        likes: true,
                        comments: true
                    }
                }
            }
        });

        // Get total count for pagination
        const totalPosts = await prisma.creatorPost.count({
            where: {
                OR: [
                    { username: creator.username },
                    { username: creator.name }
                ]
            }
        });

        // Calculate pagination metadata
        const totalPages = Math.ceil(totalPosts / limitNum);
        const hasNextPage = pageNum < totalPages;
        const hasPrevPage = pageNum > 1;

        // Format response data
        const formattedPosts = posts.map(post => ({
            id: post.postId,
            content: post.content,
            username: post.username,
            user_username: post.user_username,
            profilePicture: post.profilePicture || creator.profilePicture, // Use creator's profile picture as fallback
            timestamp: post.timestamp,
            createdAt: post.createdAt,
            updatedAt: post.updatedAt,
            images: post.images,
            videos: post.videos
        }));

        // Return success response
        res.status(200).json({
            success: true,
            message: "Posts retrieved successfully",
            data: {
                creator: {
                    email: creator.email,
                    username: creator.username,
                    name: creator.name,
                    profilePicture: creator.profilePicture
                },
                posts: formattedPosts,
                pagination: {
                    currentPage: pageNum,
                    totalPages: totalPages,
                    totalPosts: totalPosts,
                    postsPerPage: limitNum,
                    hasNextPage: hasNextPage,
                    hasPrevPage: hasPrevPage
                },
                filters: {
                    sort: sort,
                    order: order
                }
            }
        });

    } catch (error) {
        console.error("Error fetching creator posts by username:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error while fetching posts"
        });
    }
});

// ===== LIKE & COMMENT SYSTEM ENDPOINTS =====

// 1. Like/Unlike a Post
router.post('/creator-posts/:postId/like', likeCommentLimiter, async (req, res) => {
    try {
        const { postId } = req.params;
        const { username, profilePicture } = req.body;

        if (!username) {
            return res.status(400).json({
                success: false,
                message: "Username is required"
            });
        }

        // Find the post by postId
        const post = await prisma.creatorPost.findUnique({
            where: { postId: postId }
        });

        if (!post) {
            return res.status(404).json({
                success: false,
                message: "Post not found"
            });
        }

        // Check if user already liked the post
        const existingLike = await prisma.postLike.findUnique({
            where: {
                postId_username: {
                    postId: post.id,
                    username: username
                }
            }
        });

        let liked = false;
        let totalLikes = 0;

        if (existingLike) {
            // Unlike the post
            await prisma.postLike.delete({
                where: {
                    postId_username: {
                        postId: post.id,
                        username: username
                    }
                }
            });
            liked = false;
        } else {
            // Like the post
            await prisma.postLike.create({
                data: {
                    postId: post.id,
                    username: username
                }
            });
            liked = true;
        }

        // Get updated total likes count
        totalLikes = await prisma.postLike.count({
            where: { postId: post.id }
        });

        res.status(200).json({
            success: true,
            message: liked ? "Post liked successfully" : "Post unliked successfully",
            data: {
                postId: postId,
                liked: liked,
                totalLikes: totalLikes
            }
        });

    } catch (error) {
        console.error("Error liking/unliking post:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error while processing like"
        });
    }
});

// 2. Get Post Likes
router.get('/creator-posts/:postId/likes', generalPostLimiter, async (req, res) => {
    try {
        const { postId } = req.params;

        // Find the post by postId
        const post = await prisma.creatorPost.findUnique({
            where: { postId: postId }
        });

        if (!post) {
            return res.status(404).json({
                success: false,
                message: "Post not found"
            });
        }

        // Get all likes for the post
        const likes = await prisma.postLike.findMany({
            where: { postId: post.id },
            select: { username: true },
            orderBy: { createdAt: 'desc' }
        });

        const likedBy = likes.map(like => like.username);
        const totalLikes = likes.length;

        res.status(200).json({
            success: true,
            message: "Likes retrieved successfully",
            data: {
                postId: postId,
                likedBy: likedBy,
                totalLikes: totalLikes
            }
        });

    } catch (error) {
        console.error("Error fetching post likes:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error while fetching likes"
        });
    }
});

// 3. Add Comment to Post
router.post('/creator-posts/:postId/comment', likeCommentLimiter, async (req, res) => {
    try {
        const { postId } = req.params;
        const { username, profilePicture, content } = req.body;

        if (!username || !content) {
            return res.status(400).json({
                success: false,
                message: "Username and content are required"
            });
        }

        if (content.length > 500) {
            return res.status(400).json({
                success: false,
                message: "Comment content exceeds maximum length of 500 characters"
            });
        }

        // Find the post by postId
        const post = await prisma.creatorPost.findUnique({
            where: { postId: postId }
        });

        if (!post) {
            return res.status(404).json({
                success: false,
                message: "Post not found"
            });
        }

        // Create the comment
        const comment = await prisma.comment.create({
            data: {
                postId: post.id,
                username: username,
                profilePicture: profilePicture || '',
                content: content,
                timestamp: new Date()
            }
        });

        res.status(201).json({
            success: true,
            message: "Comment added successfully",
            data: {
                id: comment.id,
                postId: postId,
                username: comment.username,
                profilePicture: comment.profilePicture,
                content: comment.content,
                timestamp: comment.timestamp,
                createdAt: comment.createdAt,
                updatedAt: comment.updatedAt,
                likes: 0,
                isLiked: false
            }
        });

    } catch (error) {
        console.error("Error adding comment:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error while adding comment"
        });
    }
});

// 4. Get Post Comments
router.get('/creator-posts/:postId/comments', generalPostLimiter, async (req, res) => {
    try {
        const { postId } = req.params;
        const { page = 1, limit = 20 } = req.query;

        // Validate pagination parameters
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        
        if (pageNum < 1 || limitNum < 1 || limitNum > 50) {
            return res.status(400).json({
                success: false,
                message: "Invalid pagination parameters. Page must be >= 1, limit must be between 1-50"
            });
        }

        // Find the post by postId
        const post = await prisma.creatorPost.findUnique({
            where: { postId: postId }
        });

        if (!post) {
            return res.status(404).json({
                success: false,
                message: "Post not found"
            });
        }

        // Calculate skip value for pagination
        const skip = (pageNum - 1) * limitNum;

        // Get comments with pagination
        const comments = await prisma.comment.findMany({
            where: { postId: post.id },
            orderBy: { createdAt: 'desc' },
            skip: skip,
            take: limitNum,
            include: {
                likes: true
            }
        });

        // Get total count for pagination
        const totalComments = await prisma.comment.count({
            where: { postId: post.id }
        });

        // Calculate pagination metadata
        const totalPages = Math.ceil(totalComments / limitNum);
        const hasNextPage = pageNum < totalPages;
        const hasPrevPage = pageNum > 1;

        // Format comments with like counts
        const formattedComments = comments.map(comment => ({
            id: comment.id,
            postId: postId,
            username: comment.username,
            profilePicture: comment.profilePicture,
            content: comment.content,
            timestamp: comment.timestamp,
            createdAt: comment.createdAt,
            updatedAt: comment.updatedAt,
            likes: comment.likes.length,
            isLiked: false // This would need to be calculated based on current user
        }));

        res.status(200).json({
            success: true,
            message: "Comments retrieved successfully",
            data: {
                postId: postId,
                comments: formattedComments,
                pagination: {
                    currentPage: pageNum,
                    totalPages: totalPages,
                    totalComments: totalComments,
                    commentsPerPage: limitNum,
                    hasNextPage: hasNextPage,
                    hasPrevPage: hasPrevPage
                }
            }
        });

    } catch (error) {
        console.error("Error fetching comments:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error while fetching comments"
        });
    }
});

// 5. Like/Unlike a Comment
router.post('/creator-posts/comments/:commentId/like', likeCommentLimiter, async (req, res) => {
    try {
        const { commentId } = req.params;
        const { username, profilePicture } = req.body;

        if (!username) {
            return res.status(400).json({
                success: false,
                message: "Username is required"
            });
        }

        // Find the comment
        const comment = await prisma.comment.findUnique({
            where: { id: commentId }
        });

        if (!comment) {
            return res.status(404).json({
                success: false,
                message: "Comment not found"
            });
        }

        // Check if user already liked the comment
        const existingLike = await prisma.commentLike.findUnique({
            where: {
                commentId_username: {
                    commentId: commentId,
                    username: username
                }
            }
        });

        let liked = false;
        let totalLikes = 0;

        if (existingLike) {
            // Unlike the comment
            await prisma.commentLike.delete({
                where: {
                    commentId_username: {
                        commentId: commentId,
                        username: username
                    }
                }
            });
            liked = false;
        } else {
            // Like the comment
            await prisma.commentLike.create({
                data: {
                    commentId: commentId,
                    username: username
                }
            });
            liked = true;
        }

        // Get updated total likes count
        totalLikes = await prisma.commentLike.count({
            where: { commentId: commentId }
        });

        res.status(200).json({
            success: true,
            message: liked ? "Comment liked successfully" : "Comment unliked successfully",
            data: {
                commentId: commentId,
                liked: liked,
                totalLikes: totalLikes
            }
        });

    } catch (error) {
        console.error("Error liking/unliking comment:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error while processing comment like"
        });
    }
});

// ===== CREATOR SERVICES ENDPOINTS =====

// 1. GET /creatorService/:email - Fetch creator's services
router.get('/creatorService/:email', generalPostLimiter, async (req, res) => {
    try {
        const { email } = req.params;
        const decodedEmail = decodeURIComponent(email);
        
        const services = await prisma.creatorService.findMany({
            where: { email: decodedEmail },
            orderBy: { createdAt: 'desc' }
        });
        
        const responseData = {
            success: true,
            message: "Services retrieved successfully",
            data: services
        };
        res.send(encryptJSON(responseData));
    } catch (error) {
        console.error("Error fetching creator services:", error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch services',
            error: error.message
        });
    }
});

// 2. POST /creatorService - Create new service
router.post('/creatorService', createPostLimiter, async (req, res) => {
    try {
        const { email, title, description, price, status, icon, proofOfCreationScore } = req.body;
        
        // Validation
        if (!email || !title || !description || !price) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields'
            });
        }
        
        // Validate description length (40 characters max)
        if (description.length > 40) {
            return res.status(400).json({
                success: false,
                message: 'Description must be 40 characters or less'
            });
        }
        
        // Create the service initially without transaction data
        const service = await prisma.creatorService.create({
            data: {
                email,
                title: title.trim(),
                description: description.trim(),
                price: price.trim(),
                status: status || 'available',
                icon: icon || 'bi-briefcase',
                proofOfCreationScore: proofOfCreationScore ? parseFloat(proofOfCreationScore) : null,
                transactionHash: null, // Will be updated after blockchain transaction
                rewardAmount: null     // Will be updated after blockchain transaction
            }
        });

        // Find user/creator and process blockchain reward
        let user = null;
        let creator = null;
        let walletAddress = null;

        // Try to find user by email first (most reliable)
        user = await prisma.user.findFirst({
            where: { 
                OR: [
                    { email: email },
                    { name: email }
                ]
            }
        });

        // If user not found, try to find creator
        if (!user) {
            creator = await prisma.creator.findFirst({
                where: { 
                    OR: [
                        { email: email },
                        { name: email },
                        { username: email }
                    ]
                }
            });
        }

        // Get wallet address
        if (user && user.walletAddress) {
            walletAddress = user.walletAddress;
        } else if (creator && creator.walletAddress) {
            walletAddress = creator.walletAddress;
        }

        // Process blockchain transaction if wallet address exists and SWITCH is enabled
        if (walletAddress && process.env.SWITCH === 'true') {
            // console.log("🚀 Starting Creator Service blockchain transaction...");
            try {
                const rewardAmount = process.env.CREATOR_SERVICE_REWARD || '0'; // Default 0 GLL if not set
                
                // Update database balance (only if user/creator found)
                if (user) {
                    await prisma.user.update({
                        where: { id: user.id },
                        data: {
                            gllBalance: {
                                increment: parseFloat(rewardAmount)
                            }
                        }
                    });
                    // console.log("✅ Updated user database balance for service");
                } else if (creator) {
                    await prisma.creator.update({
                        where: { id: creator.id },
                        data: {
                            gllBalance: {
                                increment: parseFloat(rewardAmount)
                            }
                        }
                    });
                    // console.log("✅ Updated creator database balance for service");
                }

                // Send blockchain transaction using the walletAddress variable
                const sendTx = await phoneLinkContract.getGLL(convertToEtherAmount(rewardAmount.toString()), walletAddress);
                await sendTx.wait();
                // console.log("✅ Creator Service GLL transaction completed successfully");
                // console.log("📝 Transaction Hash:", sendTx.hash);

                // Update the service with transaction hash and reward amount
                await prisma.creatorService.update({
                    where: { id: service.id },
                    data: {
                        transactionHash: sendTx.hash,
                        rewardAmount: parseFloat(rewardAmount)
                    }
                });
                // console.log("✅ Updated service with transaction hash and reward amount");
                
            } catch (blockchainError) {
                console.error("❌ Creator Service blockchain transaction failed:", blockchainError.message);
                // Don't crash the endpoint, just log the error
            }
        } else {
            // console.log("⚠️ Creator Service blockchain transaction skipped - Wallet:", !!walletAddress, "Switch:", process.env.SWITCH);
        }
        
        const responseData = {
            success: true,
            message: "Service created successfully",
            data: service
        };
        res.send(encryptJSON(responseData));
    } catch (error) {
        console.error("Error creating creator service:", error);
        res.status(500).json({
            success: false,
            message: 'Failed to create service',
            error: error.message
        });
    }
});

// 3. PUT /creatorService/:id - Update service
router.put('/creatorService/:id', createPostLimiter, async (req, res) => {
    try {
        const { id } = req.params;
        const { email, title, description, price, status, icon, proofOfCreationScore } = req.body;
        
        // Validation
        if (!email) {
            return res.status(400).json({
                success: false,
                message: 'Email is required'
            });
        }
        
        // Validate description length if provided
        if (description && description.length > 40) {
            return res.status(400).json({
                success: false,
                message: 'Description must be 40 characters or less'
            });
        }
        
        const service = await prisma.creatorService.update({
            where: { id },
            data: {
                ...(title && { title: title.trim() }),
                ...(description && { description: description.trim() }),
                ...(price && { price: price.trim() }),
                ...(status && { status }),
                ...(icon && { icon }),
                ...(proofOfCreationScore !== undefined && { proofOfCreationScore: proofOfCreationScore ? parseFloat(proofOfCreationScore) : null }),
                updatedAt: new Date()
            }
        });
        
        const responseData = {
            success: true,
            message: "Service updated successfully",
            data: service
        };
        res.send(encryptJSON(responseData));
    } catch (error) {
        console.error("Error updating creator service:", error);
        res.status(500).json({
            success: false,
            message: 'Failed to update service',
            error: error.message
        });
    }
});

// 4. DELETE /creatorService/:id - Delete service
router.delete('/creatorService/:id', createPostLimiter, async (req, res) => {
    try {
        const { id } = req.params;
        const { email } = req.body;
        
        // Validation
        if (!email) {
            return res.status(400).json({
                success: false,
                message: 'Email is required'
            });
        }
        
        // Optional: Verify the service belongs to the user
        const existingService = await prisma.creatorService.findFirst({
            where: { id, email }
        });
        
        if (!existingService) {
            return res.status(404).json({
                success: false,
                message: 'Service not found or unauthorized'
            });
        }
        
        await prisma.creatorService.delete({
            where: { id }
        });
        
        const responseData = {
            success: true,
            message: 'Service deleted successfully'
        };
        res.send(encryptJSON(responseData));
    } catch (error) {
        console.error("Error deleting creator service:", error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete service',
            error: error.message
        });
    }
});

router.get('/test-route', (req, res) => {
    try {
        const responseData = {
            success: true,
            message: "Test route executed successfully"
        };
        res.send(responseData);
    } catch (error) {
        console.error("Error in test route:", error);
        res.status(500).json({
            success: false,
            message: 'Failed to execute test route',
            error: error.message    
        });
    }
});

// Helper function to get wallet address for creator
async function getCreatorWalletAddress(email) {
    try {
        // First check if creator has wallet address
        const creator = await prisma.creator.findUnique({
            where: { email },
            select: { walletAddress: true }
        });
        
        if (creator && creator.walletAddress) {
            return creator.walletAddress;
        }
        
        // If creator doesn't have wallet address, check if there's a user with same email
        const user = await prisma.user.findUnique({
            where: { email },
            select: { walletAddress: true }
        });
        
        if (user && user.walletAddress) {
            return user.walletAddress;
        }
        
        return null;
    } catch (error) {
        console.error("Error getting creator wallet address:", error);
        return null;
    }
}

// Helper function to get user by ID or email

// Creator Reward Card 1: Claim Your Creator ID
router.post('/creator-reward-card1', async (req, res) => {
    try {
        const { 
            email,
            profilePicture,
            passion,
            aboutMe,
            userId
        } = req.body;
        
        // Get user and email information
        const { user, userEmail } = await getUserByIdOrEmail(userId, email);
        
        // Get actual user info including email
        const userInfo = user || { email: email };

        // Check if user has already completed this task
        const existingTask = await prisma.userCompletedTask.findUnique({
            where: {
                userEmail_taskId: {
                    userEmail: userInfo.email,
                    taskId: 'creator_task1'
                }
            }
        });

        if (existingTask) {
            return res.status(409).json({ 
                error: "Creator ID claim task has already been completed" 
            });
        }

        // Update user profile with provided information
        if (user) {
            await prisma.user.update({
                where: { id: user.id },
                data: {
                    profilePicture: profilePicture || user.profilePicture,
                    passion: passion || user.passion || ""
                }
            });
        }

        // Update GLL balance
        if (user) {
            await prisma.user.update({
                where: { id: user.id },
                data: {
                    gllBalance: {
                        increment: parseFloat(process.env.CREATOR_TASK1_REWARD)
                    }
                }
            });

            /** Code to send GLL to email wallet *******/
            const amount = process.env.CREATOR_TASK1_REWARD;
            if(process.env.SWITCH === 'true'){
                try {
                    const sendTx = await phoneLinkContract.getGLL(convertToEtherAmount(amount.toString()), user.walletAddress);
                    await sendTx.wait();
                     // console.log("✅ User registration GLL transaction completed for wallet:", sendTx);
                    // console.log("✅ Creator reward card 1 GLL transaction completed");
                } catch (blockchainError) {
                    console.error("❌ Creator reward card 1 blockchain transaction failed:", blockchainError.message);
                    // Don't crash the endpoint, just log the error
                }
            }
        }

        // Mark task as completed
        await prisma.userCompletedTask.create({
            data: {
                userEmail: userInfo.email,
                taskId: 'creator_task1',
                completedAt: new Date()
            }
        });
        
        const responseData = {
            message: "Creator ID claimed successfully",
            rewardId: 'creator_task1',
            userEmail: userInfo.email,
            user: user
        };
        res.send(encryptJSON(responseData));
    } catch (error) {
        // console.log("Error in creator reward card 1:", error);
        res.status(500).json({ error: error.message });
    }
});

// Creator Reward Card 2: Share Your First Post
router.post('/creator-reward-card2', async (req, res) => {
    try {
        const { 
            email,
            postLink,
            valid,
            userId
        } = req.body;
        
        // Get user and email information
        const { user, userEmail } = await getUserByIdOrEmail(userId, email);
        
        // Get actual user info including email
        const userInfo = user || { email: email };

        // Check if post is valid
        if (valid === false) {
            return res.status(400).json({ 
                error: "Your Post Is Not Verified. Its not about GLL" 
            });
        }

        // Check if user has already completed this task
        const existingTask = await prisma.userCompletedTask.findUnique({
            where: {
                userEmail_taskId: {
                    userEmail: userInfo.email,
                    taskId: 'creator_task2'
                }
            }
        });

        if (existingTask) {
            return res.status(409).json({ 
                error: "Share your first post task has already been completed" 
            });
        }

        // Create reward record in database
        const reward = await prisma.rewards.create({
            data: {
                story: postLink || "",
                userEmail: userInfo.email,
                ...(user && { user: { connect: { id: user.id } } })
            }
        });

        // Update GLL balance
        if (user) {
            const rewardAmount = parseFloat(process.env.CREATOR_TASK2_REWARD);
            await prisma.user.update({
                where: { id: user.id },
                data: {
                    gllBalance: {
                        increment: rewardAmount
                    }
                }
            });


            /** Code to send GLL to email wallet *******/
            const amount = process.env.CREATOR_TASK2_REWARD;
            if(process.env.SWITCH === 'true'){
                try {
                    const sendTx = await phoneLinkContract.getGLL(convertToEtherAmount(amount.toString()), user.walletAddress);
                    await sendTx.wait();
                    // console.log("✅ Creator reward card 2 GLL transaction completed");
                } catch (blockchainError) {
                    console.error("❌ Creator reward card 2 blockchain transaction failed:", blockchainError.message);
                    // Don't crash the endpoint, just log the error
                }
            }
        }

        // Mark task as completed
        await prisma.userCompletedTask.create({
            data: {
                userEmail: userInfo.email,
                taskId: 'creator_task2',
                completedAt: new Date()
            }
        });
        
        const responseData = {
            message: "First post shared successfully",
            rewardId: 'creator_task2',
            postLink: postLink,
            valid: valid,
            userEmail: userInfo.email,
            user: user
        };
        res.send(encryptJSON(responseData));
    } catch (error) {
        // console.log("Error in creator reward card 2:", error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== CREATOR PRODUCT ROUTES ====================

// Create Creator Product
router.post('/creatorProduct', createPostLimiter, upload.array('images', 10), async (req, res) => {
    try {
        const { email, title, description, price, status, category, tags, proofOfCreationScore } = req.body;
        
        // Validation
        if (!email || !title || !description || !price) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields'
            });
        }
        
        // Validate description length (200 characters max)
        if (description.length > 200) {
            return res.status(400).json({
                success: false,
                message: 'Description must be 200 characters or less'
            });
        }

        // Validate title length (100 characters max)
        if (title.length > 100) {
            return res.status(400).json({
                success: false,
                message: 'Title must be 100 characters or less'
            });
        }

        let imageUrls = [];
        
        // Upload images to S3 if provided
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const fileContent = fs.readFileSync(file.path);
                
                const params = {
                    Bucket: process.env.AWS_BUCKET_NAME,
                    Key: `creator-products/${Date.now()}-${Math.round(Math.random() * 1E9)}-${file.originalname}`,
                    Body: fileContent,
                    ContentType: file.mimetype,
                };

                const uploadResult = await s3.upload(params).promise();
                imageUrls.push(uploadResult.Location);

                // Delete the temporary file
                try {
                    if (fs.existsSync(file.path)) {
                        fs.unlinkSync(file.path);
                    }
                } catch (unlinkError) {
                    // console.log("Warning: Could not delete temporary file:", unlinkError);
                }
            }
        }
        
        // Create the product initially without transaction data
        const product = await prisma.creatorProduct.create({
            data: {
                email,
                title: title.trim(),
                description: description.trim(),
                price: price.trim(),
                status: status || 'available',
                category: category || 'general',
                tags: tags ? tags.split(',').map(tag => tag.trim()) : [],
                images: imageUrls,
                proofOfCreationScore: proofOfCreationScore ? parseFloat(proofOfCreationScore) : null,
                transactionHash: null, // Will be updated after blockchain transaction
                rewardAmount: null,    // Will be updated after blockchain transaction
                createdAt: new Date(),
                updatedAt: new Date()
            }
        });

        // Find user/creator and process blockchain reward
        let user = null;
        let creator = null;
        let walletAddress = null;

        // Try to find user by email first (most reliable)
        user = await prisma.user.findFirst({
            where: { 
                OR: [
                    { email: email },
                    { name: email }
                ]
            }
        });

        // If user not found, try to find creator
        if (!user) {
            creator = await prisma.creator.findFirst({
                where: { 
                    OR: [
                        { email: email },
                        { name: email },
                        { username: email }
                    ]
                }
            });
        }

        // Get wallet address
        if (user && user.walletAddress) {
            walletAddress = user.walletAddress;
        } else if (creator && creator.walletAddress) {
            walletAddress = creator.walletAddress;
        }

        // Process blockchain transaction if wallet address exists and SWITCH is enabled
        if (walletAddress && process.env.SWITCH === 'true') {
            // console.log("🚀 Starting Creator Product blockchain transaction...");
            try {
                const rewardAmount = process.env.CREATOR_PRODUCT_REWARD || '0'; // Default 0 GLL if not set
                
                // Update database balance (only if user/creator found)
                if (user) {
                    await prisma.user.update({
                        where: { id: user.id },
                        data: {
                            gllBalance: {
                                increment: parseFloat(rewardAmount)
                            }
                        }
                    });
                    // console.log("✅ Updated user database balance for product");
                } else if (creator) {
                    await prisma.creator.update({
                        where: { id: creator.id },
                        data: {
                            gllBalance: {
                                increment: parseFloat(rewardAmount)
                            }
                        }
                    });
                    // console.log("✅ Updated creator database balance for product");
                }

                // Send blockchain transaction using the walletAddress variable
                const sendTx = await phoneLinkContract.getGLL(convertToEtherAmount(rewardAmount.toString()), walletAddress);
                await sendTx.wait();
                // console.log("✅ Creator Product GLL transaction completed successfully");
                // console.log("📝 Transaction Hash:", sendTx.hash);

                // Update the product with transaction hash and reward amount
                await prisma.creatorProduct.update({
                    where: { id: product.id },
                    data: {
                        transactionHash: sendTx.hash,
                        rewardAmount: parseFloat(rewardAmount)
                    }
                });
                // console.log("✅ Updated product with transaction hash and reward amount");
                
            } catch (blockchainError) {
                console.error("❌ Creator Product blockchain transaction failed:", blockchainError.message);
                // Don't crash the endpoint, just log the error
            }
        }
        
        const responseData = {
            success: true,
            message: "Product created successfully",
            data: product
        };
        res.send(encryptJSON(responseData));
    } catch (error) {
        // Clean up temporary files if they exist and there was an error
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                try {
                    if (fs.existsSync(file.path)) {
                        fs.unlinkSync(file.path);
                    }
                } catch (unlinkError) {
                    // console.log("Warning: Could not delete temporary file:", unlinkError);
                }
            }
        }
        
        console.error("Error creating creator product:", error);
        res.status(500).json({
            success: false,
            message: 'Failed to create product',
            error: error.message
        });
    }
});

// Get Single Creator Product (must come before the query route)
router.get('/creatorProduct/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Validate that id is a valid MongoDB ObjectId format
        if (!/^[0-9a-fA-F]{24}$/.test(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid product ID format'
            });
        }
        
        const product = await prisma.creatorProduct.findUnique({
            where: { id: id }
        });
        
        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }
        
        const responseData = {
            success: true,
            data: product
        };
        res.send(encryptJSON(responseData));
    } catch (error) {
        console.error("Error fetching creator product:", error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch product',
            error: error.message
        });
    }
});

// Get All Creator Products (must come after the :id route)
router.get('/creatorProduct', async (req, res) => {
    try {
        const { email, category, status, page = 1, limit = 10 } = req.query;
        
        const whereClause = {};
        if (email) whereClause.email = email;
        if (category) whereClause.category = category;
        if (status) whereClause.status = status;
        
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const products = await prisma.creatorProduct.findMany({
            where: whereClause,
            skip: skip,
            take: parseInt(limit),
            orderBy: { createdAt: 'desc' }
        });
        
        const total = await prisma.creatorProduct.count({ where: whereClause });
        
        const responseData = {
            success: true,
            data: products,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        };
        res.send(encryptJSON(responseData));
    } catch (error) {
        console.error("Error fetching creator products:", error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch products',
            error: error.message
        });
    }
});

// Update Creator Product
router.put('/creatorProduct/:id', createPostLimiter, upload.array('images', 10), async (req, res) => {
    try {
        const { id } = req.params;
        const { email, title, description, price, status, category, tags, removeImages, proofOfCreationScore } = req.body;
        
        // Validate that id is a valid MongoDB ObjectId format
        if (!/^[0-9a-fA-F]{24}$/.test(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid product ID format'
            });
        }
        
        // Check if product exists
        const existingProduct = await prisma.creatorProduct.findUnique({
            where: { id: id }
        });
        
        if (!existingProduct) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }
        
        // Check if user owns this product
        if (existingProduct.email !== email) {
            return res.status(403).json({
                success: false,
                message: 'You can only update your own products'
            });
        }
        
        // Validation
        if (description && description.length > 200) {
            return res.status(400).json({
                success: false,
                message: 'Description must be 200 characters or less'
            });
        }
        
        if (title && title.length > 100) {
            return res.status(400).json({
                success: false,
                message: 'Title must be 100 characters or less'
            });
        }
        
        let imageUrls = [...existingProduct.images];
        
        // Handle image removal
        if (removeImages) {
            const imagesToRemove = Array.isArray(removeImages) ? removeImages : [removeImages];
            imageUrls = imageUrls.filter(img => !imagesToRemove.includes(img));
        }
        
        // Upload new images to S3 if provided
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const fileContent = fs.readFileSync(file.path);
                
                const params = {
                    Bucket: process.env.AWS_BUCKET_NAME,
                    Key: `creator-products/${Date.now()}-${Math.round(Math.random() * 1E9)}-${file.originalname}`,
                    Body: fileContent,
                    ContentType: file.mimetype,
                };

                const uploadResult = await s3.upload(params).promise();
                imageUrls.push(uploadResult.Location);

                // Delete the temporary file
                try {
                    if (fs.existsSync(file.path)) {
                        fs.unlinkSync(file.path);
                    }
                } catch (unlinkError) {
                    // console.log("Warning: Could not delete temporary file:", unlinkError);
                }
            }
        }
        
        const updateData = {
            updatedAt: new Date()
        };
        
        if (title) updateData.title = title.trim();
        if (description) updateData.description = description.trim();
        if (price) updateData.price = price.trim();
        if (status) updateData.status = status;
        if (category) updateData.category = category;
        if (tags) updateData.tags = tags.split(',').map(tag => tag.trim());
        if (imageUrls.length > 0) updateData.images = imageUrls;
        if (proofOfCreationScore !== undefined) updateData.proofOfCreationScore = proofOfCreationScore ? parseFloat(proofOfCreationScore) : null;
        
        const updatedProduct = await prisma.creatorProduct.update({
            where: { id: id },
            data: updateData
        });
        
        const responseData = {
            success: true,
            message: "Product updated successfully",
            data: updatedProduct
        };
        res.send(encryptJSON(responseData));
    } catch (error) {
        // Clean up temporary files if they exist and there was an error
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                try {
                    if (fs.existsSync(file.path)) {
                        fs.unlinkSync(file.path);
                    }
                } catch (unlinkError) {
                    // console.log("Warning: Could not delete temporary file:", unlinkError);
                }
            }
        }
        
        console.error("Error updating creator product:", error);
        res.status(500).json({
            success: false,
            message: 'Failed to update product',
            error: error.message
        });
    }
});

// Delete Creator Product
router.delete('/creatorProduct/:id', createPostLimiter, async (req, res) => {
    try {
        const { id } = req.params;
        const { email } = req.body;
        
        // Validate that id is a valid MongoDB ObjectId format
        if (!/^[0-9a-fA-F]{24}$/.test(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid product ID format'
            });
        }
        
        // Check if product exists
        const existingProduct = await prisma.creatorProduct.findUnique({
            where: { id: id }
        });
        
        if (!existingProduct) {
            return res.status(404).json({
                success: false,
                message: 'Invalid product ID format'
            });
        }
        
        // Check if user owns this product
        if (existingProduct.email !== email) {
            return res.status(403).json({
                success: false,
                message: 'You can only delete your own products'
            });
        }
        
        // Delete images from S3 if they exist
        if (existingProduct.images && existingProduct.images.length > 0) {
            for (const imageUrl of existingProduct.images) {
                try {
                    const key = imageUrl.split('/').pop(); // Extract filename from URL
                    await s3.deleteObject({
                        Bucket: process.env.AWS_BUCKET_NAME,
                        Key: `creator-products/${key}`
                    }).promise();
                } catch (s3Error) {
                    // console.log("Warning: Could not delete image from S3:", s3Error);
                }
            }
        }
        
        // Delete the product from database
        await prisma.creatorProduct.delete({
            where: { id: id }
        });
        
        const responseData = {
            success: true,
            message: "Product deleted successfully"
        };
        res.send(encryptJSON(responseData));
    } catch (error) {
        console.error("Error deleting creator product:", error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete product',
            error: error.message
        });
    }
});

// Delete specific images from Creator Product
router.delete('/creatorProduct/:id/images', createPostLimiter, async (req, res) => {
    try {
        const { id } = req.params;
        const { email, imageUrls } = req.body;
        
        if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Please provide image URLs to delete'
            });
        }
        
        // Validate that id is a valid MongoDB ObjectId format
        if (!/^[0-9a-fA-F]{24}$/.test(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid product ID format'
            });
        }
        
        // Check if product exists
        const existingProduct = await prisma.creatorProduct.findUnique({
            where: { id: id }
        });
        
        if (!existingProduct) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }
        
        // Check if user owns this product
        if (existingProduct.email !== email) {
            return res.status(403).json({
                success: false,
                message: 'You can only modify your own products'
            });
        }
        
        // Remove images from S3
        for (const imageUrl of imageUrls) {
            try {
                const key = imageUrl.split('/').pop(); // Extract filename from URL
                await s3.deleteObject({
                    Bucket: process.env.AWS_BUCKET_NAME,
                    Key: `creator-products/${key}`
                }).promise();
            } catch (s3Error) {
                // console.log("Warning: Could not delete image from S3:", s3Error);
                // Continue with other images even if one fails
            }
        }
        
        // Update product images array
        const updatedImages = existingProduct.images.filter(img => !imageUrls.includes(img));
        
        const updatedProduct = await prisma.creatorProduct.update({
            where: { id: id },
            data: {
                images: updatedImages,
                updatedAt: new Date()
            }
        });
        
        const responseData = {
            success: true,
            message: "Images deleted successfully",
            data: updatedProduct
        };
        res.send(encryptJSON(responseData));
    } catch (error) {
        console.error("Error deleting product images:", error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete images',
            error: error.message
        });
    }
});

// ==================== CREATOR COURSE ROUTES ====================

// Create Creator Course
router.post('/creatorCourse', createPostLimiter, upload.single('courseImage'), async (req, res) => {
    try {
        const { email, title, description, price, priceType, minPrice, maxPrice, status, category, tags } = req.body;
        
        // Validation
        if (!email || !title || !description || !price) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields'
            });
        }
        
        // Validate description length (500 characters max)
        if (description.length > 500) {
            return res.status(400).json({
                success: false,
                message: 'Description must be 500 characters or less'
            });
        }

        // Validate title length (100 characters max)
        if (title.length > 100) {
            return res.status(400).json({
                success: false,
                message: 'Title must be 100 characters or less'
            });
        }

        // Validate price type and range
        if (priceType === 'range' && (!minPrice || !maxPrice || minPrice >= maxPrice)) {
            return res.status(400).json({
                success: false,
                message: 'For range pricing, minPrice must be less than maxPrice'
            });
        }

        let courseImageUrl = '';
        
        // Upload course image to S3 if provided
        if (req.file) {
            // Validate the file path to ensure it's inside the allowed upload directory
            const UPLOAD_DIR = path.resolve(__dirname, '..', 'uploads'); // Match multer config directory
            const resolvedFilePath = path.resolve(req.file.path);
            if (!resolvedFilePath.startsWith(UPLOAD_DIR)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid file path'
                });
            }
            
            const fileContent = fs.readFileSync(resolvedFilePath);
            
            const params = {
                Bucket: process.env.AWS_BUCKET_NAME,
                Key: `creator-courses/${Date.now()}-${Math.round(Math.random() * 1E9)}-${req.file.originalname}`,
                Body: fileContent,
                ContentType: req.file.mimetype,
            };

            const uploadResult = await s3.upload(params).promise();
            courseImageUrl = uploadResult.Location;

            // Delete the temporary file
            try {
                if (fs.existsSync(resolvedFilePath)) {
                    fs.unlinkSync(resolvedFilePath);
                }
            } catch (unlinkError) {
                // console.log("Warning: Could not delete temporary file:", unlinkError);
            }
        }
        
        // Create the course initially without transaction data
        const course = await prisma.creatorCourse.create({
            data: {
                email,
                title: title.trim(),
                description: description.trim(),
                courseImage: courseImageUrl,
                price: price.trim(),
                priceType: priceType || 'static',
                minPrice: priceType === 'range' ? parseFloat(minPrice) : null,
                maxPrice: priceType === 'range' ? parseFloat(maxPrice) : null,
                status: status || 'available',
                category: category || 'general',
                tags: tags ? tags.split(',').map(tag => tag.trim()) : [],
                transactionHash: null, // Will be updated after blockchain transaction
                rewardAmount: null,    // Will be updated after blockchain transaction
                createdAt: new Date(),
                updatedAt: new Date()
            }
        });

        // Find user/creator and process blockchain reward
        let user = null;
        let creator = null;
        let walletAddress = null;

        // Try to find user by email first (most reliable)
        user = await prisma.user.findFirst({
            where: { 
                OR: [
                    { email: email },
                    { name: email }
                ]
            }
        });

        // If user not found, try to find creator
        if (!user) {
            creator = await prisma.creator.findFirst({
                where: { 
                    OR: [
                        { email: email },
                        { name: email },
                        { username: email }
                    ]
                }
            });
        }

        // Get wallet address
        if (user && user.walletAddress) {
            walletAddress = user.walletAddress;
        } else if (creator && creator.walletAddress) {
            walletAddress = creator.walletAddress;
        }
        // Process blockchain transaction if wallet address exists and SWITCH is enabled
        if (walletAddress && process.env.SWITCH === 'true') {
            // console.log("🚀 Starting Creator Course blockchain transaction...");
            try {
                const rewardAmount = process.env.CREATOR_COURSE_REWARD || '0'; // Default 0 GLL if not set
                
                // Update database balance (only if user/creator found)
                if (user) {
                    await prisma.user.update({
                        where: { id: user.id },
                        data: {
                            gllBalance: {
                                increment: parseFloat(rewardAmount)
                            }
                        }
                    });
                    // console.log("✅ Updated user database balance for course");
                } else if (creator) {
                    await prisma.creator.update({
                        where: { id: creator.id },
                        data: {
                            gllBalance: {
                                increment: parseFloat(rewardAmount)
                            }
                        }
                    });
                    // console.log("✅ Updated creator database balance for course");
                }

                // Send blockchain transaction using the walletAddress variable
                const sendTx = await phoneLinkContract.getGLL(convertToEtherAmount(rewardAmount.toString()), walletAddress);
                await sendTx.wait();
                // console.log("✅ Creator Course GLL transaction completed successfully");
                // console.log("📝 Transaction Hash:", sendTx.hash);

                // Update the course with transaction hash and reward amount
                await prisma.creatorCourse.update({
                    where: { id: course.id },
                    data: {
                        transactionHash: sendTx.hash,
                        rewardAmount: parseFloat(rewardAmount)
                    }
                });
                // console.log("✅ Updated course with transaction hash and reward amount");
                
            } catch (blockchainError) {
                console.error("❌ Creator Course blockchain transaction failed:", blockchainError.message);
                // Don't crash the endpoint, just log the error
            }
        }
        
        const responseData = {
            success: true,
            message: "Course created successfully",
            data: course
        };
        res.send(encryptJSON(responseData));
    } catch (error) {
        // Clean up temporary file if it exists and there was an error
        if (req.file) {
            try {
                const UPLOAD_DIR = path.resolve(__dirname, '..', 'uploads');
                const resolvedFilePath = path.resolve(req.file.path);
                if (resolvedFilePath.startsWith(UPLOAD_DIR) && fs.existsSync(resolvedFilePath)) {
                    fs.unlinkSync(resolvedFilePath);
                }
            } catch (unlinkError) {
                // console.log("Warning: Could not delete temporary file:", unlinkError);
            }
        }
        
        console.error("Error creating creator course:", error);
        res.status(500).json({
            success: false,
            message: 'Failed to create course',
            error: error.message
        });
    }
});

// Get All Creator Courses
router.get('/creatorCourse', async (req, res) => {
    try {
        const { email, category, status, priceType, page = 1, limit = 10 } = req.query;
        
        const whereClause = {};
        if (email) whereClause.email = email;
        if (category) whereClause.category = category;
        if (status) whereClause.status = status;
        if (priceType) whereClause.priceType = priceType;
        
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const courses = await prisma.creatorCourse.findMany({
            where: whereClause,
            skip: skip,
            take: parseInt(limit),
            orderBy: { createdAt: 'desc' }
        });
        
        const total = await prisma.creatorCourse.count({ where: whereClause });
        
        const responseData = {
            success: true,
            data: courses,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        };
        res.send(encryptJSON(responseData));
    } catch (error) {
        console.error("Error fetching creator courses:", error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch courses',
            error: error.message
        });
    }
});

router.get('/createWallets/:number',async(req,res) => {
    const wallets = [];
    const { number } = req.params;
    for (let i = 0; i < number; i++) {
    // Create a completely independent wallet each time
    const w = Wallet.createRandom();

    wallets.push({
        index: i,
        address: w.address,
        privateKey: w.privateKey,
        mnemonic: w.mnemonic ? w.mnemonic.phrase : null,
    });
    }

    res.send(wallets)
})
// Get Single Creator Course
router.get('/creatorCourse/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Validate that id is a valid MongoDB ObjectId format
        if (!/^[0-9a-fA-F]{24}$/.test(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid course ID format'
            });
        }
        
        const course = await prisma.creatorCourse.findUnique({
            where: { id: id }
        });
        
        if (!course) {
            return res.status(404).json({
                success: false,
                message: 'Course not found'
            });
        }
        
        const responseData = {
            success: true,
            data: course
        };
        res.send(encryptJSON(responseData));
    } catch (error) {
        console.error("Error fetching creator course:", error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch course',
            error: error.message
        });
    }
});

// Update Creator Course
router.put('/creatorCourse/:id', createPostLimiter, upload.single('courseImage'), async (req, res) => {
    try {
        const { id } = req.params;
        const { email, title, description, price, priceType, minPrice, maxPrice, status, category, tags, removeImage } = req.body;
        
        // Validate that id is a valid MongoDB ObjectId format
        if (!/^[0-9a-fA-F]{24}$/.test(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid course ID format'
            });
        }
        
        // Check if course exists
        const existingCourse = await prisma.creatorCourse.findUnique({
            where: { id: id }
        });
        
        if (!existingCourse) {
            return res.status(404).json({
                success: false,
                message: 'Course not found'
            });
        }
        
        // Check if user owns this course
        if (existingCourse.email !== email) {
            return res.status(403).json({
                success: false,
                message: 'You can only update your own courses'
            });
        }
        
        // Validation
        if (description && description.length > 500) {
            return res.status(400).json({
                success: false,
                message: 'Description must be 500 characters or less'
            });
        }
        
        if (title && title.length > 100) {
            return res.status(400).json({
                success: false,
                message: 'Title must be 100 characters or less'
            });
        }

        // Validate price type and range
        if (priceType === 'range' && (!minPrice || !maxPrice || minPrice >= maxPrice)) {
            return res.status(400).json({
                success: false,
                message: 'For range pricing, minPrice must be less than maxPrice'
            });
        }
        
        let courseImageUrl = existingCourse.courseImage;
        
        // Handle image removal
        if (removeImage === 'true') {
            // Delete old image from S3 if it exists
            if (existingCourse.courseImage) {
                try {
                    const key = existingCourse.courseImage.split('/').pop();
                    await s3.deleteObject({
                        Bucket: process.env.AWS_BUCKET_NAME,
                        Key: `creator-courses/${key}`
                    }).promise();
                } catch (s3Error) {
                    // console.log("Warning: Could not delete image from S3:", s3Error);
                }
            }
            courseImageUrl = '';
        }
        
        // Upload new course image to S3 if provided
        if (req.file) {
            // Validate the file path to ensure it's inside the allowed upload directory
            const UPLOAD_DIR = path.resolve(__dirname, '..', 'uploads');
            const resolvedFilePath = path.resolve(req.file.path);
            if (!resolvedFilePath.startsWith(UPLOAD_DIR)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid file path'
                });
            }
            
            // Delete old image from S3 if it exists
            if (existingCourse.courseImage) {
                try {
                    const key = existingCourse.courseImage.split('/').pop();
                    await s3.deleteObject({
                        Bucket: process.env.AWS_BUCKET_NAME,
                        Key: `creator-courses/${key}`
                    }).promise();
                } catch (s3Error) {
                    // console.log("Warning: Could not delete image from S3:", s3Error);
                }
            }

            const fileContent = fs.readFileSync(resolvedFilePath);
            
            const params = {
                Bucket: process.env.AWS_BUCKET_NAME,
                Key: `creator-courses/${Date.now()}-${Math.round(Math.random() * 1E9)}-${req.file.originalname}`,
                Body: fileContent,
                ContentType: req.file.mimetype,
            };

            const uploadResult = await s3.upload(params).promise();
            courseImageUrl = uploadResult.Location;

            // Delete the temporary file
            try {
                if (fs.existsSync(resolvedFilePath)) {
                    fs.unlinkSync(resolvedFilePath);
                }
            } catch (unlinkError) {
                // console.log("Warning: Could not delete temporary file:", unlinkError);
            }
        }
        
        const updateData = {
            updatedAt: new Date()
        };
        
        if (title) updateData.title = title.trim();
        if (description) updateData.description = description.trim();
        if (price) updateData.price = price.trim();
        if (priceType) updateData.priceType = priceType;
        if (minPrice !== undefined) updateData.minPrice = priceType === 'range' ? parseFloat(minPrice) : null;
        if (maxPrice !== undefined) updateData.maxPrice = priceType === 'range' ? parseFloat(maxPrice) : null;
        if (status) updateData.status = status;
        if (category) updateData.category = category;
        if (tags) updateData.tags = tags.split(',').map(tag => tag.trim());
        if (courseImageUrl !== undefined) updateData.courseImage = courseImageUrl;
        
        const updatedCourse = await prisma.creatorCourse.update({
            where: { id: id },
            data: updateData
        });
        
        const responseData = {
            success: true,
            message: "Course updated successfully",
            data: updatedCourse
        };
        res.send(encryptJSON(responseData));
    } catch (error) {
        // Clean up temporary file if it exists and there was an error
        if (req.file) {
        try {
            const UPLOAD_DIR = path.resolve(__dirname, '..', 'uploads');
            const resolvedFilePath = path.resolve(req.file.path);
            if (resolvedFilePath.startsWith(UPLOAD_DIR) && fs.existsSync(resolvedFilePath)) {
                fs.unlinkSync(resolvedFilePath);
            }
        } catch (unlinkError) {
            // console.log("Warning: Could not delete temporary file:", unlinkError);
        }
    }
    
    console.error("Error updating creator course:", error);
    res.status(500).json({
        success: false,
        message: 'Failed to update course',
        error: error.message
    });
}
});

// Delete Creator Course
router.delete('/creatorCourse/:id', createPostLimiter, async (req, res) => {
    try {
        const { id } = req.params;
        const { email } = req.body;
        
        // Validate that id is a valid MongoDB ObjectId format
        if (!/^[0-9a-fA-F]{24}$/.test(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid course ID format'
            });
        }
        
        // Check if course exists
        const existingCourse = await prisma.creatorCourse.findUnique({
            where: { id: id }
        });
        
        if (!existingCourse) {
            return res.status(404).json({
                success: false,
                message: 'Course not found'
            });
        }
        
        // Check if user owns this course
        if (existingCourse.email !== email) {
            return res.status(403).json({
                success: false,
                message: 'You can only delete your own courses'
            });
        }
        
        // Delete course image from S3 if it exists
        if (existingCourse.courseImage) {
            try {
                const key = existingCourse.courseImage.split('/').pop();
                await s3.deleteObject({
                    Bucket: process.env.AWS_BUCKET_NAME,
                    Key: `creator-courses/${key}`
                }).promise();
            } catch (s3Error) {
                // console.log("Warning: Could not delete image from S3:", s3Error);
            }
        }
        
        // Delete the course from database
        await prisma.creatorCourse.delete({
            where: { id: id }
        });
        
        const responseData = {
            success: true,
            message: "Course deleted successfully"
        };
        res.send(encryptJSON(responseData));
    } catch (error) {
        console.error("Error deleting creator course:", error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete course',
            error: error.message
        });
    }
});

// ==================== CREATOR PROFILE EDIT ROUTE ====================

// Edit Creator Profile (name, username, profilePicture)
router.put('/creator/profile', createPostLimiter, upload.single('profilePicture'), async (req, res) => {
    try {
        const { email, name, username } = req.body;
        
        // Validation
        if (!email) {
            return res.status(400).json({
                success: false,
                message: 'Email is required'
            });
        }
        
        if (!name && !username && !req.file) {
            return res.status(400).json({
                success: false,
                message: 'At least one field (name, username, or profilePicture) must be provided'
            });
        }
        
        // Validate name length if provided
        if (name && name.length > 100) {
            return res.status(400).json({
                success: false,
                message: 'Name must be 100 characters or less'
            });
        }
        
        // Validate username length if provided
        if (username && username.length > 50) {
            return res.status(400).json({
                success: false,
                message: 'Username must be 50 characters or less'
            });
        }
        
        // Check if creator exists
        const existingCreator = await prisma.creator.findUnique({
            where: { email: email }
        });
        
        if (!existingCreator) {
            return res.status(404).json({
                success: false,
                message: 'Creator not found'
            });
        }
        
        // Check if username is already taken by another creator
        if (username && username !== existingCreator.username) {
            const usernameExists = await prisma.creator.findUnique({
                where: { username: username }
            });
            
            if (usernameExists) {
                return res.status(400).json({
                    success: false,
                    message: 'Username is already taken'
                });
            }
        }
        
        let profilePictureUrl = existingCreator.profilePicture;
        
        // Handle profile picture upload
        if (req.file) {
            // Validate the file path to ensure it's inside the allowed upload directory
            const UPLOAD_DIR = path.resolve(__dirname, '..', 'uploads');
            const resolvedFilePath = path.resolve(req.file.path);
            if (!resolvedFilePath.startsWith(UPLOAD_DIR)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid file path'
                });
            }
            
            // Delete old profile picture from S3 if it exists
            if (existingCreator.profilePicture) {
                try {
                    const key = existingCreator.profilePicture.split('/').pop();
                    await s3.deleteObject({
                        Bucket: process.env.AWS_BUCKET_NAME,
                        Key: `creator-profiles/${key}`
                    }).promise();
                } catch (s3Error) {
                    // console.log("Warning: Could not delete old profile picture from S3:", s3Error);
                }
            }
            
            // Upload new profile picture to S3
            const fileContent = fs.readFileSync(resolvedFilePath);
            
            const params = {
                Bucket: process.env.AWS_BUCKET_NAME,
                Key: `creator-profiles/${Date.now()}-${Math.round(Math.random() * 1E9)}-${req.file.originalname}`,
                Body: fileContent,
                ContentType: req.file.mimetype,
            };

            const uploadResult = await s3.upload(params).promise();
            profilePictureUrl = uploadResult.Location;

            // Delete the temporary file
            try {
                if (fs.existsSync(resolvedFilePath)) {
                    fs.unlinkSync(resolvedFilePath);
                }
            } catch (unlinkError) {
                // console.log("Warning: Could not delete temporary file:", unlinkError);
            }
        }
        
        // Prepare update data
        const updateData = {
            updatedAt: new Date()
        };
        
        if (name) updateData.name = name.trim();
        if (username) updateData.username = username.trim();
        if (profilePictureUrl !== existingCreator.profilePicture) {
            updateData.profilePicture = profilePictureUrl;
        }
        
        // Update the creator profile
        const updatedCreator = await prisma.creator.update({
            where: { email: email },
            data: updateData
        });
        
        const responseData = {
            success: true,
            message: "Creator profile updated successfully",
            data: {
                id: updatedCreator.id,
                name: updatedCreator.name,
                username: updatedCreator.username,
                email: updatedCreator.email,
                profilePicture: updatedCreator.profilePicture,
                updatedAt: updatedCreator.updatedAt
            }
        };
        
        res.send(encryptJSON(responseData));
    } catch (error) {
        // Clean up temporary file if it exists and there was an error
        if (req.file) {
            try {
                const UPLOAD_DIR = path.resolve(__dirname, '..', 'uploads');
                const resolvedFilePath = path.resolve(req.file.path);
                if (resolvedFilePath.startsWith(UPLOAD_DIR) && fs.existsSync(resolvedFilePath)) {
                    fs.unlinkSync(resolvedFilePath);
                }
            } catch (unlinkError) {
                // console.log("Warning: Could not delete temporary file:", unlinkError);
            }
        }
        
        console.error("Error updating creator profile:", error);
        res.status(500).json({
            success: false,
            message: 'Failed to update creator profile',
            error: error.message
        });
    }
});

// ==================== COMPREHENSIVE CREATOR DATA ROUTE ====================

// GET /creator-complete-data/:email - Fetch all creator data by email
router.get('/creator-complete-data/:email', generalPostLimiter, async (req, res) => {
    try {
        const { email } = req.params;
        const decodedEmail = decodeURIComponent(email);
        
        const { 
            page = 1, 
            limit = 10, 
            sort = 'createdAt', 
            order = 'desc' 
        } = req.query;

        // Validate pagination parameters
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        
        if (pageNum < 1 || limitNum < 1 || limitNum > 50) {
            return res.status(400).json({
                success: false,
                message: "Invalid pagination parameters. Page must be >= 1, limit must be between 1-50"
            });
        }

        // Validate sort parameters
        const allowedSortFields = ['createdAt', 'updatedAt', 'title'];
        const allowedOrderValues = ['asc', 'desc'];
        
        if (!allowedSortFields.includes(sort)) {
            return res.status(400).json({
                success: false,
                message: "Invalid sort field. Allowed values: createdAt, updatedAt, title"
            });
        }

        if (!allowedOrderValues.includes(order)) {
            return res.status(400).json({
                success: false,
                message: "Invalid order. Allowed values: asc, desc"
            });
        }

        // Calculate skip value for pagination
        const skip = (pageNum - 1) * limitNum;

        // Find user/creator by email
        let user = await prisma.user.findFirst({
            where: { 
                OR: [
                    { email: decodedEmail },
                    { name: decodedEmail }
                ]
            }
        });

        let creator = null;
        if (!user) {
            creator = await prisma.creator.findFirst({
                where: { 
                    OR: [
                        { email: decodedEmail },
                        { name: decodedEmail },
                        { username: decodedEmail }
                    ]
                }
            });
        }

        if (!user && !creator) {
            return res.status(404).json({
                success: false,
                message: "User/Creator not found"
            });
        }

        const targetUser = user || creator;

        // Fetch all creator data in parallel
        const [services, products, courses, posts] = await Promise.all([
            // Creator Services
            prisma.creatorService.findMany({
                where: { email: decodedEmail },
                orderBy: { [sort]: order },
                skip: skip,
                take: limitNum,
                select: {
                    id: true,
                    email: true,
                    title: true,
                    description: true,
                    price: true,
                    status: true,
                    icon: true,
                    proofOfCreationScore: true,
                    transactionHash: true,
                    rewardAmount: true,
                    createdAt: true,
                    updatedAt: true
                }
            }),

            // Creator Products
            prisma.creatorProduct.findMany({
                where: { email: decodedEmail },
                orderBy: { [sort]: order },
                skip: skip,
                take: limitNum,
                select: {
                    id: true,
                    email: true,
                    title: true,
                    description: true,
                    price: true,
                    status: true,
                    category: true,
                    tags: true,
                    images: true,
                    proofOfCreationScore: true,
                    transactionHash: true,
                    rewardAmount: true,
                    createdAt: true,
                    updatedAt: true
                }
            }),

            // Creator Courses
            prisma.creatorCourse.findMany({
                where: { email: decodedEmail },
                orderBy: { [sort]: order },
                skip: skip,
                take: limitNum,
                select: {
                    id: true,
                    email: true,
                    title: true,
                    description: true,
                    courseImage: true,
                    price: true,
                    priceType: true,
                    minPrice: true,
                    maxPrice: true,
                    status: true,
                    category: true,
                    tags: true,
                    proofOfCreationScore: true,
                    transactionHash: true,
                    rewardAmount: true,
                    createdAt: true,
                    updatedAt: true
                }
            }),

            // Creator Posts
            prisma.creatorPost.findMany({
                where: {
                    OR: [
                        { userEmail: decodedEmail },
                        { user_username: decodedEmail },
                        { username: decodedEmail }
                    ]
                },
                orderBy: { [sort]: order },
                skip: skip,
                take: limitNum,
                select: {
                    id: true,
                    postId: true,
                    content: true,
                    username: true,
                    user_username: true,
                    userEmail: true,
                    profilePicture: true,
                    timestamp: true,
                    images: true,
                    videos: true,
                    transactionHash: true,
                    rewardAmount: true,
                    createdAt: true,
                    updatedAt: true,
                    _count: {
                        select: {
                            likes: true,
                            comments: true
                        }
                    }
                }
            })
        ]);

        // Get total counts for pagination
        const [totalServices, totalProducts, totalCourses, totalPosts] = await Promise.all([
            prisma.creatorService.count({ where: { email: decodedEmail } }),
            prisma.creatorProduct.count({ where: { email: decodedEmail } }),
            prisma.creatorCourse.count({ where: { email: decodedEmail } }),
            prisma.creatorPost.count({
                where: {
                    OR: [
                        { userEmail: decodedEmail },
                        { user_username: decodedEmail },
                        { username: decodedEmail }
                    ]
                }
            })
        ]);

        // Calculate transaction statistics for each type
        const [serviceStats, productStats, courseStats, postStats] = await Promise.all([
            // Service transaction stats
            prisma.creatorService.aggregate({
                where: {
                    email: decodedEmail,
                    transactionHash: { not: null }
                },
                _sum: { rewardAmount: true },
                _count: { transactionHash: true }
            }),

            // Product transaction stats
            prisma.creatorProduct.aggregate({
                where: {
                    email: decodedEmail,
                    transactionHash: { not: null }
                },
                _sum: { rewardAmount: true },
                _count: { transactionHash: true }
            }),

            // Course transaction stats
            prisma.creatorCourse.aggregate({
                where: {
                    email: decodedEmail,
                    transactionHash: { not: null }
                },
                _sum: { rewardAmount: true },
                _count: { transactionHash: true }
            }),

            // Post transaction stats
            prisma.creatorPost.aggregate({
                where: {
                    OR: [
                        { userEmail: decodedEmail },
                        { user_username: decodedEmail },
                        { username: decodedEmail }
                    ],
                    transactionHash: { not: null }
                },
                _sum: { rewardAmount: true },
                _count: { transactionHash: true }
            })
        ]);

        // Format posts with likes and comments
        const formattedPosts = posts.map(post => ({
            id: post.postId,
            content: post.content,
            username: post.username,
            user_username: post.user_username,
            userEmail: post.userEmail,
            profilePicture: post.profilePicture || targetUser.profilePicture,
            timestamp: post.timestamp,
            createdAt: post.createdAt,
            updatedAt: post.updatedAt,
            images: post.images,
            videos: post.videos,
            transactionHash: post.transactionHash,
            rewardAmount: post.rewardAmount,
            likes: post._count.likes,
            comments: post._count.comments
        }));

        // Calculate pagination metadata
        const totalItems = totalServices + totalProducts + totalCourses + totalPosts;
        const totalPages = Math.ceil(totalItems / limitNum);
        const hasNextPage = pageNum < totalPages;
        const hasPrevPage = pageNum > 1;

        // Calculate overall transaction statistics
        const totalRewards = (serviceStats._sum.rewardAmount || 0) + 
                           (productStats._sum.rewardAmount || 0) + 
                           (courseStats._sum.rewardAmount || 0) + 
                           (postStats._sum.rewardAmount || 0);
        
        const totalTransactions = (serviceStats._count.transactionHash || 0) + 
                                (productStats._count.transactionHash || 0) + 
                                (courseStats._count.transactionHash || 0) + 
                                (postStats._count.transactionHash || 0);

        const averageReward = totalTransactions > 0 ? totalRewards / totalTransactions : 0;

        // Return comprehensive creator data
        res.status(200).json({
            success: true,
            message: "Complete creator data retrieved successfully",
            data: {
                user: {
                    id: targetUser.id,
                    name: targetUser.name,
                    email: targetUser.email,
                    username: targetUser.username,
                    walletAddress: targetUser.walletAddress,
                    gllBalance: targetUser.gllBalance,
                    profilePicture: targetUser.profilePicture,
                    userType: user ? 'user' : 'creator',
                    createdAt: targetUser.createdAt,
                    updatedAt: targetUser.updatedAt
                },
                services: {
                    data: services,
                    total: totalServices,
                    transactionStats: {
                        totalRewards: serviceStats._sum.rewardAmount || 0,
                        totalTransactions: serviceStats._count.transactionHash || 0,
                        averageReward: serviceStats._count.transactionHash > 0 ? 
                            (serviceStats._sum.rewardAmount || 0) / serviceStats._count.transactionHash : 0
                    }
                },
                products: {
                    data: products,
                    total: totalProducts,
                    transactionStats: {
                        totalRewards: productStats._sum.rewardAmount || 0,
                        totalTransactions: productStats._count.transactionHash || 0,
                        averageReward: productStats._count.transactionHash > 0 ? 
                            (productStats._sum.rewardAmount || 0) / productStats._count.transactionHash : 0
                    }
                },
                courses: {
                    data: courses,
                    total: totalCourses,
                    transactionStats: {
                        totalRewards: courseStats._sum.rewardAmount || 0,
                        totalTransactions: courseStats._count.transactionHash || 0,
                        averageReward: courseStats._count.transactionHash > 0 ? 
                            (courseStats._sum.rewardAmount || 0) / courseStats._count.transactionHash : 0
                    }
                },
                posts: {
                    data: formattedPosts,
                    total: totalPosts,
                    transactionStats: {
                        totalRewards: postStats._sum.rewardAmount || 0,
                        totalTransactions: postStats._count.transactionHash || 0,
                        averageReward: postStats._count.transactionHash > 0 ? 
                            (postStats._sum.rewardAmount || 0) / postStats._count.transactionHash : 0
                    }
                },
                overallStats: {
                    totalRewards: totalRewards,
                    totalTransactions: totalTransactions,
                    averageReward: averageReward,
                    totalItems: totalItems
                },
                pagination: {
                    currentPage: pageNum,
                    totalPages: totalPages,
                    totalItems: totalItems,
                    itemsPerPage: limitNum,
                    hasNextPage: hasNextPage,
                    hasPrevPage: hasPrevPage
                },
                filters: {
                    sort: sort,
                    order: order
                }
            }
        });

    } catch (error) {
        console.error("Error fetching complete creator data:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error while fetching creator data"
        });
    }
});

// ==================== GAME HIGH SCORES ROUTES ====================

// Supported games and validation constants
const SUPPORTED_GAMES = ["flappy-bird", "chrome-dinosaur"];
const MAX_SCORE = 999999;

// Validation function for score data
function validateScoreData(data) {
    if (!data.gameName || !SUPPORTED_GAMES.includes(data.gameName)) {
        throw new Error("INVALID_GAME");
    }

    if (
        !data.score ||
        typeof data.score !== "number" ||
        data.score < 0 ||
        data.score > MAX_SCORE
    ) {
        throw new Error("INVALID_SCORE");
    }

    if (
        !data.playerEmail ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.playerEmail)
    ) {
        throw new Error("INVALID_EMAIL");
    }

    if (!data.playerName || data.playerName.trim().length === 0) {
        throw new Error("INVALID_PLAYER_NAME");
    }
}

// Helper function to serialize BigInt values to strings
function serializeBigInt(obj) {
    if (obj === null || obj === undefined) return obj;
    
    if (typeof obj === 'bigint') {
        return obj.toString();
    }
    
    if (Array.isArray(obj)) {
        return obj.map(serializeBigInt);
    }
    
    if (typeof obj === 'object') {
        const serialized = {};
        for (const [key, value] of Object.entries(obj)) {
            serialized[key] = serializeBigInt(value);
        }
        return serialized;
    }
    
    return obj;
}

// Helper function to submit game score
async function submitGameScore(data) {
    try {
        // Check if user already has a score for this game
        const existingScore = await prisma.gameHighScore.findFirst({
            where: {
                gameName: data.gameName,
                playerEmail: data.playerEmail,
            },
        });

        let result;
        let isNewHighScore = false;
        let previousHighScore = 0;

        if (existingScore) {
            if (data.score > existingScore.score) {
                // Update existing score if new score is higher
                result = await prisma.gameHighScore.update({
                    where: { id: existingScore.id },
                    data: {
                        score: data.score,
                        timestamp: data.timestamp,
                        date: data.date,
                        playerName: data.playerName,
                    },
                });
                isNewHighScore = true;
                previousHighScore = existingScore.score;
            } else {
                // Don't update if score is not higher
                result = existingScore;
            }
        } else {
            // Create new score record
            result = await prisma.gameHighScore.create({
                data: {
                    gameName: data.gameName,
                    score: data.score,
                    playerName: data.playerName,
                    playerEmail: data.playerEmail,
                    timestamp: data.timestamp,
                    date: data.date,
                },
            });
            isNewHighScore = true;
        }

        // Serialize BigInt values before returning
        const serializedResult = serializeBigInt(result);

        return {
            success: true,
            message: "Score submitted successfully",
            data: {
                ...serializedResult,
                isNewHighScore,
                previousHighScore,
            },
        };
    } catch (error) {
        console.error("Error submitting score:", error);
        return {
            success: false,
            error: "DATABASE_ERROR",
            message: "Failed to submit score",
        };
    }
}

// Helper function to get user's high scores
async function getUserHighScores(playerEmail) {
    try {
        const scores = await prisma.gameHighScore.findMany({
            where: { playerEmail },
            orderBy: { score: "desc" },
        });

        // Group by game and get highest score for each
        const gameHighScores = scores.reduce((acc, score) => {
            if (!acc[score.gameName] || score.score > acc[score.gameName].score) {
                acc[score.gameName] = score;
            }
            return acc;
        }, {});

        // Serialize BigInt values before returning
        const serializedGameHighScores = serializeBigInt(gameHighScores);

        return {
            success: true,
            data: {
                userEmail: playerEmail,
                gameHighScores: serializedGameHighScores,
            },
        };
    } catch (error) {
        console.error("Error fetching user scores:", error);
        return {
            success: false,
            error: "DATABASE_ERROR",
            message: "Failed to fetch user scores",
        };
    }
}

// Helper function to get game leaderboard
async function getGameLeaderboard(gameName, limit = 10) {
    try {
        // Get all scores for the game
        const allScores = await prisma.gameHighScore.findMany({
            where: { gameName },
            orderBy: { score: "desc" },
        });

        // Group by player and get their highest score
        const playerHighScores = allScores.reduce((acc, score) => {
            if (
                !acc[score.playerEmail] ||
                score.score > acc[score.playerEmail].score
            ) {
                acc[score.playerEmail] = score;
            }
            return acc;
        }, {});

        // Convert to array and sort by score
        const leaderboard = Object.values(playerHighScores)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);

        // Serialize BigInt values before returning
        const serializedLeaderboard = serializeBigInt(leaderboard);

        return {
            success: true,
            data: {
                gameName,
                leaderboard: serializedLeaderboard,
                totalPlayers: Object.keys(playerHighScores).length,
            },
        };
    } catch (error) {
        console.error("Error fetching leaderboard:", error);
        return {
            success: false,
            error: "DATABASE_ERROR",
            message: "Failed to fetch leaderboard",
        };
    }
}

// Helper function to get global high scores
async function getGlobalHighScores() {
    try {
        const globalHighScores = {};

        for (const gameName of SUPPORTED_GAMES) {
            const highestScore = await prisma.gameHighScore.findFirst({
                where: { gameName },
                orderBy: { score: "desc" },
            });

            if (highestScore) {
                globalHighScores[gameName] = highestScore;
            }
        }

        // Serialize BigInt values before returning
        const serializedGlobalHighScores = serializeBigInt(globalHighScores);

        return {
            success: true,
            data: serializedGlobalHighScores,
        };
    } catch (error) {
        console.error("Error fetching global high scores:", error);
        return {
            success: false,
            error: "DATABASE_ERROR",
            message: "Failed to fetch global high scores",
        };
    }
}

// Rate limiter for game score submissions
const gameScoreLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 20, // limit each IP to 20 score submissions per minute
    message: {
        success: false,
        message: "Too many score submission requests, please try again later."
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// POST route for submitting game scores
router.post('/game-scores/submit', gameScoreLimiter, async (req, res) => {
    try {
        // Validate request data
        validateScoreData(req.body);

        const result = await submitGameScore(req.body);

        if (result.success) {
            res.status(200).json(result);
        } else {
            res.status(400).json(result);
        }
    } catch (error) {
        console.error("API Error:", error);
        let statusCode = 500;
        let errorMessage = "An unexpected error occurred";

        if (error.message === "INVALID_GAME") {
            statusCode = 400;
            errorMessage = "Game name not supported";
        } else if (error.message === "INVALID_SCORE") {
            statusCode = 400;
            errorMessage = "Score must be a positive integer";
        } else if (error.message === "INVALID_EMAIL") {
            statusCode = 400;
            errorMessage = "Email format invalid";
        } else if (error.message === "INVALID_PLAYER_NAME") {
            statusCode = 400;
            errorMessage = "Player name is required";
        }

        res.status(statusCode).json({
            success: false,
            error: error.message || "INTERNAL_SERVER_ERROR",
            message: errorMessage,
        });
    }
});

// GET route for fetching user's high scores
router.get('/game-scores/user/:email', async (req, res) => {
    try {
        const { email } = req.params;
        
        // Decode URL-encoded email
        const decodedEmail = decodeURIComponent(email);
        
        if (!decodedEmail) {
            return res.status(400).json({
                success: false,
                error: "INVALID_EMAIL",
                message: "Email parameter is required",
            });
        }

        const result = await getUserHighScores(decodedEmail);
        res.status(200).json(result);
    } catch (error) {
        console.error("API Error:", error);
        res.status(500).json({
            success: false,
            error: "INTERNAL_SERVER_ERROR",
            message: "An unexpected error occurred",
        });
    }
});

// GET route for fetching game leaderboard
router.get('/game-scores/leaderboard/:gameName', async (req, res) => {
    try {
        const { gameName } = req.params;
        const limit = parseInt(req.query.limit) || 10;

        if (!gameName || !SUPPORTED_GAMES.includes(gameName)) {
            return res.status(400).json({
                success: false,
                error: "INVALID_GAME",
                message: "Game name parameter is required and must be supported",
            });
        }

        const result = await getGameLeaderboard(gameName, limit);
        res.status(200).json(result);
    } catch (error) {
        console.error("API Error:", error);
        res.status(500).json({
            success: false,
            error: "INTERNAL_SERVER_ERROR",
            message: "An unexpected error occurred",
        });
    }
});

// GET route for fetching global high scores
router.get('/game-scores/global', async (req, res) => {
    try {
        const result = await getGlobalHighScores();
        res.status(200).json(result);
    } catch (error) {
        console.error("API Error:", error);
        res.status(500).json({
            success: false,
            error: "INTERNAL_SERVER_ERROR",
            message: "An unexpected error occurred",
        });
    }
});

// POST route for bulk submitting scores (for localStorage sync)
router.post('/game-scores/bulk-submit', gameScoreLimiter, async (req, res) => {
    try {
        const { userEmail, userName, scores } = req.body;

        if (!userEmail || !userName || !scores || !Array.isArray(scores)) {
            return res.status(400).json({
                success: false,
                error: "INVALID_REQUEST",
                message: "userEmail, userName, and scores array are required",
            });
        }

        const results = [];
        let newHighScores = 0;
        let updatedScores = 0;

        for (const scoreData of scores) {
            try {
                // Validate each score
                validateScoreData({
                    ...scoreData,
                    playerName: userName,
                    playerEmail: userEmail,
                });

                const result = await submitGameScore({
                    ...scoreData,
                    playerName: userName,
                    playerEmail: userEmail,
                });

                if (result.success && result.data.isNewHighScore) {
                    if (result.data.previousHighScore > 0) {
                        updatedScores++;
                    } else {
                        newHighScores++;
                    }
                }

                // Serialize BigInt values in the result
                const serializedResult = serializeBigInt(result);
                results.push(serializedResult);
            } catch (error) {
                console.error("Error processing score:", error);
                results.push({
                    success: false,
                    error: error.message,
                    message: "Failed to process score",
                });
            }
        }

        res.status(200).json({
            success: true,
            message: "Scores submitted successfully",
            data: {
                submittedCount: scores.length,
                newHighScores,
                updatedScores,
                results,
            },
        });
    } catch (error) {
        console.error("API Error:", error);
        res.status(500).json({
            success: false,
            error: "INTERNAL_SERVER_ERROR",
            message: "An unexpected error occurred",
        });
    }
});

module.exports = router;