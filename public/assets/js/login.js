const $ = id => document.getElementById(id);
let activeSession = null;

function nextUrl(){
  const next = new URLSearchParams(location.search).get('next') || '/sala.html';
  if(!next.startsWith('/')) return '/sala.html';
  const clean = next.split('?')[0];
  if(clean === '/' || clean === '/index.html' || clean === '/index_graf.html' || clean === '/index_graf_v6.html') return '/sala.html';
  return next;
}

function initials(name){
  const clean = String(name || '').trim();
  if(!clean) return '--';
  return clean.split(/\s+/).slice(0,2).map(p => p[0]).join('').toUpperCase();
}

function roleLabel(user){
  if(!user) return '';
  if(user.admin_plus) return 'admin+';
  return String(user.role || '');
}

async function checkSession(){
  const params = new URLSearchParams(location.search);
  if(params.get('logout') === '1'){
    $('status').textContent = 'Voce saiu com seguranca.';
    return;
  }
  try{
    const r = await fetch('/api/me', {cache:'no-store'});
    if(!r.ok) return;
    const data = await r.json();
    if(!data.ok || !data.user) return;
    activeSession = data.user;
    $('sessionBox').classList.add('show');
    $('sessionAvatar').textContent = initials(activeSession.username);
    $('sessionName').textContent = activeSession.username;
    $('sessionRole').textContent = 'Sessao ativa - '+roleLabel(activeSession);
    $('status').textContent = 'Ja existe uma sessao ativa neste navegador.';
  }catch(e){}
}

async function login(){
  const username = $('username').value.trim();
  const password = $('password').value;
  const st = $('status');
  st.className = 'status';
  st.textContent = 'Entrando...';
  $('btnLogin').disabled = true;

  try{
    const r = await fetch('/api/login',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username,password})
    });
    const data = await r.json();
    if(!r.ok || !data.ok) throw new Error(data.error || 'Falha no login');

    location.href = nextUrl();
  }catch(e){
    $('btnLogin').disabled = false;
    st.className = 'status err';
    st.textContent = e.message;
  }
}

$('btnLogin').onclick = login;
$('btnContinue').onclick = ()=>{
  location.href = nextUrl();
};
$('btnLogout').onclick = async ()=>{
  $('btnLogout').disabled = true;
  $('btnLogout').textContent = 'Saindo...';
  await fetch('/api/logout',{method:'POST'});
  activeSession = null;
  $('sessionBox').classList.remove('show');
  $('status').textContent = 'Sessao encerrada. Entre com outro usuario.';
  $('username').focus();
};
$('password').addEventListener('keydown', e => { if(e.key === 'Enter') login(); });
$('username').addEventListener('keydown', e => { if(e.key === 'Enter') $('password').focus(); });
checkSession();
