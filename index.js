import express from "express";
import { readFile, writeFile } from 'fs/promises';
import { existsSync, mkdirSync } from "fs";
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from "uuid";



const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const dataPath = path.join(__dirname, 'data', 'transactions.json');

// --- parse form bodies
app.use(express.urlencoded({ extended: true })); // important for POST form parsing
app.use(express.json()); // optional if you want JSON bodies

// Ensure the /data directory exists
if (!existsSync(path.join(__dirname, 'data'))) {
  mkdirSync(path.join(__dirname, 'data'));
  console.log("📁 Created missing data directory");
}

// Ensure transactions.json exists
if (!existsSync(dataPath)) {
  await writeFile(dataPath, JSON.stringify([], null, 2));
  console.log("✅ Created new transactions.json file");
}

async function loadData() {
  try {
    // If file doesn’t exist → create it empty
    if (!existsSync(dataPath)) {
      await writeFile(dataPath, JSON.stringify([], null, 2));
      console.log("✅ Created new transactions.json");
      return [];
    }

    const data = await readFile(dataPath, "utf8");
    return JSON.parse(data || "[]");
  } catch (err) {
    console.warn("⚠️ Could not read transactions.json:", err.message);
    return [];
  }
}

const PORT = process.env.PORT || 3000;



app.use(express.static("public"));

app.get("/", (req, res) => {
  res.render("index.ejs");
});

app.get("/transactions", async (req, res) => {
  const data = await loadData();
  res.render("view-transactions.ejs", { data });
});

app.get("/buy-btc-strike", (req, res) => {
  res.render("buy-btc-strike.ejs");
});


// Handle form submission
app.post("/buy-btc-strike", async (req, res) => {
  console.log("[POST] /buy-btc-strike");
  console.log("Received form data:", req.body);


  const transaction = {
    id: uuidv4(),
    type: "Buy with Strike",
    date: req.body.date,
    amount: parseFloat(req.body.amount),
    pricePerBtc: parseFloat(req.body.pricePerBtc),
    priceOrder: parseFloat(req.body.priceOrder),
    comments: req.body.comments || "",
    fee:
      parseFloat(req.body.priceOrder) -
      parseFloat(req.body.amount) * parseFloat(req.body.pricePerBtc),
    crypto_currency: "BTC",
    tx_hash: req.body.transactionId || null,
    wallet_address: "Strike",
    order_of_use: "FIFO"
  };
  
  console.log("Constructed transaction object:", transaction);

  try {
    let transactions = [];
    try {
      const fileData = await readFile(dataPath, "utf8");
      transactions = JSON.parse(fileData || "[]");
      console.log(`Loaded ${transactions.length} existing transactions.`);
    } catch (err) {
      console.warn("No existing transactions file found or failed to read. Starting fresh:", err.message);
    }

    transactions.push(transaction);
    console.log("New transactions array length:", transactions.length);

    await writeFile(dataPath, JSON.stringify(transactions, null, 2));
    console.log("Transaction saved successfully to", dataPath);

    res.redirect("/"); // redirect after success
  } catch (error) {
    console.error("Error saving transaction:", error);
    res.status(500).send("Server error saving transaction");
  }
});1

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
