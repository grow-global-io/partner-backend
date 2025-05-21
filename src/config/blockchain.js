const PhoneLink = require('../../artifacts/contracts/phoneLink.sol/phoneLink.json');
const ERC20Permit = require('../../abi/ERC20Permit.json');
const { ethers, JsonRpcProvider, parseUnits, formatUnits } = require("ethers");
const prisma = require('../config/db');

const provider = new JsonRpcProvider(process.env.RPC_URL);
const fs = require('fs')
const signerPrivateKey = fs.readFileSync('.secret', 'utf8')
  .toString()
  .trim()
  .replace(/(\r\n|\n|\r)/g, '');
const signer = new ethers.Wallet(signerPrivateKey, provider);

const tokenContract = new ethers.Contract(process.env.GLL_ADDRESS, ERC20Permit, signer);
const phoneLinkContract = new ethers.Contract(process.env.CONTRACT_ADDRESS, PhoneLink.abi, signer);

/**
 * Converts a string amount to ether amount (wei)
 * @param {string} amount - The amount as a string (e.g., "1.5")
 * @returns {BigNumber} The amount in wei
 */
const convertToEtherAmount = (amount) => {
    try {
        return parseUnits(amount.toString(), 'ether');
    } catch (error) {
        throw new Error(`Error converting amount to ether: ${error.message}`);
    }
};

/**
 * Gets the token balance for a given address
 * @param {string} address - The wallet address to check balance for
 * @returns {Promise<string>} The token balance in ether units
 */
const getMyBalance = async (email) => {
    try {
        const tempUser = await prisma.user.findUnique({
            where: { email }
        });
        if (!tempUser) {
            return res.status(400).json({ error: "Email not found. Please login to gll.one first." });
        }
        const balance = await tokenContract.balanceOf(tempUser.walletAddress);
        return formatUnits(balance, 'ether');
    } catch (error) {
        throw new Error(`Error getting token balance: ${error.message}`);
    }
};

module.exports = {
    tokenContract,
    phoneLinkContract,
    convertToEtherAmount,
    getMyBalance
}