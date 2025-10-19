import express from "express";
import { readFile, writeFile } from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import PDFDocument from "pdfkit";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const dataPath = path.join(__dirname, "data", "transactions.json");
const PORT = process.env.PORT || 3000;

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

app.get("/", (req, res) => {
  res.render("index.ejs");
});

app.get("/export", (req, res) => {
  res.render("export.ejs");
});

app.get("/transactions", async (req, res) => {
  const data = await loadData();
  res.render("view-transactions.ejs", { data });
});

app.get("/buy-btc-strike", (req, res) => {
  res.render("buy-btc-strike.ejs");
});

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
app.get("/export/tax/:year", async (req, res) => {
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

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
