"use strict";

const express = require("express");
const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();

function carregarEnvLocal() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;

  const linhas = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const linha of linhas) {
    const limpa = linha.trim();
    if (!limpa || limpa.startsWith("#")) continue;
    const idx = limpa.indexOf("=");
    if (idx <= 0) continue;
    const chave = limpa.slice(0, idx).trim();
    let valor = limpa.slice(idx + 1).trim();
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
      valor = valor.slice(1, -1);
    }
    if (!process.env[chave]) process.env[chave] = valor;
  }
}

carregarEnvLocal();

const app = express();

const PORT = Number(process.env.PORT) || 3000;
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const IS_RAILWAY = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID);
const DEFAULT_HOSPITAL_NOME = "Hospital Samaritano";
const DEFAULT_HOSPITAL_SLUG = "samaritano";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.MAPACC_OPENAI_API_KEY || "";
const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || "gpt-5.4-mini";
const MAX_IMPORT_IMAGE_CHARS = 12 * 1024 * 1024;
const DEFAULT_IMPORT_PROMPT = [
  "Extraia a lista de cirurgias do Samaritano no formato:",
  "",
  "Inicio | Sala | Cirurgia | Duracao | Servico | Iniciais | Idade",
  "",
  "Regras:",
  "- Inicio: usar coluna \"Ho...\".",
  "- Sala real: usar a coluna \"Sala P\".",
  "- Se \"Sala P\" = \"Sala 01 (Oeste)\", escrever \"Oeste 01\".",
  "- Se \"Sala P\" = \"Sala 01\" sem Oeste, escrever \"Lane 01\".",
  "- Se \"Sala P\" estiver vazia, escrever \"Cirurgias nao escaladas\".",
  "- Excecao: se \"Sala P\" estiver vazia, mas a coluna \"Sala\" indicar Radiologia Intervencionista/Radiol., escrever \"Hemo\".",
  "- Servico: se houver \"Sma\" em qualquer parte do servico, escrever \"SMA\". Se for \"Anestesista Particular\", escrever \"Anestesista Particular\".",
  "- Iniciais e idade: extrair da coluna \"Paciente\".",
  "- Separar iniciais e idade em colunas diferentes.",
  "- Manter uma linha por cirurgia."
].join("\n");
const SIRIO_LIBANES_SALAS = [
  ...Array.from({ length: 14 }, (_, i) => `Sala D${String(i + 1).padStart(2, "0")}`),
  "RPA D",
  ...Array.from({ length: 12 }, (_, i) => `Sala C${String(i + 1).padStart(2, "0")}`),
  "RPA C",
  ...Array.from({ length: 12 }, (_, i) => `EDA ${String(i + 1).padStart(2, "0")}`),
  "RPA EDA",
  ...Array.from({ length: 5 }, (_, i) => `RAVA ${String(i + 1).padStart(2, "0")}`),
  "RNM",
  "TC",
  "RPA CDI"
];
const BACKUP_TABLES = [
  "hospitais",
  "hospital_salas",
  "users",
  "user_hospitais",
  "hospital_acessos_dia",
  "cirurgias",
  "anestesistas_dia"
];

// Railway usa volume persistente em /data; localmente o .env pode usar DB_FILE=./database.db.
const DB_FILE = IS_RAILWAY && (!process.env.DB_FILE || process.env.DB_FILE === "./database.db")
  ? "/data/database.db"
  : (process.env.DB_FILE || "/data/database.db");

try {
  fs.mkdirSync(path.dirname(path.resolve(DB_FILE)), { recursive: true });
} catch (e) {}

console.log("==================================");
console.log("Sistema Mapa de Cirurgias por Dia");
console.log("DB:", DB_FILE);
console.log("Railway:", IS_RAILWAY ? "sim" : "nao");
console.log("OpenAI API key:", OPENAI_API_KEY ? "configurada" : "nao configurada");
console.log("OpenAI vision model:", OPENAI_VISION_MODEL);
console.log("PORT:", PORT);
console.log("==================================");

app.disable("x-powered-by");
app.use(express.json({ limit: "14mb" }));
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

