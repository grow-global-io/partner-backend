/**
 * Email Service using Brevo API
 */
const fetch = require('node-fetch');

/**
 * Sends an OTP verification email using Brevo API
 * @param {string} email - Recipient email address
 * @param {string} otp - One-time password for verification
 * @returns {Promise} - Response from Brevo API
 */

async function sendVerificationEmail(email, otp) {
  try {
    const options = {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': "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",
      },
      body: JSON.stringify({
        replyTo: { email: 'info@growglobal.io' },
        to: [{ email }],
        templateId: 3,
        params: { otp },
      }),
    };

    const response = await fetch('https://api.brevo.com/v3/smtp/email', options);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error sending verification email:', error);
    throw new Error('Failed to send verification email');
  }
}

/**
 * Generates a random 6-digit OTP
 * @returns {string} - 6-digit OTP
 */
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

module.exports = {
  sendVerificationEmail,
  generateOTP,
};