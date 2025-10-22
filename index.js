import express from "express";
import { readFile, writeFile } from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import PDFDocument from "pdfkit";
import session from "express-session";
import bcrypt from "bcrypt";
import flash from "connect-flash";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const dataPath = path.join(__dirname, "data", "transactions.json");
const PORT = process.env.PORT || 3000;

// ====== 🔐 AUTH CONFIG ======
const USERNAME = process.env.APP_USERNAME || "admin";
const PASSWORD = process.env.APP_PASSWORD || "changeme123";
const SESSION_SECRET = process.env.SESSION_SECRET || "supergeheim123"

// Passwort beim Start hashen
const PASSWORD_HASH = await bcrypt.hash(PASSWORD, 10);

// --- Login-Versuchslimits (IP-basiert)
const loginAttempts = new Map(); // speichert { ip: { count, lockUntil } }
const MAX_ATTEMPTS = 3;
const LOCK_TIME_MINUTES = 60; //60 Minuten
const LOCK_TIME_MS = LOCK_TIME_MINUTES * 60 * 1000;

// --- Session middleware
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
  })
);

// Make flash messages available in all views
app.use(flash());
app.use((req, res, next) => {
  res.locals.success_msg = req.flash("success_msg");
  res.locals.error_msg = req.flash("error_msg");
  next();
});

// --- Middleware to protect routes
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function isLocked(ip) {
  const record = loginAttempts.get(ip);
  if (!record) return false;

  if (record.lockUntil && record.lockUntil > Date.now()) {
    return true; // noch gesperrt
  }

  // Falls Sperre abgelaufen, Eintrag zurücksetzen
  if (record.lockUntil && record.lockUntil <= Date.now()) {
    loginAttempts.delete(ip);
  }
  return false;
}

function registerFailedAttempt(ip) {
  const record = loginAttempts.get(ip) || { count: 0, lockUntil: null };
  record.count += 1;

  if (record.count >= MAX_ATTEMPTS) {
    record.lockUntil = Date.now() + LOCK_TIME_MS;
    console.warn(`🚫 Login von ${ip} gesperrt.`);
  }

  loginAttempts.set(ip, record);
}

function resetAttempts(ip) {
  loginAttempts.delete(ip);
}

// --- parse form bodies
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Ensure data directory and file exist
if (!existsSync(path.join(__dirname, "data"))) {
  mkdirSync(path.join(__dirname, "data"));
  console.log("📁 Created missing data directory");
}

if (!existsSync(dataPath)) {
  await writeFile(dataPath, JSON.stringify([], null, 2));
  console.log("✅ Created new transactions.json file");
}

async function loadData() {
  try {
    if (!existsSync(dataPath)) {
      await writeFile(dataPath, JSON.stringify([], null, 2));
      return [];
    }
    const data = await readFile(dataPath, "utf8");
    return JSON.parse(data || "[]");
  } catch (err) {
    console.warn("⚠️ Could not read transactions.json:", err.message);
    return [];
  }
}

