const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const token = params.get('token') || '';
if(token){
  $('requestBox').classList.add('hidden');
  $('resetBox').classList.remove('hidden');
  $('status').textContent = 'Link validado no navegador. Informe a nova senha.';
}

async function api(url, body){
  const r = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});
  const data = await r.json().catch(()=>({}));
  if(!r.ok || data.ok===false) throw new Error(data.error || 'Erro de API');
  return data;
}

$('btnRequest').onclick = async ()=>{
  const st = $('status');
  try{
    $('btnRequest').disabled = true;
    $('btnRequest').textContent = 'Enviando...';
    const data = await api('/api/password-reset/request',{identificador:$('identificador').value.trim()});
    st.className = 'status ok';
    st.textContent = data.message || 'Se existir e-mail cadastrado, enviaremos um link.';
  }catch(e){
    st.className = 'status err';
    st.textContent = e.message;
  }finally{
    $('btnRequest').disabled = false;
    $('btnRequest').textContent = 'Enviar link';
  }
};

$('btnReset').onclick = async ()=>{
  const st = $('status');
  const password = $('newPassword').value;
  if(password !== $('confirmPassword').value){
    st.className = 'status err';
    st.textContent = 'As senhas nao conferem.';
    return;
  }
  try{
    $('btnReset').disabled = true;
    $('btnReset').textContent = 'Salvando...';
    const data = await api('/api/password-reset/confirm',{token,password});
    st.className = 'status ok';
    st.textContent = data.message || 'Senha redefinida.';
    setTimeout(()=>{ location.href='/login.html'; }, 1200);
  }catch(e){
    st.className = 'status err';
    st.textContent = e.message;
    $('btnReset').disabled = false;
    $('btnReset').textContent = 'Salvar nova senha';
  }
};

$('identificador').addEventListener('keydown', e => { if(e.key === 'Enter') $('btnRequest').click(); });
$('confirmPassword').addEventListener('keydown', e => { if(e.key === 'Enter') $('btnReset').click(); });
