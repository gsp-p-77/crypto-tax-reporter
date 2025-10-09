import { useEffect, useState } from "react";

export default function App() {
  const [transactions, setTransactions] = useState([]);
  const [form, setForm] = useState({ date: "", type: "", amount: "", price: "" });

  useEffect(() => {
    fetch("/api/transactions")
      .then((res) => res.json())
      .then(setTransactions);
  }, []);

  const addTx = async () => {
    await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setTransactions([...transactions, form]);
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Crypto Tax Tracker (Local)</h1>

      <div className="flex gap-2 mb-4">
        <input
          placeholder="Datum"
          type="date"
          value={form.date}
          onChange={(e) => setForm({ ...form, date: e.target.value })}
        />
        <select
          value={form.type}
          onChange={(e) => setForm({ ...form, type: e.target.value })}
        >
          <option value="">Art</option>
          <option value="Kauf">Kauf</option>
          <option value="Verkauf">Verkauf</option>
        </select>
        <input
          placeholder="Menge BTC"
          type="number"
          step="0.000001"
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
        />
        <input
          placeholder="Preis EUR"
          type="number"
          value={form.price}
          onChange={(e) => setForm({ ...form, price: e.target.value })}
        />
        <button onClick={addTx}>Hinzufügen</button>
      </div>

      <table>
        <thead>
          <tr>
            <th>Datum</th>
            <th>Art</th>
            <th>Menge</th>
            <th>Preis (EUR)</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((t, i) => (
            <tr key={i}>
              <td>{t.date}</td>
              <td>{t.type}</td>
              <td>{t.amount}</td>
              <td>{t.price}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
