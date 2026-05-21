"use strict";

const express = require("express");
const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const { configureStaticAssets, noStore } = require("./static-assets");

const ROOT_DIR = path.resolve(__dirname, "../..");

function carregarEnvLocal() {
  const envPath = path.join(ROOT_DIR, ".env");
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
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const IS_RAILWAY = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID);
const CONFIG_CHECK_VERSION = "2026-05-17-railway-volume-guard-v3";
const SERVER_BUILD_ID = "2026-05-21-refactor";
const DEFAULT_HOSPITAL_NOME = "Hospital Samaritano";
const DEFAULT_HOSPITAL_SLUG = "samaritano";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.MAPACC_OPENAI_API_KEY || "";
const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || "gpt-5.4-mini";
const APP_BASE_URL = String(process.env.APP_BASE_URL || process.env.RAILWAY_PUBLIC_DOMAIN || "").trim();
const DEFAULT_SMTP_HOST = "smtp-mail.outlook.com";
const DEFAULT_SMTP_PORT = 587;
const DEFAULT_SMTP_USER = "mapa_cc@outlook.com.br";
const SMTP_HOST = String(process.env.SMTP_HOST || DEFAULT_SMTP_HOST).trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || DEFAULT_SMTP_PORT);
const SMTP_USER = String(process.env.SMTP_USER || DEFAULT_SMTP_USER).trim();
const SMTP_PASS = String(process.env.SMTP_PASS || "").trim();
const SMTP_FROM = String(process.env.SMTP_FROM || SMTP_USER || "").trim();
const SMTP_REQUIRE_TLS = String(process.env.SMTP_REQUIRE_TLS || "true").toLowerCase() !== "false";
const INITIAL_ADMIN_USER = String(process.env.INITIAL_ADMIN_USER || (IS_RAILWAY ? "" : "godofredo")).trim();
const INITIAL_ADMIN_PASSWORD = String(process.env.INITIAL_ADMIN_PASSWORD || (IS_RAILWAY ? "" : "admin")).trim();
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
  "empresas",
  "empresa_hospitais",
  "hospitais",
  "hospital_salas",
  "app_config",
  "users",
  "user_empresas",
  "user_hospitais",
  "hospital_acessos_dia",
  "cirurgias",
  "anestesistas_dia"
];

const RAILWAY_DATA_DIR = String(process.env.RAILWAY_VOLUME_MOUNT_PATH || "/data").trim() || "/data";

function normalizarCaminho(p) {
  return path.resolve(String(p || ""));
}

function estaDentroDoDiretorio(caminho, diretorio) {
  const absCaminho = normalizarCaminho(caminho);
  const absDiretorio = normalizarCaminho(diretorio);
  return absCaminho === absDiretorio || absCaminho.startsWith(absDiretorio + path.sep);
}

function resolverDbFile() {
  const envDbFile = String(process.env.DB_FILE || "").trim();

  if (!IS_RAILWAY) {
    return envDbFile || "/data/database.db";
  }

  if (envDbFile && !estaDentroDoDiretorio(envDbFile, RAILWAY_DATA_DIR)) {
    console.warn(`DB_FILE ignorado no Railway porque esta fora de ${RAILWAY_DATA_DIR}: ${envDbFile}`);
  }

  return envDbFile && estaDentroDoDiretorio(envDbFile, RAILWAY_DATA_DIR)
    ? envDbFile
    : path.join(RAILWAY_DATA_DIR, "database.db");
}

const DB_FILE = resolverDbFile();

function validarVolumeRailway() {
  if (!IS_RAILWAY) return;

  if (!estaDentroDoDiretorio(DB_FILE, RAILWAY_DATA_DIR)) {
    console.error(`FATAL: no Railway o banco precisa ficar dentro de ${RAILWAY_DATA_DIR}. DB atual: ${DB_FILE}`);
    process.exit(1);
  }

  try {
    const stat = fs.statSync(RAILWAY_DATA_DIR);
    if (!stat.isDirectory()) throw new Error(`${RAILWAY_DATA_DIR} nao e um diretorio`);
    const marker = path.join(RAILWAY_DATA_DIR, ".mapacc-volume-ok");
    fs.writeFileSync(marker, new Date().toISOString(), "utf8");
  } catch (err) {
    console.error(`FATAL: volume ${RAILWAY_DATA_DIR} nao esta montado ou nao esta gravavel:`, err.message);
    process.exit(1);
  }
}

