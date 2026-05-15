"use strict";

const express = require("express");
const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();

const app = express();

const PORT = Number(process.env.PORT) || 3000;
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");

// Railway Volume persistente
const DB_FILE = "/data/database.db";

try {
  fs.mkdirSync("/data", { recursive: true });
} catch (e) {}

console.log("==================================");
console.log("Sistema Mapa de Cirurgias por Dia");
console.log("DB:", DB_FILE);
console.log("PORT:", PORT);
console.log("==================================");

app.disable("x-powered-by");
app.use(express.json({ limit: "3mb" }));
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
      else resolve({ lastID: this.lastID, changes: this.changes });
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
  await run("PRAGMA foreign_keys = ON");

  await run(`
    CREATE TABLE IF NOT EXISTS cirurgias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      data_cirurgia TEXT NOT NULL,

      horario_inicio TEXT NOT NULL,
      nome_cirurgia TEXT NOT NULL,
      duracao TEXT NOT NULL,

      sala TEXT NOT NULL,

      servico TEXT NOT NULL CHECK(servico IN ('SMA', 'Particular')),

      anestesista_escalado TEXT,

      iniciais_paciente TEXT NOT NULL,
      idade_paciente INTEGER NOT NULL,

      criado_em TEXT DEFAULT (datetime('now', 'localtime')),
      atualizado_em TEXT DEFAULT (datetime('now', 'localtime')),

      UNIQUE(data_cirurgia, iniciais_paciente, idade_paciente)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS anestesistas_dia (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      data_escala TEXT NOT NULL,
      nome_anestesista TEXT NOT NULL,

      observacao TEXT,

      criado_em TEXT DEFAULT (datetime('now', 'localtime')),
      atualizado_em TEXT DEFAULT (datetime('now', 'localtime')),

      UNIQUE(data_escala, nome_anestesista)
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

  await run(`
    CREATE TRIGGER IF NOT EXISTS trg_update_anestesistas_dia
    AFTER UPDATE ON anestesistas_dia
    FOR EACH ROW
    BEGIN
      UPDATE anestesistas_dia
      SET atualizado_em = datetime('now', 'localtime')
      WHERE id = OLD.id;
    END;
  `);

  console.log("Banco inicializado.");
}

function validarDataISO(data) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(data || ""));
}

function validarCirurgia(body) {
  const data_cirurgia = String(body.data_cirurgia || "").trim();
  const horario_inicio = String(body.horario_inicio || "").trim();
  const nome_cirurgia = String(body.nome_cirurgia || "").trim();
  const duracao = String(body.duracao || "").trim();
  const sala = String(body.sala || "").trim();
  const servico = String(body.servico || "").trim();
  const anestesista_escalado = String(body.anestesista_escalado || "").trim();
  const iniciais_paciente = String(body.iniciais_paciente || "").trim().toUpperCase();
  const idade_paciente = Number(body.idade_paciente);

  if (!validarDataISO(data_cirurgia)) return { ok:false, error:"Data da cirurgia inválida." };
  if (!horario_inicio) return { ok:false, error:"Horário obrigatório." };
  if (!nome_cirurgia) return { ok:false, error:"Nome da cirurgia obrigatório." };
  if (!duracao) return { ok:false, error:"Duração obrigatória." };
  if (!sala) return { ok:false, error:"Sala obrigatória." };

  if (servico !== "SMA" && servico !== "Particular") {
    return { ok:false, error:"Serviço deve ser SMA ou Particular." };
  }

  if (!iniciais_paciente) return { ok:false, error:"Iniciais do paciente obrigatórias." };

  if (!Number.isInteger(idade_paciente) || idade_paciente < 0 || idade_paciente > 130) {
    return { ok:false, error:"Idade inválida." };
  }

  return {
    ok:true,
    data_cirurgia,
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

function validarAnestesista(body) {
  const data_escala = String(body.data_escala || "").trim();
  const nome_anestesista = String(body.nome_anestesista || "").trim();
  const observacao = String(body.observacao || "").trim();

  if (!validarDataISO(data_escala)) return { ok:false, error:"Data da escala inválida." };
  if (!nome_anestesista) return { ok:false, error:"Nome do anestesista obrigatório." };

  return { ok:true, data_escala, nome_anestesista, observacao };
}

// HEALTH
app.get("/api/health", async (req, res) => {
  try {
    const c = await get("SELECT COUNT(*) AS total FROM cirurgias");
    const a = await get("SELECT COUNT(*) AS total FROM anestesistas_dia");

    res.json({
      ok:true,
      database: DB_FILE,
      total_cirurgias: c.total,
      total_anestesistas_dia: a.total,
      timestamp: new Date().toISOString()
    });
  } catch(err) {
    res.status(500).json({ ok:false, error:err.message });
  }
});

// MAPA DO DIA
app.get("/api/dia/:data", async (req, res) => {
  try {
    const data = String(req.params.data || "").trim();
    if (!validarDataISO(data)) {
      return res.status(400).json({ error:"Data inválida. Use YYYY-MM-DD." });
    }

    const cirurgias = await all(`
      SELECT *
      FROM cirurgias
      WHERE data_cirurgia = ?
      ORDER BY horario_inicio ASC, sala ASC
    `, [data]);

    const anestesistas = await all(`
      SELECT *
      FROM anestesistas_dia
      WHERE data_escala = ?
      ORDER BY nome_anestesista ASC
    `, [data]);

    res.json({
      data,
      cirurgias,
      anestesistas
    });
  } catch(err) {
    res.status(500).json({ error:err.message });
  }
});

// CIRURGIAS
app.get("/api/cirurgias", async (req, res) => {
  try {
    const data = String(req.query.data || "").trim();

    let rows;

    if (data) {
      if (!validarDataISO(data)) return res.status(400).json({ error:"Data inválida." });

      rows = await all(`
        SELECT *
        FROM cirurgias
        WHERE data_cirurgia = ?
        ORDER BY horario_inicio ASC, sala ASC
      `, [data]);
    } else {
      rows = await all(`
        SELECT *
        FROM cirurgias
        ORDER BY data_cirurgia DESC, horario_inicio ASC
      `);
    }

    res.json(rows);
  } catch(err) {
    res.status(500).json({ error:err.message });
  }
});

app.post("/api/cirurgias", async (req, res) => {
  try {
    const v = validarCirurgia(req.body);
    if (!v.ok) return res.status(400).json({ error:v.error });

    const result = await run(`
      INSERT INTO cirurgias (
        data_cirurgia,
        horario_inicio,
        nome_cirurgia,
        duracao,
        sala,
        servico,
        anestesista_escalado,
        iniciais_paciente,
        idade_paciente
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      v.data_cirurgia,
      v.horario_inicio,
      v.nome_cirurgia,
      v.duracao,
      v.sala,
      v.servico,
      v.anestesista_escalado,
      v.iniciais_paciente,
      v.idade_paciente
    ]);

    const row = await get("SELECT * FROM cirurgias WHERE id = ?", [result.lastID]);
    res.status(201).json(row);
  } catch(err) {
    if (String(err.message || "").includes("UNIQUE")) {
      return res.status(400).json({
        error:"Já existe cirurgia nesse dia com essas iniciais e idade."
      });
    }

    res.status(500).json({ error:err.message });
  }
});

