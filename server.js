"use strict";

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

try {
  fs.mkdirSync("/data", { recursive: true });
} catch (e) {}

console.log("==================================");
console.log("Sistema de Cirurgias");
console.log("DB:", DB_FILE);
console.log("PORT:", PORT);
console.log("==================================");

app.disable("x-powered-by");

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) {
    console.error("Erro SQLite:", err);
    process.exit(1);
  }

  console.log("SQLite conectado.");
});

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
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
    db.all(sql, params, function(err, rows) {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, function(err, row) {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

async function initDb() {

  await run("PRAGMA journal_mode = WAL");

  await run(`
    CREATE TABLE IF NOT EXISTS cirurgias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      horario_inicio TEXT NOT NULL,
      nome_cirurgia TEXT NOT NULL,
      duracao TEXT NOT NULL,

      sala TEXT NOT NULL,

      servico TEXT NOT NULL
        CHECK(servico IN ('SMA', 'Particular')),

      anestesista_escalado TEXT,

      iniciais_paciente TEXT NOT NULL,
      idade_paciente INTEGER NOT NULL,

      criado_em TEXT DEFAULT (datetime('now', 'localtime')),
      atualizado_em TEXT DEFAULT (datetime('now', 'localtime')),

      UNIQUE(iniciais_paciente, idade_paciente)
    )
  `);

  await run(`
    CREATE TRIGGER IF NOT EXISTS trg_update_cirurgias
    AFTER UPDATE ON cirurgias
    FOR EACH ROW
    BEGIN
      UPDATE cirurgias
      SET atualizado_em = datetime('now', 'localtime')
      WHERE id = OLD.id;
    END;
  `);

  console.log("Tabela cirurgias pronta.");
}

function validarCirurgia(body) {

  const horario_inicio = String(body.horario_inicio || "").trim();
  const nome_cirurgia = String(body.nome_cirurgia || "").trim();
  const duracao = String(body.duracao || "").trim();

  const sala = String(body.sala || "").trim();

  const servico = String(body.servico || "").trim();

  const anestesista_escalado =
    String(body.anestesista_escalado || "").trim();

  const iniciais_paciente =
    String(body.iniciais_paciente || "").trim().toUpperCase();

  const idade_paciente =
    Number(body.idade_paciente);

  if (!horario_inicio)
    return { ok:false, error:"Horário obrigatório." };

  if (!nome_cirurgia)
    return { ok:false, error:"Nome da cirurgia obrigatório." };

  if (!duracao)
    return { ok:false, error:"Duração obrigatória." };

  if (!sala)
    return { ok:false, error:"Sala obrigatória." };

  if (
    servico !== "SMA" &&
    servico !== "Particular"
  ) {
    return {
      ok:false,
      error:"Serviço deve ser SMA ou Particular."
    };
  }

  if (!iniciais_paciente)
    return {
      ok:false,
      error:"Iniciais do paciente obrigatórias."
    };

  if (
    !Number.isInteger(idade_paciente) ||
    idade_paciente < 0 ||
    idade_paciente > 130
  ) {
    return {
      ok:false,
      error:"Idade inválida."
    };
  }

  return {
    ok:true,

    horario_inicio,
    nome_cirurgia,
    duracao,

    sala,

    servico,

    anestesista_escalado,

    iniciais_paciente,
    idade_paciente
  };
}

// ======================================
// HEALTH
// ======================================

app.get("/api/health", async (req, res) => {

  try {

    const total =
      await get(
        "SELECT COUNT(*) AS total FROM cirurgias"
      );

    res.json({
      ok:true,
      database: DB_FILE,
      total_cirurgias: total.total,
      timestamp: new Date().toISOString()
    });

  } catch(err) {

    res.status(500).json({
      ok:false,
      error: err.message
    });

  }

});

// ======================================
// LISTAR CIRURGIAS
// ======================================

app.get("/api/cirurgias", async (req, res) => {

  try {

    const rows =
      await all(`
        SELECT *
        FROM cirurgias
        ORDER BY horario_inicio ASC
      `);

    res.json(rows);

  } catch(err) {

    res.status(500).json({
      error: err.message
    });

  }

});

// ======================================
// INSERIR CIRURGIA
// ======================================

app.post("/api/cirurgias", async (req, res) => {

  try {

    const v = validarCirurgia(req.body);

    if (!v.ok) {
      return res.status(400).json({
        error: v.error
      });
    }

    await run(`
      INSERT INTO cirurgias (
        horario_inicio,
        nome_cirurgia,
        duracao,
        sala,
        servico,
        anestesista_escalado,
        iniciais_paciente,
        idade_paciente
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      v.horario_inicio,
      v.nome_cirurgia,
      v.duracao,
      v.sala,
      v.servico,
      v.anestesista_escalado,
      v.iniciais_paciente,
      v.idade_paciente
    ]);

    res.json({
      ok:true
    });

  } catch(err) {

    if (
      String(err.message || "")
      .includes("UNIQUE")
    ) {

      return res.status(400).json({
        error:
          "Já existe cirurgia com essas iniciais e idade."
      });

    }

    res.status(500).json({
      error: err.message
    });

  }

});

// ======================================
// EDITAR
// ======================================

app.put("/api/cirurgias/:id", async (req, res) => {

  try {

    const id = Number(req.params.id);

    const v = validarCirurgia(req.body);

    if (!v.ok) {
      return res.status(400).json({
        error: v.error
      });
    }

    await run(`
      UPDATE cirurgias
      SET
        horario_inicio = ?,
        nome_cirurgia = ?,
        duracao = ?,
        sala = ?,
        servico = ?,
        anestesista_escalado = ?,
        iniciais_paciente = ?,
        idade_paciente = ?
      WHERE id = ?
    `, [
      v.horario_inicio,
      v.nome_cirurgia,
      v.duracao,
      v.sala,
      v.servico,
      v.anestesista_escalado,
      v.iniciais_paciente,
      v.idade_paciente,
      id
    ]);

    res.json({
      ok:true
    });

  } catch(err) {

    res.status(500).json({
      error: err.message
    });

  }

});

// ======================================
// DELETE
// ======================================

app.delete("/api/cirurgias/:id", async (req, res) => {

  try {

    const id = Number(req.params.id);

    await run(
      "DELETE FROM cirurgias WHERE id = ?",
      [id]
    );

    res.json({
      ok:true
    });

  } catch(err) {

    res.status(500).json({
      error: err.message
    });

  }

});

// ======================================
// DB INSPECTOR
// ======================================

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

      const columns =
        await all(
          `PRAGMA table_info("${tableName}")`
        );

      const rows =
        await all(
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

  } catch(err) {

    res.status(500).json({
      error: err.message
    });

  }

});

// ======================================
// ROUTES
// ======================================

app.get("/api/routes", (req, res) => {

  res.json([
    "GET /api/cirurgias",
    "POST /api/cirurgias",
    "PUT /api/cirurgias/:id",
    "DELETE /api/cirurgias/:id",
    "GET /api/db-inspector",
    "GET /api/health"
  ]);

});

// ======================================
// FRONTEND
// ======================================

app.use(express.static(PUBLIC_DIR));

app.get("/", (req, res) => {
  res.sendFile(
    path.join(PUBLIC_DIR, "index.html")
  );
});

app.use("/api", (req, res) => {
  res.status(404).json({
    error:"API não encontrada."
  });
});

app.get("*", (req, res) => {
  res.sendFile(
    path.join(PUBLIC_DIR, "index.html")
  );
});

// ======================================
// START
// ======================================

initDb()
  .then(() => {

    app.listen(PORT, "0.0.0.0", () => {
      console.log(
        `Servidor rodando na porta ${PORT}`
      );
    });

  })
  .catch((err) => {

    console.error(err);

    process.exit(1);

  });