function timestampArquivo() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function criarBackupBootBanco() {
  if (!IS_RAILWAY) return null;
  if (!fs.existsSync(DB_FILE)) return null;

  const backupDir = path.join(RAILWAY_DATA_DIR, "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = timestampArquivo();
  const baseNome = path.basename(DB_FILE);
  const arquivos = [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`];
  const copiados = [];

  for (const arquivo of arquivos) {
    if (!fs.existsSync(arquivo)) continue;
    const sufixo = arquivo === DB_FILE ? "" : arquivo.slice(DB_FILE.length);
    const destino = path.join(backupDir, `boot-${stamp}-${baseNome}${sufixo}`);
    fs.copyFileSync(arquivo, destino);
    copiados.push(destino);
  }

  return copiados;
}

validarVolumeRailway();

try {
  fs.mkdirSync(path.dirname(path.resolve(DB_FILE)), { recursive: true });
} catch (e) {}

let BOOT_DB_BACKUP_FILES = null;
try {
  BOOT_DB_BACKUP_FILES = criarBackupBootBanco();
} catch (err) {
  console.error("Aviso: nao foi possivel criar backup de boot do banco:", err.message);
}

console.log("==================================");
console.log("Sistema Mapa de Cirurgias por Dia");
console.log("Server build:", SERVER_BUILD_ID);
console.log("DB:", DB_FILE);
console.log("Railway:", IS_RAILWAY ? "sim" : "nao");
if (IS_RAILWAY) console.log(`Railway volume ${RAILWAY_DATA_DIR}:`, "ok");
if (BOOT_DB_BACKUP_FILES && BOOT_DB_BACKUP_FILES.length) console.log("Backup boot DB:", BOOT_DB_BACKUP_FILES.join(", "));
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

async function getConfigValue(chave) {
  const row = await get(`SELECT valor FROM app_config WHERE chave = ?`, [chave]);
  return row ? String(row.valor || "") : "";
}

async function setConfigValue(chave, valor) {
  await run(`
    INSERT INTO app_config(chave, valor, atualizado_em)
    VALUES(?, ?, datetime('now', 'localtime'))
    ON CONFLICT(chave) DO UPDATE SET
      valor = excluded.valor,
      atualizado_em = datetime('now', 'localtime')
  `, [chave, valor]);
}

async function resolverOpenAIKey() {
  return OPENAI_API_KEY || await getConfigValue("openai_api_key");
}

function normalizarTextoChave(valor) {
  return String(valor || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function normalizarIdentidadeCirurgia(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizarSemAcento(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function salaEhNaoEscalada(valor) {
  const sala = normalizarSemAcento(valor);
  return sala.includes("nao escalad") || sala.includes("sem sala");
}

function normalizarSalaCirurgia(valor) {
  const sala = String(valor || "").trim();
  if (salaEhNaoEscalada(sala)) return "Nao escaladas";
  return sala;
}

function normalizarIniciaisPaciente(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .trim();
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
    CREATE TABLE IF NOT EXISTS app_config (
      chave TEXT PRIMARY KEY,
      valor TEXT,
      atualizado_em TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS empresas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      ativo INTEGER NOT NULL DEFAULT 1,
      criado_em TEXT DEFAULT (datetime('now', 'localtime')),
      atualizado_em TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

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
    CREATE TABLE IF NOT EXISTS empresa_hospitais (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL,
      hospital_id INTEGER NOT NULL,
      criado_em TEXT DEFAULT (datetime('now', 'localtime')),
      UNIQUE(empresa_id, hospital_id),
      FOREIGN KEY(empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
      FOREIGN KEY(hospital_id) REFERENCES hospitais(id) ON DELETE CASCADE
    )
  `);

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
    CREATE TABLE IF NOT EXISTS user_empresas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      empresa_id INTEGER NOT NULL,
      papel TEXT NOT NULL DEFAULT 'plantonista',
      criado_em TEXT DEFAULT (datetime('now', 'localtime')),
      UNIQUE(user_id, empresa_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
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
    { nome:"Nao escaladas", setor:"Mapa", bloco:"Virtual", tipo:"virtual", ordem:0 },
    ...Array.from({ length:10 }, (_, i) => ({ nome:`Oeste ${i + 1}`, setor:"Centro cirurgico", bloco:"Oeste", tipo:"oeste", ordem:i + 1 })),
    ...Array.from({ length:10 }, (_, i) => ({ nome:`Lane ${i + 1}`, setor:"Centro cirurgico", bloco:"Lane", tipo:"lane", ordem:i + 11 })),
    { nome:"CDI", setor:"CDI", bloco:"Diagnostico", tipo:"cdi", ordem:21 },
    { nome:"HEMO", setor:"Hemodinamica", bloco:"Hemodinamica", tipo:"hemo", ordem:22 }
  ];

  for (const sala of salasPadrao) {
    await run(`
      INSERT OR IGNORE INTO hospital_salas (hospital_id, nome, setor, bloco, tipo, ordem)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [hospitalId, sala.nome, sala.setor, sala.bloco, sala.tipo, sala.ordem]);
  }

  await run(
    `INSERT OR IGNORE INTO hospitais (nome, slug, tipo) VALUES (?, ?, 'hospital')`,
    ["Hospital Sirio-Libanes", "hospital-sirio-libanes"]
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
    nome_escala TEXT,
    password_hash TEXT NOT NULL,
    email TEXT,
    role TEXT NOT NULL DEFAULT 'plantonista',
    ativo INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await garantirColuna("users", "ativo", "INTEGER NOT NULL DEFAULT 1");
  await garantirColuna("users", "email", "TEXT");
  await garantirColuna("users", "nome_escala", "TEXT");
  await run(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
}

async function migrarAnestesistasDiaPorHospital(hospitalPadraoId) {
  await run(`
    CREATE TABLE IF NOT EXISTS anestesistas_dia_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hospital_id INTEGER NOT NULL DEFAULT ${hospitalPadraoId},
      user_id INTEGER,
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
      user_id,
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
      user_id,
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
  await garantirColuna("cirurgias", "pre_feito", "INTEGER NOT NULL DEFAULT 0");
  await garantirColuna("cirurgias", "pre_feito_por", "TEXT");
  await garantirColuna("cirurgias", "pre_feito_user_id", "INTEGER");
  await garantirColuna("cirurgias", "pre_feito_em", "TEXT");
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

      user_id INTEGER,
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

  // Migracao segura para bancos ja existentes
  await garantirColuna("anestesistas_dia", "horario_escala", "TEXT");
  await garantirColuna("anestesistas_dia", "funcao", "TEXT");
  await garantirColuna("anestesistas_dia", "user_id", "INTEGER");
  await garantirColuna("anestesistas_dia", "hospital_id", `INTEGER NOT NULL DEFAULT ${hospitalPadraoId}`);
  await run(`UPDATE anestesistas_dia SET hospital_id = ? WHERE hospital_id IS NULL OR hospital_id = 0`, [hospitalPadraoId]);
  await migrarAnestesistasDiaPorHospital(hospitalPadraoId);
  await garantirColuna("anestesistas_dia", "user_id", "INTEGER");
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS ux_anestesistas_dia_hospital ON anestesistas_dia (hospital_id, data_escala, nome_anestesista)`);
  await run(`CREATE INDEX IF NOT EXISTS ix_anestesistas_dia_user ON anestesistas_dia (user_id, hospital_id, data_escala)`);

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

function campoPresente(body, ...nomes) {
  return nomes.some(nome => Object.prototype.hasOwnProperty.call(body || {}, nome));
}

function boolBanco(valor) {
  return valor === true || valor === 1 || valor === "1" || String(valor || "").toLowerCase() === "true" ? 1 : 0;
}

function validarCirurgia(body) {
  const hospital_id = Number(body.hospital_id || body.hospitalId || 0);
  const data_cirurgia = String(body.data_cirurgia || "").trim();
  const horario_inicio = String(body.horario_inicio || "").trim();
  const nome_cirurgia = String(body.nome_cirurgia || "").trim();
  const nome_cirurgia_key = normalizarTextoChave(nome_cirurgia);
  const duracao = String(body.duracao || "").trim();
  const sala = normalizarSalaCirurgia(body.sala);
  const servico = String(body.servico || "").trim();
  const anestesista_escalado = String(body.anestesista_escalado || "").trim();
  const iniciais_paciente = normalizarIniciaisPaciente(body.iniciais_paciente);
  const idade_paciente = Number(body.idade_paciente);
  const observacao = String(body.observacao || "").trim();
  const finalizada = body.finalizada === true || body.finalizada === 1 || body.finalizada === "1" ? 1 : 0;
  const pre_feito_presente = campoPresente(body, "pre_feito", "preFeito");
  const pre_feito_por_presente = campoPresente(body, "pre_feito_por", "preFeitoPor");
  const pre_feito_user_id_presente = campoPresente(body, "pre_feito_user_id", "preFeitoUserId");
  const pre_feito_em_presente = campoPresente(body, "pre_feito_em", "preFeitoEm");
  const pre_feito = pre_feito_presente ? boolBanco(body.pre_feito ?? body.preFeito) : null;
  const pre_feito_por = pre_feito_por_presente ? String(body.pre_feito_por ?? body.preFeitoPor ?? "").trim() : null;
  const preFeitoUserRaw = body.pre_feito_user_id ?? body.preFeitoUserId;
  const pre_feito_user_id = pre_feito_user_id_presente && Number.isInteger(Number(preFeitoUserRaw)) && Number(preFeitoUserRaw) > 0 ? Number(preFeitoUserRaw) : null;
  const pre_feito_em = pre_feito_em_presente ? String(body.pre_feito_em ?? body.preFeitoEm ?? "").trim() : null;

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
    finalizada,
    pre_feito,
    pre_feito_por,
    pre_feito_user_id,
    pre_feito_em,
    pre_feito_presente,
    pre_feito_por_presente,
    pre_feito_user_id_presente,
    pre_feito_em_presente
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
  if(row) return true;

  const empresa = await get(`
    SELECT eh.id
    FROM empresa_hospitais eh
    JOIN user_empresas ue ON ue.empresa_id = eh.empresa_id
    JOIN empresas e ON e.id = eh.empresa_id AND e.ativo = 1
    WHERE ue.user_id = ?
      AND eh.hospital_id = ?
    LIMIT 1
  `, [userId, hospitalId]);
  return !!empresa;
}

async function resolverUsuarioDaEscala({ userId, nomeAnestesista, hospitalId }) {
  const id = Number(userId || 0);
  if (Number.isInteger(id) && id > 0) {
    const user = await get(`SELECT id, username, nome_escala, role, ativo FROM users WHERE id = ?`, [id]);
    return user && user.ativo !== 0 ? user : null;
  }

  const nome = String(nomeAnestesista || "").trim();
  if (!nome) return null;
  const normalizado = normalizarTextoChave(nome);

  const users = await all(`
    SELECT
      u.id,
      u.username,
      u.nome_escala,
      u.role,
      u.ativo,
      CASE
        WHEN lower(COALESCE(NULLIF(u.nome_escala, ''), u.username)) = lower(?) THEN 3
        WHEN lower(u.username) = lower(?) THEN 2
        WHEN lower(COALESCE(NULLIF(u.nome_escala, ''), u.username)) LIKE lower(?) THEN 1
        ELSE 0
      END AS match_score
    FROM users u
    WHERE u.ativo = 1
      AND (
        lower(COALESCE(NULLIF(u.nome_escala, ''), u.username)) = lower(?)
        OR lower(u.username) = lower(?)
        OR lower(COALESCE(NULLIF(u.nome_escala, ''), u.username)) LIKE lower(?)
      )
    ORDER BY match_score DESC, COALESCE(NULLIF(u.nome_escala, ''), u.username) ASC
  `, [nome, nome, `%${nome}%`, nome, nome, `%${nome}%`]);

  for (const user of users) {
    const display = normalizarTextoChave(user.nome_escala || user.username);
    const login = normalizarTextoChave(user.username);
    if (display === normalizado || login === normalizado) return user;
  }

  const vinculado = [];
  for (const user of users) {
    if (await usuarioTemVinculo(user.id, hospitalId)) vinculado.push(user);
  }
  return vinculado[0] || users[0] || null;
}

async function liberarAcessoPlantaoPorEscala({ userId, hospitalId, data, criadoPor }) {
  if (!Number.isInteger(Number(userId)) || Number(userId) <= 0) return;
  await run(`
    INSERT INTO hospital_acessos_dia(data_acesso, hospital_id, user_id, papel_dia, pode_ver, pode_editar, criado_por)
    VALUES(?, ?, ?, 'plantonista', 1, 0, ?)
    ON CONFLICT(data_acesso, hospital_id, user_id) DO UPDATE SET
      pode_ver = 1,
      atualizado_em = datetime('now', 'localtime')
  `, [data, hospitalId, userId, criadoPor || null]);
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
    const coordenaHoje = diario && diario.pode_ver && diario.papel_dia === "coordenador";
    if (!coordenaHoje) {
      return { pode_ver:false, pode_editar:false, papel_dia:"coordenador", origem:"fora-do-plantao" };
    }
    return {
      pode_ver:true,
      pode_editar:true,
      papel_dia:"coordenador",
      origem:"diario"
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
      LEFT JOIN user_hospitais uh ON uh.hospital_id = h.id AND uh.user_id = ?
      LEFT JOIN empresa_hospitais eh ON eh.hospital_id = h.id
      LEFT JOIN user_empresas ue ON ue.empresa_id = eh.empresa_id AND ue.user_id = ?
      LEFT JOIN empresas e ON e.id = eh.empresa_id AND e.ativo = 1
      WHERE h.ativo = 1
        AND (uh.id IS NOT NULL OR (ue.id IS NOT NULL AND e.id IS NOT NULL))
      ORDER BY h.nome
    `, [user.id, user.id]);
  } else {
    hospitais = await all(`
      SELECT DISTINCT h.*
      FROM hospitais h
      JOIN hospital_acessos_dia ad ON ad.hospital_id = h.id AND ad.user_id = ? AND ad.data_acesso = ? AND ad.pode_ver = 1
      WHERE h.ativo = 1
      ORDER BY h.nome
    `, [user.id, data || dataLocalISO()]);
  }

  const enriquecidos = [];
  for (const hospital of hospitais) {
    const acesso = await acessoHospitalNoDia(req, hospital.id, data);
    const empresas = await all(`
      SELECT e.id, e.nome
      FROM empresas e
      JOIN empresa_hospitais eh ON eh.empresa_id = e.id
      WHERE eh.hospital_id = ? AND e.ativo = 1
      ORDER BY e.nome
    `, [hospital.id]);
    enriquecidos.push({
      ...hospital,
      empresa_ids: empresas.map(e => e.id).join(","),
      empresas: empresas.map(e => e.nome).join(", "),
      papel_dia: acesso.papel_dia,
      pode_ver: acesso.pode_ver ? 1 : 0,
      pode_editar: acesso.pode_editar ? 1 : 0,
      origem_acesso: acesso.origem
    });
  }

  return enriquecidos.filter(h => h.pode_ver);
}

async function hospitaisRecepcao(req, data) {
  const user = usuarioAtual(req);
  if (!user) return [];
  if (isAdminLike(user) || user.role === "escalador") return hospitaisPermitidos(req, data);

  const hospitais = await all(`
    SELECT DISTINCT h.*
    FROM hospitais h
    LEFT JOIN user_hospitais uh ON uh.hospital_id = h.id AND uh.user_id = ?
    LEFT JOIN empresa_hospitais eh ON eh.hospital_id = h.id
    LEFT JOIN user_empresas ue ON ue.empresa_id = eh.empresa_id AND ue.user_id = ?
    LEFT JOIN empresas e ON e.id = eh.empresa_id AND e.ativo = 1
    LEFT JOIN hospital_acessos_dia ad ON ad.hospital_id = h.id AND ad.user_id = ? AND ad.data_acesso = ? AND ad.pode_ver = 1
    WHERE h.ativo = 1
      AND (uh.id IS NOT NULL OR (ue.id IS NOT NULL AND e.id IS NOT NULL) OR ad.id IS NOT NULL)
    ORDER BY h.nome
  `, [user.id, user.id, user.id, data || dataLocalISO()]);

  const enriquecidos = [];
  for (const hospital of hospitais) {
    const acesso = await acessoHospitalNoDia(req, hospital.id, data);
    const empresas = await all(`
      SELECT e.id, e.nome
      FROM empresas e
      JOIN empresa_hospitais eh ON eh.empresa_id = e.id
      WHERE eh.hospital_id = ? AND e.ativo = 1
      ORDER BY e.nome
    `, [hospital.id]);
    enriquecidos.push({
      ...hospital,
      empresa_ids: empresas.map(e => e.id).join(","),
      empresas: empresas.map(e => e.nome).join(", "),
      papel_dia: acesso.papel_dia,
      pode_ver: acesso.pode_ver ? 1 : 0,
      pode_editar: acesso.pode_editar ? 1 : 0,
      origem_acesso: acesso.origem
    });
  }
  return enriquecidos;
}

async function empresasDoUsuario(user) {
  if (!user) return [];
  if (isAdminLike(user)) return all(`SELECT id, nome FROM empresas WHERE ativo = 1 ORDER BY nome`);
  return all(`
    SELECT DISTINCT e.id, e.nome
    FROM empresas e
    JOIN user_empresas ue ON ue.empresa_id = e.id AND ue.user_id = ?
    WHERE e.ativo = 1
    ORDER BY e.nome
  `, [user.id]);
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
  const duracaoInformada = String(item.duracao_informada || item.duracao_original || "").trim();
  const duracaoEstimadaIa = String(item.duracao_estimada_ia || item.duracao_ia || "").trim();
  const tempoCirurgicoIa = Number(item.tempo_cirurgico_estimado_min || 0);
  const tempoGiroSala = Number(item.tempo_giro_sala_min || 0);
  const justificativaIa = String(item.estimativa_ia_justificativa || "").trim();
  if (obs) observacoes.push(obs);
  if (servicoOriginal && servicoOriginal !== normalizarServicoExtraido(servicoOriginal)) {
    observacoes.push("Servico original: " + servicoOriginal);
  }
  if (duracaoInformada) observacoes.push("Duracao informada: " + duracaoInformada);
  if (duracaoEstimadaIa) observacoes.push("Estimativa IA: " + duracaoEstimadaIa);
  if (tempoCirurgicoIa > 0) observacoes.push("Tempo cirurgico IA: " + tempoCirurgicoIa + " min");
  if (tempoGiroSala > 0) observacoes.push("Giro de sala IA: " + tempoGiroSala + " min");
  if (justificativaIa) observacoes.push("Justificativa IA: " + justificativaIa);

  return {
    data_cirurgia: currentDate,
    horario_inicio: String(item.horario_inicio || item.inicio || "").trim(),
    sala: String(item.sala || "Nao escaladas").trim(),
    nome_cirurgia: String(item.nome_cirurgia || item.cirurgia || item.nome || "").trim(),
    duracao: String(item.duracao || duracaoEstimadaIa || duracaoInformada || "01:00").trim(),
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
  const apiKey = await resolverOpenAIKey();
  if (!apiKey) {
    const err = new Error("Chave OpenAI nao configurada. Configure em /admin_clinicas.html ou via OPENAI_API_KEY.");
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
            duracao_informada: { type: "string" },
            duracao_estimada_ia: { type: "string" },
            tempo_cirurgico_estimado_min: { type: "integer" },
            tempo_giro_sala_min: { type: "integer" },
            estimativa_ia_justificativa: { type: "string" },
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
            "duracao_informada",
            "duracao_estimada_ia",
            "tempo_cirurgico_estimado_min",
            "tempo_giro_sala_min",
            "estimativa_ia_justificativa",
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
    "Para duracao, use a melhor estimativa operacional: tempo cirurgico provavel do procedimento + tempo de giro de sala.",
    "Se a imagem trouxer uma duracao informada pela enfermagem, preserve esse valor em duracao_informada, mas deixe duracao como a melhor estimativa final.",
    "Preencha duracao_estimada_ia, tempo_cirurgico_estimado_min, tempo_giro_sala_min e estimativa_ia_justificativa com uma justificativa curta e conservadora.",
    "Quando nao der para estimar com seguranca, use a duracao informada; se tambem nao houver, use 01:00 e explique em aviso.",
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

function arquivoInfo(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return {
      existe: true,
      tamanho: stat.size,
      mtime: stat.mtime.toISOString()
    };
  } catch (e) {
    return {
      existe: false,
      tamanho: 0,
      mtime: null
    };
  }
}

app.get("/api/deploy-info", (req, res) => {
  noStore(res);
  const publicFiles = fs.existsSync(PUBLIC_DIR)
    ? fs.readdirSync(PUBLIC_DIR).filter(name => !name.startsWith(".")).sort()
    : [];

  res.json({
    ok: true,
    server_build_id: SERVER_BUILD_ID,
    railway: IS_RAILWAY,
    cwd: process.cwd(),
    root_dir: ROOT_DIR,
    public_dir: PUBLIC_DIR,
    server_entry: arquivoInfo(path.join(ROOT_DIR, "server.js")),
    server_app: arquivoInfo(__filename),
    usuarios_html: arquivoInfo(path.join(PUBLIC_DIR, "usuarios.html")),
    usuarios1_html: arquivoInfo(path.join(PUBLIC_DIR, "usuarios1.html")),
    reg_html: arquivoInfo(path.join(PUBLIC_DIR, "reg.html")),
    version_js: arquivoInfo(path.join(PUBLIC_DIR, "assets", "js", "version.js")),
    theme_css: arquivoInfo(path.join(PUBLIC_DIR, "assets", "css", "theme.css")),
    public_files: publicFiles
  });
});

function statusBancoPersistente() {
  const info = {
    data_dir: RAILWAY_DATA_DIR,
    data_dir_existe: fs.existsSync(RAILWAY_DATA_DIR),
    data_dir_gravavel: false,
    database_existe: fs.existsSync(DB_FILE),
    database_tamanho: 0,
    database_mtime: null,
    database_em_volume: estaDentroDoDiretorio(DB_FILE, RAILWAY_DATA_DIR),
    boot_backup_files: BOOT_DB_BACKUP_FILES || []
  };

  try {
    const marker = path.join(RAILWAY_DATA_DIR, ".mapacc-config-check");
    fs.writeFileSync(marker, new Date().toISOString(), "utf8");
    info.data_dir_gravavel = true;
  } catch (e) {
    info.data_dir_gravavel = false;
  }

  try {
    const stat = fs.statSync(DB_FILE);
    info.database_tamanho = stat.size;
    info.database_mtime = stat.mtime.toISOString();
  } catch (e) {}

  return info;
}

app.get("/api/config-check", authRequired, adminRequired, async (req, res) => {
  const dbOpenAIKey = await getConfigValue("openai_api_key");
  const resolvedKey = await resolverOpenAIKey();
  const persistencia = statusBancoPersistente();
  res.json({
    ok: true,
    config_check_version: CONFIG_CHECK_VERSION,
    railway: IS_RAILWAY,
    database: DB_FILE,
    persistencia,
    openai_api_key_configurada: !!resolvedKey,
    openai_api_key_tamanho: resolvedKey ? resolvedKey.length : 0,
    openai_api_key_nome_usado: process.env.OPENAI_API_KEY ? "OPENAI_API_KEY" : (process.env.MAPACC_OPENAI_API_KEY ? "MAPACC_OPENAI_API_KEY" : (dbOpenAIKey ? "app_config" : "")),
    openai_api_key_no_banco: !!dbOpenAIKey,
    mapacc_teste: process.env.MAPACC_TESTE || "",
    openai_vision_model: OPENAI_VISION_MODEL,
    smtp_configurado: smtpConfigurado(),
    smtp_host: SMTP_HOST,
    smtp_port: SMTP_PORT,
    smtp_user: SMTP_USER,
    smtp_from: SMTP_FROM,
    smtp_require_tls: SMTP_REQUIRE_TLS,
    port: PORT
  });
});

app.get("/api/admin-config/openai", authRequired, adminRequired, async (req, res) => {
  try{
    const dbOpenAIKey = await getConfigValue("openai_api_key");
    const resolvedKey = await resolverOpenAIKey();
    res.json({
      ok:true,
      configurada:!!resolvedKey,
      origem:process.env.OPENAI_API_KEY ? "OPENAI_API_KEY" : (process.env.MAPACC_OPENAI_API_KEY ? "MAPACC_OPENAI_API_KEY" : (dbOpenAIKey ? "app_config" : "")),
      tamanho:resolvedKey ? resolvedKey.length : 0,
      model:OPENAI_VISION_MODEL
    });
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});

app.post("/api/admin-config/openai", authRequired, adminRequired, async (req, res) => {
  try{
    const apiKey = String(req.body.api_key || req.body.openai_api_key || "").trim();
    if(!apiKey) return res.status(400).json({ok:false,error:"Chave OpenAI vazia"});
    if(!apiKey.startsWith("sk-")) return res.status(400).json({ok:false,error:"A chave deve comecar com sk-"});
    await setConfigValue("openai_api_key", apiKey);
    res.json({ok:true,configurada:true,tamanho:apiKey.length});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
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
      SELECT a.*, u.username, u.nome_escala
      FROM anestesistas_dia a
      LEFT JOIN users u ON u.id = a.user_id
      WHERE a.data_escala = ?
        AND a.hospital_id = ?
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

// UPSERT: se data + nome + iniciais + idade ja existir, atualiza em vez de duplicar.
async function encontrarCirurgiaExistente(v) {
  const existenteExato = await get(`
    SELECT id
    FROM cirurgias
    WHERE hospital_id = ?
      AND data_cirurgia = ?
      AND nome_cirurgia_key = ?
      AND iniciais_paciente = ?
      AND idade_paciente = ?
    ORDER BY id ASC
    LIMIT 1
  `, [
    v.hospital_id,
    v.data_cirurgia,
    v.nome_cirurgia_key,
    v.iniciais_paciente,
    v.idade_paciente
  ]);
  if (existenteExato) return existenteExato;

  const nomeIdentidade = normalizarIdentidadeCirurgia(v.nome_cirurgia);
  const iniciaisIdentidade = normalizarIniciaisPaciente(v.iniciais_paciente);
  const candidatos = await all(`
    SELECT id, horario_inicio, sala, nome_cirurgia, nome_cirurgia_key, iniciais_paciente
    FROM cirurgias
    WHERE hospital_id = ?
      AND data_cirurgia = ?
      AND idade_paciente = ?
    ORDER BY
      CASE WHEN horario_inicio = ? THEN 0 ELSE 1 END,
      CASE WHEN lower(sala) LIKE '%escalad%' OR lower(sala) LIKE '%sem sala%' THEN 0 ELSE 1 END,
      id ASC
    LIMIT 120
  `, [
    v.hospital_id,
    v.data_cirurgia,
    v.idade_paciente,
    v.horario_inicio
  ]);

  return candidatos.find(row => {
    const mesmoNome =
      normalizarIdentidadeCirurgia(row.nome_cirurgia) === nomeIdentidade ||
      normalizarIdentidadeCirurgia(row.nome_cirurgia_key) === nomeIdentidade;
    const mesmasIniciais = normalizarIniciaisPaciente(row.iniciais_paciente) === iniciaisIdentidade;
    return mesmoNome && mesmasIniciais;
  }) || null;
}

async function atualizarCirurgiaExistente(id, v) {
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
      finalizada = ?,
      pre_feito = CASE WHEN ? THEN ? ELSE pre_feito END,
      pre_feito_por = CASE WHEN ? THEN ? ELSE pre_feito_por END,
      pre_feito_user_id = CASE WHEN ? THEN ? ELSE pre_feito_user_id END,
      pre_feito_em = CASE WHEN ? THEN ? ELSE pre_feito_em END
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
    v.pre_feito_presente ? 1 : 0,
    v.pre_feito,
    v.pre_feito_por_presente ? 1 : 0,
    v.pre_feito_por,
    v.pre_feito_user_id_presente ? 1 : 0,
    v.pre_feito_user_id,
    v.pre_feito_em_presente ? 1 : 0,
    v.pre_feito_em,
    id
  ]);

  return get("SELECT * FROM cirurgias WHERE id = ?", [id]);
}

app.post("/api/cirurgias", async (req, res) => {
  try {
    const hospitalId = await hospitalDaRequisicao(req);
    req.body.hospital_id = hospitalId;
    const v = validarCirurgia(req.body);
    if (!v.ok) return res.status(400).json({ error:v.error });
    if (!await exigirHospital(req, res, hospitalId, true, v.data_cirurgia)) return;

    const existente = await encontrarCirurgiaExistente(v);
    if (existente) {
      const row = await atualizarCirurgiaExistente(existente.id, v);

      return res.json({
        ok:true,
        action:"updated_existing",
        message:"Cirurgia ja existia neste hospital; dados atualizados.",
        cirurgia: row
      });
    }

    let result;
    try {
      result = await run(`
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
          finalizada,
          pre_feito,
          pre_feito_por,
          pre_feito_user_id,
          pre_feito_em
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        v.pre_feito_presente ? v.pre_feito : 0,
        v.pre_feito_por_presente ? v.pre_feito_por : null,
        v.pre_feito_user_id_presente ? v.pre_feito_user_id : null,
        v.pre_feito_em_presente ? v.pre_feito_em : null
      ]);
    } catch (insertErr) {
      if (String(insertErr.message || "").includes("UNIQUE")) {
        const existenteAposConflito = await encontrarCirurgiaExistente(v);
        if (existenteAposConflito) {
          const row = await atualizarCirurgiaExistente(existenteAposConflito.id, v);
          return res.json({
            ok:true,
            action:"updated_existing",
            message:"Cirurgia ja existia neste hospital; dados atualizados.",
            cirurgia: row
          });
        }
      }
      throw insertErr;
    }

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
        finalizada = ?,
        pre_feito = CASE WHEN ? THEN ? ELSE pre_feito END,
        pre_feito_por = CASE WHEN ? THEN ? ELSE pre_feito_por END,
        pre_feito_user_id = CASE WHEN ? THEN ? ELSE pre_feito_user_id END,
        pre_feito_em = CASE WHEN ? THEN ? ELSE pre_feito_em END
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
      v.pre_feito_presente ? 1 : 0,
      v.pre_feito,
      v.pre_feito_por_presente ? 1 : 0,
      v.pre_feito_por,
      v.pre_feito_user_id_presente ? 1 : 0,
      v.pre_feito_user_id,
      v.pre_feito_em_presente ? 1 : 0,
      v.pre_feito_em,
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

function usuarioPodeMarcarPreFeito(user, cirurgia, acesso) {
  if (!user || !cirurgia || !acesso || !acesso.pode_ver) return false;
  if (isAdminLike(user) || acesso.pode_editar) return true;
  if (user.role !== "plantonista") return false;

  const anest = normalizarTextoChave(cirurgia.anestesista_escalado || "");
  if (!anest) return false;
  const nomesUsuario = [
    user.nome_escala,
    user.username
  ].map(normalizarTextoChave).filter(Boolean);
  return nomesUsuario.includes(anest);
}

app.post("/api/cirurgias/:id/pre-feito", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error:"ID invalido." });

    const atual = await get("SELECT * FROM cirurgias WHERE id = ?", [id]);
    if (!atual) return res.status(404).json({ error:"Cirurgia nao encontrada." });

    const user = usuarioAtual(req);
    if (!user) return res.status(401).json({ ok:false, error:"Nao autenticado" });

    const acesso = await acessoHospitalNoDia(req, atual.hospital_id, atual.data_cirurgia || dataLocalISO());
    if (!usuarioPodeMarcarPreFeito(user, atual, acesso)) {
      return res.status(403).json({ ok:false, error:"Voce pode ver esta cirurgia, mas nao pode marcar o pre feito dela." });
    }

    const marcado = boolBanco(req.body.pre_feito ?? req.body.preFeito);
    const nomeUsuario = String(user.nome_escala || user.username || "").trim();

    if (marcado) {
      await run(`
        UPDATE cirurgias
        SET
          pre_feito = 1,
          pre_feito_por = ?,
          pre_feito_user_id = ?,
          pre_feito_em = datetime('now', 'localtime')
        WHERE id = ?
      `, [nomeUsuario, user.id || null, id]);
    } else {
      await run(`
        UPDATE cirurgias
        SET
          pre_feito = 0,
          pre_feito_por = NULL,
          pre_feito_user_id = NULL,
          pre_feito_em = NULL
        WHERE id = ?
      `, [id]);
    }

    const row = await get("SELECT * FROM cirurgias WHERE id = ?", [id]);
    res.json({ ok:true, cirurgia:row });
  } catch(err) {
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
        SELECT a.*, u.username, u.nome_escala
        FROM anestesistas_dia a
        LEFT JOIN users u ON u.id = a.user_id
        WHERE a.data_escala = ?
          AND a.hospital_id = ?
        ORDER BY horario_escala ASC, nome_anestesista ASC
      `, [data, hospitalId]);
    } else {
      rows = await all(`
        SELECT a.*, u.username, u.nome_escala
        FROM anestesistas_dia a
        LEFT JOIN users u ON u.id = a.user_id
        WHERE a.hospital_id = ?
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
    const usuarioEscala = await resolverUsuarioDaEscala({
      userId: req.body.user_id || req.body.userId,
      nomeAnestesista: v.nome_anestesista,
      hospitalId: v.hospital_id
    });
    const usuarioEscalaId = usuarioEscala ? usuarioEscala.id : null;

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
        SET user_id = ?, horario_escala = ?, funcao = ?, observacao = ?
        WHERE id = ?
      `, [usuarioEscalaId, v.horario_escala, v.funcao, v.observacao, existente.id]);

      if (usuarioEscalaId) {
        await liberarAcessoPlantaoPorEscala({ userId:usuarioEscalaId, hospitalId:v.hospital_id, data:v.data_escala, criadoPor:req.user && req.user.id });
      }

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
        user_id,
        data_escala,
        nome_anestesista,
        horario_escala,
        funcao,
        observacao
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      v.hospital_id,
      usuarioEscalaId,
      v.data_escala,
      v.nome_anestesista,
      v.horario_escala,
      v.funcao,
      v.observacao
    ]);

    if (usuarioEscalaId) {
      await liberarAcessoPlantaoPorEscala({ userId:usuarioEscalaId, hospitalId:v.hospital_id, data:v.data_escala, criadoPor:req.user && req.user.id });
    }

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
    const usuarioEscala = await resolverUsuarioDaEscala({
      userId: req.body.user_id || req.body.userId,
      nomeAnestesista: v.nome_anestesista,
      hospitalId: v.hospital_id
    });
    const usuarioEscalaId = usuarioEscala ? usuarioEscala.id : null;

    const result = await run(`
      UPDATE anestesistas_dia
      SET
        hospital_id = ?,
        user_id = ?,
        data_escala = ?,
        nome_anestesista = ?,
        horario_escala = ?,
        funcao = ?,
        observacao = ?
      WHERE id = ?
    `, [
      v.hospital_id,
      usuarioEscalaId,
      v.data_escala,
      v.nome_anestesista,
      v.horario_escala,
      v.funcao,
      v.observacao,
      id
    ]);

    if (result.changes === 0) return res.status(404).json({ error:"Anestesista nao encontrado." });
    if (usuarioEscalaId) {
      await liberarAcessoPlantaoPorEscala({ userId:usuarioEscalaId, hospitalId:v.hospital_id, data:v.data_escala, criadoPor:req.user && req.user.id });
    }

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

// Mantido escondido para diagnostico
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

function sha256Hex(value){
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function publicBaseUrl(req){
  if(APP_BASE_URL){
    if(APP_BASE_URL.startsWith('http://') || APP_BASE_URL.startsWith('https://')) return APP_BASE_URL.replace(/\/+$/,'');
    return 'https://' + APP_BASE_URL.replace(/\/+$/,'');
  }
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  return proto + '://' + req.get('host');
}

function smtpConfigurado(){
  return !!(SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS && SMTP_FROM);
}

async function enviarEmailRecuperacao({ to, username, resetLink }) {
  if(!smtpConfigurado()) {
    const err = new Error('SMTP nao configurado');
    err.code = 'SMTP_NOT_CONFIGURED';
    throw err;
  }
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host:SMTP_HOST,
    port:SMTP_PORT,
    secure:SMTP_PORT === 465,
    requireTLS:SMTP_REQUIRE_TLS && SMTP_PORT !== 465,
    connectionTimeout:15000,
    greetingTimeout:15000,
    socketTimeout:30000,
    auth:{ user:SMTP_USER, pass:SMTP_PASS }
  });
  await transporter.sendMail({
    from:SMTP_FROM,
    to,
    subject:'Recuperacao de senha - MAPA CC',
    text:[
      'Ola '+username+',',
      '',
      'Recebemos uma solicitacao para redefinir sua senha no MAPA CC.',
      'Acesse o link abaixo em ate 30 minutos:',
      resetLink,
      '',
      'Se voce nao solicitou isso, ignore este e-mail.'
    ].join('\n')
  });
}

// Cria tabela de usuarios e, se o banco estiver vazio, o admin inicial.
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    nome_escala TEXT,
    password_hash TEXT NOT NULL,
    email TEXT,
    role TEXT NOT NULL DEFAULT 'plantonista',
    ativo INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`ALTER TABLE users ADD COLUMN email TEXT`, () => {});
  db.run(`ALTER TABLE users ADD COLUMN nome_escala TEXT`, () => {});
  db.run(`ALTER TABLE users ADD COLUMN ativo INTEGER NOT NULL DEFAULT 1`, () => {});

  db.get(`SELECT COUNT(*) AS total FROM users`, [], (err, row) => {
    if (err) {
      console.error('Erro ao verificar usuario inicial:', err.message);
      if (IS_RAILWAY) process.exit(1);
      return;
    }

    if (row && row.total === 0) {
      if (!INITIAL_ADMIN_USER || !INITIAL_ADMIN_PASSWORD) {
        console.error('FATAL: banco sem usuarios. Configure INITIAL_ADMIN_USER e INITIAL_ADMIN_PASSWORD.');
        if (IS_RAILWAY) process.exit(1);
        return;
      }

      db.run(
        `INSERT INTO users(username,nome_escala,password_hash,role) VALUES(?,?,?,?)`,
        [INITIAL_ADMIN_USER, INITIAL_ADMIN_USER, hashPassword(INITIAL_ADMIN_PASSWORD), 'admin']
      );
      console.log(`Usuario inicial criado: ${INITIAL_ADMIN_USER}`);
    }
  });

  db.run(`UPDATE users SET role = 'coordenador' WHERE role = 'user'`);
});

const getUserByUsername = (username) => new Promise((resolve,reject)=>{
  db.get(`SELECT * FROM users WHERE username = ?`, [username], (err,row)=>err?reject(err):resolve(row));
});

const getUserById = (id) => new Promise((resolve,reject)=>{
  db.get(`SELECT id, username, nome_escala, role, created_at FROM users WHERE id = ?`, [id], (err,row)=>err?reject(err):resolve(row));
});

function authRequired(req,res,next){
  const sid = parseCookies(req).ccsama_session;
  const session = sid && sessions.get(sid);
  if(!session){
    if(req.path.startsWith('/api/')) return res.status(401).json({ok:false,error:'Nao autenticado'});
    return res.status(401).type('text/plain').send('Nao autenticado.');
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

// Rotas publicas de login
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
    const sessionUser = {id:user.id, username:user.username, nome_escala:user.nome_escala || user.username, role:user.role, admin_plus:isAdminPlusUser(user)};
    sessions.set(sid, {user:sessionUser, createdAt:Date.now()});

    res.setHeader('Set-Cookie', `ccsama_session=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800`);
    res.json({ok:true,user:{username:user.username,nome_escala:user.nome_escala || user.username,role:user.role,admin_plus:isAdminPlusUser(user)}});
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

app.post('/api/password-reset/request', async (req,res)=>{
  try{
    const identificador = String(req.body.identificador || req.body.email || req.body.username || '').trim();
    const respostaPadrao = {
      ok:true,
      message:'Se existir usuario com e-mail cadastrado, enviaremos um link de recuperacao.',
      smtp_configurado:smtpConfigurado()
    };
    if(!identificador) return res.json(respostaPadrao);

    const user = await get(`
      SELECT id, username, email, ativo
      FROM users
      WHERE lower(username) = lower(?) OR lower(COALESCE(email,'')) = lower(?)
      LIMIT 1
    `, [identificador, identificador]);
    if(!user || !user.email || user.ativo === 0) return res.json(respostaPadrao);

    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = sha256Hex(token);
    await run(`UPDATE password_reset_tokens SET used_at = datetime('now', 'localtime') WHERE user_id = ? AND used_at IS NULL`, [user.id]);
    await run(`
      INSERT INTO password_reset_tokens(user_id, token_hash, expires_at)
      VALUES(?, ?, datetime('now', '+30 minutes', 'localtime'))
    `, [user.id, tokenHash]);

    const resetLink = publicBaseUrl(req) + '/reset_senha.html?token=' + encodeURIComponent(token);
    await enviarEmailRecuperacao({ to:user.email, username:user.username, resetLink });
    res.json(respostaPadrao);
  }catch(e){
    if(e.code === 'SMTP_NOT_CONFIGURED'){
      return res.status(503).json({ok:false,error:'Envio de e-mail ainda nao configurado no servidor. Configure SMTP_PASS no Railway. O Outlook ja esta pre-configurado como mapa_cc@outlook.com.br.',smtp_configurado:false});
    }
    res.status(500).json({ok:false,error:e.message});
  }
});

app.post('/api/password-reset/confirm', async (req,res)=>{
  try{
    const token = String(req.body.token || '').trim();
    const password = String(req.body.password || '');
    if(!token) return res.status(400).json({ok:false,error:'Token ausente'});
    if(password.length < 4) return res.status(400).json({ok:false,error:'A senha deve ter pelo menos 4 caracteres'});
    const tokenHash = sha256Hex(token);
    const row = await get(`
      SELECT prt.id, prt.user_id, u.username, u.ativo
      FROM password_reset_tokens prt
      JOIN users u ON u.id = prt.user_id
      WHERE prt.token_hash = ?
        AND prt.used_at IS NULL
        AND datetime(prt.expires_at) >= datetime('now', 'localtime')
      LIMIT 1
    `, [tokenHash]);
    if(!row || row.ativo === 0) return res.status(400).json({ok:false,error:'Link invalido ou expirado'});

    await run(`UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [hashPassword(password), row.user_id]);
    await run(`UPDATE password_reset_tokens SET used_at = datetime('now', 'localtime') WHERE id = ?`, [row.id]);
    res.json({ok:true,message:'Senha redefinida. Voce ja pode entrar.'});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});

app.get('/api/me', authRequired, async (req,res)=>{
  const data = validarDataISO(req.query.data) ? req.query.data : dataLocalISO();
  const recepcao = req.query.recepcao === '1' || req.query.reception === '1';
  const hospitais = recepcao ? await hospitaisRecepcao(req, data) : await hospitaisPermitidos(req, data);
  const mapaEmpresas = new Map();
  const empresasUsuario = await empresasDoUsuario(req.user);
  for (const empresa of empresasUsuario) {
    mapaEmpresas.set(Number(empresa.id), { id:Number(empresa.id), nome:empresa.nome });
  }
  for (const h of hospitais) {
    const ids = String(h.empresa_ids || '').split(',').map(Number).filter(Boolean);
    const nomes = String(h.empresas || '').split(',').map(s => s.trim()).filter(Boolean);
    ids.forEach((id, idx) => mapaEmpresas.set(id, {id, nome:nomes[idx] || ('Empresa '+id)}));
  }
  res.json({ok:true,user:req.user,empresas:[...mapaEmpresas.values()],hospitais});
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
        COUNT(DISTINCT uh.user_id) AS total_usuarios,
        COALESCE(group_concat(DISTINCT e.nome), '') AS empresas,
        COALESCE(group_concat(DISTINCT e.id), '') AS empresa_ids
      FROM hospitais h
      LEFT JOIN hospital_salas hs ON hs.hospital_id = h.id AND hs.ativa = 1
      LEFT JOIN user_hospitais uh ON uh.hospital_id = h.id
      LEFT JOIN empresa_hospitais eh ON eh.hospital_id = h.id
      LEFT JOIN empresas e ON e.id = eh.empresa_id AND e.ativo = 1
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

app.get('/api/admin-empresas', authRequired, adminRequired, async (req,res)=>{
  try{
    const empresas = await all(`
      SELECT
        e.id,
        e.nome,
        e.slug,
        e.ativo,
        COALESCE(group_concat(DISTINCT h.id), '') AS hospital_ids,
        COALESCE(group_concat(DISTINCT h.nome), '') AS hospitais,
        COUNT(DISTINCT ue.user_id) AS total_usuarios
      FROM empresas e
      LEFT JOIN empresa_hospitais eh ON eh.empresa_id = e.id
      LEFT JOIN hospitais h ON h.id = eh.hospital_id AND h.ativo = 1
      LEFT JOIN user_empresas ue ON ue.empresa_id = e.id
      WHERE e.ativo = 1
      GROUP BY e.id
      ORDER BY e.nome
    `);
    res.json({ok:true,empresas});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});

app.post('/api/empresas', authRequired, adminRequired, async (req,res)=>{
  try{
    const id = Number(req.body.id || 0);
    const nome = String(req.body.nome || '').trim();
    const hospitalIds = Array.isArray(req.body.hospital_ids) ? req.body.hospital_ids.map(Number).filter(n => Number.isInteger(n) && n > 0) : [];
    if(!nome) return res.status(400).json({ok:false,error:'Nome da empresa obrigatorio'});

    let empresaId = id;
    if(empresaId > 0){
      const atual = await get(`SELECT id FROM empresas WHERE id = ? AND ativo = 1`, [empresaId]);
      if(!atual) return res.status(404).json({ok:false,error:'Empresa nao encontrada'});
      const duplicado = await get(`SELECT id FROM empresas WHERE lower(nome) = lower(?) AND id <> ? AND ativo = 1`, [nome, empresaId]);
      if(duplicado) return res.status(409).json({ok:false,error:'Ja existe empresa com este nome'});
      await run(`UPDATE empresas SET nome = ?, atualizado_em = datetime('now', 'localtime') WHERE id = ?`, [nome, empresaId]);
      await run(`DELETE FROM empresa_hospitais WHERE empresa_id = ?`, [empresaId]);
    }else{
      const existente = await get(`SELECT id FROM empresas WHERE lower(nome) = lower(?) AND ativo = 1`, [nome]);
      if(existente) return res.status(409).json({ok:false,error:'Ja existe empresa com este nome'});
      const slug = normalizarTextoChave(nome).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || ('empresa-'+Date.now());
      const result = await run(`INSERT INTO empresas(nome, slug) VALUES(?, ?)`, [nome, slug]);
      empresaId = result.lastID;
    }

    for(const hospitalId of hospitalIds){
      await run(`INSERT OR IGNORE INTO empresa_hospitais(empresa_id, hospital_id) VALUES(?, ?)`, [empresaId, hospitalId]);
    }
    const empresa = await get(`SELECT * FROM empresas WHERE id = ?`, [empresaId]);
    res.json({ok:true,empresa});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});

app.delete('/api/empresas/:id', authRequired, adminRequired, async (req,res)=>{
  try{
    const id = Number(req.params.id);
    if(!Number.isInteger(id) || id <= 0) return res.status(400).json({ok:false,error:'Empresa invalida'});
    await run(`UPDATE empresas SET ativo = 0, atualizado_em = datetime('now', 'localtime') WHERE id = ?`, [id]);
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
      SELECT ad.*, u.username, u.nome_escala, u.role
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
      SELECT ad.*, u.username, u.nome_escala, u.role
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
      SELECT u.id, u.username, u.nome_escala, u.email, u.role, u.ativo, u.created_at,
        CASE WHEN lower(u.username) = 'godofredo' THEN 1 ELSE 0 END AS admin_plus,
        COALESCE(group_concat(DISTINCT h.id), '') AS hospital_ids,
        COALESCE(group_concat(DISTINCT h.nome), '') AS hospitais,
        COALESCE(group_concat(DISTINCT emp.id), '') AS empresa_ids,
        COALESCE(group_concat(DISTINCT emp.nome), '') AS empresas
      FROM users u
      LEFT JOIN user_hospitais uh ON uh.user_id = u.id
      LEFT JOIN hospitais h ON h.id = uh.hospital_id
      LEFT JOIN user_empresas ue ON ue.user_id = u.id
      LEFT JOIN empresas emp ON emp.id = ue.empresa_id AND emp.ativo = 1
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
    if(!user || (!isAdminLike(user) && !['escalador','coordenador'].includes(user.role))){
      return res.status(403).json({ok:false,error:'Acesso restrito ao admin, escalador ou coordenador'});
    }
    const users = await all(`
      SELECT id, username, nome_escala, email, role,
        CASE WHEN lower(username) = 'godofredo' THEN 1 ELSE 0 END AS admin_plus
      FROM users
      WHERE ativo = 1
      ORDER BY COALESCE(NULLIF(nome_escala,''), username)
    `);
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
      const nomeEscalaPresente = Object.prototype.hasOwnProperty.call(req.body, 'nome_escala') || Object.prototype.hasOwnProperty.call(req.body, 'nome');
      const rolePresente = Object.prototype.hasOwnProperty.call(req.body, 'role');
      const ativoPresente = Object.prototype.hasOwnProperty.call(req.body, 'ativo');
      const senhaPresente = Object.prototype.hasOwnProperty.call(req.body, 'password');
      const hospitaisPresente = Object.prototype.hasOwnProperty.call(req.body, 'hospital_ids');
      const emailPresente = Object.prototype.hasOwnProperty.call(req.body, 'email');
      const empresasPresente = Object.prototype.hasOwnProperty.call(req.body, 'empresa_ids');

      if(usernamePresente || nomeEscalaPresente || rolePresente || ativoPresente || senhaPresente || hospitaisPresente || emailPresente || empresasPresente){
        const usuario = await atualizarUsuarioSimples(bodyId, req.body || {});
        return res.json({ok:true,usuario});
      }

      const deleted = await excluirUsuarioSimples(bodyId);
      return res.json({ok:true,deleted_id:deleted.id});
    }

    const username = String(req.body.username || '').trim();
    const nomeEscala = String(req.body.nome_escala || req.body.nome || username).trim();
    const email = String(req.body.email || '').trim();
    const password = String(req.body.password || '');
    const roleInput = String(req.body.role || 'plantonista').trim().toLowerCase();
    const role = ['admin','escalador','coordenador','plantonista'].includes(roleInput) ? roleInput : 'plantonista';
    const ativo = req.body.ativo === false || req.body.ativo === 0 || req.body.ativo === '0' ? 0 : 1;
    const hospitalIds = Array.isArray(req.body.hospital_ids) ? req.body.hospital_ids.map(Number).filter(n => Number.isInteger(n) && n > 0) : [];
    const empresaIds = Array.isArray(req.body.empresa_ids) ? req.body.empresa_ids.map(Number).filter(n => Number.isInteger(n) && n > 0) : [];
    if(!username) return res.status(400).json({ok:false,error:'Usuario vazio'});
    if(password.length < 4) return res.status(400).json({ok:false,error:'Senha muito curta'});
    const result = await run(`INSERT INTO users(username,nome_escala,email,password_hash,role,ativo) VALUES(?,?,?,?,?,?)`, [username, nomeEscala, email, hashPassword(password), role, ativo]);
    for (const hospitalId of hospitalIds) {
      await run(`INSERT OR IGNORE INTO user_hospitais(user_id, hospital_id, papel) VALUES(?,?,?)`, [result.lastID, hospitalId, role]);
    }
    for (const empresaId of empresaIds) {
      await run(`INSERT OR IGNORE INTO user_empresas(user_id, empresa_id, papel) VALUES(?,?,?)`, [result.lastID, empresaId, role]);
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

  const alvo = await get(`SELECT id, username, nome_escala, email FROM users WHERE id = ?`, [id]);
  if(!alvo) {
    const err = new Error('Usuario nao encontrado');
    err.status = 404;
    throw err;
  }

  const username = String(body.username ?? alvo.username).trim();
  const nomeEscala = String(body.nome_escala ?? body.nome ?? alvo.nome_escala ?? username).trim();
  const email = String(body.email ?? alvo.email ?? '').trim();
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
  const empresaIds = Array.isArray(body.empresa_ids)
    ? body.empresa_ids.map(Number).filter(n => Number.isInteger(n) && n > 0)
    : [];

  await run(`UPDATE users SET username = ?, nome_escala = ?, email = ?, role = ?, ativo = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [username, nomeEscala, email, role, ativo, id]);
  if(password){
    await run(`UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [hashPassword(password), id]);
  }
  await run(`DELETE FROM user_hospitais WHERE user_id = ?`, [id]);
  for (const hospitalId of hospitalIds) {
    await run(`INSERT OR IGNORE INTO user_hospitais(user_id, hospital_id, papel) VALUES(?,?,?)`, [id, hospitalId, role]);
  }
  await run(`DELETE FROM user_empresas WHERE user_id = ?`, [id]);
  for (const empresaId of empresaIds) {
    await run(`INSERT OR IGNORE INTO user_empresas(user_id, empresa_id, papel) VALUES(?,?,?)`, [id, empresaId, role]);
  }

  for (const [sid, session] of sessions.entries()) {
    if(session.user && Number(session.user.id) === id) {
      if(ativo === 0) sessions.delete(sid);
      else session.user = {...session.user, username, nome_escala:nomeEscala, role, admin_plus:isAdminPlusUser({username})};
    }
  }

  return {id, username, nome_escala:nomeEscala, email, role, ativo};
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
  await run(`DELETE FROM user_empresas WHERE user_id = ?`, [id]);
  await run(`DELETE FROM users WHERE id = ?`, [id]);

  for (const [sid, session] of sessions.entries()) {
    if(session.user && Number(session.user.id) === id) sessions.delete(sid);
  }

  return {id};
}

function idUsuarioBody(body) {
  return Number((body && (body.id || body.user_id || body.userId)) || 0);
}

async function handleAtualizarUsuario(req, res) {
  try{
    const id = idUsuarioBody(req.body);
    const usuario = await atualizarUsuarioSimples(id, req.body || {});
    res.json({ok:true,usuario});
  }catch(e){
    res.status(e.status || 500).json({ok:false,error:e.message});
  }
}

async function handleExcluirUsuarioBody(req, res) {
  try{
    const deleted = await excluirUsuarioSimples(idUsuarioBody(req.body));
    res.json({ok:true,deleted_id:deleted.id});
  }catch(e){
    res.status(e.status || 500).json({ok:false,error:e.message});
  }
}

async function handleExcluirUsuarioParam(req, res) {
  try{
    const id = Number(req.params.id);
    const deleted = await excluirUsuarioSimples(id);
    res.json({ok:true,deleted_id:deleted.id});
  }catch(e){
    res.status(e.status || 500).json({ok:false,error:e.message});
  }
}

app.post(['/api/users-update', '/api/users/update'], authRequired, handleAtualizarUsuario);
app.post(['/api/users-delete', '/api/users/delete'], authRequired, handleExcluirUsuarioBody);

app.put('/api/users/:id', authRequired, async (req,res)=>{
  try{
    const id = Number(req.params.id);
    const usuario = await atualizarUsuarioSimples(id, req.body || {});
    res.json({ok:true,usuario});
  }catch(e){
    res.status(e.status || 500).json({ok:false,error:e.message});
  }
});

app.delete('/api/users/:id', authRequired, handleExcluirUsuarioParam);

configureStaticAssets(app, { publicDir: PUBLIC_DIR });

module.exports = {
  app,
  db,
  initDb,
  config: {
    PORT,
    ROOT_DIR,
    PUBLIC_DIR,
    SERVER_BUILD_ID
  }
};
