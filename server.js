"use strict";

const express = require("express");
const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();

const app = express();

const PORT = Number(process.env.PORT) || 3000;
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DB_FILE = "/data/database.db";

try { fs.mkdirSync("/data", { recursive: true }); } catch (e) {}

app.disable("x-powered-by");
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) {
    console.error("Erro SQLite:", err);
    process.exit(1);
  }
  console.log("SQLite conectado:", DB_FILE);
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

function normalizarTextoChave(valor) {
  return String(valor || "").trim().replace(/\s+/g, " ").toUpperCase();
}

async function garantirColuna(tabela, coluna, definicao) {
  const cols = await all(`PRAGMA table_info("${tabela}")`);
  if (!cols.some(c => c.name === coluna)) {
    await run(`ALTER TABLE "${tabela}" ADD COLUMN ${coluna} ${definicao}`);
  }
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
      nome_cirurgia_key TEXT,
      duracao TEXT NOT NULL,
      sala TEXT NOT NULL,
      servico TEXT NOT NULL CHECK(servico IN ('SMA', 'Particular')),
      anestesista_escalado TEXT,
      iniciais_paciente TEXT NOT NULL,
      idade_paciente INTEGER NOT NULL,
      finalizada INTEGER NOT NULL DEFAULT 0,
      criado_em TEXT DEFAULT (datetime('now', 'localtime')),
      atualizado_em TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  await garantirColuna("cirurgias", "nome_cirurgia_key", "TEXT");
  await garantirColuna("cirurgias", "finalizada", "INTEGER NOT NULL DEFAULT 0");

  const antigas = await all(`
    SELECT id, nome_cirurgia
    FROM cirurgias
    WHERE nome_cirurgia_key IS NULL OR trim(nome_cirurgia_key) = ''
  `);

  for (const row of antigas) {
    await run(
      "UPDATE cirurgias SET nome_cirurgia_key = ? WHERE id = ?",
      [normalizarTextoChave(row.nome_cirurgia), row.id]
    );
  }

  await run(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_cirurgias_identidade
    ON cirurgias (
      data_cirurgia,
      nome_cirurgia_key,
      iniciais_paciente,
      idade_paciente
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS anestesistas_dia (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data_escala TEXT NOT NULL,
      nome_anestesista TEXT NOT NULL,
      horario_escala TEXT,
      funcao TEXT,
      observacao TEXT,
      criado_em TEXT DEFAULT (datetime('now', 'localtime')),
      atualizado_em TEXT DEFAULT (datetime('now', 'localtime')),
      UNIQUE(data_escala, nome_anestesista)
    )
  `);

  await garantirColuna("anestesistas_dia", "horario_escala", "TEXT");
  await garantirColuna("anestesistas_dia", "funcao", "TEXT");

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
  const nome_cirurgia_key = normalizarTextoChave(nome_cirurgia);
  const duracao = String(body.duracao || "").trim();
  const sala = String(body.sala || "").trim();
  const servico = String(body.servico || "").trim();
  const anestesista_escalado = String(body.anestesista_escalado || "").trim();
  const iniciais_paciente = String(body.iniciais_paciente || "").trim().toUpperCase();
  const idade_paciente = Number(body.idade_paciente);
  const finalizada = body.finalizada ? 1 : 0;

  if (!validarDataISO(data_cirurgia)) return { ok:false, error:"Data inválida." };
  if (!horario_inicio) return { ok:false, error:"Horário obrigatório." };
  if (!nome_cirurgia) return { ok:false, error:"Nome da cirurgia obrigatório." };
  if (!duracao) return { ok:false, error:"Duração obrigatória." };
  if (!sala) return { ok:false, error:"Sala obrigatória." };
  if (servico !== "SMA" && servico !== "Particular") return { ok:false, error:"Serviço deve ser SMA ou Particular." };
  if (!iniciais_paciente) return { ok:false, error:"Iniciais obrigatórias." };
  if (!Number.isInteger(idade_paciente) || idade_paciente < 0 || idade_paciente > 130) return { ok:false, error:"Idade inválida." };

  return {
    ok:true,
    data_cirurgia,
    horario_inicio,
    nome_cirurgia,
    nome_cirurgia_key,
    duracao,
    sala,
    servico,
    anestesista_escalado,
    iniciais_paciente,
    idade_paciente,
    finalizada
  };
}

function validarAnestesista(body) {
  const data_escala = String(body.data_escala || "").trim();
  const nome_anestesista = String(body.nome_anestesista || "").trim();
  const horario_escala = String(body.horario_escala || "").trim();
  const funcao = String(body.funcao || "").trim();
  const observacao = String(body.observacao || "").trim();

  if (!validarDataISO(data_escala)) return { ok:false, error:"Data da escala inválida." };
  if (!nome_anestesista) return { ok:false, error:"Nome do anestesista obrigatório." };

  return { ok:true, data_escala, nome_anestesista, horario_escala, funcao, observacao };
}

app.get("/api/health", async (req, res) => {
  try {
    const c = await get("SELECT COUNT(*) AS total FROM cirurgias");
    const a = await get("SELECT COUNT(*) AS total FROM anestesistas_dia");
    res.json({ ok:true, database:DB_FILE, total_cirurgias:c.total, total_anestesistas_dia:a.total });
  } catch(err) {
    res.status(500).json({ ok:false, error:err.message });
  }
});

app.get("/api/dia/:data", async (req, res) => {
  try {
    const data = String(req.params.data || "").trim();
    if (!validarDataISO(data)) return res.status(400).json({ error:"Data inválida." });

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
      ORDER BY horario_escala ASC, nome_anestesista ASC
    `, [data]);

    res.json({ data, cirurgias, anestesistas });
  } catch(err) {
    res.status(500).json({ error:err.message });
  }
});

