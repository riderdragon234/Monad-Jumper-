const express = require('express');
const bodyParser = require('body-parser');
const { ethers } = require('ethers');
const cors = require('cors'); // Import CORS
require('dotenv').config(); // Load environment variables

const app = express();
const port = process.env.PORT || 3000; // Use PORT from environment or default to 3000

// CORS configuration
const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests from local and production frontend URLs
        const allowedOrigins = [
            process.env.FRONTEND_URL_LOCAL,
            process.env.FRONTEND_URL_PROD,
        ];
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('CORS policy: Access denied'));
        }
    },
    methods: 'POST', // Only allow POST requests
    allowedHeaders: ['Content-Type'], // Allowed headers
};

// Middleware
app.use(cors(corsOptions)); // Enable CORS with options
app.use(bodyParser.json());

// Ethereum setup
const provider = new ethers.providers.JsonRpcProvider('https://your-monad-testnet-url'); // Replace with your actual Ethereum node URL
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider); // Load wallet with private key from .env

// Endpoint to handle jump actions
app.post('/jump', async (req, res) => {
    const { score, address } = req.body;

    // Construct transaction
    const tx = {
        to: address, // Address of the user
        value: ethers.utils.parseEther('0.001'), // Example value
        gasLimit: 21000, // Set gas limit
    };

    try {
        const transactionResponse = await wallet.sendTransaction(tx);
        console.log(`Transaction sent for jump score ${score}:`, transactionResponse);
        res.status(200).send({ success: true, transactionHash: transactionResponse.hash });
    } catch (error) {
        console.error('Transaction failed:', error);
        res.status(500).send({ success: false, error: error.message });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Relayer server running at ${process.env.API_URL}`); // Log the API URL
});