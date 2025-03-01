const express = require('express');
const bodyParser = require('body-parser');
const { ethers } = require('ethers');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: './backend/.env' });

console.log("VERCEL:", process.env.VERCEL);
console.log("VERCEL_URL:", process.env.VERCEL_URL);

const app = express();
const port = process.env.PORT || 3000;
const API_URL = process.env.API_URL_PROD || `http://localhost:${port}`;

// ✅ Dynamically allow frontend URLs, including Vercel preview deployments
const allowedOrigins = new Set([
  process.env.FRONTEND_URL_LOCAL || "http://127.0.0.1:5500",
  "http://localhost:5500",
  API_URL,
  process.env.FRONTEND_URL_PROD || "https://monad-jumper.vercel.app"
]);

// ✅ Automatically allow all Vercel preview domains
if (process.env.VERCEL === "1" && process.env.VERCEL_URL) {
  allowedOrigins.add(`https://${process.env.VERCEL_URL}`);
  allowedOrigins.add(`https://monad-jumper-${process.env.VERCEL_URL}`);
}

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || [...allowedOrigins].some((allowed) => origin.startsWith(allowed))) {
      callback(null, true);
    } else {
      console.error(`❌ CORS Rejected for Origin: ${origin}`);
      callback(new Error("⚠️ CORS policy: Unauthorized request!"));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(bodyParser.json());

// ✅ Force CORS Headers for Allowed Origins
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && [...allowedOrigins].some((allowed) => origin.startsWith(allowed))) {
    res.header("Access-Control-Allow-Origin", origin);
  }
  res.header("Access-Control-Allow-Methods", "GET, HEAD, PUT, PATCH, POST, DELETE");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Credentials", "true");
  next();
});

// ✅ Handle OPTIONS requests for preflight
app.options('*', (req, res) => {
  res.header("Access-Control-Allow-Origin", req.headers.origin);
  res.header("Access-Control-Allow-Methods", "GET, HEAD, PUT, PATCH, POST, DELETE");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Credentials", "true");
  res.sendStatus(204); // No content for preflight requests
});

// ✅ Serve static files from "public" folder
app.use(express.static(path.join(__dirname, 'public')));

// ✅ Inject environment variables into HTML
app.get('/', (req, res) => {
  const filePath = path.join(__dirname, 'public', 'index.html');
  let html = fs.readFileSync(filePath, 'utf8');
  html = html.replace('{{API_URL}}', API_URL);
  res.send(html);
});

// ✅ Serve API URL dynamically
app.get('/config', (req, res) => {
  res.json({ api_url: API_URL });
});

// ✅ Test Route to Check CORS Headers
app.get("/test-cors", (req, res) => {
  res.json({ message: "✅ CORS is working!" });
});

// ✅ Ethereum setup
const provider = new ethers.JsonRpcProvider('https://testnet-rpc.monad.xyz');
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const nonceManager = new ethers.NonceManager(wallet);
const pendingTransactions = new Map();
const usedNonces = new Set(); // ✅ Track used nonces

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

    pendingTransactions.set(transactionResponse.hash, { nonce, score, address });

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
  console.log("🔄 Checking for pending transactions...");
  let foundPending = false;

  for (const [txHash, data] of pendingTransactions) {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
      console.log(`⚠️ Resending unconfirmed transaction: ${txHash}`);
      await processTransaction(data.score, data.address);
      foundPending = true;
    } else {
      console.log(`✅ Transaction already confirmed: ${txHash}`);
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