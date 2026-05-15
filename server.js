const express = require("express");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Serve arquivos estáticos: index.html, css, js etc
app.use(express.static(__dirname));

const db = new sqlite3.Database(path.join(__dirname, "database.sqlite"));

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS states (
      date TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// Página principal
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/index.html", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Teste da API
app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "API funcionando" });
});

// Carregar estado do dia
app.get("/api/state/:date", (req, res) => {
  const date = req.params.date;

  db.get("SELECT data FROM states WHERE date = ?", [date], (err, row) => {
    if (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }

    if (!row) {
      return res.json({ ok: true, date, data: null });
    }

    res.json({
      ok: true,
      date,
      data: JSON.parse(row.data)
    });
  });
});

// Salvar estado do dia
app.post("/api/state/:date", (req, res) => {
  const date = req.params.date;
  const data = JSON.stringify(req.body || {});

  db.run(
    `
    INSERT INTO states (date, data, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(date) DO UPDATE SET
      data = excluded.data,
      updated_at = CURRENT_TIMESTAMP
    `,
    [date, data],
    function (err) {
      if (err) {
        return res.status(500).json({ ok: false, error: err.message });
      }

      res.json({ ok: true, date });
    }
  );
});

// Compatibilidade: se seu HTML chamar /api/state sem data
app.get("/api/state", (req, res) => {
  const date = req.query.date || "default";

  db.get("SELECT data FROM states WHERE date = ?", [date], (err, row) => {
    if (err) return res.status(500).json({ ok: false, error: err.message });

    res.json({
      ok: true,
      date,
      data: row ? JSON.parse(row.data) : null
    });
  });
});

app.post("/api/state", (req, res) => {
  const date = req.query.date || req.body.date || "default";
  const payload = req.body.data ?? req.body;
  const data = JSON.stringify(payload);

  db.run(
    `
    INSERT INTO states (date, data, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(date) DO UPDATE SET
      data = excluded.data,
      updated_at = CURRENT_TIMESTAMP
    `,
    [date, data],
    function (err) {
      if (err) return res.status(500).json({ ok: false, error: err.message });

      res.json({ ok: true, date });
    }
  );
});

// Qualquer outra rota abre o index
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
