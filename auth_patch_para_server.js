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
