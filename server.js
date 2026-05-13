const express = require('express');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// IMPORTANT: this line makes EVERY file inside /public work online
app.use(express.static(path.join(__dirname, 'public')));

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'mapa_cc.db');
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS plantoes (
    data TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`);
});

function emptyPlantao(data) {
  return { data, items: [], anesthetists: [], catalog: [], updatedAt: null };
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, db: DB_PATH, now: new Date().toISOString() });
});

app.get('/api/status', (req, res) => {
  db.all('SELECT data, updatedAt, payload FROM plantoes ORDER BY data DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    let cirurgias = 0;
    let anestesistas = 0;
    const datas = [];
    for (const r of rows || []) {
      try {
        const p = JSON.parse(r.payload || '{}');
        cirurgias += Array.isArray(p.items) ? p.items.length : 0;
        anestesistas += Array.isArray(p.anesthetists) ? p.anesthetists.length : 0;
        datas.push({ data: r.data, updatedAt: r.updatedAt, cirurgias: (p.items || []).length, anestesistas: (p.anesthetists || []).length });
      } catch {}
    }
    res.json({ ok: true, database: DB_PATH, plantoes: rows.length, cirurgias, anestesistas, datas });
  });
});

app.get('/api/plantao/:data', (req, res) => {
  const data = req.params.data;
  db.get('SELECT payload FROM plantoes WHERE data = ?', [data], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.json(emptyPlantao(data));
    try {
      const payload = JSON.parse(row.payload);
      return res.json({ ...emptyPlantao(data), ...payload });
    } catch (e) {
      return res.status(500).json({ error: 'Payload inválido no banco', details: e.message });
    }
  });
});

app.put('/api/plantao/:data', (req, res) => {
  const data = req.params.data;
  const payload = {
    data,
    items: Array.isArray(req.body.items) ? req.body.items : [],
    anesthetists: Array.isArray(req.body.anesthetists) ? req.body.anesthetists : [],
    catalog: Array.isArray(req.body.catalog) ? req.body.catalog : [],
    updatedAt: new Date().toISOString()
  };
  db.run(
    `INSERT INTO plantoes (data, payload, updatedAt) VALUES (?, ?, ?)
     ON CONFLICT(data) DO UPDATE SET payload=excluded.payload, updatedAt=excluded.updatedAt`,
    [data, JSON.stringify(payload), payload.updatedAt],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ok: true, ...payload });
    }
  );
});

app.post('/api/plantao/:data', (req, res) => {
  req.method = 'PUT';
  app._router.handle(req, res);
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`CC Sama rodando na porta ${PORT}`);
  console.log(`Banco SQLite: ${DB_PATH}`);
});
