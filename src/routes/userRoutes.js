const express = require('express');
const prisma = require('../config/db');
const multer = require('multer');
const AWS = require('aws-sdk');
const path = require('path');
const fs = require('fs');

const router = express.Router();

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
            })
            res.status(200).json({
                message: "User added successfully"
            })
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
            res.status(200).json({
                message: "Details updated successfully"
            })
        }
    } catch (error) {
        console.log("Error completing registration:", error);
        res.status(500).json({ error: error.message });
    }
});

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
                    gllBalance: 20.0,
                    accountName: "",
                    accountNumber: "",
                    ifscCode: "",
                    gstNumber: "",
                    companyAddress: "",
                    companyType: "",
                    companyName: "",
                    terms: true
                }
            })
            res.status(200).json({
                message: "Email added successfully"
            })
        } else {
            const updatedUser = await prisma.user.update({
                where: { id: tempUser.id },
                data: {
                    name: name,
                    email: email,
                    designation: designation,
                    phone: phone,
                    international: international,
                    gllBalance: 20.0
                }
            });
            res.status(200).json({
                message: "Details updated successfully"
            })
        }
    } catch (error) {
        console.log("Error completing registration:", error);
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
            oemCertificate ,
            fy2324Data     ,
            fy2425Data 
        } = req.body;

        if (!email) {
            return res.status(400).json({ error: "Email is required" });
        }
        // Find the temporary user record that should have been verified
        const tempUser = await prisma.user.findUnique({
            where: { email }
        });

        console.log("tempUser", tempUser)


        if (!tempUser) {
            return res.status(400).json({ error: "Email not found. Please request verification first." });
        }


        // Update the temporary user with complete registration information
        const updatedUser = await prisma.user.update({
            where: { id: tempUser.id },
            data: {
                "name": name,
                "designation": designation,
                "phone": phone,
                "accountName": accountName,
                "accountNumber": accountNumber,
                "ifscCode": ifscCode,
                "gstNumber": gstNumber,
                "companyAddress": companyAddress,
                "companyType": companyType,
                "international": international,
                "terms": terms,
                "verificationOTP": null,
                "otpExpiry": null,
                "gllBalance": 100.0,
                "msmeCertificate": msmeCertificate,
                "oemCertificate": oemCertificate,
                "fy2324Data": fy2324Data,
                "fy2425Data": fy2425Data,
                "companyName": companyName
            }
        });


         res.status(201).json({
            
            message: "Registration completed successfully."
        });
        console.log("Registration completed successfully.")
    } catch (error) {
        console.log("Error completing registration:", error);
        res.status(500).json({ error: error });
    }
});

router.post('/uploads', upload.single('file'), async (req, res) => {

    let documentUrl = null;
    try {
        console.log("Request body:", req.body);
        const { file } = req.body;
        console.log("File:", file);


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
        console.log("Error uploading file:", error);
        res.status(500).json({ error: error });
    }
})


// Save-Data From Reward Card1
router.post('/save-reward-card1', upload.single('document'), async (req, res) => {
    try {
        console.log("Request body:", req.body);
        const { companyName, financialYear, documentType, notes, userId, email } = req.body;
        let documentUrl = null;

        // Check if user ID was provided and user exists
        let user = null;
        if (userId) {
            user = await prisma.user.findUnique({
                where: { id: userId }
            });
        } else if (email) {
            // If userId is not provided but email is, try to find user by email
            user = await prisma.user.findUnique({
                where: { email }
            });
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

            // Delete the temporary file
            fs.unlinkSync(req.file.path);
        }

        const createUser = await prisma.rewards.create({
            data: {
                companyName,
                financialYear,
                documentType,
                document: documentUrl, // Store the S3 URL instead of the file
                notes,
                userEmail: user ? user.email : email, // Store email for reference
                ...(user && { user: { connect: { id: user.id } } })
            }
        });
        
        console.log("Data saved with document URL:", documentUrl);
        console.log("gllBalance", gllBalance);
        
        // If user exists, update GLL balance
        if (user) {
            await prisma.user.update({
                where: { id: user.id },
                data: {
                    gllBalance: {
                        
                        increment: 200 // Add 100 GLL Ions to the user's balance as reward
                    }
                }
            });
        }
        
        res.status(200).json({
            message: "Data saved successfully",
            documentUrl,
            rewardId: createUser.id,
            userEmail: createUser.userEmail
        });
    } catch (error) {
        console.log("Error saving data:", error);
        // Clean up temporary file if it exists and there was an error
        if (req.file && req.file.path) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ error: error.message });
    }
});

console.log("gllBalance", gllBalance);

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

        console.log("user", user)
        res.send(user);
    } catch (error) {
        console.error("Error fetching user data:", error);
        res.status(500).json({
            success: false,
            error: "Something went wrong while fetching user data",
            details: error.message
        });
    }
});


// Save data from Reward Card2 - Store Connection
// router.post('/save-reward-card2', upload.none(), async (req, res) => {
//     try {
//         console.log("Request body:", req.body);
//         const { platform, storeUrl, storeId, consented } = req.body;
        
//         // Validate required fields
//         if (!platform || !storeUrl || consented !== 'true') {
//             return res.status(400).json({ 
//                 error: "Missing required fields. Platform, store URL, and consent are required." 
//             });
//         }

