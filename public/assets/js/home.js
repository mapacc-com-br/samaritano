(async function(){
  const status = document.getElementById('status');
  try{
    const r = await fetch('/api/me', {cache:'no-store'});
    if(r.status === 401){
      location.replace('/login.html?next=/sala.html');
      return;
    }
    if(!r.ok) throw new Error('Falha ao verificar login');
    status.textContent = 'Login confirmado. Abrindo sala...';
    location.replace('/sala.html');
  }catch(e){
    location.replace('/login.html?next=/sala.html');
  }
})();