app.put("/api/cirurgias/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error:"ID inválido." });

    const v = validarCirurgia(req.body);
    if (!v.ok) return res.status(400).json({ error:v.error });

    const result = await run(`
      UPDATE cirurgias
      SET
        data_cirurgia = ?,
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
      v.data_cirurgia,
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

    if (result.changes === 0) return res.status(404).json({ error:"Cirurgia não encontrada." });

    const row = await get("SELECT * FROM cirurgias WHERE id = ?", [id]);
    res.json(row);
  } catch(err) {
    if (String(err.message || "").includes("UNIQUE")) {
      return res.status(400).json({
        error:"Já existe cirurgia nesse dia com essas iniciais e idade."
      });
    }

    res.status(500).json({ error:err.message });
  }
});

app.delete("/api/cirurgias/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error:"ID inválido." });

    const result = await run("DELETE FROM cirurgias WHERE id = ?", [id]);

    if (result.changes === 0) return res.status(404).json({ error:"Cirurgia não encontrada." });

    res.json({ ok:true, deleted_id:id });
  } catch(err) {
    res.status(500).json({ error:err.message });
  }
});

// ANESTESISTAS DO DIA
app.get("/api/anestesistas", async (req, res) => {
  try {
    const data = String(req.query.data || "").trim();

    let rows;

    if (data) {
      if (!validarDataISO(data)) return res.status(400).json({ error:"Data inválida." });

      rows = await all(`
        SELECT *
        FROM anestesistas_dia
        WHERE data_escala = ?
        ORDER BY nome_anestesista ASC
      `, [data]);
    } else {
      rows = await all(`
        SELECT *
        FROM anestesistas_dia
        ORDER BY data_escala DESC, nome_anestesista ASC
      `);
    }

    res.json(rows);
  } catch(err) {
    res.status(500).json({ error:err.message });
  }
});

app.post("/api/anestesistas", async (req, res) => {
  try {
    const v = validarAnestesista(req.body);
    if (!v.ok) return res.status(400).json({ error:v.error });

    const result = await run(`
      INSERT INTO anestesistas_dia (
        data_escala,
        nome_anestesista,
        observacao
      )
      VALUES (?, ?, ?)
    `, [
      v.data_escala,
      v.nome_anestesista,
      v.observacao
    ]);

    const row = await get("SELECT * FROM anestesistas_dia WHERE id = ?", [result.lastID]);
    res.status(201).json(row);
  } catch(err) {
    if (String(err.message || "").includes("UNIQUE")) {
      return res.status(400).json({
        error:"Esse anestesista já está na escala desse dia."
      });
    }

    res.status(500).json({ error:err.message });
  }
});

app.put("/api/anestesistas/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error:"ID inválido." });

    const v = validarAnestesista(req.body);
    if (!v.ok) return res.status(400).json({ error:v.error });

    const result = await run(`
      UPDATE anestesistas_dia
      SET
        data_escala = ?,
        nome_anestesista = ?,
        observacao = ?
      WHERE id = ?
    `, [
      v.data_escala,
      v.nome_anestesista,
      v.observacao,
      id
    ]);

    if (result.changes === 0) return res.status(404).json({ error:"Anestesista não encontrado." });

    const row = await get("SELECT * FROM anestesistas_dia WHERE id = ?", [id]);
    res.json(row);
  } catch(err) {
    if (String(err.message || "").includes("UNIQUE")) {
      return res.status(400).json({
        error:"Esse anestesista já está na escala desse dia."
      });
    }

    res.status(500).json({ error:err.message });
  }
});

app.delete("/api/anestesistas/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error:"ID inválido." });

    const result = await run("DELETE FROM anestesistas_dia WHERE id = ?", [id]);

    if (result.changes === 0) return res.status(404).json({ error:"Anestesista não encontrado." });

    res.json({ ok:true, deleted_id:id });
  } catch(err) {
    res.status(500).json({ error:err.message });
  }
});

// DB INSPECTOR
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

      const columns = await all(`PRAGMA table_info("${tableName}")`);
      const rows = await all(`SELECT * FROM "${tableName}"`);

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
    res.status(500).json({ error:err.message });
  }
});

app.get("/api/routes", (req, res) => {
  res.json([
    "GET /api/health",
    "GET /api/dia/:data",
    "GET /api/cirurgias?data=YYYY-MM-DD",
    "POST /api/cirurgias",
    "PUT /api/cirurgias/:id",
    "DELETE /api/cirurgias/:id",
    "GET /api/anestesistas?data=YYYY-MM-DD",
    "POST /api/anestesistas",
    "PUT /api/anestesistas/:id",
    "DELETE /api/anestesistas/:id",
    "GET /api/db-inspector"
  ]);
});

// FRONTEND
app.use(express.static(PUBLIC_DIR));

app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.use("/api", (req, res) => {
  res.status(404).json({ error:"API não encontrada." });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

initDb()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Servidor rodando na porta ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Erro ao iniciar:", err);
    process.exit(1);
  });

process.on("SIGINT", () => {
  db.close(() => process.exit(0));
});

process.on("SIGTERM", () => {
  db.close(() => process.exit(0));
});