app.get("/api/cirurgias", async (req, res) => {
  try {
    const data = String(req.query.data || "").trim();
    let rows;
    if (data) {
      if (!validarDataISO(data)) return res.status(400).json({ error:"Data inválida." });
      rows = await all(`
        SELECT * FROM cirurgias
        WHERE data_cirurgia = ?
        ORDER BY horario_inicio ASC, sala ASC
      `, [data]);
    } else {
      rows = await all("SELECT * FROM cirurgias ORDER BY data_cirurgia DESC, horario_inicio ASC");
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

    const existente = await get(`
      SELECT id FROM cirurgias
      WHERE data_cirurgia = ?
        AND nome_cirurgia_key = ?
        AND iniciais_paciente = ?
        AND idade_paciente = ?
    `, [v.data_cirurgia, v.nome_cirurgia_key, v.iniciais_paciente, v.idade_paciente]);

    if (existente) {
      await run(`
        UPDATE cirurgias
        SET horario_inicio=?, nome_cirurgia=?, nome_cirurgia_key=?, duracao=?, sala=?, servico=?,
            anestesista_escalado=?, iniciais_paciente=?, idade_paciente=?, finalizada=?
        WHERE id=?
      `, [
        v.horario_inicio, v.nome_cirurgia, v.nome_cirurgia_key, v.duracao, v.sala, v.servico,
        v.anestesista_escalado, v.iniciais_paciente, v.idade_paciente, v.finalizada, existente.id
      ]);
      const row = await get("SELECT * FROM cirurgias WHERE id=?", [existente.id]);
      return res.json({ ok:true, action:"updated_existing", message:"Cirurgia já existia; dados atualizados.", cirurgia:row });
    }

    const result = await run(`
      INSERT INTO cirurgias (
        data_cirurgia, horario_inicio, nome_cirurgia, nome_cirurgia_key, duracao, sala,
        servico, anestesista_escalado, iniciais_paciente, idade_paciente, finalizada
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      v.data_cirurgia, v.horario_inicio, v.nome_cirurgia, v.nome_cirurgia_key, v.duracao, v.sala,
      v.servico, v.anestesista_escalado, v.iniciais_paciente, v.idade_paciente, v.finalizada
    ]);

    const row = await get("SELECT * FROM cirurgias WHERE id=?", [result.lastID]);
    res.status(201).json({ ok:true, action:"inserted_new", message:"Cirurgia nova inserida.", cirurgia:row });
  } catch(err) {
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
      SET data_cirurgia=?, horario_inicio=?, nome_cirurgia=?, nome_cirurgia_key=?, duracao=?, sala=?,
          servico=?, anestesista_escalado=?, iniciais_paciente=?, idade_paciente=?, finalizada=?
      WHERE id=?
    `, [
      v.data_cirurgia, v.horario_inicio, v.nome_cirurgia, v.nome_cirurgia_key, v.duracao, v.sala,
      v.servico, v.anestesista_escalado, v.iniciais_paciente, v.idade_paciente, v.finalizada, id
    ]);

    if (result.changes === 0) return res.status(404).json({ error:"Cirurgia não encontrada." });

    const row = await get("SELECT * FROM cirurgias WHERE id=?", [id]);
    res.json(row);
  } catch(err) {
    if (String(err.message || "").includes("UNIQUE")) {
      return res.status(400).json({ error:"Já existe outra cirurgia nesse dia com mesmo nome, iniciais e idade." });
    }
    res.status(500).json({ error:err.message });
  }
});

app.patch("/api/cirurgias/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error:"ID inválido." });

    const atual = await get("SELECT * FROM cirurgias WHERE id=?", [id]);
    if (!atual) return res.status(404).json({ error:"Cirurgia não encontrada." });

    const merged = { ...atual, ...req.body };
    const v = validarCirurgia(merged);
    if (!v.ok) return res.status(400).json({ error:v.error });

    await run(`
      UPDATE cirurgias
      SET data_cirurgia=?, horario_inicio=?, nome_cirurgia=?, nome_cirurgia_key=?, duracao=?, sala=?,
          servico=?, anestesista_escalado=?, iniciais_paciente=?, idade_paciente=?, finalizada=?
      WHERE id=?
    `, [
      v.data_cirurgia, v.horario_inicio, v.nome_cirurgia, v.nome_cirurgia_key, v.duracao, v.sala,
      v.servico, v.anestesista_escalado, v.iniciais_paciente, v.idade_paciente, v.finalizada, id
    ]);

    const row = await get("SELECT * FROM cirurgias WHERE id=?", [id]);
    res.json(row);
  } catch(err) {
    if (String(err.message || "").includes("UNIQUE")) {
      return res.status(400).json({ error:"Já existe outra cirurgia nesse dia com mesmo nome, iniciais e idade." });
    }
    res.status(500).json({ error:err.message });
  }
});

