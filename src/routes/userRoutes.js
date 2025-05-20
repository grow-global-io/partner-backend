const express = require('express');
const prisma = require('../config/db');
const multer = require('multer');
const AWS = require('aws-sdk');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { phoneLinkContract, convertToEtherAmount, getMyBalance } = require('../config/blockchain');
const { encryptJSON} = require('../config/encrypt')

const router = express.Router();

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
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        // You can add file type validation here if needed
        cb(null, true);
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
    const { name, email, designation, phone, international } = req.body;

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
                    international: international
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
        } = req.body;

        if (!email) {
            return res.status(400).json({ error: "Email is required" });
        }
        
        // Find the temporary user record
        const tempUser = await prisma.user.findUnique({
            where: { email }
        });

        // console.log("tempUser", tempUser);

        if (!tempUser) {
            return res.status(400).json({ error: "Email not found. Please request verification first." });
        }
        
        // Validate that all required fields are provided for a complete registration
        if (!name || !phone || !companyName || !companyType) {
            return res.status(400).json({ 
                error: "Incomplete registration. Please provide all required information." 
            });
        }

        // Update the user with complete registration information
        // Set GLL balance to 100.0 only when all steps are completed
        const updatedUser = await prisma.user.update({
            where: { id: tempUser.id },
            data: {
                name,
                designation,
                phone,
                accountName:null,
                accountNumber:null,
                ifscCode,
                gstNumber,
                companyAddress,
                companyType,
                international,
                terms,
                verificationOTP: null,
                otpExpiry: null,
                msmeCertificate,
                oemCertificate,
                fy2324Data,
                fy2425Data,
                companyName,
                apiKey,
                bankName,
                bankBranch,
                // Set GLL balance to 100.0 upon successful completion of all steps
                gllBalance: {
                    increment: parseFloat(process.env.REGISTER_REWARD)
                }
            }
        });

        /** Code to send GLL to email wallet *******/
        // amount = 100.0
        // const sendTx = await phoneLinkContract.getGLL(convertToEtherAmount(amount.toString()),tempUser.walletAddress);
        // await sendTx.wait();
        /** ************* */

        /** Code to get GLL balance from email wallet ***** */
        // const myBalance = await getMyBalance(email);
        // console.log("My Balance:", myBalance);
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

        res.status(200).json({
            message: "File uploaded successfully",
            url : documentUrl
        });

    }
    catch (error) {
        // console.log("Error uploading file:", error);
        res.status(500).json({ error: error });
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
                gllBalance: true
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
                gllBalance: true
            }
        });
        
        // If user found by email, use email from database
        if (user) {
            userEmail = user.email;
            // console.log("User found by email. Using email from database:", userEmail);
        } else {
            // If no user found but email provided, use the provided email
            userEmail = email;
            // console.log("No user found. Using provided email:", userEmail);
        }
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
        
        console.log("MSME Registration saved:", reward);
        
        // If user exists, update GLL balance
        if (user) {
            console.log('Current GLL Balance:', user.gllBalance);
            console.log('CARD4_REWARD value:', process.env.CARD4_REWARD);
            
            const rewardAmount = process.env.CARD4_REWARD ? parseFloat(process.env.CARD4_REWARD) : 100;
            console.log('Reward amount to be added:', rewardAmount);

            const updatedUser = await prisma.user.update({
                where: { id: user.id },
                data: {
                    gllBalance: {
                        increment: rewardAmount // Add 100 GLL Ions to the user's balance as reward
                    }
                }
            });
            console.log('Updated GLL Balance:', updatedUser.gllBalance);
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
        console.log("Error completing MSME registration:", error);
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

// // Save data from Reward Card5 - Invoice Upload
// router.post('/save-reward-card5', upload.array('multipleFiles'), async (req, res) => {
//     try {
//         console.log("Request body:", req.body);
//         const { 
//             invoiceNumber, 
//             amount, 
//             dueDate, 
//             customerName, 
//             singleFileUrl, 
//             multipleFileUrls, 
//             userId 
//         } = req.body;
        
//         // Validate required fields
//         if (!invoiceNumber || !amount || !dueDate || !customerName) {
//             return res.status(400).json({ 
//                 error: "Missing required fields. Invoice details are required." 
//             });
//         }

//         // Check if user ID was provided and user exists
//         let user = null;
//         if (userId) {
//             user = await prisma.user.findUnique({
//                 where: { id: userId }
//             });
//         }

//         // Initialize array to store all file URLs
//         let fileUrls = [];

//         // Add pre-uploaded files if available
//         if (singleFileUrl) {
//             fileUrls.push(singleFileUrl);
//         }

//         if (multipleFileUrls) {
//             try {
//                 const parsedUrls = JSON.parse(multipleFileUrls);
//                 if (Array.isArray(parsedUrls)) {
//                     fileUrls = [...fileUrls, ...parsedUrls];
//                 }
//             } catch (e) {
//                 console.error("Error parsing multipleFileUrls:", e);
//             }
//         }

//         // Handle single file upload if present
//         if (req.files && req.files.length > 0) {
//             // Process all files in the request
//             for (const file of req.files) {
//                 const fileContent = fs.readFileSync(file.path);
//                 const params = {
//                     Bucket: process.env.AWS_BUCKET_NAME,
//                     Key: `invoices/${Date.now()}-${file.originalname}`,
//                     Body: fileContent,
//                     ContentType: file.mimetype,
//                 };
    
//                 const uploadResult = await s3.upload(params).promise();
//                 fileUrls.push(uploadResult.Location);
    
//                 // Delete the temporary file
//                 fs.unlinkSync(file.path);
//             }
//         }

//         // Check if we have at least one file
//         if (fileUrls.length === 0) {
//             return res.status(400).json({ error: "At least one invoice file is required" });
//         }

//         // Create invoice record in database
//         const invoice = await prisma.invoice.create({
//             data: {
//                 invoiceNumber,
//                 amount,
//                 dueDate: new Date(dueDate),
//                 customerName,
//                 fileUrls,
//                 ...(user && { user: { connect: { id: userId } } })
//             }
//         });
        
//         console.log("Invoice saved:", invoice);
        
//         // If user exists, update GLL balance
//         if (user) {
//             await prisma.user.update({
//                 where: { id: userId },
//                 data: {
//                     gllBalance: {
//                         increment: 100 // Add 100 GLL Ions to the user's balance as reward
//                     }
//                 }
//             });
//         }
        
//         res.status(200).json({
//             message: "Invoice uploaded successfully",
//             reward: "100 GLL Ions",
//             invoiceId: invoice.id,
//             fileUrls
//         });
//     } catch (error) {
//         console.log("Error uploading invoice:", error);
//         // Clean up temporary files if they exist and there was an error
//         if (req.files && req.files.length > 0) {
//             for (const file of req.files) {
//                 if (fs.existsSync(file.path)) {
//                     fs.unlinkSync(file.path);
//                 }
//             }
//         }
//         res.status(500).json({ error: error.message });
//     }
// });

// // Save data from Reward Card6 - MSME Referral
// router.post('/save-reward-card6', upload.none(), async (req, res) => {
//     try {
//         console.log("Request body:", req.body);
//         const { uciNumber, msmeUciId, customerId, city, state, status, userId } = req.body;
        
//         // Validate required fields
//         if (!uciNumber || !msmeUciId || !customerId || !city || !state) {
//             return res.status(400).json({ 
//                 error: "Missing required fields. Referral details are required." 
//             });
//         }

//         // Check if user ID was provided and user exists
//         let user = null;
//         if (userId) {
//             user = await prisma.user.findUnique({
//                 where: { id: userId }
//             });
//         }

//         // Create or update MSME referral record in database
//         const msmeReferral = await prisma.msmeReferral.create({
//             data: {
//                 uciNumber,
//                 msmeUciId,
//                 customerId,
//                 city,
//                 state,
//                 status: status || "pending",
//                 ...(user && { user: { connect: { id: userId } } })
//             }
//         });
        
//         console.log("MSME Referral saved:", msmeReferral);
        
//         // If user exists, update GLL balance
//         if (user) {
//             await prisma.user.update({
//                 where: { id: userId },
//                 data: {
//                     gllBalance: {
//                         increment: status === 'completed' ? 200 : 100
//                         // Add more GLL Ions if marked as completed
//                     }
//                 }
//             });
//         }
        
//         res.status(200).json({
//             message: status === 'completed' 
//                 ? "MSME referral marked as completed successfully" 
//                 : "MSME referral submitted successfully",
//             reward: status === 'completed' ? "200 GLL Ions" : "100 GLL Ions",
//             referralId: msmeReferral.id,
//             status: msmeReferral.status
//         });
//     } catch (error) {
//         console.log("Error processing MSME referral:", error);
//         res.status(500).json({ error: error.message });
//     }
// });

// // Save data from Reward Card7 - Business Story
// router.post('/save-reward-card7', upload.none(), async (req, res) => {
//     try {
//         console.log("Request body:", req.body);
//         const { imageUrl, story, userId } = req.body;
        
//         // Validate required fields
//         if (!imageUrl || !story) {
//             return res.status(400).json({ 
//                 error: "Missing required fields. Image URL and story are required." 
//             });
//         }

//         // Validate story length
//         if (story.length > 280) {
//             return res.status(400).json({ 
//                 error: "Story exceeds maximum length of 280 characters." 
//             });
//         }

//         // Check if user ID was provided and user exists
//         let user = null;
//         if (userId) {
//             user = await prisma.user.findUnique({
//                 where: { id: userId }
//             });
//         }

//         // Create business story record in database
//         const businessStory = await prisma.businessStory.create({
//             data: {
//                 imageUrl,
//                 story,
//                 ...(user && { user: { connect: { id: userId } } })
//             }
//         });
        
//         console.log("Business Story saved:", businessStory);
        
//         // If user exists, update GLL balance
//         if (user) {
//             await prisma.user.update({
//                 where: { id: userId },
//                 data: {
//                     gllBalance: {
//                         increment: 100 // Add 100 GLL Ions to the user's balance as reward
//                     }
//                 }
//             });
//         }
        
//         res.status(200).json({
//             message: "Business story submitted successfully",
//             reward: "100 GLL Ions",
//             storyId: businessStory.id
//         });
//     } catch (error) {
//         console.log("Error submitting business story:", error);
//         res.status(500).json({ error: error.message });
//     }
// });

// // Save data from Reward Card8 - Product
// router.post('/save-reward-card8', upload.none(), async (req, res) => {
//     try {
//         console.log("Request body:", req.body);
//         const { 
//             productName, 
//             gstInNumber, 
//             uciCode, 
//             productCategory, 
//             productMaterial, 
//             originCountry, 
//             imageUrl, 
//             status, 
//             userId 
//         } = req.body;
        
//         // Validate required fields
//         if (!productName || !gstInNumber || !uciCode || !productCategory || 
//             !productMaterial || !originCountry || !imageUrl) {
//             return res.status(400).json({ 
//                 error: "Missing required fields. All product details and certificate image are required." 
//             });
//         }

//         // Check if user ID was provided and user exists
//         let user = null;
//         if (userId) {
//             user = await prisma.user.findUnique({
//                 where: { id: userId }
//             });
//         }

//         // Create product record in database
//         const product = await prisma.product.create({
//             data: {
//                 productName,
//                 gstInNumber,
//                 uciCode,
//                 productCategory,
//                 productMaterial,
//                 originCountry,
//                 imageUrl,
//                 status: status || "pending",
//                 ...(user && { user: { connect: { id: userId } } })
//             }
//         });
        
//         console.log("Product saved:", product);
        
//         // If user exists, update GLL balance
//         if (user) {
//             await prisma.user.update({
//                 where: { id: userId },
//                 data: {
//                     gllBalance: {
//                         increment: status === 'completed' ? 180 : 90
//                         // Double reward if product is marked as completed
//                     }
//                 }
//             });
//         }
        
//         res.status(200).json({
//             message: status === 'completed' 
//                 ? "Product marked as completed successfully" 
//                 : "Product added successfully",
//             reward: status === 'completed' ? "180 GLL Ions" : "90 GLL Ions",
//             productId: product.id,
//             status: product.status
//         });
//     } catch (error) {
//         console.log("Error processing product:", error);
//         res.status(500).json({ error: error.message });
//     }
// });

// // Save data from Reward Card9 - Social Media Accounts
// router.post('/save-reward-card9', upload.none(), async (req, res) => {
//     try {
//         console.log("Request body:", req.body);
//         const { platform, userId } = req.body;
        
//         // Validate required fields
//         if (!platform || Object.keys(platform).length === 0) {
//             return res.status(400).json({ 
//                 error: "Missing required fields. At least one social media platform must be connected." 
//             });
//         }

//         // Check if user ID was provided and user exists
//         let user = null;
//         if (userId) {
//             user = await prisma.user.findUnique({
//                 where: { id: userId }
//             });
//         }

//         // Extract platform data from the form
//         const platforms = [];
//         // Handle the array-like structure from FormData
//         for (let i = 0; i < Object.keys(platform).length / 2; i++) {
//             if (platform[i] && platform[i].name && platform[i].url) {
//                 platforms.push({
//                     name: platform[i].name,
//                     url: platform[i].url
//                 });
//             }
//         }

//         if (platforms.length === 0) {
//             return res.status(400).json({ 
//                 error: "No valid platforms provided. Each platform must have a name and URL." 
//             });
//         }

//         // Create social account record in database
//         const socialAccount = await prisma.socialAccount.create({
//             data: {
//                 ...(user && { user: { connect: { id: userId } } }),
//                 platforms: {
//                     create: platforms.map(p => ({
//                         name: p.name,
//                         url: p.url,
//                         connected: true
//                     }))
//                 }
//             },
//             include: {
//                 platforms: true
//             }
//         });
        
//         console.log("Social Account saved:", socialAccount);
        
//         // If user exists, update GLL balance
//         if (user) {
//             await prisma.user.update({
//                 where: { id: userId },
//                 data: {
//                     gllBalance: {
//                         increment: 300 // Add 300 GLL Ions to the user's balance as reward
//                     }
//                 }
//             });
//         }
        
//         res.status(200).json({
//             message: "Social accounts connected successfully",
//             reward: "300 GLL Ions",
//             socialAccountId: socialAccount.id,
//             connectedPlatforms: socialAccount.platforms.length
//         });
//     } catch (error) {
//         console.log("Error connecting social accounts:", error);
//         res.status(500).json({ error: error.message });
//     }
// });

module.exports = router;