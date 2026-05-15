```js
"use strict";

/**
 * Sistema SQLite + Express pronto para Railway
 * COM VOLUME PERSISTENTE
 */

const express = require("express");
const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();

const app = express();

const PORT = Number(process.env.PORT) || 3000;

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");

// DATABASE PERSISTENTE NO RAILWAY VOLUME
const DB_FILE = "/data/database.db";

console.log("==================================");
console.log("Iniciando app Node/Express/SQLite");
console.log("ROOT_DIR:", ROOT_DIR);
console.log("PUBLIC_DIR:", PUBLIC_DIR);
console.log("DB_FILE:", DB_FILE);
console.log("PORT:", PORT);
console.log("==================================");

// cria pasta /data se não existir
try {
  fs.mkdirSync("/data", { recursive: true });
} catch (e) {
  console.log("Pasta /data já existe.");
}

app.disable("x-powered-by");

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) {
    console.error("Erro ao abrir SQLite:", err);
    process.exit(1);
  }

  console.log("SQLite aberto com sucesso:", DB_FILE);
});

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({
        lastID: this.lastID,
        changes: this.changes
      });
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, function (err, rows) {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, function (err, row) {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

async function initDb() {
  await run("PRAGMA journal_mode = WAL");
  await run("PRAGMA foreign_keys = ON");

  await run(`
    CREATE TABLE IF NOT EXISTS pessoas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      idade INTEGER NOT NULL,
      criado_em TEXT DEFAULT (datetime('now', 'localtime')),
      atualizado_em TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  await run(`
    CREATE TRIGGER IF NOT EXISTS trg_update_pessoas
    AFTER UPDATE ON pessoas
    FOR EACH ROW
    BEGIN
      UPDATE pessoas
      SET atualizado_em = datetime('now', 'localtime')
      WHERE id = OLD.id;
    END;
  `);

  console.log("Banco inicializado.");
}

function validarPessoa(body) {
  const nome = String(body.nome || "").trim();
  const idade = Number(body.idade);

  if (!nome) {
    return {
      ok: false,
      error: "Nome é obrigatório."
    };
  }

  if (
    !Number.isInteger(idade) ||
    idade < 0 ||
    idade > 130
  ) {
    return {
      ok: false,
      error: "Idade inválida."
    };
  }

  return {
    ok: true,
    nome,
    idade
  };
}

// =========================
// API HEALTH
// =========================

app.get("/api/health", async (req, res) => {
  try {
    const total = await get(
      "SELECT COUNT(*) as total FROM pessoas"
    );

    res.json({
      ok: true,
      db_file: DB_FILE,
      db_exists: fs.existsSync(DB_FILE),
      pessoas_total: total.total,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

// =========================
// LISTAR
// =========================

app.get("/api/pessoas", async (req, res) => {
  try {
    const rows = await all(
      "SELECT * FROM pessoas ORDER BY id DESC"
    );

    res.json(rows);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: err.message
    });
  }
});

// =========================
// INSERIR
// =========================

app.post("/api/pessoas", async (req, res) => {
  try {
    const validacao = validarPessoa(req.body);

    if (!validacao.ok) {
      return res.status(400).json({
        error: validacao.error
      });
    }

    const result = await run(
      "INSERT INTO pessoas (nome, idade) VALUES (?, ?)",
      [validacao.nome, validacao.idade]
    );

    const row = await get(
      "SELECT * FROM pessoas WHERE id = ?",
      [result.lastID]
    );

    res.status(201).json(row);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: err.message
    });
  }
});

// =========================
// EDITAR
// =========================

app.put("/api/pessoas/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    const validacao = validarPessoa(req.body);

    if (!validacao.ok) {
      return res.status(400).json({
        error: validacao.error
      });
    }

    await run(
      "UPDATE pessoas SET nome = ?, idade = ? WHERE id = ?",
      [
        validacao.nome,
        validacao.idade,
        id
      ]
    );

    const row = await get(
      "SELECT * FROM pessoas WHERE id = ?",
      [id]
    );

    res.json(row);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: err.message
    });
  }
});

// =========================
// DELETAR
// =========================

app.delete("/api/pessoas/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    await run(
      "DELETE FROM pessoas WHERE id = ?",
      [id]
    );

    res.json({
      ok: true,
      deleted_id: id
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: err.message
    });
  }
});

// =========================
// DB INSPECTOR
// =========================

app.get("/api/db-inspector", async (req, res) => {
  try {
    const tables = await all(`
      SELECT name
      FROM sqlite_master
      WHERE type='table'
      ORDER BY name
    `);

    const result = {};

    for (const table of tables) {
      const tableName = table.name;

      const columns = await all(
        `PRAGMA table_info("${tableName}")`
      );

      const rows = await all(
        `SELECT * FROM "${tableName}"`
      );

      result[tableName] = {
        columns,
        row_count: rows.length,
        rows
      };
    }

    res.json({
      database_file: DB_FILE,
      tables: result
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: err.message
    });
  }
});

// =========================
// ROTAS
// =========================

app.get("/api/routes", (req, res) => {
  res.json([
    "GET /api/health",
    "GET /api/pessoas",
    "POST /api/pessoas",
    "PUT /api/pessoas/:id",
    "DELETE /api/pessoas/:id",
    "GET /api/db-inspector",
    "GET /api/routes"
  ]);
});

// =========================
// FRONTEND
// =========================

app.use(express.static(PUBLIC_DIR));

app.get("/", (req, res) => {
  res.sendFile(
    path.join(PUBLIC_DIR, "index.html")
  );
});

app.use("/api", (req, res) => {
  res.status(404).json({
    error: "API não encontrada."
  });
});

app.get("*", (req, res) => {
  res.sendFile(
    path.join(PUBLIC_DIR, "index.html")
  );
});

// =========================
// START
// =========================

initDb()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(
        `Servidor rodando na porta ${PORT}`
      );
    });
  })
  .catch((err) => {
    console.error(
      "Erro ao iniciar banco:",
      err
    );

    process.exit(1);
  });

process.on("SIGINT", () => {
  db.close(() => process.exit(0));
});

process.on("SIGTERM", () => {
  db.close(() => process.exit(0));
});
```
