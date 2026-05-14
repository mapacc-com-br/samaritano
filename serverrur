// server.js — CC Sama Bolso v4
// Backend Node/Express + SQLite para Railway
// Rotas compatíveis com frontend v4 e fallback para variações comuns de endpoint.

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Arquivos estáticos: index.html / celv4.html / importador etc.
app.use(express.static(__dirname, {
  extensions: ["html"]
}));

// ---------- SQLite ----------
let db;
try {
  const Database = require("better-sqlite3");
  const dataDir = process.env.DATA_DIR || __dirname;
  const dbPath = process.env.DB_PATH || path.join(dataDir, "cc_sama.sqlite");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS surgeries (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      start TEXT,
      room TEXT,
      title TEXT,
      duration INTEGER DEFAULT 60,
      service TEXT,
      initials TEXT,
      age TEXT,
      anesthetist TEXT,
      obs TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS anesthetists (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      name TEXT NOT NULL,
      start TEXT,
      end TEXT,
      role TEXT,
      room TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  console.log("SQLite OK");
} catch (err) {
  console.error("Erro SQLite:", err);
  process.exit(1);
}

function uid(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeDate(date) {
  if (!date) return new Date().toISOString().slice(0, 10);
  return String(date).slice(0, 10);
}

function normalizeSurgery(raw = {}, forcedDate = null) {
  const date = normalizeDate(forcedDate || raw.date || raw.day);
  const id = raw.id || uid("sx");

  return {
    id,
    date,
    start: raw.start || raw.inicio || raw.time || "",
    room: raw.room || raw.sala || "Cirurgias não escaladas",
    title: raw.title || raw.cirurgia || raw.name || raw.procedure || "",
    duration: Number(raw.duration || raw.duracao || raw.minutes || 60) || 60,
    service: raw.service || raw.servico || "",
    initials: raw.initials || raw.iniciais || "",
    age: raw.age || raw.idade || "",
    anesthetist: raw.anesthetist || raw.anestesista || "",
    obs: raw.obs || raw.observation || "",
    status: raw.status || "active"
  };
}

function normalizeAnesthetist(raw = {}, forcedDate = null) {
  const date = normalizeDate(forcedDate || raw.date || raw.day);
  return {
    id: raw.id || uid("an"),
    date,
    name: raw.name || raw.nome || raw.anesthetist || raw.anestesista || "",
    start: raw.start || raw.inicio || "",
    end: raw.end || raw.fim || raw.saida || "",
    role: raw.role || raw.funcao || "",
    room: raw.room || raw.sala || ""
  };
}

function listSurgeries(date) {
  return db.prepare(`
    SELECT * FROM surgeries
    WHERE date = ? AND COALESCE(status, 'active') != 'deleted'
    ORDER BY start, room, title
  `).all(normalizeDate(date));
}

function listAnesthetists(date) {
  return db.prepare(`
    SELECT * FROM anesthetists
    WHERE date = ?
    ORDER BY start, name
  `).all(normalizeDate(date));
}

function upsertSurgery(s) {
  const item = normalizeSurgery(s);
  db.prepare(`
    INSERT INTO surgeries
      (id, date, start, room, title, duration, service, initials, age, anesthetist, obs, status, updated_at)
    VALUES
      (@id, @date, @start, @room, @title, @duration, @service, @initials, @age, @anesthetist, @obs, @status, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      date=excluded.date,
      start=excluded.start,
      room=excluded.room,
      title=excluded.title,
      duration=excluded.duration,
      service=excluded.service,
      initials=excluded.initials,
      age=excluded.age,
      anesthetist=excluded.anesthetist,
      obs=excluded.obs,
      status=excluded.status,
      updated_at=CURRENT_TIMESTAMP
  `).run(item);
  return item;
}

function upsertAnesthetist(a) {
  const item = normalizeAnesthetist(a);
  db.prepare(`
    INSERT INTO anesthetists
      (id, date, name, start, end, role, room, updated_at)
    VALUES
      (@id, @date, @name, @start, @end, @role, @room, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      date=excluded.date,
      name=excluded.name,
      start=excluded.start,
      end=excluded.end,
      role=excluded.role,
      room=excluded.room,
      updated_at=CURRENT_TIMESTAMP
  `).run(item);
  return item;
}

function getDayPayload(date) {
  const d = normalizeDate(date);
  return {
    ok: true,
    date: d,
    surgeries: listSurgeries(d),
    anesthetists: listAnesthetists(d)
  };
}

// ---------- Health ----------
app.get("/health", (req, res) => res.json({ ok: true, app: "cc-sama-bolso-v4" }));
app.get("/api/health", (req, res) => res.json({ ok: true, app: "cc-sama-bolso-v4" }));

// ---------- Day load/save: aceita várias rotas possíveis ----------
app.get(["/api/day/:date", "/api/days/:date", "/api/map/:date"], (req, res) => {
  res.json(getDayPayload(req.params.date));
});

app.get("/api/day", (req, res) => {
  res.json(getDayPayload(req.query.date));
});

app.post(["/api/day/:date", "/api/days/:date", "/api/map/:date"], (req, res) => {
  const date = normalizeDate(req.params.date);
  saveFullDay(date, req.body);
  res.json(getDayPayload(date));
});

app.post("/api/day", (req, res) => {
  const date = normalizeDate(req.body.date || req.query.date);
  saveFullDay(date, req.body);
  res.json(getDayPayload(date));
});

function saveFullDay(date, body = {}) {
  const surgeries = body.surgeries || body.cirurgias || [];
  const anesthetists = body.anesthetists || body.anestesistas || [];

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM surgeries WHERE date = ?").run(date);
    db.prepare("DELETE FROM anesthetists WHERE date = ?").run(date);

    for (const raw of surgeries) {
      upsertSurgery({ ...raw, date, id: raw.id || uid("sx") });
    }
    for (const raw of anesthetists) {
      upsertAnesthetist({ ...raw, date, id: raw.id || uid("an") });
    }
  });
  tx();
}

// ---------- Surgeries ----------
app.get(["/api/surgeries", "/api/cirurgias"], (req, res) => {
  res.json({ ok: true, surgeries: listSurgeries(req.query.date) });
});

app.post(["/api/surgeries", "/api/cirurgias"], (req, res) => {
  const items = Array.isArray(req.body) ? req.body : (req.body.surgeries || req.body.cirurgias || [req.body]);
  const saved = items.map(upsertSurgery);
  res.json({ ok: true, surgeries: saved });
});

app.put(["/api/surgeries/:id", "/api/cirurgias/:id"], (req, res) => {
  const current = db.prepare("SELECT * FROM surgeries WHERE id = ?").get(req.params.id);
  if (!current) return res.status(404).json({ ok: false, error: "Cirurgia não encontrada" });
  const saved = upsertSurgery({ ...current, ...req.body, id: req.params.id });
  res.json({ ok: true, surgery: saved });
});

app.patch(["/api/surgeries/:id", "/api/cirurgias/:id"], (req, res) => {
  const current = db.prepare("SELECT * FROM surgeries WHERE id = ?").get(req.params.id);
  if (!current) return res.status(404).json({ ok: false, error: "Cirurgia não encontrada" });
  const saved = upsertSurgery({ ...current, ...req.body, id: req.params.id });
  res.json({ ok: true, surgery: saved });
});

app.delete(["/api/surgeries/:id", "/api/cirurgias/:id"], (req, res) => {
  db.prepare("UPDATE surgeries SET status='deleted', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// ---------- Importador ----------
app.post(["/api/import", "/api/importar"], (req, res) => {
  const date = normalizeDate(req.body.date || req.query.date);
  const surgeries = req.body.surgeries || req.body.cirurgias || req.body.items || [];
  const saved = surgeries.map((s) => upsertSurgery({ ...s, date }));
  res.json({ ok: true, date, inserted: saved.length, surgeries: saved });
});

// ---------- Anesthetists ----------
app.get(["/api/anesthetists", "/api/anestesistas"], (req, res) => {
  res.json({ ok: true, anesthetists: listAnesthetists(req.query.date) });
});

app.post(["/api/anesthetists", "/api/anestesistas"], (req, res) => {
  const items = Array.isArray(req.body) ? req.body : (req.body.anesthetists || req.body.anestesistas || [req.body]);
  const saved = items.map(upsertAnesthetist);
  res.json({ ok: true, anesthetists: saved });
});

app.put(["/api/anesthetists/:id", "/api/anestesistas/:id"], (req, res) => {
  const current = db.prepare("SELECT * FROM anesthetists WHERE id = ?").get(req.params.id);
  if (!current) return res.status(404).json({ ok: false, error: "Anestesista não encontrado" });
  const saved = upsertAnesthetist({ ...current, ...req.body, id: req.params.id });
  res.json({ ok: true, anesthetist: saved });
});

app.patch(["/api/anesthetists/:id", "/api/anestesistas/:id"], (req, res) => {
  const current = db.prepare("SELECT * FROM anesthetists WHERE id = ?").get(req.params.id);
  if (!current) return res.status(404).json({ ok: false, error: "Anestesista não encontrado" });
  const saved = upsertAnesthetist({ ...current, ...req.body, id: req.params.id });
  res.json({ ok: true, anesthetist: saved });
});

app.delete(["/api/anesthetists/:id", "/api/anestesistas/:id"], (req, res) => {
  db.prepare("DELETE FROM anesthetists WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// ---------- Frontend fallback ----------
app.get("/", (req, res) => {
  const candidates = ["celv4.html", "index.html", "celv3.html"];
  for (const file of candidates) {
    const p = path.join(__dirname, file);
    if (fs.existsSync(p)) return res.sendFile(p);
  }
  res.status(200).send("CC Sama Bolso v4 backend OK. Envie o HTML para a pasta do projeto.");
});

// Para qualquer rota não-API, tenta devolver o frontend.
// Para API inexistente, devolve JSON 404 claro.
app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({
      ok: false,
      error: "Rota API não encontrada",
      path: req.path
    });
  }

  const p = path.join(__dirname, "celv4.html");
  if (fs.existsSync(p)) return res.sendFile(p);

  const idx = path.join(__dirname, "index.html");
  if (fs.existsSync(idx)) return res.sendFile(idx);

  res.status(404).send("Arquivo não encontrado");
});

app.listen(PORT, () => {
  console.log(`CC Sama Bolso v4 rodando na porta ${PORT}`);
});
