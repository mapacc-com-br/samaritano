Javascript
  
const express = require("express");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const PORT = process.env.PORT || 3000;

// ===== DATABASE =====
const db = new sqlite3.Database("./database.db");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS cirurgias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT,
      sala TEXT,
      inicio TEXT,
      fim TEXT
    )
  `);
});

// ===== MIDDLEWARE =====
app.use(express.json());

// MUITO IMPORTANTE:
// serve apenas a pasta public
app.use(express.static(path.join(__dirname, "public")));

// ===== API =====

// teste
app.get("/api/teste", (req, res) => {
  res.json({
    ok: true,
    message: "API funcionando"
  });
});

// listar cirurgias
app.get("/api/cirurgias", (req, res) => {
  db.all("SELECT * FROM cirurgias", [], (err, rows) => {
    if (err) {
      return res.status(500).json({
        error: err.message
      });
    }

    res.json(rows);
  });
});

// salvar cirurgia
app.post("/api/cirurgias", (req, res) => {
  const { nome, sala, inicio, fim } = req.body;

  db.run(
    `
    INSERT INTO cirurgias (nome, sala, inicio, fim)
    VALUES (?, ?, ?, ?)
    `,
    [nome, sala, inicio, fim],
    function (err) {
      if (err) {
        return res.status(500).json({
          error: err.message
        });
      }

      res.json({
        success: true,
        id: this.lastID
      });
    }
  );
});

// ===== ROTAS HTML =====

// abre index.html SOMENTE na raiz
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// páginas individuais
app.get("/celv4", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "celv4.html"));
});

// ===== START =====
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
