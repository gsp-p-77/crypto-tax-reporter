import express from "express";
import fs from "fs";
import path from "path";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

const DATA_FILE = path.join("/data", "transactions.json");

// Sicherstellen, dass Datei existiert
if (!fs.existsSync("/data")) fs.mkdirSync("/data");
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]");

// API-Endpunkte
app.get("/api/transactions", (req, res) => {
  const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  res.json(data);
});

app.post("/api/transactions", (req, res) => {
  const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  data.push(req.body);
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  res.status(201).json({ success: true });
});

app.listen(3000, () => console.log("✅ Backend läuft auf Port 3000"));