function normalizarTextoChave(valor) {
  return String(valor || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

async function garantirColuna(nomeTabela, nomeColuna, definicaoSql) {
  const cols = await all(`PRAGMA table_info("${nomeTabela}")`);
  const existe = cols.some(c => c.name === nomeColuna);

  if (!existe) {
    await run(`ALTER TABLE "${nomeTabela}" ADD COLUMN ${nomeColuna} ${definicaoSql}`);
  }
}

async function garantirHospitalPadrao() {
  await run(`
    CREATE TABLE IF NOT EXISTS hospitais (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      tipo TEXT NOT NULL DEFAULT 'hospital',
      prompt_importacao_foto TEXT,
      ativo INTEGER NOT NULL DEFAULT 1,
      criado_em TEXT DEFAULT (datetime('now', 'localtime')),
      atualizado_em TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
  await garantirColuna("hospitais", "prompt_importacao_foto", "TEXT");

  await run(`
    CREATE TABLE IF NOT EXISTS hospital_salas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hospital_id INTEGER NOT NULL,
      nome TEXT NOT NULL,
      setor TEXT,
      bloco TEXT,
      tipo TEXT NOT NULL DEFAULT 'sala',
      ordem INTEGER NOT NULL DEFAULT 0,
      ativa INTEGER NOT NULL DEFAULT 1,
      criado_em TEXT DEFAULT (datetime('now', 'localtime')),
      atualizado_em TEXT DEFAULT (datetime('now', 'localtime')),
      UNIQUE(hospital_id, nome),
      FOREIGN KEY(hospital_id) REFERENCES hospitais(id) ON DELETE CASCADE
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS user_hospitais (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      hospital_id INTEGER NOT NULL,
      papel TEXT NOT NULL DEFAULT 'plantonista',
      criado_em TEXT DEFAULT (datetime('now', 'localtime')),
      UNIQUE(user_id, hospital_id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS hospital_acessos_dia (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data_acesso TEXT NOT NULL,
      hospital_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      papel_dia TEXT NOT NULL DEFAULT 'plantonista',
      pode_ver INTEGER NOT NULL DEFAULT 1,
      pode_editar INTEGER NOT NULL DEFAULT 0,
      criado_por INTEGER,
      criado_em TEXT DEFAULT (datetime('now', 'localtime')),
      atualizado_em TEXT DEFAULT (datetime('now', 'localtime')),
      UNIQUE(data_acesso, hospital_id, user_id),
      FOREIGN KEY(hospital_id) REFERENCES hospitais(id) ON DELETE CASCADE
    )
  `);

  await run(
    `INSERT OR IGNORE INTO hospitais (nome, slug, tipo) VALUES (?, ?, 'hospital')`,
    [DEFAULT_HOSPITAL_NOME, DEFAULT_HOSPITAL_SLUG]
  );

  const hospital = await get(`SELECT id FROM hospitais WHERE slug = ?`, [DEFAULT_HOSPITAL_SLUG]);
  const hospitalId = hospital.id;
  await run(`
    UPDATE hospitais
    SET prompt_importacao_foto = ?
    WHERE id = ?
      AND (prompt_importacao_foto IS NULL OR trim(prompt_importacao_foto) = '')
  `, [DEFAULT_IMPORT_PROMPT, hospitalId]);
  const salasPadrao = [
    { nome:"Não escaladas", setor:"Mapa", bloco:"Virtual", tipo:"virtual", ordem:0 },
    ...Array.from({ length:10 }, (_, i) => ({ nome:`Oeste ${i + 1}`, setor:"Centro cirúrgico", bloco:"Oeste", tipo:"oeste", ordem:i + 1 })),
    ...Array.from({ length:10 }, (_, i) => ({ nome:`Lane ${i + 1}`, setor:"Centro cirúrgico", bloco:"Lane", tipo:"lane", ordem:i + 11 })),
    { nome:"CDI", setor:"CDI", bloco:"Diagnóstico", tipo:"cdi", ordem:21 },
    { nome:"HEMO", setor:"Hemodinâmica", bloco:"Hemodinâmica", tipo:"hemo", ordem:22 }
  ];

  for (const sala of salasPadrao) {
    await run(`
      INSERT OR IGNORE INTO hospital_salas (hospital_id, nome, setor, bloco, tipo, ordem)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [hospitalId, sala.nome, sala.setor, sala.bloco, sala.tipo, sala.ordem]);
  }

  await run(
    `INSERT OR IGNORE INTO hospitais (nome, slug, tipo) VALUES (?, ?, 'hospital')`,
    ["Hospital Sírio-Libanês", "hospital-sirio-libanes"]
  );
  const sirio = await get(`SELECT id FROM hospitais WHERE slug = ?`, ["hospital-sirio-libanes"]);
  if (sirio && sirio.id) {
    await run(`UPDATE hospitais SET ativo = 1 WHERE id = ?`, [sirio.id]);
    for (let i = 0; i < SIRIO_LIBANES_SALAS.length; i++) {
      await run(`
        INSERT OR IGNORE INTO hospital_salas (hospital_id, nome, setor, bloco, tipo, ordem)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [sirio.id, SIRIO_LIBANES_SALAS[i], "", "", "sala", i + 1]);
    }
  }

  return hospitalId;
}

async function garantirUsuariosTabela() {
  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'plantonista',
    ativo INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await garantirColuna("users", "ativo", "INTEGER NOT NULL DEFAULT 1");
}

async function migrarAnestesistasDiaPorHospital(hospitalPadraoId) {
  await run(`
    CREATE TABLE IF NOT EXISTS anestesistas_dia_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hospital_id INTEGER NOT NULL DEFAULT ${hospitalPadraoId},
      data_escala TEXT NOT NULL,
      nome_anestesista TEXT NOT NULL,
      horario_escala TEXT,
      funcao TEXT,
      observacao TEXT,
      criado_em TEXT DEFAULT (datetime('now', 'localtime')),
      atualizado_em TEXT DEFAULT (datetime('now', 'localtime')),
      UNIQUE(hospital_id, data_escala, nome_anestesista)
    )
  `);

  await run(`
    INSERT OR IGNORE INTO anestesistas_dia_v2 (
      id,
      hospital_id,
      data_escala,
      nome_anestesista,
      horario_escala,
      funcao,
      observacao,
      criado_em,
      atualizado_em
    )
    SELECT
      id,
      COALESCE(NULLIF(hospital_id, 0), ?),
      data_escala,
      nome_anestesista,
      horario_escala,
      funcao,
      observacao,
      criado_em,
      atualizado_em
    FROM anestesistas_dia
  `, [hospitalPadraoId]);

  await run(`DROP TABLE anestesistas_dia`);
  await run(`ALTER TABLE anestesistas_dia_v2 RENAME TO anestesistas_dia`);
}

async function initDb() {
  await run("PRAGMA journal_mode = WAL");
  await run("PRAGMA foreign_keys = ON");
  await garantirUsuariosTabela();
  const hospitalPadraoId = await garantirHospitalPadrao();

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

      criado_em TEXT DEFAULT (datetime('now', 'localtime')),
      atualizado_em TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  await garantirColuna("cirurgias", "nome_cirurgia_key", "TEXT");
  await garantirColuna("cirurgias", "hospital_id", `INTEGER NOT NULL DEFAULT ${hospitalPadraoId}`);
  await garantirColuna("cirurgias", "observacao", "TEXT");
  await garantirColuna("cirurgias", "finalizada", "INTEGER NOT NULL DEFAULT 0");
  await run(`UPDATE cirurgias SET hospital_id = ? WHERE hospital_id IS NULL OR hospital_id = 0`, [hospitalPadraoId]);

  const antigas = await all(`
    SELECT id, nome_cirurgia
    FROM cirurgias
    WHERE nome_cirurgia_key IS NULL
       OR trim(nome_cirurgia_key) = ''
  `);

  for (const row of antigas) {
    await run(
      "UPDATE cirurgias SET nome_cirurgia_key = ? WHERE id = ?",
      [normalizarTextoChave(row.nome_cirurgia), row.id]
    );
  }

  await run(`DROP INDEX IF EXISTS ux_cirurgias_identidade`);
  await run(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_cirurgias_identidade_hospital
    ON cirurgias (
      hospital_id,
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

  // Migração segura para bancos já existentes
  await garantirColuna("anestesistas_dia", "horario_escala", "TEXT");
  await garantirColuna("anestesistas_dia", "funcao", "TEXT");
  await garantirColuna("anestesistas_dia", "hospital_id", `INTEGER NOT NULL DEFAULT ${hospitalPadraoId}`);
  await run(`UPDATE anestesistas_dia SET hospital_id = ? WHERE hospital_id IS NULL OR hospital_id = 0`, [hospitalPadraoId]);
  await migrarAnestesistasDiaPorHospital(hospitalPadraoId);
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS ux_anestesistas_dia_hospital ON anestesistas_dia (hospital_id, data_escala, nome_anestesista)`);

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

function dataLocalISO(offsetDias = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDias);
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}

function ehAmanha(data) {
  return data === dataLocalISO(1);
}

function normalizarPapelDia(papel) {
  const valor = String(papel || "").trim().toLowerCase();
  if (["admin", "escalador", "coordenador", "plantonista"].includes(valor)) return valor;
  return "plantonista";
}

function validarCirurgia(body) {
  const hospital_id = Number(body.hospital_id || body.hospitalId || 0);
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
  const observacao = String(body.observacao || "").trim();
  const finalizada = body.finalizada === true || body.finalizada === 1 || body.finalizada === "1" ? 1 : 0;

  if (!Number.isInteger(hospital_id) || hospital_id <= 0) return { ok:false, error:"Hospital invalido." };
  if (!validarDataISO(data_cirurgia)) return { ok:false, error:"Data da cirurgia invalida." };
  if (!horario_inicio) return { ok:false, error:"Horario obrigatorio." };
  if (!nome_cirurgia) return { ok:false, error:"Nome da cirurgia obrigatorio." };
  if (!duracao) return { ok:false, error:"Duracao obrigatoria." };
  if (!sala) return { ok:false, error:"Sala obrigatoria." };

  if (servico !== "SMA" && servico !== "Particular") {
    return { ok:false, error:"Servico deve ser SMA ou Particular." };
  }

  if (!iniciais_paciente) return { ok:false, error:"Iniciais do paciente obrigatorias." };

  if (!Number.isInteger(idade_paciente) || idade_paciente < 0 || idade_paciente > 130) {
    return { ok:false, error:"Idade invalida." };
  }

  return {
    ok:true,
    hospital_id,
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
    observacao,
    finalizada
  };
}

function validarAnestesista(body) {
  const hospital_id = Number(body.hospital_id || body.hospitalId || 0);
  const data_escala = String(body.data_escala || "").trim();
  const nome_anestesista = String(body.nome_anestesista || "").trim();
  const horario_escala = String(body.horario_escala || "").trim();
  const funcao = String(body.funcao || "").trim();
  const observacao = String(body.observacao || "").trim();

  if (!Number.isInteger(hospital_id) || hospital_id <= 0) return { ok:false, error:"Hospital invalido." };
  if (!validarDataISO(data_escala)) return { ok:false, error:"Data da escala invalida." };
  if (!nome_anestesista) return { ok:false, error:"Nome do anestesista obrigatorio." };

  return {
    ok:true,
    hospital_id,
    data_escala,
    nome_anestesista,
    horario_escala,
    funcao,
    observacao
  };
}

function usuarioAtual(req) {
  if (req.user) return req.user;
  if (typeof sessions === "undefined") return null;
  const sid = parseCookies(req).ccsama_session;
  const session = sid && sessions.get(sid);
  return session ? session.user : null;
}

async function hospitalPadraoId() {
  const row = await get(`SELECT id FROM hospitais WHERE slug = ?`, [DEFAULT_HOSPITAL_SLUG]);
  return row ? row.id : 1;
}

async function hospitalDaRequisicao(req) {
  const id = Number(req.query.hospital_id || req.query.hospitalId || req.body.hospital_id || req.body.hospitalId || 0);
  if (Number.isInteger(id) && id > 0) return id;
  return hospitalPadraoId();
}

async function usuarioTemVinculo(userId, hospitalId) {
  const row = await get(`
    SELECT id
    FROM user_hospitais
    WHERE user_id = ? AND hospital_id = ?
  `, [userId, hospitalId]);
  return !!row;
}

async function acessoHospitalNoDia(req, hospitalId, data) {
  const user = usuarioAtual(req);
  const dataAcesso = validarDataISO(data) ? data : dataLocalISO();

  if (!user) {
    return { pode_ver:false, pode_editar:false, papel_dia:"anonimo", origem:"nenhuma" };
  }

  if (isAdminLike(user)) {
    return { pode_ver:true, pode_editar:true, papel_dia:"admin", origem:"global" };
  }

  const vinculado = await usuarioTemVinculo(user.id, hospitalId);
  const diario = await get(`
    SELECT papel_dia, pode_ver, pode_editar
    FROM hospital_acessos_dia
    WHERE data_acesso = ?
      AND hospital_id = ?
      AND user_id = ?
  `, [dataAcesso, hospitalId, user.id]);

  if (user.role === "plantonista") {
    if (diario && diario.pode_ver) {
      return { pode_ver:true, pode_editar:false, papel_dia:"plantonista", origem:"diario" };
    }
    return { pode_ver:false, pode_editar:false, papel_dia:"plantonista", origem:"nenhuma" };
  }

  if (user.role === "coordenador") {
    if (!vinculado) {
      return { pode_ver:false, pode_editar:false, papel_dia:"coordenador", origem:"nenhuma" };
    }

    const coordenaHoje = diario && diario.pode_ver && diario.papel_dia === "coordenador";
    return {
      pode_ver:true,
      pode_editar:!!coordenaHoje,
      papel_dia:coordenaHoje ? "coordenador" : "visualizacao",
      origem:coordenaHoje ? "diario" : "vinculo"
    };
  }

  if (user.role === "escalador") {
    if (!vinculado) {
      return { pode_ver:false, pode_editar:false, papel_dia:"escalador", origem:"nenhuma" };
    }

    if (ehAmanha(dataAcesso)) {
      return { pode_ver:true, pode_editar:true, papel_dia:"escalador", origem:"dia-seguinte" };
    }

    return { pode_ver:false, pode_editar:false, papel_dia:"escalador", origem:"fora-do-dia-seguinte" };
  }

  return { pode_ver:false, pode_editar:false, papel_dia:user.role, origem:"nenhuma" };
}

async function hospitaisPermitidos(req, data) {
  const user = usuarioAtual(req);
  if (!user) return [];

  let hospitais;
  if (isAdminLike(user)) {
    hospitais = await all(`SELECT * FROM hospitais WHERE ativo = 1 ORDER BY nome`);
  } else if (user.role === "plantonista") {
    hospitais = await all(`
      SELECT DISTINCT h.*
      FROM hospitais h
      JOIN hospital_acessos_dia ad ON ad.hospital_id = h.id AND ad.user_id = ? AND ad.data_acesso = ? AND ad.pode_ver = 1
      WHERE h.ativo = 1
      ORDER BY h.nome
    `, [user.id, data || dataLocalISO()]);
  } else if (user.role === "escalador") {
    hospitais = await all(`
      SELECT DISTINCT h.*
      FROM hospitais h
      JOIN user_hospitais uh ON uh.hospital_id = h.id AND uh.user_id = ?
      WHERE h.ativo = 1
      ORDER BY h.nome
    `, [user.id]);
  } else {
    hospitais = await all(`
      SELECT DISTINCT h.*
      FROM hospitais h
      JOIN user_hospitais uh ON uh.hospital_id = h.id AND uh.user_id = ?
      WHERE h.ativo = 1
      ORDER BY h.nome
    `, [user.id]);
  }

  const enriquecidos = [];
  for (const hospital of hospitais) {
    const acesso = await acessoHospitalNoDia(req, hospital.id, data);
    enriquecidos.push({
      ...hospital,
      papel_dia: acesso.papel_dia,
      pode_ver: acesso.pode_ver ? 1 : 0,
      pode_editar: acesso.pode_editar ? 1 : 0,
      origem_acesso: acesso.origem
    });
  }

  return enriquecidos.filter(h => h.pode_ver);
}

async function podeGerenciarAcessos(req, hospitalId, data) {
  const user = usuarioAtual(req);
  if (!user) return false;
  if (isAdminLike(user)) return true;
  return user.role === "escalador" && ehAmanha(data) && await usuarioTemVinculo(user.id, hospitalId);
}

async function exigirHospital(req, res, hospitalId, escrita = false, data = null) {
  const user = usuarioAtual(req);
  if (!user) {
    res.status(401).json({ ok:false, error:"Nao autenticado" });
    return false;
  }
  const acesso = await acessoHospitalNoDia(req, hospitalId, data);
  if (!acesso.pode_ver) {
    res.status(403).json({ ok:false, error:"Voce nao tem acesso a este hospital." });
    return false;
  }
  if (escrita && !acesso.pode_editar) {
    res.status(403).json({ ok:false, error:"Voce pode visualizar este hospital, mas nao editar nesta data." });
    return false;
  }
  return true;
}

async function podeConfigurarImportacao(req, hospitalId) {
  const user = usuarioAtual(req);
  if (!user) return false;
  if (isAdminLike(user)) return true;
  return ["escalador", "coordenador"].includes(user.role) && await usuarioTemVinculo(user.id, hospitalId);
}

function dataUrlMime(dataUrl) {
  const m = String(dataUrl || "").match(/^data:([^;]+);base64,/i);
  return m ? m[1].toLowerCase() : "";
}

function normalizarServicoExtraido(servico) {
  const raw = String(servico || "").trim();
  const key = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (key.includes("sma")) return "SMA";
  if (key.includes("particular") || key.includes("externo")) return "Particular";
  return "SMA";
}

function normalizarItemFoto(item, currentDate) {
  const servicoOriginal = String(item.servico_original || item.servico || "").trim();
  const observacoes = [];
  const obs = String(item.observacao || "").trim();
  if (obs) observacoes.push(obs);
  if (servicoOriginal && servicoOriginal !== normalizarServicoExtraido(servicoOriginal)) {
    observacoes.push("Servico original: " + servicoOriginal);
  }

  return {
    data_cirurgia: currentDate,
    horario_inicio: String(item.horario_inicio || item.inicio || "").trim(),
    sala: String(item.sala || "Nao escaladas").trim(),
    nome_cirurgia: String(item.nome_cirurgia || item.cirurgia || item.nome || "").trim(),
    duracao: String(item.duracao || "01:00").trim(),
    servico: normalizarServicoExtraido(item.servico || item.servico_original),
    iniciais_paciente: String(item.iniciais_paciente || item.iniciais || "NI").replace(/\W/g, "").toUpperCase() || "NI",
    idade_paciente: Number(item.idade_paciente ?? item.idade ?? 0),
    observacao: observacoes.join(" | ")
  };
}

function extrairTextoRespostaOpenAI(data) {
  if (typeof data.output_text === "string") return data.output_text;
  const partes = [];
  for (const out of data.output || []) {
    for (const content of out.content || []) {
      if (typeof content.text === "string") partes.push(content.text);
    }
  }
  return partes.join("\n").trim();
}

async function chamarOpenAIImportacaoFoto({ imageDataUrl, hospital, salas, dataCirurgia }) {
  const apiKey = OPENAI_API_KEY;
  if (!apiKey) {
    const err = new Error("OPENAI_API_KEY/MAPACC_OPENAI_API_KEY nao configurada no servidor.");
    err.statusCode = 500;
    throw err;
  }

  const promptHospital = String(hospital.prompt_importacao_foto || DEFAULT_IMPORT_PROMPT).trim();
  const salasTexto = salas.map(s => "- " + s.nome + (s.tipo ? " (" + s.tipo + ")" : "")).join("\n");
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      cirurgias: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            horario_inicio: { type: "string" },
            sala: { type: "string" },
            nome_cirurgia: { type: "string" },
            duracao: { type: "string" },
            servico: { type: "string" },
            servico_original: { type: "string" },
            iniciais_paciente: { type: "string" },
            idade_paciente: { type: "integer" },
            observacao: { type: "string" },
            confianca: { type: "number" },
            aviso: { type: "string" }
          },
          required: [
            "horario_inicio",
            "sala",
            "nome_cirurgia",
            "duracao",
            "servico",
            "servico_original",
            "iniciais_paciente",
            "idade_paciente",
            "observacao",
            "confianca",
            "aviso"
          ]
        }
      },
      avisos: {
        type: "array",
        items: { type: "string" }
      }
    },
    required: ["cirurgias", "avisos"]
  };

  const instruction = [
    "Voce e um extrator especialista de mapas cirurgicos hospitalares.",
    "Leia a imagem com o maximo de cuidado, como no ChatGPT com visao.",
    "Aplique primeiro as regras especificas do hospital, depois normalize para o JSON pedido.",
    "Use apenas dados visiveis ou inferencias diretamente justificaveis pela imagem.",
    "Se algum campo estiver incerto, preencha o melhor valor possivel e explique em aviso.",
    "A duracao deve sair como HH:MM quando possivel. Se estiver em minutos, converta.",
    "Para sala, prefira exatamente um dos nomes da lista de salas do hospital quando houver correspondencia clara.",
    "Servico no JSON final deve ser SMA ou Particular; preserve termos como Anestesista Particular em servico_original.",
    "Data alvo da importacao: " + dataCirurgia + ".",
    "",
    "Hospital: " + hospital.nome,
    "",
    "Salas validas do hospital:",
    salasTexto || "- Nao escaladas",
    "",
    "Regras especificas deste hospital:",
    promptHospital
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_VISION_MODEL,
      reasoning: { effort: "low" },
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: instruction },
          { type: "input_image", image_url: imageDataUrl, detail: "high" }
        ]
      }],
      text: {
        format: {
          type: "json_schema",
          name: "mapa_cirurgico_extraido",
          strict: true,
          schema
        }
      }
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = data.error && data.error.message ? data.error.message : "Falha na OpenAI";
    const err = new Error(msg);
    err.statusCode = response.status;
    throw err;
  }

  const text = extrairTextoRespostaOpenAI(data);
  if (!text) throw new Error("A OpenAI nao retornou texto estruturado.");
  return JSON.parse(text);
}

