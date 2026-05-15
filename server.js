"use strict";

/**
 * Sistema SQLite + Express pronto para Railway
 * Estrutura esperada:
 *
 * server.js
 * package.json
 * public/
 *   index.html
 *
 * Rotas principais:
 * GET    /api/health
 * GET    /api/pessoas
 * POST   /api/pessoas
 * PUT    /api/pessoas/:id
 * DELETE /api/pessoas/:id
 * GET    /api/db-inspector
 */

const express = require("express");
const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();

const app = express();

const PORT = Number(process.env.PORT) || 3000;
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DB_FILE = process.env.DB_FILE || path.join(ROOT_DIR, "database.db");

console.log("==================================");
console.log("Iniciando app Node/Express/SQLite");
console.log("ROOT_DIR:", ROOT_DIR);
console.log("PUBLIC_DIR:", PUBLIC_DIR);
console.log("DB_FILE:", DB_FILE);
console.log("PORT:", PORT);
console.log("Node:", process.version);
console.log("==================================");

if (!fs.existsSync(PUBLIC_DIR)) {
  console.error("ERRO: pasta public não encontrada em:", PUBLIC_DIR);
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
    db.run(sql, params, function callback(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, function callback(err, rows) {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, function callback(err, row) {
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
      nome TEXT NOT NULL CHECK(length(trim(nome)) > 0),
      idade INTEGER NOT NULL CHECK(idade >= 0 AND idade <= 130),
      criado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);

  await run(`
    CREATE TRIGGER IF NOT EXISTS trg_pessoas_atualizado_em
    AFTER UPDATE ON pessoas
    FOR EACH ROW
    BEGIN
      UPDATE pessoas
      SET atualizado_em = datetime('now', 'localtime')
      WHERE id = OLD.id;
    END
  `);

  console.log("Banco inicializado com sucesso.");
}

function validarPessoa(body) {
  const nome = String(body.nome || "").trim();
  const idade = Number(body.idade);

  if (!nome) {
    return { ok: false, error: "Nome é obrigatório." };
  }

  if (!Number.isInteger(idade) || idade < 0 || idade > 130) {
    return { ok: false, error: "Idade deve ser um número inteiro entre 0 e 130." };
  }

  return { ok: true, nome, idade };
}

// =========================
// APIs
// =========================

app.get("/api/health", async (req, res) => {
  try {
    const pessoaCount = await get("SELECT COUNT(*) AS total FROM pessoas");
    res.json({
      ok: true,
      app: "sqlite-railway-pro",
      message: "API funcionando",
      port: PORT,
      database_file: DB_FILE,
      database_exists: fs.existsSync(DB_FILE),
      pessoas_total: pessoaCount.total,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error("Erro em /api/health:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/pessoas", async (req, res) => {
  try {
    const rows = await all("SELECT * FROM pessoas ORDER BY id DESC");
    res.json(rows);
  } catch (err) {
    console.error("Erro GET /api/pessoas:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/pessoas", async (req, res) => {
  try {
    const validacao = validarPessoa(req.body);
    if (!validacao.ok) {
      return res.status(400).json({ error: validacao.error });
    }

    const result = await run(
      "INSERT INTO pessoas (nome, idade) VALUES (?, ?)",
      [validacao.nome, validacao.idade]
    );

    const row = await get("SELECT * FROM pessoas WHERE id = ?", [result.lastID]);
    res.status(201).json(row);
  } catch (err) {
    console.error("Erro POST /api/pessoas:", err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/pessoas/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "ID inválido." });
    }

    const validacao = validarPessoa(req.body);
    if (!validacao.ok) {
      return res.status(400).json({ error: validacao.error });
    }

    const existe = await get("SELECT id FROM pessoas WHERE id = ?", [id]);
    if (!existe) {
      return res.status(404).json({ error: "Registro não encontrado." });
    }

    await run(
      "UPDATE pessoas SET nome = ?, idade = ? WHERE id = ?",
      [validacao.nome, validacao.idade, id]
    );

    const row = await get("SELECT * FROM pessoas WHERE id = ?", [id]);
    res.json(row);
  } catch (err) {
    console.error("Erro PUT /api/pessoas/:id:", err);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/pessoas/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "ID inválido." });
    }

    const result = await run("DELETE FROM pessoas WHERE id = ?", [id]);

    if (result.changes === 0) {
      return res.status(404).json({ error: "Registro não encontrado." });
    }

    res.json({ ok: true, deleted_id: id });
  } catch (err) {
    console.error("Erro DELETE /api/pessoas/:id:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/db-inspector", async (req, res) => {
  try {
    const tables = await all(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
      ORDER BY name
    `);

    const inspector = {};

    for (const table of tables) {
      const tableName = table.name;

      const columns = await all(`PRAGMA table_info("${tableName}")`);
      const rows = await all(`SELECT * FROM "${tableName}"`);

      inspector[tableName] = {
        columns,
        row_count: rows.length,
        rows
      };
    }

    res.json({
      database_file: DB_FILE,
      tables: inspector
    });
  } catch (err) {
    console.error("Erro GET /api/db-inspector:", err);
    res.status(500).json({ error: err.message });
  }
});

// Diagnóstico útil no Railway
app.get("/api/routes", (req, res) => {
  res.json([
    "GET /",
    "GET /api/health",
    "GET /api/pessoas",
    "POST /api/pessoas",
    "PUT /api/pessoas/:id",
    "DELETE /api/pessoas/:id",
    "GET /api/db-inspector",
    "GET /api/routes"
  ]);
});

// Arquivos estáticos depois das APIs
app.use(express.static(PUBLIC_DIR, {
  extensions: ["html"],
  maxAge: "0",
  etag: false
}));

app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// Se for /api inexistente, retorna JSON, não HTML
app.use("/api", (req, res) => {
  res.status(404).json({
    error: "Rota de API não encontrada.",
    path: req.path,
    dica: "Teste /api/health ou /api/routes"
  });
});

// Qualquer outra rota abre o index
app.get("*", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

initDb()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Servidor rodando em 0.0.0.0:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Falha ao inicializar o banco:", err);
    process.exit(1);
  });

process.on("SIGINT", () => {
  console.log("Fechando SQLite...");
  db.close(() => process.exit(0));
});

process.on("SIGTERM", () => {
  console.log("Fechando SQLite...");
  db.close(() => process.exit(0));
});