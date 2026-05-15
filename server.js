const express = require('express');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = process.env.DATABASE_PATH || path.join(dataDir, 'cc_sama.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS surgeries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day TEXT NOT NULL,
    start TEXT NOT NULL,
    room TEXT NOT NULL,
    title TEXT NOT NULL,
    duration INTEGER NOT NULL DEFAULT 60,
    service TEXT DEFAULT '',
    initials TEXT DEFAULT '',
    age TEXT DEFAULT '',
    obs TEXT DEFAULT '',
    anesthetist_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS anesthetists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
});

const run = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) {
    if (err) reject(err);
    else resolve({ id: this.lastID, changes: this.changes });
  });
});

const all = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
});

function safeDay(day) {
  return /^\d{4}-\d{2}-\d{2}$/.test(day || '') ? day : new Date().toISOString().slice(0, 10);
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, database: dbPath, now: new Date().toISOString() });
});

app.get('/api/state/:day', async (req, res) => {
  try {
    const day = safeDay(req.params.day);
    const surgeries = await all(`
      SELECT s.*, a.name AS anesthetist
      FROM surgeries s
      LEFT JOIN anesthetists a ON a.id = s.anesthetist_id
      WHERE s.day = ?
      ORDER BY s.room, s.start, s.id
    `, [day]);
    const anesthetists = await all('SELECT * FROM anesthetists ORDER BY name');
    res.json({ ok: true, day, surgeries, anesthetists });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/surgeries', async (req, res) => {
  try {
    const s = req.body || {};
    const result = await run(`
      INSERT INTO surgeries(day,start,room,title,duration,service,initials,age,obs,anesthetist_id)
      VALUES(?,?,?,?,?,?,?,?,?,?)
    `, [
      safeDay(s.day), s.start || '07:00', s.room || 'Cirurgias não escaladas',
      s.title || 'Cirurgia', Number(s.duration) || 60, s.service || '', s.initials || '',
      s.age || '', s.obs || '', s.anesthetist_id || null
    ]);
    res.json({ ok: true, id: result.id });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.put('/api/surgeries/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const s = req.body || {};
    await run(`
      UPDATE surgeries SET
        start = COALESCE(?, start),
        room = COALESCE(?, room),
        title = COALESCE(?, title),
        duration = COALESCE(?, duration),
        service = COALESCE(?, service),
        initials = COALESCE(?, initials),
        age = COALESCE(?, age),
        obs = COALESCE(?, obs),
        anesthetist_id = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [s.start ?? null, s.room ?? null, s.title ?? null, s.duration ?? null, s.service ?? null,
        s.initials ?? null, s.age ?? null, s.obs ?? null, s.anesthetist_id ?? null, id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete('/api/surgeries/:id', async (req, res) => {
  try {
    await run('DELETE FROM surgeries WHERE id = ?', [Number(req.params.id)]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/import', async (req, res) => {
  try {
    const day = safeDay(req.body.day);
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    let inserted = 0;
    for (const s of items) {
      await run(`INSERT INTO surgeries(day,start,room,title,duration,service,initials,age,obs)
        VALUES(?,?,?,?,?,?,?,?,?)`, [
        day, s.start || '07:00', s.room || 'Cirurgias não escaladas', s.title || 'Cirurgia',
        Number(s.duration) || 60, s.service || '', s.initials || '', s.age || '', s.obs || ''
      ]);
      inserted++;
    }
    res.json({ ok: true, inserted });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/anesthetists', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ ok: false, error: 'Nome vazio' });
    const result = await run('INSERT OR IGNORE INTO anesthetists(name) VALUES(?)', [name]);
    res.json({ ok: true, id: result.id });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`CC Sama rodando na porta ${PORT}`));