app.get("/api/health", async (req, res) => {
  try {
    const c = await get("SELECT COUNT(*) AS total FROM cirurgias");
    const a = await get("SELECT COUNT(*) AS total FROM anestesistas_dia");

    res.json({
      ok:true,
      database: DB_FILE,
      total_cirurgias: c.total,
      total_anestesistas_dia: a.total,
      regra_duplicata: "data_cirurgia + nome_cirurgia + iniciais_paciente + idade_paciente",
      escala_anestesistas: "data_escala + nome_anestesista; cada escala pertence apenas ao dia selecionado",
      timestamp: new Date().toISOString()
    });
  } catch(err) {
    res.status(500).json({ ok:false, error:err.message });
  }
});

app.get("/api/config-check", authRequired, adminRequired, async (req, res) => {
  res.json({
    ok: true,
    railway: IS_RAILWAY,
    database: DB_FILE,
    openai_api_key_configurada: !!OPENAI_API_KEY,
    openai_api_key_tamanho: OPENAI_API_KEY ? OPENAI_API_KEY.length : 0,
    openai_api_key_nome_usado: process.env.OPENAI_API_KEY ? "OPENAI_API_KEY" : (process.env.MAPACC_OPENAI_API_KEY ? "MAPACC_OPENAI_API_KEY" : ""),
    mapacc_teste: process.env.MAPACC_TESTE || "",
    openai_vision_model: OPENAI_VISION_MODEL,
    port: PORT
  });
});

