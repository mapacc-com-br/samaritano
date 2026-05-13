const express = require('express');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'cc_sama.sqlite');

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS day_data (
    date TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
});

app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'Celv1_sqlite.html'));
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, db: DB_PATH });
});

app.get('/api/day/:date', (req, res) => {
  const date = req.params.date;
  db.get('SELECT payload FROM day_data WHERE date = ?', [date], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.json({ date, items: [], anesthetists: [] });
    try {
      const payload = JSON.parse(row.payload);
      res.json({ date, items: payload.items || [], anesthetists: payload.anesthetists || [] });
    } catch {
      res.status(500).json({ error: 'Payload inválido no banco' });
    }
  });
});

app.put('/api/day/:date', (req, res) => {
  const date = req.params.date;
  const payload = {
    items: Array.isArray(req.body.items) ? req.body.items : [],
    anesthetists: Array.isArray(req.body.anesthetists) ? req.body.anesthetists : []
  };
  db.run(
    `INSERT INTO day_data(date, payload, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(date) DO UPDATE SET payload = excluded.payload, updated_at = datetime('now')`,
    [date, JSON.stringify(payload)],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ok: true, date, items: payload.items.length, anesthetists: payload.anesthetists.length });
    }
  );
});

app.listen(PORT, () => {
  console.log(`CC Sama SQLite rodando em http://localhost:${PORT}`);
  console.log(`Banco SQLite: ${DB_PATH}`);
});
