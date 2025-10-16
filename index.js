import express from "express";
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const dataPath = path.join(__dirname, 'data', 'transactions.json');

// --- parse form bodies
app.use(express.urlencoded({ extended: true })); // important for POST form parsing
app.use(express.json()); // optional if you want JSON bodies

async function loadData() {
  const data = await readFile(dataPath, 'utf8');
  return JSON.parse(data);
}

const PORT = process.env.PORT || 3000;

app.use(express.static("public"));
app.get("/", (req, res) => {
  res.render("index.ejs");
});

app.get('/load-json', async (req, res) => {
  const data = await loadData();
  res.render('table-form.ejs', { data });
});

app.post('/save', async (req, res) => {
  const { attribute1, attribute2, attribute3 } = req.body;

  // Combine arrays into list of objects
  const updatedData = attribute1.map((_, i) => ({
    attribute1: attribute1[i],
    attribute2: attribute2[i],
    attribute3: attribute3[i],
  }));

  await writeFile(dataPath, JSON.stringify(updatedData, null, 2));
  res.redirect('/');
});


app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