// -----------------------------------------------------------------------------
// TAX CALCULATION
// -----------------------------------------------------------------------------
function calculateTaxReport(transactions, year) {
  const buys = [];
  const sales = [];

  // --- Aufteilen in Käufe und Verkäufe ---
  for (const tx of transactions) {
    if (tx.type.toLowerCase().includes("buy")) {
      buys.push({ ...tx });
    } else if (tx.type.toLowerCase().includes("sell")) {
      sales.push({ ...tx });
    }
  }

  const report = [];
  let totalProfit = 0;       // wirtschaftlicher Gesamtgewinn
  let taxableProfit = 0;     // steuerpflichtiger Gewinn

  for (const sale of sales.filter(t => new Date(t.date).getFullYear() === year)) {
    let remaining = sale.amount;
    let acquisitionCost = 0;
    let profitForThisSale = 0;
    let taxableProfitForThisSale = 0;
    const usedBuys = [];
    const saleDate = new Date(sale.date);

    while (remaining > 0 && buys.length > 0) {
      const firstBuy = buys[0];
      const available = Math.min(remaining, firstBuy.amount);
      const buyDate = new Date(firstBuy.date);

      const proportionalFee = (available / firstBuy.amount) * (firstBuy.fee || 0);
      const costForThisPart = available * firstBuy.pricePerBtc + proportionalFee;

      const holdingDays = Math.floor((saleDate - buyDate) / (1000 * 60 * 60 * 24));
      const isTaxFree = holdingDays > 365;

      const sellRevenuePart =
        (available / sale.amount) * (sale.amount * sale.pricePerBtc - (sale.fee || 0));
      const profitPart = sellRevenuePart - costForThisPart;

      acquisitionCost += costForThisPart;
      remaining -= available;
      firstBuy.amount -= available;
      if (firstBuy.amount <= 0) buys.shift();

      usedBuys.push({
        id: firstBuy.id,
        date: firstBuy.date,
        amountUsed: available,
        pricePerBtc: firstBuy.pricePerBtc,
        totalCost: costForThisPart,
        feePart: proportionalFee,
        holdingDays,
        isTaxFree,
        profitPart
      });

      profitForThisSale += profitPart;
      if (!isTaxFree) taxableProfitForThisSale += profitPart;
    }

    const sellValue = sale.amount * sale.pricePerBtc - (sale.fee || 0);

    // Gesamtgewinn (immer)
    totalProfit += profitForThisSale;

    // Nur steuerpflichtige Gewinne berücksichtigen (Haltefrist <= 1 Jahr)
    taxableProfit += taxableProfitForThisSale;

    report.push({
      saleId: sale.id,
      date: sale.date,
      coin: sale.crypto_currency,
      amount: sale.amount,
      sellValue,
      buyValue: acquisitionCost,
      profit: profitForThisSale,
      taxableProfit: taxableProfitForThisSale,
      fee: sale.fee || 0,
      usedBuys,
    });
  }

  return { year, totalProfit, taxableProfit, report };
}
// -----------------------------------------------------------------------------
// PDF CREATION
// -----------------------------------------------------------------------------
async function createTaxPdf({ year, totalProfit, taxableProfit, report, allTransactions }) {
  const doc = new PDFDocument({ margin: 40 });
  const chunks = [];

  // === Header ===
  doc.fontSize(18).text(`Krypto Steuerreport ${year}`, { align: "center", underline: true });
  doc.moveDown(1.5);

  doc.fontSize(12).text(`Gesamter wirtschaftlicher Gewinn: €${totalProfit.toFixed(2)}`);
  doc.text(`Davon steuerpflichtig: €${taxableProfit.toFixed(2)}`);
  doc.moveDown(2);

  // === Tabelle Verkäufe ===
  doc.font("Helvetica-Bold").fontSize(13).text("Verkäufe und Gewinnermittlung", { underline: true });
  doc.moveDown(1);

  doc.font("Helvetica-Bold").fontSize(11);
  doc.text("Datum", 50);
  doc.text("Coin", 130);
  doc.text("Verkauf (€)", 190);
  doc.text("Kaufkosten (€)", 300);
  doc.text("Gewinn (€)", 410);
  doc.text("Steuerfrei?", 500);
  doc.moveDown(0.5);
  doc.font("Helvetica").fontSize(10);

  for (const r of report) {
    const y = doc.y;
    doc.text(new Date(r.date).toLocaleDateString(), 50, y);
    doc.text(r.coin, 130, y);
    doc.text(r.sellValue.toFixed(2), 190, y);
    doc.text(r.buyValue.toFixed(2), 300, y);
    doc.text(r.profit.toFixed(2), 410, y);
    doc.text(r.taxableProfit > 0 ? "Nein" : "Ja", 500, y);
    doc.moveDown(0.7);

    // Zugeordnete Käufe anzeigen
    if (r.usedBuys && r.usedBuys.length > 0) {
      doc.font("Helvetica-Oblique").fontSize(9).text("Zugeordnete Käufe:", { indent: 60 });
      doc.moveDown(0.3);

      for (const b of r.usedBuys) {
        doc.font("Helvetica").fontSize(9);
        doc.text(
          `→ ${b.id}\n   Datum: ${new Date(b.date).toLocaleDateString()} | Menge: ${b.amountUsed.toFixed(8)} BTC @ €${b.pricePerBtc.toFixed(2)}\n   Kosten: €${b.totalCost.toFixed(2)} | Haltezeit: ${b.holdingDays} Tage | Steuerfrei: ${b.isTaxFree ? "Ja" : "Nein"}`,
          { indent: 70 }
        );
        doc.moveDown(0.5);
      }

      doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor("#cccccc").stroke();
      doc.moveDown(1);
    }
  }

  // === Alle Transaktionen ===
  doc.addPage();
  doc.font("Helvetica-Bold").fontSize(13).text("Alle Transaktionen (Rohdaten)", { underline: true });
  doc.moveDown(1);

  if (allTransactions && allTransactions.length > 0) {
    doc.fontSize(9);
    for (const tx of allTransactions) {
      doc.text(`ID: ${tx.id}`);
      doc.text(`Typ: ${tx.type}`);
      doc.text(`Datum: ${new Date(tx.date).toLocaleString()}`);
      doc.text(`Menge: ${tx.amount}`);
      doc.text(`Preis/BTC: ${tx.pricePerBtc}`);
      doc.text(`Gesamtbetrag: ${tx.priceOrder}`);
      doc.text(`Gebühr: ${tx.fee}`);
      doc.text(`Transaktions ID: ${tx.tx_hash}`);
      doc.text(`Kommentar: ${tx.comments}`);
      doc.moveDown(0.5);
      doc.moveTo(40, doc.y).lineTo(550, doc.y).strokeColor("#dddddd").stroke();
      doc.moveDown(1);
    }
  } else {
    doc.fontSize(10).text("Keine Transaktionen vorhanden.");
  }

  // === Footer / GitHub Link ===
  doc.addPage();
  doc.fontSize(10).fillColor("blue").text(
    "Quellcode und Projektinformationen:",
    50,
    100
  );
  doc.text("https://github.com/gsp-p-77/crypto-tax-reporter", {
    link: "https://github.com/gsp-p-77/crypto-tax-reporter",
    underline: true
  });

  doc.moveDown(2);
  doc.fillColor("black").text(
    "Dieses Dokument wurde automatisch generiert. Alle Angaben ohne Gewähr.",
    { align: "center" }
  );

  // === Return Buffer ===
  doc.end();
  return await new Promise((resolve) => {
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

// -----------------------------------------------------------------------------
// ROUTES
// -----------------------------------------------------------------------------
app.use(express.static("public"));

app.get("/login", (req, res) => {
  res.render("login.ejs", { error: null });
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const ip = req.ip; // oder req.headers["x-forwarded-for"] für Reverse Proxy

  // 🔒 Sperrung prüfen
  if (isLocked(ip)) {
    const record = loginAttempts.get(ip);
    const remaining = Math.ceil((record.lockUntil - Date.now()) / 1000 / 60);
    return res.render("login.ejs", {
      error: `❌ Zu viele Fehlversuche. Login gesperrt für ${remaining} Minuten.`,
    });
  }

  // 🔑 Login prüfen
  if (username === USERNAME && (await bcrypt.compare(password, PASSWORD_HASH))) {
    req.session.user = { username };
    resetAttempts(ip); // ✅ Erfolgreicher Login → Sperre zurücksetzen
    return res.redirect("/");
  }

  // ❌ Fehlversuch registrieren
  registerFailedAttempt(ip);

  const record = loginAttempts.get(ip);
  if (record.count >= MAX_ATTEMPTS) {
    return res.render("login.ejs", {
      error: `❌ Zu viele Fehlversuche. Login gesperrt.`,
    });
  } else {
    const remaining = MAX_ATTEMPTS - record.count;
    return res.render("login.ejs", {
      error: `❌ Benutzername oder Passwort falsch. ${remaining} Versuche verbleiben.`,
    });
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

app.get("/", (req, res) => {
  res.render("index.ejs");
});

app.get("/export", requireLogin, (req, res) => {
  res.render("export.ejs");
});

app.get("/transactions", requireLogin, async (req, res) => {
  const data = await loadData();
  res.render("view-transactions.ejs", { data });
});

app.get("/buy-btc-strike", requireLogin, (req, res) => {
  res.render("buy-btc-strike.ejs");
});

app.post("/buy-btc-strike", requireLogin, async (req, res) => {
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
    order_of_use: "FIFO",
  };

  try {
    let transactions = [];
    try {
      const fileData = await readFile(dataPath, "utf8");
      transactions = JSON.parse(fileData || "[]");
    } catch (err) {
      console.warn("No existing transactions file found:", err.message);
    }

    transactions.push(transaction);
    await writeFile(dataPath, JSON.stringify(transactions, null, 2));

    res.redirect("/");
  } catch (error) {
    console.error("Error saving transaction:", error);
    res.status(500).send("Server error saving transaction");
  }
});

app.get("/sell-btc-strike", requireLogin, (req, res) => {
  res.render("sell-btc-strike.ejs");
});

app.post("/sell-btc-strike", requireLogin, async (req, res) => {
  console.log("[POST] /sell-btc-strike");
  console.log("Received form data:", req.body);

  const transaction = {
    id: uuidv4(),
    type: "Sell with Strike",
    date: req.body.date,
    amount: parseFloat(req.body.amount),
    pricePerBtc: parseFloat(req.body.pricePerBtc),
    priceOrder: parseFloat(req.body.priceOrder),
    comments: req.body.comments || "",
    fee:
      parseFloat(req.body.amount) * parseFloat(req.body.pricePerBtc) -
      parseFloat(req.body.priceOrder),      
    crypto_currency: "BTC",
    tx_hash: req.body.transactionId || null,
    wallet_address: "Strike",
    order_of_use: "FIFO",
  };

  try {
    let transactions = [];
    try {
      const fileData = await readFile(dataPath, "utf8");
      transactions = JSON.parse(fileData || "[]");
    } catch (err) {
      console.warn("No existing transactions file found:", err.message);
    }

    transactions.push(transaction);
    await writeFile(dataPath, JSON.stringify(transactions, null, 2));

    res.redirect("/");
  } catch (error) {
    console.error("Error saving transaction:", error);
    res.status(500).send("Server error saving transaction");
  }
});

// --- Tax Export ---
app.get("/export/tax/:year", requireLogin, async (req, res) => {
  const year = parseInt(req.params.year);
  const transactions = await loadData();

  const report = calculateTaxReport(transactions, year);
  const pdfBuffer = await createTaxPdf({
  ...report,               // enthält year, totalProfit, report[]
  allTransactions: transactions,  // zusätzlich alle Transaktionen
  });

  res.setHeader("Content-Disposition", `attachment; filename=taxreport-${year}.pdf`);
  res.contentType("application/pdf");
  res.send(pdfBuffer);
});

app.post("/transactions/delete", requireLogin, async (req, res) => {
  const selectedIds = req.body.selected;

  if (!selectedIds || selectedIds.length === 0) {
    req.flash("error_msg", "Please select at least one transaction to delete.");
    return res.redirect("/transactions");
  }

  // If you store data in JSON:
  const dataPath = path.join(__dirname, "data", "transactions.json");
  const fileData = JSON.parse(await readFile(dataPath, "utf-8"));

  const updatedData = fileData.filter(tx => !selectedIds.includes(tx.id));
  await writeFile(dataPath, JSON.stringify(updatedData, null, 2));

  req.flash("success_msg", `${fileData.length - updatedData.length} transaction(s) deleted successfully.`);
  res.redirect("/transactions");
});

app.get("/transfer/strike-to-coldwallet", requireLogin, (req, res) => {
  res.render("transfer-strike-to-coldwallet.ejs");
});

app.post("/transfer-strike-to-cold", async (req, res) => {
  console.log("[POST] /transfer-strike-to-cold");
  console.log("Received form data:", req.body);

  const sentAmount = parseFloat(req.body.amount);
  const feeBtc = parseFloat(req.body.networkFeeBtc || 0);
  const receivedAmount = sentAmount - feeBtc;

  const transaction = {
    id: uuidv4(),
    type: "Transfer Strike → Cold Wallet",
    date: req.body.date,
    amount: sentAmount,
    feeBtc,
    receivedAmount,
    crypto_currency: "BTC",
    from_wallet: "Strike",
    to_wallet: "Cold Wallet",
    address: req.body.destinationAddress || "",
    comments: req.body.comments || "",
    isInternalTransfer: true
  };

  try {
    let transactions = [];
    try {
      const fileData = await readFile(dataPath, "utf8");
      transactions = JSON.parse(fileData || "[]");
    } catch {
      console.warn("No existing transactions file found. Starting new one.");
    }

    transactions.push(transaction);
    await writeFile(dataPath, JSON.stringify(transactions, null, 2));

    console.log("✅ Transfer saved:", transaction);
    res.redirect("/transactions");
  } catch (error) {
    console.error("❌ Error saving transfer:", error);
    res.status(500).send("Server error saving transfer");
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
