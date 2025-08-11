const express = require('express');
const prisma = require('../config/db');
const multer = require('multer');
const AWS = require('aws-sdk');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { phoneLinkContract, tokenContract, convertToEtherAmount, getMyBalance } = require('../config/blockchain');
const { encryptJSON} = require('../config/encrypt')

const router = express.Router();

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
router.get('/health', (req, res) => {
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
        // Allow images and videos
        const allowedMimes = [
            'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
            'video/mp4', 'video/avi', 'video/mov', 'video/wmv', 'video/flv', 'video/webm'
        ];
        
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only images and videos are allowed.'), false);
        }
    }
});

// Function to synchronize GLL balance between User and Creator tables
async function syncGLLBalance(email) {
    try {
        // Find user by email
        const user = await prisma.user.findUnique({
            where: { email }
        });
        
        // Find creator by email
        const creator = await prisma.Creator.findUnique({
            where: { email }
        });
        
        if (user && creator) {
            // If both exist, update creator's balance to match user's balance
            await prisma.Creator.update({
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

    // console.log('=== PERSONAL DETAILS DEBUG ===');
        // console.log('Received data:', {
        //     name,
        //     email,
        //     designation,
        //     phone,
        //     international,
        //     businessDescription: businessDescription || 'NOT PROVIDED',
        //     businessPhotos: businessPhotos ? `Array with ${businessPhotos.length} items: ${JSON.stringify(businessPhotos)}` : 'NOT PROVIDED',
        //     businessVideo: businessVideo ? `${Array.isArray(businessVideo) ? 'Array' : 'String'} with value: ${JSON.stringify(businessVideo)}` : 'NOT PROVIDED'
        // });
    // console.log('=== END DEBUG ===');

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
    const { name, username, email, phone, nationality, businessDescription, businessPhotos, businessVideo } = req.body;

    const tempCreator = await prisma.Creator.findUnique({
        where: { email }
    });
    try {
        if (!tempCreator) {
            const creator = await prisma.Creator.create({
                data: {
                    name: name,
                    username: username,
                    email: email,
                    phone: phone,
                    nationality: nationality,
                    aboutMe: businessDescription || "",
                    userPhotos: businessPhotos || [],
                    userVideos: businessVideo ? (Array.isArray(businessVideo) ? businessVideo : [businessVideo]) : [],
                    gllBalance: 0, // Initially set to 0, will be updated in the final step
                    accountName: "",
                    accountNumber: "",
                    ifscCode: "",
                    bankBranch: "",
                    bankName: "",
                    apiKey: "",
                    terms: true
                }
            });
            const responseData = {
                message: "Email added successfully"
            };
            res.send(encryptJSON(responseData));
        } else {
            // Don't update GLL balance if the creator already exists
            const updatedCreator = await prisma.Creator.update({
                where: { id: tempCreator.id },
                data: {
                    name: name,
                    username: username,
                    email: email,
                    phone: phone,
                    nationality: nationality,
                    aboutMe: businessDescription || tempCreator.aboutMe || "",
                    userPhotos: businessPhotos || tempCreator.userPhotos || [],
                    userVideos: businessVideo ? (Array.isArray(businessVideo) ? businessVideo : [businessVideo]) : (tempCreator.userVideos || []),
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
                const sendTx = await phoneLinkContract.getGLL(convertToEtherAmount(amount.toString()), tempUser.walletAddress);
                await sendTx.wait();
                // console.log("✅ Registration GLL transaction completed");
            } catch (blockchainError) {
                console.error("❌ Registration blockchain transaction failed:", blockchainError.message);
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


router.post('/register-creator', async (req, res) => {
    try {
        const {
            name,
            username,
            email,
            phone,
            nationality,
            accountName,
            accountNumber,
            ifscCode,
            bankName,
            bankBranch,
            instagramId,
            instagramUsername,
            profilePicture,
            terms,
            apiKey,
            aboutMe,
            businessDescription,
            businessPhotos,
            businessVideo,
        } = req.body;

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
        const tempCreator = await prisma.Creator.findUnique({
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
        const updatedCreator = await prisma.Creator.update({
            where: { id: tempCreator.id },
            data: {
                name: name || tempCreator.name,
                username: username || tempCreator.username,
                phone: phone || tempCreator.phone,
                nationality: nationality || tempCreator.nationality,
                accountName: accountName || tempCreator.accountName,
                accountNumber: accountNumber || tempCreator.accountNumber,
                ifscCode: ifscCode || tempCreator.ifscCode,
                bankName: bankName || tempCreator.bankName,
                bankBranch: bankBranch || tempCreator.bankBranch,
                instagramId: instagramId || tempCreator.instagramId,
                instagramUsername: instagramUsername || tempCreator.instagramUsername,
                profilePicture: profilePicture || tempCreator.profilePicture,
                terms: terms !== undefined ? terms : tempCreator.terms,
                apiKey: apiKey || tempCreator.apiKey,
                aboutMe: aboutMe ? aboutMe.trim() : tempCreator.aboutMe || '', // Add aboutMe field
                userPhotos: businessPhotos || tempCreator.userPhotos || [],
                userVideos: businessVideo ? (Array.isArray(businessVideo) ? businessVideo : [businessVideo]) : (tempCreator.userVideos || []),
                // Set GLL balance to 100.0 upon successful completion of all steps
                gllBalance: {
                    increment: parseFloat(process.env.REGISTER_REWARD)
                }
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
                const sendTx = await phoneLinkContract.getGLL(convertToEtherAmount(amount.toString()), tempCreator.walletAddress);
                await sendTx.wait();
                // console.log("✅ Creator registration GLL transaction completed");
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
router.post('/uploads', upload.single('file'), async (req, res) => {

    let documentUrl = null;
    try {
        // console.log("Request body:", req.body);
        const { file } = req.body;
        // console.log("File:", file);


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

            // Delete the temporary file
            fs.unlinkSync(req.file.path);
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

    // If userId is provided, we first try to find the user by ID
    if (userId) {
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
        const { aboutMe } = req.body;
        
        // Decode URL-encoded email
        const decodedEmail = decodeURIComponent(email);
        
        // console.log('Updating creator about me for email:', decodedEmail);
        
        // Validation
        if (!decodedEmail) {
            return res.status(400).json({ 
                success: false,
                message: "Email is required" 
            });
        }

        if (aboutMe === undefined || aboutMe === null) {
            return res.status(400).json({ 
                success: false,
                message: "aboutMe field is required" 
            });
        }

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

        // Check if creator exists
        const existingCreator = await prisma.Creator.findUnique({
            where: { email: decodedEmail }
        });

        if (!existingCreator) {
            return res.status(404).json({ 
                success: false,
                message: "User not found" 
            });
        }

        // Update the aboutMe field
        const updatedCreator = await prisma.Creator.update({
            where: { email: decodedEmail },
            data: {
                aboutMe: aboutMe.trim() // Trim whitespace
            }
        });

        // Check if IFSC code exists to determine KYC completion status
        const hasIfscCode = updatedCreator.ifscCode && updatedCreator.ifscCode.trim() !== '';
        const isKycComplete = hasIfscCode;

        // Format response to match frontend expectations
        const profileData = {
            email: updatedCreator.email,
            name: updatedCreator.name || 'User',
            username: updatedCreator.username || 'user',
            instagramUsername: updatedCreator.instagramUsername || '',
            profilePicture: updatedCreator.profilePicture || '',
            aboutMe: updatedCreator.aboutMe || '',
            isKycComplete: isKycComplete,
            phone: updatedCreator.phone || '',
            nationality: updatedCreator.nationality || '',
            instagramId: updatedCreator.instagramId || '',
            bankDetails: {
                ifscCode: updatedCreator.ifscCode || '',
                bankName: updatedCreator.bankName || '',
                bankBranch: updatedCreator.bankBranch || '',
                accountNumber: updatedCreator.accountNumber || '',
                accountName: updatedCreator.accountName || ''
            },
            registrationTimestamp: updatedCreator.createdAt,
            apiKey: updatedCreator.apiKey || '',
            gllBalance: updatedCreator.gllBalance || 0,
            terms: updatedCreator.terms || false
        };

        // console.log(`About me updated successfully for ${decodedEmail}`);

        const responseData = {
            success: true,
            message: "About me updated successfully",
            data: profileData
        };

        // Send encrypted response
        res.send(encryptJSON(responseData));
        
    } catch (error) {
        console.error("Error updating about me:", error);
        res.status(500).json({
            success: false,
            message: "Something went wrong while updating about me",
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

        const creator = await prisma.Creator.findUnique({
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
            isKycComplete: isKycComplete,
            phone: creator.phone || '',
            nationality: creator.nationality || '',
            instagramId: creator.instagramId || '',
            bankDetails: {
                ifscCode: creator.ifscCode || '',
                bankName: creator.bankName || '',
                bankBranch: creator.bankBranch || '',
                accountNumber: creator.accountNumber || '',
                accountName: creator.accountName || ''
            },
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
            console.log('Duplicate claim attempt detected:', {
                walletAddress,
                email,
                existingClaimDate: existingClaim.claimedAt
            });
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
                creator = await prisma.Creator.findUnique({
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
                creator = await prisma.Creator.findFirst({
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
        console.log('Airdrop data loaded with', Object.keys(airdropData).length, 'entries');

        // Determine which record to update and get the wallet address
        let targetRecord = user || creator;
        let targetWalletAddress = targetRecord.walletAddress;
        let targetEmail = targetRecord.email;
        
        console.log('Target record found:', {
            id: targetRecord.id,
            email: targetEmail,
            walletAddress: targetWalletAddress,
            currentGllBalance: targetRecord.gllBalance,
            userType: user ? 'user' : 'creator'
        });

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
            console.log(`User found in airdrop Google Sheets with amount: ${rewardAmount} GLL`);
        } else {
            // User not found in Google Sheets - use default reward amount
            rewardAmount = process.env.REGISTER_REWARD ? parseFloat(process.env.REGISTER_REWARD) : 100;
            rewardSource = 'default_reward';
            console.log(`User not found in Google Sheets, using default reward: ${rewardAmount} GLL`);
        }

        console.log('Final reward amount to be added:', rewardAmount, 'from source:', rewardSource);

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
            await prisma.Creator.update({
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
                console.log('Syncing GLL balance...');
                // Only sync if we updated a user record and there's also a creator record
                if (user) {
                    const creator = await prisma.Creator.findUnique({
                        where: { email: targetEmail }
                    });
                    if (creator) {
                        // Update creator's balance to match the updated user's balance
                        await prisma.Creator.update({
                            where: { email: targetEmail },
                            data: {
                                gllBalance: targetRecord.gllBalance + rewardAmount
                            }
                        });
                        console.log('Creator GLL balance synced with user balance');
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
                        console.log('User GLL balance synced with creator balance');
                    }
                }
                console.log('GLL balance synced successfully');
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
            console.log('Airdrop claim recorded successfully for:', targetWalletAddress);
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
router.post('/creator-posts', upload.array('media', 10), async (req, res) => {
    try {
        const { id, content, username, profilePicture, timestamp } = req.body;

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
                    console.log("Warning: Could not delete temporary file:", unlinkError);
                }
            }
        }

        // Create the post with media URLs
        const newPost = await prisma.creatorPost.create({
            data: {
                postId: id,
                content: content,
                username: username,
                profilePicture: profilePicture || null,
                timestamp: parsedTimestamp,
                images: imageUrls,
                videos: videoUrls
            }
        });

        // Return success response
        res.status(201).json({
            success: true,
            message: "Post created successfully",
            data: {
                id: newPost.postId,
                content: newPost.content,
                username: newPost.username,
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
                    console.log("Warning: Could not delete temporary file:", unlinkError);
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
router.get('/creator-posts', async (req, res) => {
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
router.get('/creator-posts/:postId', async (req, res) => {
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
router.get('/creator-posts/by-email/:email', async (req, res) => {
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
        const creator = await prisma.Creator.findUnique({
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
router.get('/creator-profile/by-username/:username', async (req, res) => {
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
        const creator = await prisma.Creator.findUnique({
            where: { username: decodedUsername },
            select: {
                email: true,
                name: true,
                username: true,
                instagramUsername: true,
                profilePicture: true,
                aboutMe: true,
                ifscCode: true, // To determine KYC completion
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

        // Check if KYC is complete (has IFSC code)
        const isKycComplete = creator.ifscCode && creator.ifscCode.trim() !== '';

        // Format response data
        const profileData = {
            email: creator.email,
            name: creator.name,
            username: creator.username,
            instagramUsername: creator.instagramUsername || '',
            profilePicture: creator.profilePicture || '',
            aboutMe: creator.aboutMe || '',
            isKycComplete: isKycComplete
        };

        res.status(200).json({
            success: true,
            message: "User profile retrieved successfully",
            data: profileData
        });

    } catch (error) {
        console.error("Error fetching creator profile by username:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error while fetching user profile"
        });
    }
});

// GET endpoint for fetching creator posts by username
router.get('/creator-posts/by-username/:username', async (req, res) => {
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
        const creator = await prisma.Creator.findUnique({
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
router.post('/creator-posts/:postId/like', async (req, res) => {
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
router.get('/creator-posts/:postId/likes', async (req, res) => {
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
router.post('/creator-posts/:postId/comment', async (req, res) => {
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
router.get('/creator-posts/:postId/comments', async (req, res) => {
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
router.post('/creator-posts/comments/:commentId/like', async (req, res) => {
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

module.exports = router;