app.get("/api/dia/:data", async (req, res) => {
  try {
    const data = String(req.params.data || "").trim();
    const hospitalId = await hospitalDaRequisicao(req);
    if (!await exigirHospital(req, res, hospitalId, false, data)) return;
    if (!validarDataISO(data)) {
      return res.status(400).json({ error:"Data invalida. Use YYYY-MM-DD." });
    }

    const cirurgias = await all(`
      SELECT *
      FROM cirurgias
      WHERE data_cirurgia = ?
        AND hospital_id = ?
      ORDER BY horario_inicio ASC, sala ASC
    `, [data, hospitalId]);

    const anestesistas = await all(`
      SELECT *
      FROM anestesistas_dia
      WHERE data_escala = ?
        AND hospital_id = ?
      ORDER BY horario_escala ASC, nome_anestesista ASC
    `, [data, hospitalId]);

    const acesso = await acessoHospitalNoDia(req, hospitalId, data);
    res.json({ data, hospital_id:hospitalId, acesso, cirurgias, anestesistas });
  } catch(err) {
    res.status(500).json({ error:err.message });
  }
});

app.get("/api/cirurgias", async (req, res) => {
  try {
    const data = String(req.query.data || "").trim();
    const hospitalId = await hospitalDaRequisicao(req);
    if (!await exigirHospital(req, res, hospitalId, false, data || dataLocalISO())) return;
    let rows;

    if (data) {
      if (!validarDataISO(data)) return res.status(400).json({ error:"Data invalida." });
      rows = await all(`
        SELECT *
        FROM cirurgias
        WHERE data_cirurgia = ?
          AND hospital_id = ?
        ORDER BY horario_inicio ASC, sala ASC
      `, [data, hospitalId]);
    } else {
      rows = await all(`
        SELECT *
        FROM cirurgias
        WHERE hospital_id = ?
        ORDER BY data_cirurgia DESC, horario_inicio ASC
      `, [hospitalId]);
    }

    res.json(rows);
  } catch(err) {
    res.status(500).json({ error:err.message });
  }
});

// UPSERT:

// UPSERT: se data + nome + iniciais + idade já existir, atualiza em vez de duplicar.
app.post("/api/cirurgias", async (req, res) => {
  try {
    const hospitalId = await hospitalDaRequisicao(req);
    req.body.hospital_id = hospitalId;
    const v = validarCirurgia(req.body);
    if (!v.ok) return res.status(400).json({ error:v.error });
    if (!await exigirHospital(req, res, hospitalId, true, v.data_cirurgia)) return;

    const existente = await get(`
      SELECT id
      FROM cirurgias
      WHERE hospital_id = ?
        AND data_cirurgia = ?
        AND nome_cirurgia_key = ?
        AND iniciais_paciente = ?
        AND idade_paciente = ?
    `, [
      v.hospital_id,
      v.data_cirurgia,
      v.nome_cirurgia_key,
      v.iniciais_paciente,
      v.idade_paciente
    ]);

    if (existente) {
      await run(`
        UPDATE cirurgias
        SET
          hospital_id = ?,
          horario_inicio = ?,
          nome_cirurgia = ?,
          nome_cirurgia_key = ?,
          duracao = ?,
          sala = ?,
          servico = ?,
          anestesista_escalado = ?,
          iniciais_paciente = ?,
          idade_paciente = ?,
          observacao = ?,
          finalizada = ?
        WHERE id = ?
      `, [
        v.hospital_id,
        v.horario_inicio,
        v.nome_cirurgia,
        v.nome_cirurgia_key,
        v.duracao,
        v.sala,
        v.servico,
        v.anestesista_escalado,
        v.iniciais_paciente,
        v.idade_paciente,
        v.observacao,
        v.finalizada,
        existente.id
      ]);

      const row = await get("SELECT * FROM cirurgias WHERE id = ?", [existente.id]);

      return res.json({
        ok:true,
        action:"updated_existing",
        message:"Cirurgia ja existia neste hospital; dados atualizados.",
        cirurgia: row
      });
    }

    const result = await run(`
      INSERT INTO cirurgias (
        hospital_id,
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
        observacao,
        finalizada
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      v.hospital_id,
      v.data_cirurgia,
      v.horario_inicio,
      v.nome_cirurgia,
      v.nome_cirurgia_key,
      v.duracao,
      v.sala,
      v.servico,
      v.anestesista_escalado,
      v.iniciais_paciente,
      v.idade_paciente,
      v.observacao,
      v.finalizada
    ]);

    const row = await get("SELECT * FROM cirurgias WHERE id = ?", [result.lastID]);

    res.status(201).json({
      ok:true,
      action:"inserted_new",
      message:"Cirurgia nova inserida.",
      cirurgia: row
    });
  } catch(err) {
    res.status(500).json({ error:err.message });
  }
});

app.put("/api/cirurgias/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error:"ID invalido." });
    const atual = await get("SELECT hospital_id, data_cirurgia FROM cirurgias WHERE id = ?", [id]);
    if (!atual) return res.status(404).json({ error:"Cirurgia nao encontrada." });
    req.body.hospital_id = Number(req.body.hospital_id || req.body.hospitalId || atual.hospital_id);

    const v = validarCirurgia(req.body);
    if (!v.ok) return res.status(400).json({ error:v.error });
    if (!await exigirHospital(req, res, req.body.hospital_id, true, v.data_cirurgia)) return;

    const result = await run(`
      UPDATE cirurgias
      SET
        hospital_id = ?,
        data_cirurgia = ?,
        horario_inicio = ?,
        nome_cirurgia = ?,
        nome_cirurgia_key = ?,
        duracao = ?,
        sala = ?,
        servico = ?,
        anestesista_escalado = ?,
        iniciais_paciente = ?,
        idade_paciente = ?,
        observacao = ?,
        finalizada = ?
      WHERE id = ?
    `, [
      v.hospital_id,
      v.data_cirurgia,
      v.horario_inicio,
      v.nome_cirurgia,
      v.nome_cirurgia_key,
      v.duracao,
      v.sala,
      v.servico,
      v.anestesista_escalado,
      v.iniciais_paciente,
      v.idade_paciente,
      v.observacao,
      v.finalizada,
      id
    ]);

    if (result.changes === 0) return res.status(404).json({ error:"Cirurgia nao encontrada." });

    const row = await get("SELECT * FROM cirurgias WHERE id = ?", [id]);
    res.json(row);
  } catch(err) {
    if (String(err.message || "").includes("UNIQUE")) {
      return res.status(400).json({ error:"Ja existe outra cirurgia nesse hospital e dia com mesmo nome, iniciais e idade." });
    }
    res.status(500).json({ error:err.message });
  }
});

app.delete("/api/cirurgias/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error:"ID invalido." });
    const atual = await get("SELECT hospital_id, data_cirurgia FROM cirurgias WHERE id = ?", [id]);
    if (!atual) return res.status(404).json({ error:"Cirurgia nao encontrada." });
    if (!await exigirHospital(req, res, atual.hospital_id, true, atual.data_cirurgia || dataLocalISO())) return;

    const result = await run("DELETE FROM cirurgias WHERE id = ?", [id]);
    if (result.changes === 0) return res.status(404).json({ error:"Cirurgia nao encontrada." });

    res.json({ ok:true, deleted_id:id });
  } catch(err) {
    res.status(500).json({ error:err.message });
  }
});

app.get("/api/anestesistas", async (req, res) => {
  try {
    const data = String(req.query.data || "").trim();
    const hospitalId = await hospitalDaRequisicao(req);
    if (!await exigirHospital(req, res, hospitalId, false, data || dataLocalISO())) return;
    let rows;

    if (data) {
      if (!validarDataISO(data)) return res.status(400).json({ error:"Data invalida." });
      rows = await all(`
        SELECT *
        FROM anestesistas_dia
        WHERE data_escala = ?
          AND hospital_id = ?
        ORDER BY horario_escala ASC, nome_anestesista ASC
      `, [data, hospitalId]);
    } else {
      rows = await all(`
        SELECT *
        FROM anestesistas_dia
        WHERE hospital_id = ?
        ORDER BY data_escala DESC, horario_escala ASC, nome_anestesista ASC
      `, [hospitalId]);
    }

    res.json(rows);
  } catch(err) {
    res.status(500).json({ error:err.message });
  }
});

app.post("/api/anestesistas", async (req, res) => {
  try {
    const hospitalId = await hospitalDaRequisicao(req);
    req.body.hospital_id = hospitalId;
    const v = validarAnestesista(req.body);
    if (!v.ok) return res.status(400).json({ error:v.error });
    if (!await exigirHospital(req, res, hospitalId, true, v.data_escala)) return;

    const existente = await get(`
      SELECT id
      FROM anestesistas_dia
      WHERE hospital_id = ?
        AND data_escala = ?
        AND nome_anestesista = ?
    `, [v.hospital_id, v.data_escala, v.nome_anestesista]);

    if (existente) {
      await run(`
        UPDATE anestesistas_dia
        SET horario_escala = ?, funcao = ?, observacao = ?
        WHERE id = ?
      `, [v.horario_escala, v.funcao, v.observacao, existente.id]);

      const row = await get("SELECT * FROM anestesistas_dia WHERE id = ?", [existente.id]);

      return res.json({
        ok:true,
        action:"updated_existing",
        message:"Anestesista ja estava na escala desse hospital e dia; dados atualizados.",
        anestesista: row
      });
    }

    const result = await run(`
      INSERT INTO anestesistas_dia (
        hospital_id,
        data_escala,
        nome_anestesista,
        horario_escala,
        funcao,
        observacao
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      v.hospital_id,
      v.data_escala,
      v.nome_anestesista,
      v.horario_escala,
      v.funcao,
      v.observacao
    ]);

    const row = await get("SELECT * FROM anestesistas_dia WHERE id = ?", [result.lastID]);

    res.status(201).json({
      ok:true,
      action:"inserted_new",
      message:"Anestesista adicionado a escala do dia.",
      anestesista: row
    });
  } catch(err) {
    res.status(500).json({ error:err.message });
  }
});

