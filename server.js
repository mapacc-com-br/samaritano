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

      criado_em TEXT DEFAULT (datetime('now', 'localtime')),
      atualizado_em TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  await garantirColuna("cirurgias", "nome_cirurgia_key", "TEXT");

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

  // Migração segura para bancos já existentes
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
    nome_cirurgia_key,
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
  const horario_escala = String(body.horario_escala || "").trim();
  const funcao = String(body.funcao || "").trim();
  const observacao = String(body.observacao || "").trim();

  if (!validarDataISO(data_escala)) return { ok:false, error:"Data da escala inválida." };
  if (!nome_anestesista) return { ok:false, error:"Nome do anestesista obrigatório." };

  return {
    ok:true,
    data_escala,
    nome_anestesista,
    horario_escala,
    funcao,
    observacao
  };
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

// UPSERT: se data + nome + iniciais + idade já existir, atualiza em vez de duplicar.
app.post("/api/cirurgias", async (req, res) => {
  try {
    const v = validarCirurgia(req.body);
    if (!v.ok) return res.status(400).json({ error:v.error });

    const existente = await get(`
      SELECT id
      FROM cirurgias
      WHERE data_cirurgia = ?
        AND nome_cirurgia_key = ?
        AND iniciais_paciente = ?
        AND idade_paciente = ?
    `, [
      v.data_cirurgia,
      v.nome_cirurgia_key,
      v.iniciais_paciente,
      v.idade_paciente
    ]);

    if (existente) {
      await run(`
        UPDATE cirurgias
        SET
          horario_inicio = ?,
          nome_cirurgia = ?,
          nome_cirurgia_key = ?,
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
        v.nome_cirurgia_key,
        v.duracao,
        v.sala,
        v.servico,
        v.anestesista_escalado,
        v.iniciais_paciente,
        v.idade_paciente,
        existente.id
      ]);

      const row = await get("SELECT * FROM cirurgias WHERE id = ?", [existente.id]);

      return res.json({
        ok:true,
        action:"updated_existing",
        message:"Cirurgia já existia; dados atualizados.",
        cirurgia: row
      });
    }

    const result = await run(`
      INSERT INTO cirurgias (
        data_cirurgia,
        horario_inicio,
        nome_cirurgia,
        nome_cirurgia_key,
        duracao,
        sala,
        servico,
        anestesista_escalado,
        iniciais_paciente,
        idade_paciente
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      v.data_cirurgia,
      v.horario_inicio,
      v.nome_cirurgia,
      v.nome_cirurgia_key,
      v.duracao,
      v.sala,
      v.servico,
      v.anestesista_escalado,
      v.iniciais_paciente,
      v.idade_paciente
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
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error:"ID inválido." });

    const v = validarCirurgia(req.body);
    if (!v.ok) return res.status(400).json({ error:v.error });

    const result = await run(`
      UPDATE cirurgias
      SET
        data_cirurgia = ?,
        horario_inicio = ?,
        nome_cirurgia = ?,
        nome_cirurgia_key = ?,
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
      v.nome_cirurgia_key,
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
        error:"Já existe outra cirurgia nesse dia com mesmo nome, iniciais e idade."
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
        ORDER BY horario_escala ASC, nome_anestesista ASC
      `, [data]);
    } else {
      rows = await all(`
        SELECT *
        FROM anestesistas_dia
        ORDER BY data_escala DESC, horario_escala ASC, nome_anestesista ASC
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

    const existente = await get(`
      SELECT id
      FROM anestesistas_dia
      WHERE data_escala = ?
        AND nome_anestesista = ?
    `, [v.data_escala, v.nome_anestesista]);

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
        message:"Anestesista já estava na escala desse dia; dados atualizados.",
        anestesista: row
      });
    }

    const result = await run(`
      INSERT INTO anestesistas_dia (
        data_escala,
        nome_anestesista,
        horario_escala,
        funcao,
        observacao
      )
      VALUES (?, ?, ?, ?, ?)
    `, [
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
      message:"Anestesista adicionado à escala do dia.",
      anestesista: row
    });
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
      SET
        data_escala = ?,
        nome_anestesista = ?,
        horario_escala = ?,
        funcao = ?,
        observacao = ?
      WHERE id = ?
    `, [
      v.data_escala,
      v.nome_anestesista,
      v.horario_escala,
      v.funcao,
      v.observacao,
      id
    ]);

    if (result.changes === 0) return res.status(404).json({ error:"Anestesista não encontrado." });

    const row = await get("SELECT * FROM anestesistas_dia WHERE id = ?", [id]);
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

    const result = await run("DELETE FROM anestesistas_dia WHERE id = ?", [id]);
    if (result.changes === 0) return res.status(404).json({ error:"Anestesista não encontrado." });

    res.json({ ok:true, deleted_id:id });
  } catch(err) {
    res.status(500).json({ error:err.message });
  }
});

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
    role TEXT NOT NULL DEFAULT 'user',
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
  if(!req.user || req.user.role !== 'admin'){
    return res.status(403).json({ok:false,error:'Acesso restrito ao admin'});
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
      return res.status(401).json({ok:false,error:'Usuário ou senha inválidos'});
    }

    const sid = crypto.randomBytes(32).toString('hex');
    sessions.set(sid, {user:{id:user.id,username:user.username,role:user.role}, createdAt:Date.now()});

    res.setHeader('Set-Cookie', `ccsama_session=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800`);
    res.json({ok:true,user:{username:user.username,role:user.role}});
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
  res.json({ok:true,user:req.user});
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

app.get('/api/users', authRequired, adminRequired, async (req,res)=>{
  try{
    const users = await all(`SELECT id, username, role, created_at FROM users ORDER BY username`);
    res.json({ok:true,users});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});

app.post('/api/users', authRequired, adminRequired, async (req,res)=>{
  try{
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const role = String(req.body.role || 'user') === 'admin' ? 'admin' : 'user';
    if(!username) return res.status(400).json({ok:false,error:'Usuário vazio'});
    if(password.length < 4) return res.status(400).json({ok:false,error:'Senha muito curta'});
    await run(`INSERT INTO users(username,password_hash,role) VALUES(?,?,?)`, [username, hashPassword(password), role]);
    res.json({ok:true});
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
});

// Proteja páginas específicas.
// IMPORTANTE: coloque isto ANTES do express.static.
app.get('/index_graf_v6.html', authRequired, (req,res)=>{
  res.sendFile(path.join(__dirname,'public','index_graf_v6.html'));
});

app.get('/admin_usuarios.html', authRequired, adminRequired, (req,res)=>{
  res.sendFile(path.join(__dirname,'public','admin_usuarios.html'));
});

// Depois deste bloco, mantenha:
// app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));


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