const $ = id => document.getElementById(id);
let me = null;

function todayISO(offset=0){
  const d = new Date();
  d.setDate(d.getDate()+offset);
  const tz = d.getTimezoneOffset()*60000;
  return new Date(d-tz).toISOString().slice(0,10);
}

function brDate(iso){
  if(!iso)return '--';
  const p=iso.split('-');
  return p[2]+'/'+p[1]+'/'+p[0];
}

function status(msg, cls=''){
  $('status').className='status '+cls;
  $('status').textContent=msg;
}

function greeting(){
  const hour = new Date().getHours();
  if(hour < 12) return 'Bom dia';
  if(hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

function isAdmin(user){
  return !!user && (user.role === 'admin' || user.admin_plus);
}

function initials(name){
  const clean = String(name || '').trim();
  if(!clean) return '--';
  return clean.split(/\s+/).slice(0,2).map(p => p[0]).join('').toUpperCase();
}

function setUserMenu(user){
  $('userAvatar').textContent = initials(user.username);
  $('userName').textContent = user.username || 'Conta';
  $('menuUserName').textContent = user.username || 'Conta';
  $('menuUserRole').textContent = roleLabel(user);
}

async function api(url,opt={}){
  const r = await fetch(url,{headers:{'Content-Type':'application/json'},cache:'no-store',...opt});
  const data = await r.json().catch(()=>({}));
  if(!r.ok || data.ok===false) throw new Error(data.error || ('HTTP '+r.status));
  return data;
}

function cardHospital(h){
  const edit = Number(h.pode_editar) === 1;
  const papel = h.papel_dia || 'visualizacao';
  const data = $('dataSala').value;
  const empresa = h.empresas || 'sem empresa';
  return `
    <div class="card">
      <h2>${escapeHtml(h.nome)}</h2>
      <div class="meta">${escapeHtml(empresa)}</div>
      <div class="meta">${escapeHtml(h.tipo || 'hospital')} - ${escapeHtml(brDate(data))}</div>
      <div>
        <span class="pill ${edit ? 'edit' : 'view'}">${edit ? 'pode editar' : 'somente leitura'}</span>
        <span class="pill ${papel === 'visualizacao' ? 'warn' : ''}">${escapeHtml(papel)}</span>
      </div>
      <a class="btn" href="/index_graf.html?hospital_id=${encodeURIComponent(h.id)}&data=${encodeURIComponent(data)}">Abrir painel</a>
    </div>
  `;
}

function cardHospitalReception(h){
  const edit = Number(h.pode_editar) === 1;
  const allowed = Number(h.pode_ver) === 1;
  const papel = h.papel_dia || 'visualizacao';
  const data = $('dataSala').value;
  const empresa = h.empresas || 'sem empresa';
  return `
    <div class="card">
      <div class="cardTop">
        <div>
          <h2>${escapeHtml(h.nome)}</h2>
          <div class="meta">${escapeHtml(empresa)}</div>
        </div>
        <div class="hospitalIcon">CC</div>
      </div>
      <div class="meta">${escapeHtml(h.tipo || 'hospital')} / ${escapeHtml(brDate(data))}</div>
      <div>
        <span class="pill ${allowed ? (edit ? 'edit' : 'view') : 'lock'}">${allowed ? (edit ? 'pode editar' : 'somente leitura') : 'nao escalado'}</span>
        <span class="pill ${papel === 'visualizacao' ? 'warn' : ''}">${escapeHtml(papel)}</span>
      </div>
      <a class="btn cardAction ${allowed ? '' : 'light'}" href="${allowed ? ('/index_graf.html?hospital_id='+encodeURIComponent(h.id)+'&data='+encodeURIComponent(data)) : ('/sem_escala.html?hospital='+encodeURIComponent(h.nome)+'&data='+encodeURIComponent(data))}">${allowed ? (edit ? 'Abrir e editar mapa' : 'Abrir mapa') : 'Ver orientacao'}</a>
    </div>
  `;
}

function updateReception({user, hospitais, empresas}){
  const role = roleLabel(user);
  $('receptionTitle').textContent = greeting()+', '+(user.username || 'bem-vindo')+'.';
  $('receptionEyebrow').textContent = role === 'admin+' || role === 'admin' ? 'Recepcao administrativa' : 'Recepcao operacional';
  $('receptionCopy').textContent = roleDescription(user);
  $('statHospitais').textContent = hospitais.length;
  $('statEmpresas').textContent = empresas.length || '-';
  $('statEditaveis').textContent = hospitais.filter(h => Number(h.pode_editar) === 1).length;
  const steps = role === 'admin' || role === 'admin+'
    ? [
      ['1','Revise empresas','Mantenha empresas, hospitais e salas organizados antes do plantao.'],
      ['2','Ajuste usuarios','Vincule anestesistas, coordenadores e escaladores aos acessos corretos.'],
      ['3','Abra um mapa','Entre em um hospital para acompanhar a operacao.']
    ]
    : role === 'escalador'
      ? [
        ['1','Escolha a empresa','Use o filtro para focar nos hospitais da empresa.'],
        ['2','Confira amanha','Seu acesso de edicao fica voltado ao dia seguinte.'],
        ['3','Monte a escala','Abra o mapa para preparar salas e equipes.']
      ]
      : [
        ['1','Confirme a data','A lista mostra apenas o que esta liberado para o plantao.'],
        ['2','Escolha o hospital','Entre no mapa do hospital em que esta atuando.'],
        ['3','Acompanhe o fluxo','Visualize o andamento e edite quando seu perfil permitir.']
      ];
  $('stepList').innerHTML = steps.map(s => '<div class="step"><span class="stepNumber">'+s[0]+'</span><div><strong>'+escapeHtml(s[1])+'</strong><span>'+escapeHtml(s[2])+'</span></div></div>').join('');
}

async function load(){
  const btn = $('btnAtualizar');
  const previousLabel = btn ? btn.textContent : '';
  if(btn){
    btn.disabled = true;
    btn.textContent = 'Atualizando...';
  }
  try{
    const data = $('dataSala').value || todayISO();
    let resp = await api('/api/me?data='+encodeURIComponent(data)+'&recepcao=1');
    if(resp.user && resp.user.role === 'escalador' && !params.get('data') && data === todayISO()){
      $('dataSala').value = todayISO(1);
      resp = await api('/api/me?data='+encodeURIComponent($('dataSala').value)+'&recepcao=1');
    }
    me = resp.user;
    const admin = isAdmin(me);
    setUserMenu(me);
    $('welcome').textContent = 'Logado como '+me.username+' - '+roleDescription(me);
    $('adminLink').style.display = admin ? 'inline-flex' : 'none';
    $('clinicasLink').style.display = admin ? 'inline-flex' : 'none';
    $('adminPanel').classList.toggle('show', admin);
    const empresas = resp.empresas || [];
    const currentEmpresa = $('empresaSala').value;
    $('empresaSala').innerHTML = '<option value="">Todas</option>' + empresas.map(e => '<option value="'+escapeHtml(e.id)+'">'+escapeHtml(e.nome)+'</option>').join('');
    if(currentEmpresa) $('empresaSala').value = currentEmpresa;
    const selectedEmpresa = Number($('empresaSala').value || 0);
    const hospitais = (resp.hospitais || []).filter(h => {
      if(!selectedEmpresa) return true;
      return String(h.empresa_ids || '').split(',').map(Number).includes(selectedEmpresa);
    });
    updateReception({user:me, hospitais, empresas});
    $('hospitais').innerHTML = hospitais.length
      ? hospitais.map(cardHospitalReception).join('')
      : '<div class="empty">Nenhum hospital disponivel para esta data.</div>';
    status(hospitais.length+' hospital(is) disponivel(is) em '+brDate(data)+'.','');
  }catch(e){
    status(e.message,'err');
    if(String(e.message).toLowerCase().includes('autenticado')) location.href='/login.html?next=/sala.html';
  }finally{
    if(btn){
      btn.disabled = false;
      btn.textContent = previousLabel || 'Atualizar acessos';
    }
  }
}

function escapeHtml(value){
  return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;");
}

function roleLabel(user){
  return user && (user.admin_plus || String(user.username || '').trim().toLowerCase() === 'godofredo') ? 'admin+' : String((user && user.role) || '');
}

function roleDescription(user){
  const role = roleLabel(user);
  if(role === 'admin' || role === 'admin+') return 'perfil admin: empresas, usuarios, hospitais e mapas liberados';
  if(role === 'coordenador') return 'perfil coordenador: hospital em que estiver de plantao no dia';
  if(role === 'escalador') return 'perfil escalador: hospitais das empresas vinculadas, com edicao do dia seguinte';
  return 'perfil plantonista: empresa/hospital liberado no plantao do dia';
}

const params = new URLSearchParams(location.search);
$('dataSala').value = params.get('data') || todayISO();
$('btnAtualizar').onclick = load;
$('dataSala').onchange = load;
$('empresaSala').onchange = load;
$('btnHoje').onclick = ()=>{
  $('dataSala').value = todayISO();
  load();
};
$('btnAmanha').onclick = ()=>{
  $('dataSala').value = todayISO(1);
  load();
};
$('userMenuButton').onclick = ()=>{
  const panel = $('userMenuPanel');
  const open = !panel.classList.contains('open');
  panel.classList.toggle('open', open);
  $('userMenuButton').setAttribute('aria-expanded', open ? 'true' : 'false');
};
$('btnMinhaSala').onclick = ()=>{
  $('userMenuPanel').classList.remove('open');
  $('userMenuButton').setAttribute('aria-expanded','false');
  $('dataSala').focus();
};
$('btnLogout').onclick = async ()=>{
  $('btnLogout').textContent = 'Saindo...';
  $('btnLogout').disabled = true;
  await fetch('/api/logout',{method:'POST'});
  location.href='/login.html?logout=1';
};
document.addEventListener('click', e=>{
  if(!e.target.closest('.userMenu')){
    $('userMenuPanel').classList.remove('open');
    $('userMenuButton').setAttribute('aria-expanded','false');
  }
});
load();