app.put("/api/anestesistas/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error:"ID invalido." });
    const atual = await get("SELECT hospital_id, data_escala FROM anestesistas_dia WHERE id = ?", [id]);
    if (!atual) return res.status(404).json({ error:"Anestesista nao encontrado." });
    req.body.hospital_id = Number(req.body.hospital_id || req.body.hospitalId || atual.hospital_id);

    const v = validarAnestesista(req.body);
    if (!v.ok) return res.status(400).json({ error:v.error });
    if (!await exigirHospital(req, res, req.body.hospital_id, true, v.data_escala)) return;

    const result = await run(`
      UPDATE anestesistas_dia
      SET
        hospital_id = ?,
        data_escala = ?,
        nome_anestesista = ?,
        horario_escala = ?,
        funcao = ?,
        observacao = ?
      WHERE id = ?
    `, [
      v.hospital_id,
      v.data_escala,
      v.nome_anestesista,
      v.horario_escala,
      v.funcao,
      v.observacao,
      id
    ]);

    if (result.changes === 0) return res.status(404).json({ error:"Anestesista nao encontrado." });

    const row = await get("SELECT * FROM anestesistas_dia WHERE id = ?", [id]);
    res.json(row);
  } catch(err) {
    if (String(err.message || "").includes("UNIQUE")) {
      return res.status(400).json({ error:"Esse anestesista ja esta na escala desse hospital e dia." });
    }
    res.status(500).json({ error:err.message });
  }
});

app.delete("/api/anestesistas/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error:"ID invalido." });
    const atual = await get("SELECT hospital_id, data_escala FROM anestesistas_dia WHERE id = ?", [id]);
    if (!atual) return res.status(404).json({ error:"Anestesista nao encontrado." });
    if (!await exigirHospital(req, res, atual.hospital_id, true, atual.data_escala || dataLocalISO())) return;

    const result = await run("DELETE FROM anestesistas_dia WHERE id = ?", [id]);
    if (result.changes === 0) return res.status(404).json({ error:"Anestesista nao encontrado." });

    res.json({ ok:true, deleted_id:id });
  } catch(err) {
    res.status(500).json({ error:err.message });
  }
});

// Mantido escondido

// Mantido escondido para diagnóstico
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

      result[tableName] = { columns, row_count: rows.length, rows };
    }

    res.json({ database_file: DB_FILE, tables: result });
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
    "GET /api/hospitais?data=YYYY-MM-DD",
    "GET /api/acessos-dia?data=YYYY-MM-DD&hospital_id=ID",
    "POST /api/acessos-dia",
    "DELETE /api/acessos-dia/:id",
    "GET /api/db-inspector"
  ]);
});

// ===============================
// PATCH LOGIN CC SAMA v1
// Cole este bloco no server.js:
// 1) depois de criar o app/db/helpers
// 2) antes do app.use(express.static(...)) ou antes das rotas protegidas
// ===============================

const crypto = require('crypto');

const sessions = new Map();

function parseCookies(req){
  const header = req.headers.cookie || '';
  return Object.fromEntries(header.split(';').filter(Boolean).map(part=>{
    const idx = part.indexOf('=');
    const key = decodeURIComponent(part.slice(0, idx).trim());
    const val = decodeURIComponent(part.slice(idx+1).trim());
    return [key,val];
  }));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')){
  const hash = crypto.pbkdf2Sync(String(password), salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored){
  const [salt, hash] = String(stored || '').split(':');
  if(!salt || !hash) return false;
  const test = crypto.pbkdf2Sync(String(password), salt, 100000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash,'hex'), Buffer.from(test,'hex'));
}

// Cria tabela de usuários e usuário inicial godofredo/admin
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'plantonista',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  db.get(`SELECT id FROM users WHERE username = ?`, ['godofredo'], (err, row) => {
    if (!row) {
      db.run(
        `INSERT INTO users(username,password_hash,role) VALUES(?,?,?)`,
        ['godofredo', hashPassword('admin'), 'admin']
      );
      console.log('Usuário inicial criado: godofredo / admin');
    }
  });

  db.run(`UPDATE users SET role = 'coordenador' WHERE role = 'user'`);
});

const getUserByUsername = (username) => new Promise((resolve,reject)=>{
  db.get(`SELECT * FROM users WHERE username = ?`, [username], (err,row)=>err?reject(err):resolve(row));
});

const getUserById = (id) => new Promise((resolve,reject)=>{
  db.get(`SELECT id, username, role, created_at FROM users WHERE id = ?`, [id], (err,row)=>err?reject(err):resolve(row));
});

function authRequired(req,res,next){
  const sid = parseCookies(req).ccsama_session;
  const session = sid && sessions.get(sid);
  if(!session){
    if(req.path.startsWith('/api/')) return res.status(401).json({ok:false,error:'Não autenticado'});
    return res.redirect('/login.html?next='+encodeURIComponent(req.originalUrl));
  }
  req.user = session.user;
  next();
}

function adminRequired(req,res,next){
  if(!isAdminLike(req.user)){
    return res.status(403).json({ok:false,error:'Acesso restrito ao admin'});
  }
  next();
}

function isAdminPlusUser(user){
  return !!user && String(user.username || '').trim().toLowerCase() === 'godofredo';
}

function isAdminLike(user){
  return !!user && (user.role === 'admin' || isAdminPlusUser(user));
}

function adminPlusRequired(req,res,next){
  if(!isAdminPlusUser(req.user)){
    return res.status(403).json({ok:false,error:'Acesso restrito ao admin+'});
  }
  next();
}