//         // Create store connection record
//         const storeConnection = await prisma.storeConnection.create({
//             data: {
//                 platform,
//                 storeUrl,
//                 storeId: storeId || null,
//                 consented: consented === 'true',
//                 // connectionDate: new Date()
//             }
//         });
        
//         console.log("Store connection saved:", storeConnection);
        
//         // TODO: Add logic to add 500 GLL Ions to user's balance if needed
//         // Would require user ID to be passed from frontend
        
//         res.status(200).json({
//             message: "Store connected successfully"
//         });
//     } catch (error) {
//         console.log("Error connecting store:", error);
//         res.status(500).json({ error: error.message });
//     }
// });

// // Save data from Reward Card3 - Certificate Upload
// router.post('/save-reward-card3', upload.single('certificate'), async (req, res) => {
//     try {
//         console.log("Request body:", req.body);
//         const { certificateType, expiryDate, issueAuthority, notes, userId } = req.body;
//         let certificateUrl = null;

//         // Validate required fields
//         if (!certificateType || !expiryDate || !issueAuthority) {
//             return res.status(400).json({ 
//                 error: "Missing required fields. Certificate type, expiry date, and issuing authority are required." 
//             });
//         }

//         if (!req.file) {
//             return res.status(400).json({ error: "Certificate file is required" });
//         }

//         // Check if user ID was provided and user exists
//         let user = null;
//         if (userId) {
//             user = await prisma.user.findUnique({
//                 where: { id: userId }
//             });
//         }

//         // Upload certificate to S3
//         const fileContent = fs.readFileSync(req.file.path);
//         const params = {
//             Bucket: process.env.AWS_BUCKET_NAME,
//             Key: `certificates/${Date.now()}-${req.file.originalname}`,
//             Body: fileContent,
//             ContentType: req.file.mimetype,
//         };

//         const uploadResult = await s3.upload(params).promise();
//         certificateUrl = uploadResult.Location;

//         // Delete the temporary file
//         fs.unlinkSync(req.file.path);

//         // Create certificate record in database
//         const certificate = await prisma.certificate.create({
//             data: {
//                 certificateType,
//                 certificateUrl,
//                 expiryDate: new Date(expiryDate),
//                 issueAuthority,
//                 notes: notes || "",
//                 ...(user && { user: { connect: { id: userId } } })
//             }
//         });
        
//         console.log("Certificate saved:", certificate);
        
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
//             message: "Certificate uploaded successfully",
//             reward: "300 GLL Ions",
//             certificateId: certificate.id,
//             certificateUrl
//         });
//     } catch (error) {
//         console.log("Error uploading certificate:", error);
//         // Clean up temporary file if it exists and there was an error
//         if (req.file && req.file.path) {
//             fs.unlinkSync(req.file.path);
//         }
//         res.status(500).json({ error: error.message });
//     }
// });

// // Save data from Reward Card4 - MSME Registration
// router.post('/save-reward-card4', upload.single('certificate'), async (req, res) => {
//     try {
//         console.log("Request body:", req.body);
//         const { businessName, gstin, businessType, city, state, certificateUrl, userId } = req.body;
//         let msmeCertificateUrl = certificateUrl || null;

//         // Validate required fields
//         if (!businessName || !gstin || !businessType || !city || !state) {
//             return res.status(400).json({ 
//                 error: "Missing required fields. Business details are required." 
//             });
//         }

//         // Check if user ID was provided and user exists
//         let user = null;
//         if (userId) {
//             user = await prisma.user.findUnique({
//                 where: { id: userId }
//             });
//         }

//         // If certificate file was uploaded directly (not pre-uploaded)
//         if (req.file) {
//             const fileContent = fs.readFileSync(req.file.path);
//             const params = {
//                 Bucket: process.env.AWS_BUCKET_NAME,
//                 Key: `msme-certificates-reward-card/${Date.now()}-${req.file.originalname}`,
//                 Body: fileContent,
//                 ContentType: req.file.mimetype,
//             };

//             const uploadResult = await s3.upload(params).promise();
//             msmeCertificateUrl = uploadResult.Location;

//             // Delete the temporary file
//             fs.unlinkSync(req.file.path);
//         }

//         // Check if we have a certificate URL
//         if (!msmeCertificateUrl) {
//             return res.status(400).json({ error: "MSME Certificate is required" });
//         }

//         // Create MSME registration record in database
//         const msmeRegistration = await prisma.msmeRegistration.create({
//             data: {
//                 businessName,
//                 gstin,
//                 businessType,
//                 city,
//                 state,
//                 certificateUrl: msmeCertificateUrl,
//                 ...(user && { user: { connect: { id: userId } } })
//             }
//         });
        
//         console.log("MSME Registration saved:", msmeRegistration);
        
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
//             message: "MSME Registration completed successfully",
//             reward: "100 GLL Ions",
//             registrationId: msmeRegistration.id,
//             certificateUrl: msmeCertificateUrl
//         });
//     } catch (error) {
//         console.log("Error completing MSME registration:", error);
//         // Clean up temporary file if it exists and there was an error
//         if (req.file && req.file.path) {
//             fs.unlinkSync(req.file.path);
//         }
//         res.status(500).json({ error: error.message });
//     }
// });

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