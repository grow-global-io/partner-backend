const crypto = require("crypto");

const SECRET = Buffer.from(process.env.MY_ENCRYPT_KEY, "hex"); // 32 bytes (64 hex chars)

const encryptJSON = (jsonData) => {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", SECRET, iv);
  const jsonString = JSON.stringify(jsonData);

  let encrypted = cipher.update(jsonString, "utf8", "hex");
  encrypted += cipher.final("hex");

  return {
    iv: iv.toString("hex"),
    data: encrypted,
  };
};

module.exports = { encryptJSON };
