const express = require("express");
const prisma = require("../config/db");
const { v4: uuidv4 } = require("uuid");
const { encryptJSON } = require("../config/encrypt");

const router = express.Router();

// Dummy email service
const sendEmail = async (to, subject, text) => {
  console.log("Dummy Email Service:");
  console.log("To:", to);
  console.log("Subject:", subject);
  console.log("Text:", text);
  return true;
};

// Dummy SMS/WhatsApp service
const sendMessage = async (to, message) => {
  console.log("Dummy Message Service:");
  console.log("To:", to);
  console.log("Message:", message);
  return true;
};

// Create test hotel user
router.post("/create-test-hotel", async (req, res) => {
  try {
    const testHotel = await prisma.user.create({
      data: {
        name: "Test Hotel",
        email: "hotel@test.com",
        apiKey: "HOTEL123",
        securelinkscount: 0,
      },
    });
    res.json(encryptJSON({ message: "Test hotel created", hotel: testHotel }));
  } catch (error) {
    console.error("Error creating test hotel:", error);
    res.status(500).json({ error: error.message });
  }
});

// Create check-in link
router.post("/create-checkin", async (req, res) => {
  try {
    const {
      name,
      email,
      whatsapp,
      dob,
      address,
      country,
      bookingID,
      hotelID,
      hotelName,
      entryDate,
      exitDate,
      noOfPerson,
    } = req.body;

    // Validate required fields
    if (
      !name ||
      !email ||
      !whatsapp ||
      !dob ||
      !address ||
      !country ||
      !bookingID ||
      !hotelID ||
      !hotelName ||
      !entryDate ||
      !exitDate ||
      !noOfPerson
    ) {
      return res.status(400).json({ error: "All fields are required" });
    }

    // Find hotel user by API key
    const hotelUser = await prisma.user.findFirst({
      where: { apiKey: hotelID },
    });

    if (!hotelUser) {
      return res.status(404).json({ error: "Hotel not found" });
    }

    // Check if hotel has available credits
    if (hotelUser.securelinkscount >= 3) {
      return res.status(403).json({ error: "Credits unavailable" });
    }

    // Generate secure key and link
    const secureKey = uuidv4();
    const secureLink = `https://checkin.gll.one/${secureKey}`;

    // Create check-in record
    const checkin = await prisma.hotelCheckin.create({
      data: {
        name,
        email,
        whatsapp,
        dob: new Date(dob),
        address,
        country,
        bookingID,
        hotelID,
        hotelName,
        entryDate: new Date(entryDate),
        exitDate: new Date(exitDate),
        noOfPerson: parseInt(noOfPerson),
        secureKey,
        secureLink,
        status: "Pending",
      },
    });

    // Update hotel's securelinkscount
    await prisma.user.update({
      where: { id: hotelUser.id },
      data: {
        securelinkscount: {
          increment: 1,
        },
      },
    });

    // Send notifications using dummy services
    const message = `You can now complete your check-in using the following link: ${secureLink}`;

    // Send email notification
    await sendEmail(email, "Your Hotel Check-in Link", message);

    // Send WhatsApp notification
    await sendMessage(`whatsapp:${whatsapp}`, message);

    // Send SMS notification
    await sendMessage(whatsapp, message);

    res.json(encryptJSON({ checkinLink: secureLink }));
  } catch (error) {
    console.error("Error creating check-in:", error);
    res.status(500).json({ error: error.message });
  }
});

// Track check-in status
router.post("/track-status", async (req, res) => {
  try {
    const { secureLink } = req.body;

    if (!secureLink) {
      return res.status(400).json({ error: "Secure link is required" });
    }

    const checkin = await prisma.hotelCheckin.findUnique({
      where: { secureLink },
    });

    if (!checkin) {
      return res.status(404).json({ error: "Check-in not found" });
    }

    res.json(encryptJSON({ status: checkin.status }));
  } catch (error) {
    console.error("Error tracking status:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
