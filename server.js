// server.js — CC Sama Bolso v4 com SQLite no Railway

const express = require("express");
const cors = require("cors");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));

const dbPath = path.join(__dirname, "cc_sama.sqlite");
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS day_state (
      date TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    version: "v4-sqlite",
    db: "cc_sama.sqlite"
  });
});

// Compatibilidade: várias possibilidades que o v4 pode chamar
app.get(["/api/state/:date", "/api/day/:date", "/api/data/:date"], (req, res) => {
  const date = req.params.date;

  db.get("SELECT data FROM day_state WHERE date = ?", [date], (err, row) => {
    if (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }

    if (!row) {
      return res.json({ ok: true, date, data: null });
    }

    try {
      res.json({ ok: true, date, data: JSON.parse(row.data) });
    } catch {
      res.json({ ok: true, date, data: row.data });
    }
  });
});

app.post(["/api/state/:date", "/api/day/:date", "/api/data/:date"], (req, res) => {
  const date = req.params.date;
  const payload = req.body;

  db.run(
    `
    INSERT INTO day_state (date, data, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(date) DO UPDATE SET
      data = excluded.data,
      updated_at = CURRENT_TIMESTAMP
    `,
    [date, JSON.stringify(payload)],
    function (err) {
      if (err) {
        return res.status(500).json({ ok: false, error: err.message });
      }

      res.json({ ok: true, date, saved: true });
    }
  );
});

app.delete(["/api/state/:date", "/api/day/:date", "/api/data/:date"], (req, res) => {
  const date = req.params.date;

  db.run("DELETE FROM day_state WHERE date = ?", [date], function (err) {
    if (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }

    res.json({ ok: true, date, deleted: true });
  });
});

// Servir arquivos estáticos
app.use(express.static(__dirname));

// Abrir index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Fallback
app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({
      ok: false,
      error: "API não encontrada",
      path: req.path
    });
  }

  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log("Servidor rodando na porta " + PORT);
});
