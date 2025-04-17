const express = require('express');
const prisma = require('../config/db');
const { sendVerificationEmail, generateOTP } = require('../utils/emailService');

const router = express.Router();

/**
 * User routes
 */

// Step 1: Request email verification before registration
router.post('/request-verification', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ error: "Email is required" });
        }

        // Check if user with this email already exists
        const existingUser = await prisma.user.findUnique({
            where: { email }
        });

        if (existingUser) {
            return res.status(400).json({ error: "Email already exists" });
        }

        // Generate OTP for email verification
        const otp = generateOTP();

        const otpExpiry = new Date(Date.now() + 30 * 60 * 1000); // OTP valid for 30 minutes

        // Store the pre-registration verification data
        // We'll use a temporary record in the User model with minimal data
        const tempUser = await prisma.user.create({
            data: {
                name: "Temporary",
                designation: "Temporary",
                email,
                password: "temporary", // Will be replaced during actual registration
                phone: "temporary",
                accountName: "temporary",
                accountNumber: "temporary",
                ifscCode: "temporary",
                gstNumber: "temporary",
                companyAddress: "temporary",
                companyType: "temporary",
                companyName: "temporary",
                international: false,
                terms: false,
                verificationOTP: otp,
                otpExpiry
            }
        });

        // Send verification email with OTP
        await sendVerificationEmail(email, otp);

        res.status(200).json({
            message: "Verification OTP has been sent to your email. Please verify before completing registration."
        });
    } catch (error) {
        console.error("Error requesting verification:", error);

        // Handle duplicate email error
        if (error.code === 'P2002' && error.meta?.target?.includes('email')) {
            return res.status(400).json({ error: "Email already exists" });
        }

        res.status(500).json({ error: "Something went wrong." });
    }
});

// Step 2: Verify email with OTP
router.post('/verify-email', async (req, res) => {
    try {
        const { email, otp } = req.body;

        if (!email || !otp) {
            return res.status(400).json({ error: "Email and OTP are required" });
        }

        // Find temporary user by email
        const tempUser = await prisma.user.findUnique({
            where: { email }
        });

        if (!tempUser) {
            return res.status(404).json({ error: "No verification request found for this email" });
        }

        // Check if OTP is valid
        if (tempUser.verificationOTP !== otp) {
            return res.status(400).json({ error: "Invalid OTP" });
        }

        // Check if OTP is expired
        if (tempUser.otpExpiry && new Date() > new Date(tempUser.otpExpiry)) {
            return res.status(400).json({ error: "OTP has expired" });
        }

        // Update temporary user as verified
        await prisma.user.update({
            where: { id: tempUser.id },
            data: {
                isVerified: true
            }
        });

        res.status(200).json({
            message: "Email verified successfully. You can now complete your registration."
        });
    } catch (error) {
        console.error("Error verifying email:", error);
        res.status(500).json({ error: "Something went wrong." });
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
                    "name": name, 
                    "email": email, 
                    "designation": designation, 
                    "phone": phone, 
                    "international": international, 
                    "reward": 20.0
                }
            })
            res.status(200).json({
                message: "Email added successfully"
            })

        }else{
            const updatedUser = await prisma.user.update({
                where: { id: tempUser.id },
                data: {
                    "name": name, 
                    "email": email, 
                    "designation": designation, 
                    "phone": phone, 
                    "international": international, 
                    "reward": 20.0
                }
            });
            res.status(200).json({
                message: "Details updated successfully"
            })
        }
    }catch (error) {
        console.log("Error completing registration:", error);
        res.status(500).json({ error: error });
    }
})



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
                "reward": 100.0,
                "msmeCertificate": msmeCertificate,
                "oemCertificate": oemCertificate,
                "fy2324Data": fy2324Data,
                "fy2425Data": fy2425Data,
                "companyName": companyName
            }
        });

        // Remove password from response
        const { password: _, ...userWithoutPassword } = updatedUser;

        res.status(201).json({
            ...userWithoutPassword,
            message: "Registration completed successfully."
        });
        console.log("Registration completed successfully.")
    } catch (error) {
        console.log("Error completing registration:", error);
        res.status(500).json({ error: error });
    }
});

// This endpoint is deprecated - use /verify-email instead
router.post('/verify', async (req, res) => {
    return res.status(400).json({ error: "This endpoint is deprecated. Please use /verify-email for pre-registration verification." });
});

// Resend OTP for pre-registration verification
router.post('/resend-otp', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ error: "Email is required" });
        }

        // Find temporary user by email
        const tempUser = await prisma.user.findUnique({
            where: { email }
        });

        if (!tempUser) {
            return res.status(404).json({ error: "No verification request found for this email" });
        }

        // Check if user is already verified
        if (tempUser.isVerified) {
            return res.status(400).json({ error: "Email is already verified. You can proceed with registration." });
        }

        // Generate new OTP
        const otp = generateOTP();
        const otpExpiry = new Date(Date.now() + 30 * 60 * 1000); // OTP valid for 30 minutes

        // Update temporary user with new OTP
        await prisma.user.update({
            where: { id: tempUser.id },
            data: {
                verificationOTP: otp,
                otpExpiry
            }
        });

        // Send verification email with new OTP
        await sendVerificationEmail(email, otp);

        res.status(200).json({ message: "Verification OTP has been resent to your email" });
    } catch (error) {
        console.error("Error resending OTP:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
});



module.exports = router;