app.delete("/api/cirurgias/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error:"ID inválido." });
    const result = await run("DELETE FROM cirurgias WHERE id=?", [id]);
    if (result.changes === 0) return res.status(404).json({ error:"Cirurgia não encontrada." });
    res.json({ ok:true, deleted_id:id });
  } catch(err) {
    res.status(500).json({ error:err.message });
  }
});

app.get("/api/anestesistas", async (req, res) => {
  try {
    const data = String(req.query.data || "").trim();
    let rows;
    if (data) {
      if (!validarDataISO(data)) return res.status(400).json({ error:"Data inválida." });
      rows = await all(`
        SELECT * FROM anestesistas_dia
        WHERE data_escala = ?
        ORDER BY horario_escala ASC, nome_anestesista ASC
      `, [data]);
    } else {
      rows = await all("SELECT * FROM anestesistas_dia ORDER BY data_escala DESC, horario_escala ASC, nome_anestesista ASC");
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

    const existente = await get(`
      SELECT id FROM anestesistas_dia
      WHERE data_escala=? AND nome_anestesista=?
    `, [v.data_escala, v.nome_anestesista]);

    if (existente) {
      await run(`
        UPDATE anestesistas_dia
        SET horario_escala=?, funcao=?, observacao=?
        WHERE id=?
      `, [v.horario_escala, v.funcao, v.observacao, existente.id]);
      const row = await get("SELECT * FROM anestesistas_dia WHERE id=?", [existente.id]);
      return res.json({ ok:true, action:"updated_existing", message:"Anestesista já estava na escala; dados atualizados.", anestesista:row });
    }

    const result = await run(`
      INSERT INTO anestesistas_dia (data_escala, nome_anestesista, horario_escala, funcao, observacao)
      VALUES (?, ?, ?, ?, ?)
    `, [v.data_escala, v.nome_anestesista, v.horario_escala, v.funcao, v.observacao]);

    const row = await get("SELECT * FROM anestesistas_dia WHERE id=?", [result.lastID]);
    res.status(201).json({ ok:true, action:"inserted_new", message:"Anestesista adicionado à escala do dia.", anestesista:row });
  } catch(err) {
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
      SET data_escala=?, nome_anestesista=?, horario_escala=?, funcao=?, observacao=?
      WHERE id=?
    `, [v.data_escala, v.nome_anestesista, v.horario_escala, v.funcao, v.observacao, id]);

    if (result.changes === 0) return res.status(404).json({ error:"Anestesista não encontrado." });
    const row = await get("SELECT * FROM anestesistas_dia WHERE id=?", [id]);
    res.json(row);
  } catch(err) {
    if (String(err.message || "").includes("UNIQUE")) {
      return res.status(400).json({ error:"Esse anestesista já está na escala desse dia." });
    }
    res.status(500).json({ error:err.message });
  }
});

app.delete("/api/anestesistas/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error:"ID inválido." });
    const result = await run("DELETE FROM anestesistas_dia WHERE id=?", [id]);
    if (result.changes === 0) return res.status(404).json({ error:"Anestesista não encontrado." });
    res.json({ ok:true, deleted_id:id });
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
    "PATCH /api/cirurgias/:id",
    "DELETE /api/cirurgias/:id",
    "GET /api/anestesistas?data=YYYY-MM-DD",
    "POST /api/anestesistas",
    "PUT /api/anestesistas/:id",
    "DELETE /api/anestesistas/:id"
  ]);
});

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

process.on("SIGINT", () => db.close(() => process.exit(0)));
process.on("SIGTERM", () => db.close(() => process.exit(0)));