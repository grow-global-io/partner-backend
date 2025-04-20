const express = require('express');
const prisma = require('../config/db');

const router = express.Router();

router.post('/save-connect-wallet', async (req, res) => {
    const { name, email, walletAddress, glltag } = req.body;

    const tempUser = await prisma.user.findUnique({
        where: { email }
    });
    try{
        if (!tempUser) {
            const user = await prisma.user.create({
                data: {
                    // name: name,
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
                    // name: name,
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
    try{
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
                    reward: 20.0
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

        // Check if the email exists and is verified
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

        
        res.status(200).json({
            success: true,
            user: user
        });
    } catch (error) {
        console.error("Error fetching user data:", error);
        res.status(500).json({ 
            success: false, 
            error: "Something went wrong while fetching user data",
            details: error.message 
        });
    }
});

module.exports = router;