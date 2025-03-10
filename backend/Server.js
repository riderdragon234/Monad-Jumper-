const express = require('express');
const bodyParser = require('body-parser');
const { ethers } = require('ethers');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: './backend/.env' });

const app = express();
const port = process.env.PORT || 3000;

// ✅ Determine Correct API URL
const API_URL = process.env.API_URL_PROD || process.env.API_URL || `http://localhost:${port}`;

console.log("🔥 Server is starting...");
console.log("API_URL:", API_URL);

// ✅ Middleware: Fix `req.body` Parsing Issues
app.use(express.json()); // ✅ Ensures JSON body parsing
app.use(bodyParser.urlencoded({ extended: true })); // ✅ Ensures form data parsing
app.use(bodyParser.json()); // ✅ Ensures Express parses JSON correctly

// ✅ Dynamically allow frontend URLs, including Vercel preview deployments
const allowedOrigins = new Set([
  process.env.FRONTEND_URL_LOCAL, // Local frontend URL from .env
  process.env.FRONTEND_URL_PROD,  // Production frontend URL from .env
]);

// ✅ Automatically Allow All Vercel Preview Deployments (*.vercel.app)
if (process.env.VERCEL_URL) {
  allowedOrigins.add(`https://${process.env.VERCEL_URL}`);
}

// ✅ Global CORS Middleware (Fixes OPTIONS Preflight Issues)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  console.log(`🔍 Incoming Request from Origin: ${origin}`);
  if (origin && [...allowedOrigins].some((allowed) => origin.endsWith(".vercel.app") || origin === allowed)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    console.log(`✅ CORS Allowed for: ${origin}`);
  } else {
    console.error(`❌ CORS Rejected for: ${origin}`);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") {
    return res.status(204).end(); // ✅ Respond to preflight requests
  }
  next();
});

// ✅ Serve static files from "public" folder
app.use(express.static(path.join(__dirname, 'public')));

// ✅ Inject environment variables into HTML
app.get('/', (req, res) => {
  const filePath = path.join(__dirname, 'public', 'index.html');
  let html = fs.readFileSync(filePath, 'utf8');
  html = html.replace('{{API_URL}}', API_URL); // ✅ Replace placeholder with actual API_URL
  res.send(html);
});

// ✅ Serve API URL dynamically
app.get('/config', (req, res) => {
  res.json({ api_url: API_URL });
});

// ✅ Test Route for CORS Debugging
app.get("/test-cors", (req, res) => {
  res.json({ message: "✅ CORS is working!" });
});

// ✅ Ethereum setup
const provider = new ethers.JsonRpcProvider('https://testnet-rpc.monad.xyz');
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const nonceManager = new ethers.NonceManager(wallet);
const pendingTransactions = new Map();
const usedNonces = new Set(); // ✅ Track used nonces

// ✅ Track game state and retry attempts
let isGameActive = false; // Global game state
const MAX_RETRY_ATTEMPTS = 3; // Max retries for pending transactions

// ✅ Endpoint to control game state
app.post('/game-state', (req, res) => {
  const { action } = req.body;
  if (action === 'start') {
    isGameActive = true;
    console.log("🔄 Game retry initiated. Resuming transaction processing.");
  } else if (action === 'stop') {
    isGameActive = false;
    pendingTransactions.clear(); // Clear pending transactions
    console.log("🛑 Game stopped. Pending transactions cleared.");
  }
  res.status(200).send({ success: true });
});

// ✅ Process a transaction
async function processTransaction(score, address) {
  try {
    // ✅ Fetch nonce only once and track it
    const nonce = await nonceManager.getNonce();
    if (!usedNonces.has(nonce)) {
      console.log(`🚀 Using Nonce: ${nonce} for score ${score}`);
      usedNonces.add(nonce);
    }

    const feeData = await provider.getFeeData();
    if (!feeData.maxPriorityFeePerGas || !feeData.maxFeePerGas) {
      throw new Error("⚠️ Could not fetch gas fee data.");
    }

    const OWNER_WALLET = process.env.OWNER_WALLET; // ✅ Your wallet address in .env
    const tx = {
      to: OWNER_WALLET, // ✅ Send funds to YOUR wallet instead of the user
      value: ethers.parseEther('0.0001'), // Amount received per jump
      gasLimit: 21000,
      nonce: nonce,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
      maxFeePerGas: feeData.maxFeePerGas,
    };

    const transactionResponse = await nonceManager.sendTransaction(tx);
    console.log(`✅ Transaction sent for jump score ${score}: ${transactionResponse.hash}`);

    pendingTransactions.set(transactionResponse.hash, { nonce, score, address, attempts: 1 });

    transactionResponse.wait().then((receipt) => {
      console.log(`✅ Confirmed in block ${receipt.blockNumber}: ${transactionResponse.hash}`);
      pendingTransactions.delete(transactionResponse.hash);
    }).catch((error) => {
      console.error("❌ Transaction failed after sending:", error);
    });

    return { success: true, transactionHash: transactionResponse.hash };
  } catch (error) {
    console.error('❌ Transaction failed:', error);
    return { success: false, error: error.message };
  }
}

// ✅ Retry pending transactions
async function retryPendingTransactions() {
  if (!isGameActive) {
    console.log("⏸️ Game inactive. Pausing transaction retries.");
    return;
  }

  console.log("🔄 Checking for pending transactions...");
  let foundPending = false;

  for (const [txHash, data] of pendingTransactions) {
    const attemptCount = data.attempts || 1;

    if (attemptCount > MAX_RETRY_ATTEMPTS) {
      console.log(`❌ Max retries reached for: ${txHash}`);
      pendingTransactions.delete(txHash);
      continue;
    }

    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
      console.log(`⚠️ Resending (Attempt ${attemptCount}/5): ${txHash}`);
      pendingTransactions.set(txHash, { ...data, attempts: attemptCount + 1 });
      await processTransaction(data.score, data.address);
      foundPending = true;
    } else {
      console.log(`✅ Confirmed: ${txHash}`);
      pendingTransactions.delete(txHash);
    }
  }

  if (!foundPending) {
    console.log("✅ No pending transactions found.");
  }
}

// ✅ Endpoint to handle jump actions
app.post('/jump', async (req, res) => {
  const { score, address } = req.body;
  if (!score || !address) {
    return res.status(400).json({ success: false, error: "Missing required fields" });
  }
  console.log(`🚀 Processing jump for score ${score}, address: ${address}`);
  const transactionData = await processTransaction(score, address);
  res.status(202).send({
    success: transactionData.success,
    message: transactionData.success ? "Transaction sent successfully." : "Transaction failed.",
    transactionHash: transactionData.transactionHash || null,
    error: transactionData.error || null,
    logs: [
      `Score: ${score}`,
      `Sender: ${address}`,
      `TransactionHash: ${transactionData.transactionHash || "N/A"}`,
      `Status: ${transactionData.success ? "✅ Success" : "❌ Failed"}`
    ]
  });
});

// ✅ Start the server
app.listen(port, async () => {
  console.log(`🔥 Relayer server running at ${API_URL}`);
  await retryPendingTransactions();
});