// Rotas públicas de login
app.post('/api/login', async (req,res)=>{
  try{
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const user = await getUserByUsername(username);
    if(!user || !verifyPassword(password, user.password_hash)){
      return res.status(401).json({ok:false,error:'Usuario ou senha invalidos'});
    }
    if(user.ativo === 0 && !isAdminPlusUser(user)){
      return res.status(403).json({ok:false,error:'Usuario inativo'});
    }

    const sid = crypto.randomBytes(32).toString('hex');
    const sessionUser = {id:user.id, username:user.username, role:user.role, admin_plus:isAdminPlusUser(user)};
    sessions.set(sid, {user:sessionUser, createdAt:Date.now()});

    res.setHeader('Set-Cookie', `ccsama_session=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800`);
    res.json({ok:true,user:{username:user.username,role:user.role,admin_plus:isAdminPlusUser(user)}});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});

app.post('/api/logout', (req,res)=>{
  const sid = parseCookies(req).ccsama_session;
  if(sid) sessions.delete(sid);
  res.setHeader('Set-Cookie','ccsama_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
  res.json({ok:true});
});

app.get('/api/me', authRequired, async (req,res)=>{
  const data = validarDataISO(req.query.data) ? req.query.data : dataLocalISO();
  const hospitais = await hospitaisPermitidos(req, data);
  res.json({ok:true,user:req.user,hospitais});
});

app.get('/api/hospitais', authRequired, async (req,res)=>{
  try{
    const data = validarDataISO(req.query.data) ? req.query.data : dataLocalISO();
    const hospitais = await hospitaisPermitidos(req, data);
    res.json({ok:true,hospitais});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});

app.get('/api/admin-hospitais', authRequired, adminRequired, async (req,res)=>{
  try{
    const hospitais = await all(`
      SELECT
        h.id,
        h.nome,
        h.slug,
        h.tipo,
        h.ativo,
        COUNT(DISTINCT hs.id) AS total_salas,
        COUNT(DISTINCT uh.user_id) AS total_usuarios
      FROM hospitais h
      LEFT JOIN hospital_salas hs ON hs.hospital_id = h.id AND hs.ativa = 1
      LEFT JOIN user_hospitais uh ON uh.hospital_id = h.id
      WHERE h.ativo = 1
      GROUP BY h.id
      ORDER BY h.nome
    `);
    res.json({ok:true,hospitais});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});

app.post('/api/hospitais', authRequired, adminRequired, async (req,res)=>{
  try{
    const nome = String(req.body.nome || '').trim();
    const tipo = String(req.body.tipo || 'hospital').trim() || 'hospital';
    if(!nome) return res.status(400).json({ok:false,error:'Nome do hospital obrigatorio'});
    const existente = await get(`SELECT id FROM hospitais WHERE lower(nome) = lower(?)`, [nome]);
    if(existente) return res.status(409).json({ok:false,error:'Ja existe hospital/clinica com este nome'});
    const slug = normalizarTextoChave(nome).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || ('hospital-'+Date.now());
    const result = await run(`INSERT INTO hospitais(nome, slug, tipo) VALUES(?,?,?)`, [nome, slug, tipo]);
    const hospitalId = result.lastID;
    const salas = Array.isArray(req.body.salas) ? req.body.salas : [];
    for(let i=0;i<salas.length;i++){
      const sala = typeof salas[i] === 'string' ? {nome:salas[i]} : salas[i];
      const salaNome = String(sala.nome || '').trim();
      if(!salaNome) continue;
      await run(`
        INSERT OR IGNORE INTO hospital_salas(hospital_id, nome, setor, bloco, tipo, ordem)
        VALUES(?, ?, ?, ?, ?, ?)
      `, [hospitalId, salaNome, String(sala.setor || ''), String(sala.bloco || ''), String(sala.tipo || 'sala'), Number(sala.ordem || i)]);
    }
    const hospital = await get(`SELECT * FROM hospitais WHERE id = ?`, [hospitalId]);
    res.status(201).json({ok:true,hospital});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});

app.put('/api/hospitais/:id', authRequired, adminRequired, async (req,res)=>{
  try{
    const id = Number(req.params.id);
    if(!Number.isInteger(id) || id <= 0) return res.status(400).json({ok:false,error:'Hospital invalido'});
    const atual = await get(`SELECT id FROM hospitais WHERE id = ? AND ativo = 1`, [id]);
    if(!atual) return res.status(404).json({ok:false,error:'Hospital/clinica nao encontrado'});

    const nome = String(req.body.nome || '').trim();
    const tipo = String(req.body.tipo || 'hospital').trim() || 'hospital';
    if(!nome) return res.status(400).json({ok:false,error:'Nome do hospital obrigatorio'});

    const duplicado = await get(`SELECT id FROM hospitais WHERE lower(nome) = lower(?) AND id <> ? AND ativo = 1`, [nome, id]);
    if(duplicado) return res.status(409).json({ok:false,error:'Ja existe hospital/clinica com este nome'});

    await run(`
      UPDATE hospitais
      SET nome = ?, tipo = ?, atualizado_em = datetime('now', 'localtime')
      WHERE id = ? AND ativo = 1
    `, [nome, tipo, id]);
    const hospital = await get(`SELECT * FROM hospitais WHERE id = ?`, [id]);
    res.json({ok:true,hospital});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});

app.delete('/api/hospitais/:id', authRequired, adminRequired, async (req,res)=>{
  try{
    const id = Number(req.params.id);
    if(!Number.isInteger(id) || id <= 0) return res.status(400).json({ok:false,error:'Hospital invalido'});
    const atual = await get(`SELECT id, nome FROM hospitais WHERE id = ? AND ativo = 1`, [id]);
    if(!atual) return res.status(404).json({ok:false,error:'Hospital/clinica nao encontrado'});

    const total = await get(`SELECT COUNT(*) AS total FROM hospitais WHERE ativo = 1`);
    if(total && total.total <= 1) return res.status(400).json({ok:false,error:'Nao e possivel deletar o ultimo hospital ativo'});

    await run(`UPDATE hospitais SET ativo = 0, atualizado_em = datetime('now', 'localtime') WHERE id = ?`, [id]);
    res.json({ok:true,deleted_id:id});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});

app.get('/api/admin-backup', authRequired, adminRequired, async (req,res)=>{
  try{
    const backup = {
      ok:true,
      versao:1,
      gerado_em:new Date().toISOString(),
      database:DB_FILE,
      tables:{}
    };
    for (const table of BACKUP_TABLES) {
      backup.tables[table] = await all(`SELECT * FROM ${table}`);
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="mapa-cc-backup-${dataLocalISO()}.json"`);
    res.json(backup);
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});

async function importarTabelaBackup(table, rows) {
  if (!BACKUP_TABLES.includes(table) || !Array.isArray(rows) || !rows.length) return 0;
  const colsInfo = await all(`PRAGMA table_info("${table}")`);
  const validCols = colsInfo.map(c => c.name);
  let imported = 0;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const cols = Object.keys(row).filter(c => validCols.includes(c));
    if (!cols.length) continue;
    const placeholders = cols.map(() => "?").join(", ");
    const updates = cols.filter(c => c !== "id").map(c => `${c}=excluded.${c}`).join(", ");
    const sql = `
      INSERT INTO ${table} (${cols.join(", ")})
      VALUES (${placeholders})
      ${updates ? `ON CONFLICT(id) DO UPDATE SET ${updates}` : "ON CONFLICT(id) DO NOTHING"}
    `;
    await run(sql, cols.map(c => row[c]));
    imported++;
  }
  return imported;
}

app.post('/api/admin-backup/import', authRequired, adminRequired, async (req,res)=>{
  try{
    const payload = req.body || {};
    const tables = payload.tables && typeof payload.tables === "object" ? payload.tables : {};
    const resumo = {};
    await run("BEGIN IMMEDIATE");
    try{
      for (const table of BACKUP_TABLES) {
        resumo[table] = await importarTabelaBackup(table, tables[table]);
      }
      await run("COMMIT");
    }catch(e){
      await run("ROLLBACK").catch(() => {});
      throw e;
    }
    res.json({ok:true,importado:resumo});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});

app.get('/api/hospitais/:id/salas', authRequired, async (req,res)=>{
  try{
    const hospitalId = Number(req.params.id);
    const data = validarDataISO(req.query.data) ? req.query.data : dataLocalISO();
    if(!await exigirHospital(req, res, hospitalId, false, data)) return;
    const salas = await all(`
      SELECT *
      FROM hospital_salas
      WHERE hospital_id = ? AND ativa = 1
      ORDER BY ordem ASC, nome ASC
    `, [hospitalId]);
    res.json({ok:true,salas});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});

app.get('/api/hospitais/:id/importacao-foto', authRequired, async (req,res)=>{
  try{
    const hospitalId = Number(req.params.id);
    const data = validarDataISO(req.query.data) ? req.query.data : dataLocalISO();
    if(!await exigirHospital(req, res, hospitalId, false, data)) return;
    const hospital = await get(`SELECT id, nome, prompt_importacao_foto FROM hospitais WHERE id = ? AND ativo = 1`, [hospitalId]);
    if(!hospital) return res.status(404).json({ok:false,error:'Hospital nao encontrado'});
    res.json({
      ok:true,
      hospital_id:hospital.id,
      hospital_nome:hospital.nome,
      prompt_importacao_foto:hospital.prompt_importacao_foto || DEFAULT_IMPORT_PROMPT,
      model:OPENAI_VISION_MODEL
    });
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});

app.put('/api/hospitais/:id/importacao-foto', authRequired, async (req,res)=>{
  try{
    const hospitalId = Number(req.params.id);
    if(!await podeConfigurarImportacao(req, hospitalId)){
      return res.status(403).json({ok:false,error:'Acesso restrito para configurar importacao por foto.'});
    }
    const prompt = String(req.body.prompt_importacao_foto || req.body.prompt || '').trim();
    if(prompt.length < 20) return res.status(400).json({ok:false,error:'Informe regras de importacao mais completas.'});
    if(prompt.length > 12000) return res.status(400).json({ok:false,error:'Prompt muito longo.'});
    await run(`
      UPDATE hospitais
      SET prompt_importacao_foto = ?, atualizado_em = datetime('now', 'localtime')
      WHERE id = ? AND ativo = 1
    `, [prompt, hospitalId]);
    const hospital = await get(`SELECT id, nome, prompt_importacao_foto FROM hospitais WHERE id = ?`, [hospitalId]);
    res.json({ok:true,hospital});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});

app.post('/api/importar-foto-cirurgias', authRequired, async (req,res)=>{
  try{
    const hospitalId = await hospitalDaRequisicao(req);
    const dataCirurgia = validarDataISO(req.body.data_cirurgia || req.body.data) ? String(req.body.data_cirurgia || req.body.data) : dataLocalISO();
    if(!await exigirHospital(req, res, hospitalId, true, dataCirurgia)) return;

    const imageDataUrl = String(req.body.image_data_url || req.body.image || '').trim();
    const mime = dataUrlMime(imageDataUrl);
    if(!imageDataUrl || !mime) return res.status(400).json({ok:false,error:'Imagem invalida.'});
    if(!["image/jpeg", "image/png", "image/webp"].includes(mime)) return res.status(400).json({ok:false,error:'Use imagem JPG, PNG ou WebP.'});
    if(imageDataUrl.length > MAX_IMPORT_IMAGE_CHARS) return res.status(413).json({ok:false,error:'Imagem muito grande. Tente tirar a foto mais proxima ou reduzir a resolucao.'});

    const hospital = await get(`SELECT id, nome, prompt_importacao_foto FROM hospitais WHERE id = ? AND ativo = 1`, [hospitalId]);
    if(!hospital) return res.status(404).json({ok:false,error:'Hospital nao encontrado'});
    const salas = await all(`
      SELECT nome, tipo
      FROM hospital_salas
      WHERE hospital_id = ? AND ativa = 1
      ORDER BY ordem ASC, nome ASC
    `, [hospitalId]);

    const extraido = await chamarOpenAIImportacaoFoto({ imageDataUrl, hospital, salas, dataCirurgia });
    const cirurgias = Array.isArray(extraido.cirurgias)
      ? extraido.cirurgias.map(item => normalizarItemFoto(item, dataCirurgia)).filter(item => item.horario_inicio && item.nome_cirurgia)
      : [];
    const avisos = Array.isArray(extraido.avisos) ? extraido.avisos.map(String).filter(Boolean) : [];
    for(const item of extraido.cirurgias || []){
      if(item && item.aviso) avisos.push(String(item.aviso));
    }

    res.json({
      ok:true,
      model:OPENAI_VISION_MODEL,
      hospital_id:hospitalId,
      cirurgias,
      avisos:[...new Set(avisos)].slice(0, 20)
    });
  }catch(e){
    res.status(e.statusCode || 500).json({ok:false,error:e.message});
  }
});

app.put('/api/hospitais/:id/salas', authRequired, async (req,res)=>{
  try{
    const hospitalId = Number(req.params.id);
    if(!await exigirHospital(req, res, hospitalId, true)) return;
    const salas = Array.isArray(req.body.salas) ? req.body.salas : [];
    await run(`UPDATE hospital_salas SET ativa = 0 WHERE hospital_id = ?`, [hospitalId]);
    for(let i=0;i<salas.length;i++){
      const sala = typeof salas[i] === 'string' ? {nome:salas[i]} : salas[i];
      const salaNome = String(sala.nome || '').trim();
      if(!salaNome) continue;
      await run(`
        INSERT INTO hospital_salas(hospital_id, nome, setor, bloco, tipo, ordem, ativa)
        VALUES(?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(hospital_id, nome) DO UPDATE SET
          setor = excluded.setor,
          bloco = excluded.bloco,
          tipo = excluded.tipo,
          ordem = excluded.ordem,
          ativa = 1,
          atualizado_em = datetime('now', 'localtime')
      `, [hospitalId, salaNome, String(sala.setor || ''), String(sala.bloco || ''), String(sala.tipo || 'sala'), Number(sala.ordem || i)]);
    }
    const atualizadas = await all(`SELECT * FROM hospital_salas WHERE hospital_id = ? AND ativa = 1 ORDER BY ordem ASC, nome ASC`, [hospitalId]);
    res.json({ok:true,salas:atualizadas});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});

app.get('/api/acessos-dia', authRequired, async (req,res)=>{
  try{
    const data = String(req.query.data || req.query.data_acesso || "").trim();
    const hospitalId = Number(req.query.hospital_id || req.query.hospitalId || 0);
    if(!validarDataISO(data)) return res.status(400).json({ok:false,error:'Data invalida'});
    if(!Number.isInteger(hospitalId) || hospitalId <= 0) return res.status(400).json({ok:false,error:'Hospital invalido'});
    if(!await exigirHospital(req, res, hospitalId, false, data)) return;

    const acessos = await all(`
      SELECT ad.*, u.username, u.role
      FROM hospital_acessos_dia ad
      JOIN users u ON u.id = ad.user_id
      WHERE ad.data_acesso = ?
        AND ad.hospital_id = ?
      ORDER BY ad.papel_dia ASC, u.username ASC
    `, [data, hospitalId]);

    res.json({ok:true,acessos});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});

app.post('/api/acessos-dia', authRequired, async (req,res)=>{
  try{
    const data = String(req.body.data || req.body.data_acesso || "").trim();
    const hospitalId = Number(req.body.hospital_id || req.body.hospitalId || 0);
    const userId = Number(req.body.user_id || req.body.userId || 0);
    const papelDia = normalizarPapelDia(req.body.papel_dia || req.body.papelDia);
    const podeVer = 1;
    const podeEditar = papelDia === "plantonista" ? 0 : 1;

    if(!validarDataISO(data)) return res.status(400).json({ok:false,error:'Data invalida'});
    if(!Number.isInteger(hospitalId) || hospitalId <= 0) return res.status(400).json({ok:false,error:'Hospital invalido'});
    if(!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ok:false,error:'Usuario invalido'});
    if(!await podeGerenciarAcessos(req, hospitalId, data)) return res.status(403).json({ok:false,error:'Acesso restrito ao admin ou escalador deste hospital no dia seguinte'});

    await run(`
      INSERT INTO hospital_acessos_dia(data_acesso, hospital_id, user_id, papel_dia, pode_ver, pode_editar, criado_por)
      VALUES(?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(data_acesso, hospital_id, user_id) DO UPDATE SET
        papel_dia = excluded.papel_dia,
        pode_ver = excluded.pode_ver,
        pode_editar = excluded.pode_editar,
        atualizado_em = datetime('now', 'localtime')
    `, [data, hospitalId, userId, papelDia, podeVer, podeEditar, req.user.id]);

    const acesso = await get(`
      SELECT ad.*, u.username, u.role
      FROM hospital_acessos_dia ad
      JOIN users u ON u.id = ad.user_id
      WHERE ad.data_acesso = ? AND ad.hospital_id = ? AND ad.user_id = ?
    `, [data, hospitalId, userId]);

    res.json({ok:true,acesso});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});

app.delete('/api/acessos-dia/:id', authRequired, async (req,res)=>{
  try{
    const id = Number(req.params.id);
    if(!Number.isInteger(id) || id <= 0) return res.status(400).json({ok:false,error:'ID invalido'});
    const atual = await get(`SELECT hospital_id, data_acesso FROM hospital_acessos_dia WHERE id = ?`, [id]);
    if(!atual) return res.status(404).json({ok:false,error:'Acesso nao encontrado'});
    if(!await podeGerenciarAcessos(req, atual.hospital_id, atual.data_acesso)) return res.status(403).json({ok:false,error:'Acesso restrito ao admin ou escalador deste hospital no dia seguinte'});
    await run(`DELETE FROM hospital_acessos_dia WHERE id = ?`, [id]);
    res.json({ok:true,deleted_id:id});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});

app.post('/api/change-password', authRequired, async (req,res)=>{
  try{
    const oldPassword = String(req.body.oldPassword || '');
    const newPassword = String(req.body.newPassword || '');
    if(newPassword.length < 4) return res.status(400).json({ok:false,error:'Nova senha muito curta'});
    const full = await getUserByUsername(req.user.username);
    if(!verifyPassword(oldPassword, full.password_hash)){
      return res.status(400).json({ok:false,error:'Senha atual incorreta'});
    }
    await run(`UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [hashPassword(newPassword), req.user.id]);
    res.json({ok:true});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});

app.get('/api/users', authRequired, async (req,res)=>{
  try{
    const users = await all(`
      SELECT u.id, u.username, u.role, u.ativo, u.created_at,
        CASE WHEN lower(u.username) = 'godofredo' THEN 1 ELSE 0 END AS admin_plus,
        COALESCE(group_concat(h.id), '') AS hospital_ids,
        COALESCE(group_concat(h.nome, ', '), '') AS hospitais
      FROM users u
      LEFT JOIN user_hospitais uh ON uh.user_id = u.id
      LEFT JOIN hospitais h ON h.id = uh.hospital_id
      GROUP BY u.id
      ORDER BY u.username
    `);
    res.json({ok:true,users});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});

app.get('/api/usuarios-opcoes', authRequired, async (req,res)=>{
  try{
    const user = usuarioAtual(req);
    if(!user || (!isAdminLike(user) && user.role !== 'escalador')){
      return res.status(403).json({ok:false,error:'Acesso restrito ao admin ou escalador'});
    }
    const users = await all(`SELECT id, username, role, CASE WHEN lower(username) = 'godofredo' THEN 1 ELSE 0 END AS admin_plus FROM users ORDER BY username`);
    res.json({ok:true,users});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});

app.post('/api/users', authRequired, async (req,res)=>{
  try{
    const action = String(req.body.action || '').trim().toLowerCase();
    const bodyId = Number(req.body.id || req.body.user_id || req.body.userId || 0);
    if(action === 'update'){
      const usuario = await atualizarUsuarioSimples(bodyId, req.body || {});
      return res.json({ok:true,usuario});
    }
    if(action === 'delete'){
      const deleted = await excluirUsuarioSimples(bodyId);
      return res.json({ok:true,deleted_id:deleted.id});
    }

    if(bodyId > 0){
      const usernamePresente = Object.prototype.hasOwnProperty.call(req.body, 'username');
      const rolePresente = Object.prototype.hasOwnProperty.call(req.body, 'role');
      const ativoPresente = Object.prototype.hasOwnProperty.call(req.body, 'ativo');
      const senhaPresente = Object.prototype.hasOwnProperty.call(req.body, 'password');
      const hospitaisPresente = Object.prototype.hasOwnProperty.call(req.body, 'hospital_ids');

      if(usernamePresente || rolePresente || ativoPresente || senhaPresente || hospitaisPresente){
        const usuario = await atualizarUsuarioSimples(bodyId, req.body || {});
        return res.json({ok:true,usuario});
      }

      const deleted = await excluirUsuarioSimples(bodyId);
      return res.json({ok:true,deleted_id:deleted.id});
    }

    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const roleInput = String(req.body.role || 'plantonista').trim().toLowerCase();
    const role = ['admin','escalador','coordenador','plantonista'].includes(roleInput) ? roleInput : 'plantonista';
    const ativo = req.body.ativo === false || req.body.ativo === 0 || req.body.ativo === '0' ? 0 : 1;
    const hospitalIds = Array.isArray(req.body.hospital_ids) ? req.body.hospital_ids.map(Number).filter(n => Number.isInteger(n) && n > 0) : [];
    if(!username) return res.status(400).json({ok:false,error:'Usuario vazio'});
    if(password.length < 4) return res.status(400).json({ok:false,error:'Senha muito curta'});
    const result = await run(`INSERT INTO users(username,password_hash,role,ativo) VALUES(?,?,?,?)`, [username, hashPassword(password), role, ativo]);
    for (const hospitalId of hospitalIds) {
      await run(`INSERT OR IGNORE INTO user_hospitais(user_id, hospital_id, papel) VALUES(?,?,?)`, [result.lastID, hospitalId, role]);
    }
    res.json({ok:true});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});

async function atualizarUsuarioSimples(id, body){
  if(!Number.isInteger(id) || id <= 0) {
    const err = new Error('ID invalido');
    err.status = 400;
    throw err;
  }

  const alvo = await get(`SELECT id, username FROM users WHERE id = ?`, [id]);
  if(!alvo) {
    const err = new Error('Usuario nao encontrado');
    err.status = 404;
    throw err;
  }

  const username = String(body.username ?? alvo.username).trim();
  if(!username) {
    const err = new Error('Usuario vazio');
    err.status = 400;
    throw err;
  }

  const duplicado = await get(`SELECT id FROM users WHERE lower(username) = lower(?) AND id <> ?`, [username, id]);
  if(duplicado) {
    const err = new Error('Ja existe outro usuario com este nome');
    err.status = 409;
    throw err;
  }

  const roleInput = String(body.role || 'plantonista').trim().toLowerCase();
  const role = ['admin','escalador','coordenador','plantonista'].includes(roleInput) ? roleInput : 'plantonista';
  const ativo = body.ativo === false || body.ativo === 0 || body.ativo === '0' ? 0 : 1;
  const password = String(body.password || '');
  if(password && password.length < 4) {
    const err = new Error('Senha muito curta');
    err.status = 400;
    throw err;
  }

  const hospitalIds = Array.isArray(body.hospital_ids)
    ? body.hospital_ids.map(Number).filter(n => Number.isInteger(n) && n > 0)
    : [];

  await run(`UPDATE users SET username = ?, role = ?, ativo = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [username, role, ativo, id]);
  if(password){
    await run(`UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [hashPassword(password), id]);
  }
  await run(`DELETE FROM user_hospitais WHERE user_id = ?`, [id]);
  for (const hospitalId of hospitalIds) {
    await run(`INSERT OR IGNORE INTO user_hospitais(user_id, hospital_id, papel) VALUES(?,?,?)`, [id, hospitalId, role]);
  }

  for (const [sid, session] of sessions.entries()) {
    if(session.user && Number(session.user.id) === id) {
      if(ativo === 0) sessions.delete(sid);
      else session.user = {...session.user, username, role, admin_plus:isAdminPlusUser({username})};
    }
  }

  return {id, username, role, ativo};
}

async function excluirUsuarioSimples(id){
  if(!Number.isInteger(id) || id <= 0) {
    const err = new Error('ID invalido');
    err.status = 400;
    throw err;
  }

  const alvo = await get(`SELECT id, username FROM users WHERE id = ?`, [id]);
  if(!alvo) {
    const err = new Error('Usuario nao encontrado');
    err.status = 404;
    throw err;
  }

  const total = await get(`SELECT COUNT(*) AS total FROM users`);
  if(total && total.total <= 1) {
    const err = new Error('Nao e possivel excluir o ultimo usuario');
    err.status = 400;
    throw err;
  }

  await run(`DELETE FROM hospital_acessos_dia WHERE user_id = ?`, [id]);
  await run(`DELETE FROM user_hospitais WHERE user_id = ?`, [id]);
  await run(`DELETE FROM users WHERE id = ?`, [id]);

  for (const [sid, session] of sessions.entries()) {
    if(session.user && Number(session.user.id) === id) sessions.delete(sid);
  }

  return {id};
}

app.post('/api/users-update', authRequired, async (req,res)=>{
  try{
    const id = Number(req.body.id || req.body.user_id || req.body.userId || 0);
    const usuario = await atualizarUsuarioSimples(id, req.body || {});
    res.json({ok:true,usuario});
  }catch(e){
    res.status(e.status || 500).json({ok:false,error:e.message});
  }
});

app.post('/api/users/update', authRequired, async (req,res)=>{
  try{
    const id = Number(req.body.id || req.body.user_id || req.body.userId || 0);
    const usuario = await atualizarUsuarioSimples(id, req.body || {});
    res.json({ok:true,usuario});
  }catch(e){
    res.status(e.status || 500).json({ok:false,error:e.message});
  }
});

app.post('/api/users-delete', authRequired, async (req,res)=>{
  try{
    const id = Number(req.body.id || req.body.user_id || req.body.userId || 0);
    const deleted = await excluirUsuarioSimples(id);
    res.json({ok:true,deleted_id:deleted.id});
  }catch(e){
    res.status(e.status || 500).json({ok:false,error:e.message});
  }
});

app.post('/api/users/delete', authRequired, async (req,res)=>{
  try{
    const id = Number(req.body.id || req.body.user_id || req.body.userId || 0);
    const deleted = await excluirUsuarioSimples(id);
    res.json({ok:true,deleted_id:deleted.id});
  }catch(e){
    res.status(e.status || 500).json({ok:false,error:e.message});
  }
});

app.put('/api/users/:id', authRequired, async (req,res)=>{
  try{
    const id = Number(req.params.id);
    if(!Number.isInteger(id) || id <= 0) return res.status(400).json({ok:false,error:'ID invalido'});

    const alvo = await get(`SELECT id, username FROM users WHERE id = ?`, [id]);
    if(!alvo) return res.status(404).json({ok:false,error:'Usuario nao encontrado'});

    let username = String(req.body.username ?? alvo.username).trim();
    if(!username) return res.status(400).json({ok:false,error:'Usuario vazio'});

    const duplicado = await get(`SELECT id FROM users WHERE lower(username) = lower(?) AND id <> ?`, [username, id]);
    if(duplicado) return res.status(409).json({ok:false,error:'Ja existe outro usuario com este nome'});

    const roleInput = String(req.body.role || 'plantonista').trim().toLowerCase();
    const role = ['admin','escalador','coordenador','plantonista'].includes(roleInput) ? roleInput : 'plantonista';
    let ativo = req.body.ativo === false || req.body.ativo === 0 || req.body.ativo === '0' ? 0 : 1;
    const password = String(req.body.password || '');
    if(password && password.length < 4) return res.status(400).json({ok:false,error:'Senha muito curta'});

    const hospitalIds = Array.isArray(req.body.hospital_ids)
      ? req.body.hospital_ids.map(Number).filter(n => Number.isInteger(n) && n > 0)
      : [];

    await run(`UPDATE users SET username = ?, role = ?, ativo = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [username, role, ativo, id]);
    if(password){
      await run(`UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [hashPassword(password), id]);
    }
    await run(`DELETE FROM user_hospitais WHERE user_id = ?`, [id]);
    for (const hospitalId of hospitalIds) {
      await run(`INSERT OR IGNORE INTO user_hospitais(user_id, hospital_id, papel) VALUES(?,?,?)`, [id, hospitalId, role]);
    }

    for (const [sid, session] of sessions.entries()) {
      if(session.user && Number(session.user.id) === id) {
        if(ativo === 0) sessions.delete(sid);
        else session.user = {...session.user, username, role, admin_plus:isAdminPlusUser({username})};
      }
    }

    res.json({ok:true});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});

app.delete('/api/users/:id', authRequired, async (req,res)=>{
  try{
    const id = Number(req.params.id);
    if(!Number.isInteger(id) || id <= 0) return res.status(400).json({ok:false,error:'ID invalido'});

    const alvo = await get(`SELECT id, username FROM users WHERE id = ?`, [id]);
    if(!alvo) return res.status(404).json({ok:false,error:'Usuario nao encontrado'});
    const total = await get(`SELECT COUNT(*) AS total FROM users`);
    if(total && total.total <= 1) return res.status(400).json({ok:false,error:'Nao e possivel excluir o ultimo usuario'});

    await run(`DELETE FROM hospital_acessos_dia WHERE user_id = ?`, [id]);
    await run(`DELETE FROM user_hospitais WHERE user_id = ?`, [id]);
    await run(`DELETE FROM users WHERE id = ?`, [id]);

    for (const [sid, session] of sessions.entries()) {
      if(session.user && Number(session.user.id) === id) sessions.delete(sid);
    }

    res.json({ok:true,deleted_id:id});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});

// Proteja

// Proteja páginas específicas.
// IMPORTANTE: coloque isto ANTES do express.static.
app.get('/index_graf_v6.html', authRequired, (req,res)=>{
  res.sendFile(path.join(__dirname,'public','index_graf.html'));
});

app.get('/index_graf.html', authRequired, (req,res)=>{
  res.sendFile(path.join(__dirname,'public','index_graf.html'));
});

app.get('/sala.html', authRequired, (req,res)=>{
  res.sendFile(path.join(__dirname,'public','sala.html'));
});

app.get('/', authRequired, (req,res)=>{
  res.sendFile(path.join(__dirname,'public','index.html'));
});

app.get('/index.html', authRequired, (req,res)=>{
  res.sendFile(path.join(__dirname,'public','index.html'));
});

app.get('/admin_clinicas.html', authRequired, adminRequired, (req,res)=>{
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.sendFile(path.join(__dirname,'public','admin_clinicas.html'));
});

app.get('/admin_usuarios.html', authRequired, (req,res)=>{
  res.redirect('/usuarios.html');
});

app.get('/reg.html', authRequired, (req,res)=>{
  res.redirect('/usuarios.html');
});

app.get('/usuarios.html', authRequired, (req,res)=>{
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.sendFile(path.join(__dirname,'public','usuarios.html'));
});

// Depois deste bloco, mantenha:
// app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));


app.use(express.static(PUBLIC_DIR, { index:false }));

app.use("/api", (req, res) => {
  res.status(404).json({ error:"API não encontrada." });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

initDb()
  .then(() => {
    const server = app.listen(PORT, "0.0.0.0", () => {
      console.log(`Servidor rodando na porta ${PORT}`);
    });
    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.error("");
        console.error(`Porta ${PORT} ja esta em uso.`);
        console.error("Provavelmente existe outro servidor do MAPA CC aberto.");
        console.error(`Feche o outro terminal/processo Node ou inicie com outra porta: $env:PORT='3010'; npm start`);
      } else {
        console.error("Erro no servidor:", err);
      }
      db.close(() => process.exit(1));
    });
  })
  .catch((err) => {
    console.error("Erro ao iniciar:", err);
    process.exit(1);
  });

process.on("SIGINT", () => db.close(() => process.exit(0)));
process.on("SIGTERM", () => db.close(() => process.exit(0)));
