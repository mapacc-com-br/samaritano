(function(){
'use strict';

var rooms=[];
var startHour=5,endHour=31,hourW=64,labelW=132,rowH=66;
var currentDate="";
var currentHospitalId=null;
var currentHospital=null;
var currentUser=null;
var currentAccess={pode_editar:true,papel_dia:'admin'};
var usersForAccess=[];
var registeredUsers=[];
var dailyAccess=[];
var items=[];
var anesthetists=[];
var selectedId=null;
var parsedImport=[];
var parsedAnesImport=[];
var savingImport=false;
var timelineMin=null;
var timelineCustom=false;
var mapExpanded=false;
var collapsedRoomGroups={};
var pastePhotoBusy=false;
var PROCEDURE_SUGGESTIONS=[
  "Colecistectomia videolaparoscopica","Herniorrafia inguinal","Herniorrafia umbilical","Apendicectomia videolaparoscopica","Gastrectomia","Colectomia","Retossigmoidectomia","Hemorroidectomia","Fistulectomia anal","Colonoscopia","Endoscopia digestiva alta",
  "Artroscopia de joelho","Artroplastia de quadril","Artroplastia de joelho","Reconstrucao de LCA","Tenorrafia","Reducao de fratura","Osteossintese",
  "Mamoplastia redutora","Mastopexia","Abdominoplastia","Lipoaspiracao","Rinoplastia","Blefaroplastia",
  "Histerectomia","Ooforectomia","Laqueadura tubaria","Miomectomia","Resseccao de endometriose",
  "Prostatectomia","RTU de prostata","Ureterolitotripsia","Nefrectomia","Varicocelectomia",
  "Tireoidectomia","Parotidectomia","Septoplastia","Amigdalectomia","Timpanoplastia",
  "Craniotomia","Artrodese de coluna","Microdiscectomia","Laminectomia","Angioplastia","Arteriografia","Embolizacao"
];
var ANESTHETIST_SEEDS=["Romulo","Romulo"];

function $(id){return document.getElementById(id)}
function todayISO(){var d=new Date();var off=d.getTimezoneOffset()*60000;return new Date(d-off).toISOString().slice(0,10)}
function brDate(iso){if(!iso)return"--";var p=iso.split("-");return p[2]+"/"+p[1]+"/"+p[0]}
function parseTime(t){
  if(!t)return null;
  var s=String(t).trim();
  var m=s.match(/(\d{1,2})[:hH]?(\d{2})?/);
  if(!m)return null;
  var h=Number(m[1]), mi=Number(m[2]||0);
  if(!Number.isFinite(h)||!Number.isFinite(mi))return null;
  var total=h*60+mi;
  // v6: horarios entre 00:00 e 04:59 pertencem ao fim do plantao, no dia seguinte.
  if(endHour>24 && h<startHour)total+=24*60;
  return total;
}
function fmtTime(min){
  min=Math.round(Number(min)||0);
  var h=Math.floor(min/60),m=min%60;
  h=((h%24)+24)%24;
  return String(h).padStart(2,"0")+":"+String(m).padStart(2,"0");
}
function parseDur(d){if(!d)return 60;var s=String(d).trim().toLowerCase().replace(/\s+/g,"");if(s.includes(":")){var p=s.split(":");return Number(p[0])*60+Number(p[1]||0)}var hm=s.match(/^(\d+)(?:h|hora|horas)(\d+)?(?:m|min)?$/);if(hm)return Number(hm[1])*60+Number(hm[2]||0);var mm=s.match(/^(\d+)(?:m|min|minuto|minutos)$/);if(mm)return Number(mm[1]);var n=Number(s.replace(",","."));if(!Number.isFinite(n))return 60;if(n>0&&n<12)return Math.round(n*60);return Math.round(n)}
function durToText(v){var n=parseDur(v);var h=Math.floor(n/60),m=n%60;return String(h).padStart(2,"0")+":"+String(m).padStart(2,"0")}
function normRoomText(value){
  return String(value||"")
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase()
    .replace(/\b0+(\d+)\b/g,"$1")
    .replace(/\s+/g," ")
    .trim();
}
function roomNumber(value){
  var m=normRoomText(value).match(/\d+/);
  return m?Number(m[0]):null;
}
function roomNameToIndex(name){
  var raw=String(name||"").trim();
  var key=normRoomText(raw);
  if(!key||key.includes("nao escalad")||key.includes("sem sala"))return 0;

  var exact=rooms.findIndex(function(r){return normRoomText(r.name)===key});
  if(exact>=0)return exact;

  if(key.includes("hemo")||key.includes("radio")){
    var hemo=rooms.findIndex(function(r){return normRoomText(r.type)==="hemo"||normRoomText(r.name).includes("hemo")});
    return hemo>=0?hemo:0;
  }

  if(key.includes("cdi")){
    var cdi=rooms.findIndex(function(r){return normRoomText(r.type)==="cdi"||normRoomText(r.name).includes("cdi")});
    return cdi>=0?cdi:0;
  }

  var n=roomNumber(key);
  if(n!==null){
    var sameNumber=rooms.findIndex(function(r){
      if(normRoomText(r.type)==="virtual")return false;
      return roomNumber(r.name)===n;
    });
    if(sameNumber>=0)return sameNumber;
  }

  var partial=rooms.findIndex(function(r){
    var rk=normRoomText(r.name);
    return rk && (rk.includes(key)||key.includes(rk));
  });
  return partial>=0?partial:0;
}
function canonicalRoomName(name){
  var idx=roomNameToIndex(name);
  return rooms[idx]?rooms[idx].name:(rooms[0]?rooms[0].name:"Nao escaladas");
}
function isUnscheduledRoomName(name){return roomNameToIndex(name)===0}
function html(s){return String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}
function roomGroupLabel(room,idx){
  var type=normRoomText(room && room.type);
  var name=normRoomText(room && room.name);
  var explicit=String((room && (room.group || room.bloco || room.setor)) || '').trim();
  if(idx===0 || type==='virtual' || name.includes('nao escalad') || name.includes('sem sala'))return 'Sem sala';
  if(explicit)return explicit;
  if(type.includes('oeste') || name.includes('oeste'))return 'Oeste';
  if(type.includes('lane') || name.includes('lane'))return 'Lane';
  if(type.includes('hemo') || name.includes('hemo'))return 'Hemodinamica';
  if(type.includes('cdi') || name.includes('cdi'))return 'CDI';
  return 'Outras salas';
}
function roomGroupKey(label){return normRoomText(label).replace(/[^a-z0-9]+/g,'_') || 'grupo'}
function collapsedRoomStorageKey(){
  return 'ccsama_collapsed_room_groups_'+(currentHospitalId||'default');
}
function loadCollapsedRoomGroups(){
  try{collapsedRoomGroups=JSON.parse(localStorage.getItem(collapsedRoomStorageKey())||'{}')||{}}
  catch(e){collapsedRoomGroups={}}
}
function saveCollapsedRoomGroups(){
  try{localStorage.setItem(collapsedRoomStorageKey(),JSON.stringify(collapsedRoomGroups))}catch(e){}
}
function roomGroups(){
  var map={};
  rooms.forEach(function(room,idx){
    var label=roomGroupLabel(room,idx);
    var key=roomGroupKey(label);
    if(!map[key])map[key]={key:key,label:label,indices:[],type:room.type||'sala'};
    map[key].indices.push(idx);
    if(!map[key].type || map[key].type==='sala')map[key].type=room.type||map[key].type;
  });
  return Object.keys(map).map(function(k){return map[k]});
}
function isGroupCollapsible(group){
  return group && group.label !== 'Sem sala' && group.indices.length > 0;
}
function isGroupCollapsed(group){
  return !!(group && collapsedRoomGroups[group.key]);
}
function toggleRoomGroup(key){
  var group=roomGroups().find(function(g){return g.key===key});
  if(!group || !isGroupCollapsible(group))return;
  collapsedRoomGroups[key]=!collapsedRoomGroups[key];
  saveCollapsedRoomGroups();
  renderMap();
  renderSectorControls();
}
function renderSectorControls(){
  var box=$('mapSectorControls');
  if(!box)return;
  var groups=roomGroups().filter(isGroupCollapsible);
  if(!groups.length){box.innerHTML='';return}
  box.innerHTML='<div class="sectorLabel">Setores</div>'+groups.map(function(g){
    var active=isGroupCollapsed(g);
    var activeItems=items.filter(function(it){return !isFinished(it) && g.indices.includes(it.row)});
    var conflicts=activeItems.filter(function(it){return conflictsForItem(it,items).length}).length;
    var pending=activeItems.filter(isUnassignedSma).length;
    var text=(active?'+ ':'- ')+g.label+' | '+activeItems.length;
    if(pending)text+=' | '+pending+' pend.';
    if(conflicts)text+=' | '+conflicts+' conf.';
    return '<button type="button" class="light sectorToggle '+(active?'collapsed':'')+'" data-sector="'+html(g.key)+'" title="'+html(active?'Expandir '+g.label:'Recolher '+g.label)+'">'+html(text)+'</button>';
  }).join('');
  box.querySelectorAll('[data-sector]').forEach(function(btn){
    btn.onclick=function(){toggleRoomGroup(btn.dataset.sector)};
  });
}
function roleLabel(user){return user && (user.admin_plus || String(user.username || '').trim().toLowerCase() === 'godofredo') ? 'admin+' : String((user && user.role) || '')}
function initials(name){var clean=String(name||'').trim();return clean?clean.split(/\s+/).slice(0,2).map(function(p){return p[0]}).join('').toUpperCase():'--'}
function renderSession(user){
  if(!$('sessionAvatar'))return;
  $('sessionAvatar').textContent=initials(user&&user.username);
  $('sessionName').textContent=(user&&user.username)||'Conta';
  $('sessionRole').textContent=roleLabel(user);
}
function uniq(arr){return Array.from(new Set(arr.map(function(x){return String(x||'').trim()}).filter(Boolean))).sort(function(a,b){return a.localeCompare(b,'pt-BR')})}
function getStoredList(key){try{return JSON.parse(localStorage.getItem(key)||'[]')}catch(e){return []}}
function storeValue(key,val){val=String(val||'').trim();if(!val)return;var list=uniq(getStoredList(key).concat([val]));try{localStorage.setItem(key,JSON.stringify(list.slice(0,200)))}catch(e){}}
function allProcedureSuggestions(){return uniq(PROCEDURE_SUGGESTIONS.concat(getStoredList('ccsama_procedures')).concat(items.map(function(i){return i.name}))) }
function userScaleName(u){return String((u&&u.nome_escala)||'').trim() || String((u&&u.username)||'').trim()}
function allAnesthetistSuggestions(){return uniq(ANESTHETIST_SEEDS.concat(getStoredList('ccsama_anesthetists')).concat(registeredUsers.map(userScaleName)).concat(anesthetists.map(function(a){return a.name}))) }
function datalistHtml(id,values){return '<datalist id="'+id+'">'+values.map(function(v){return '<option value="'+html(v)+'"></option>'}).join('')+'</datalist>'}
function refreshAnesDatalist(){var dl=$('anesNameOptions');if(dl)dl.innerHTML=allAnesthetistSuggestions().map(function(v){return '<option value="'+html(v)+'"></option>'}).join('')}
function findRegisteredUserByName(name){
  var key=String(name||'').trim().toLowerCase();
  if(!key)return null;
  return registeredUsers.find(function(u){
    return String(userScaleName(u)).trim().toLowerCase()===key || String(u.username||'').trim().toLowerCase()===key;
  }) || null;
}
function status(msg,cls){$('status').textContent=msg;$('status').className="status "+(cls||"")}
function selectedItem(){return items.find(x=>x.id===selectedId)}
function canEdit(){
  if(currentUser && (currentUser.role === 'admin' || currentUser.admin_plus))return true;
  if(!currentAccess)return false;
  return currentAccess.pode_editar === true || currentAccess.pode_editar === 1 || currentAccess.pode_editar === '1';
}
function canManageAccess(){return currentUser && (currentUser.role==='admin' || currentUser.admin_plus || currentUser.role==='escalador')}
function requireEdit(){
  if(canEdit())return true;
  status('Este hospital esta em modo somente leitura para voce nesta data.','warn');
  return false;
}
function setDisabled(id,disabled){var el=$(id);if(el)el.disabled=disabled}
function applyAccessMode(){
  var readonly=!canEdit();
  ['btnSaveImported','btnAddSurgeryImport','btnAddSurgery','btnAddSurgery2','btnAddAnes','btnSaveImportedAnes','btnParse','btnParseAnes','btnAutoSuggest','btnAutoSuggest2','btnPhotoImport','btnSavePhotoPrompt'].forEach(function(id){setDisabled(id,readonly)});
  var accessCard=$('accessCard');
  if(accessCard)accessCard.style.display=canManageAccess()?'block':'none';
  if(readonly){
    status((currentHospital?currentHospital.nome+' | ':'')+'Somente leitura em '+brDate(currentDate)+'.','warn');
  }
}
function nowPlantaoMin(){
  var d=new Date();
  var min=d.getHours()*60+d.getMinutes();
  if(endHour>24 && d.getHours()<startHour)min+=24*60;
  return Math.max(startHour*60,Math.min(endHour*60,min));
}
function getTimelineMin(){return timelineMin==null?nowPlantaoMin():timelineMin}
function minToX(min){return labelW+((min-startHour*60)/60)*hourW}
function clearTextSelection(){
  try{
    var sel=window.getSelection&&window.getSelection();
    if(sel)sel.removeAllRanges();
  }catch(e){}
}
function beginMapInteraction(){
  document.body.classList.add('mapInteracting');
  clearTextSelection();
}
function endMapInteraction(){
  document.body.classList.remove('mapInteracting');
  clearTextSelection();
}
function updateStickyRulerTop(){
  var h=document.querySelector('header');
  var px=h?Math.ceil(h.getBoundingClientRect().height)+6:132;
  document.documentElement.style.setProperty('--mapRulerTop',px+'px');
}
function setMapExpanded(expanded){
  mapExpanded=!!expanded;
  var tab=$('tab-mapa');
  var btn=$('btnExpandMap');
  document.body.classList.toggle('mapExpanded',mapExpanded);
  if(tab)tab.classList.toggle('mapExpandedView',mapExpanded);
  if(btn){
    btn.textContent=mapExpanded?'Recolher':'Expandir';
    btn.classList.toggle('active',mapExpanded);
  }
  renderMap();
  renderSectorControls();
  setTimeout(function(){
    updateStickyRulerTop();
    setupMapScrollSync(labelW+(endHour-startHour)*hourW);
  },0);
}

async function api(url,opt){
  if(currentHospitalId && /^\/api\/(dia|cirurgias|anestesistas)(\/|\?|$)/.test(url)){
    url += (url.includes('?') ? '&' : '?') + 'hospital_id=' + encodeURIComponent(currentHospitalId);
  }
  var r=await fetch(url,Object.assign({headers:{"Content-Type":"application/json"},cache:"no-store"},opt||{}));
  var text=await r.text(); var data={};
  try{data=text?JSON.parse(text):{}}catch(e){throw new Error("Resposta nao JSON: "+text.slice(0,150))}
  if(!r.ok)throw new Error(data.error||("Erro HTTP "+r.status));
  return data;
}

function setPhotoStatus(msg,cls){
  var el=$('photoImportStatus');
  if(el)el.textContent=msg||'';
  if(msg)status(msg,cls||'warn');
}
function readFileAsDataUrl(file){
  return new Promise(function(resolve,reject){
    var reader=new FileReader();
    reader.onload=function(){resolve(String(reader.result||''))};
    reader.onerror=function(){reject(new Error('Nao consegui ler a imagem.'))};
    reader.readAsDataURL(file);
  });
}
function loadImage(dataUrl){
  return new Promise(function(resolve,reject){
    var img=new Image();
    img.onload=function(){resolve(img)};
    img.onerror=function(){reject(new Error('Nao consegui abrir a imagem.'))};
    img.src=dataUrl;
  });
}
async function preparePhotoDataUrl(file){
  var original=await readFileAsDataUrl(file);
  try{
    var img=await loadImage(original);
    var maxSide=1800;
    var scale=Math.min(1,maxSide/Math.max(img.width,img.height));
    var canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(img.width*scale));
    canvas.height=Math.max(1,Math.round(img.height*scale));
    canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
    return canvas.toDataURL('image/jpeg',0.9);
  }catch(e){
    return original;
  }
}
function showPhotoPreview(dataUrl){
  var img=$('photoImportPreview');
  if(!img)return;
  img.src=dataUrl;
  img.classList.remove('hidden');
}
function imageFileFromPasteEvent(ev){
  var items=(ev.clipboardData && ev.clipboardData.items) ? Array.from(ev.clipboardData.items) : [];
  for(var i=0;i<items.length;i++){
    if(items[i].kind==='file'){
      var file=items[i].getAsFile();
      if(file && String(file.type||'').toLowerCase().startsWith('image/'))return file;
    }
  }
  var files=(ev.clipboardData && ev.clipboardData.files) ? Array.from(ev.clipboardData.files) : [];
  return files.find(function(file){return String(file.type||'').toLowerCase().startsWith('image/')}) || null;
}
async function handlePhotoPasteEvent(ev){
  var importar=$('tab-importar');
  if(!importar || importar.classList.contains('hidden'))return;
  var file=imageFileFromPasteEvent(ev);
  if(!file)return;
  ev.preventDefault();
  if(pastePhotoBusy)return;
  pastePhotoBusy=true;
  try{await handlePhotoFile(file)}
  finally{pastePhotoBusy=false}
}
async function pastePhotoFromClipboard(){
  if(!requireEdit())return;
  if(!navigator.clipboard || !navigator.clipboard.read){
    setPhotoStatus('O navegador nao liberou leitura direta da area de transferencia. Cole a imagem enquanto estiver na aba Importar.','warn');
    return;
  }
  try{
    pastePhotoBusy=true;
    var clipboardItems=await navigator.clipboard.read();
    for(var i=0;i<clipboardItems.length;i++){
      var item=clipboardItems[i];
      var type=(item.types||[]).find(function(t){return String(t).toLowerCase().startsWith('image/')});
      if(type){
        var blob=await item.getType(type);
        var file=new File([blob],'imagem-colada.'+(type.split('/')[1]||'png'),{type:type});
        await handlePhotoFile(file);
        return;
      }
    }
    setPhotoStatus('Nao encontrei imagem na area de transferencia.','warn');
  }catch(e){
    setPhotoStatus('Nao consegui ler a imagem colada: '+e.message,'err');
  }finally{
    pastePhotoBusy=false;
  }
}
function importItemsToText(list){
  return (list||[]).map(function(c){
    return [c.horario_inicio||'',c.sala||'',c.nome_cirurgia||'',c.duracao||'',c.servico||'',c.iniciais_paciente||'',c.idade_paciente||0,c.observacao||''].join(' | ').replace(/\s+\|\s+$/,'');
  }).join('\n');
}
async function loadPhotoPrompt(){
  if(!currentHospitalId||!$('photoImportPrompt'))return;
  try{
    var cfg=await api('/api/hospitais/'+encodeURIComponent(currentHospitalId)+'/importacao-foto?data='+encodeURIComponent(currentDate));
    $('photoImportPrompt').value=cfg.prompt_importacao_foto||'';
    var info=$('photoImportStatus');
    if(info)info.textContent='IA de leitura: '+(cfg.model||'modelo configurado')+' | regras carregadas para '+(cfg.hospital_nome||'hospital')+'.';
  }catch(e){
    var info=$('photoImportStatus');
    if(info)info.textContent='Nao foi possivel carregar as regras de foto: '+e.message;
  }
}
async function savePhotoPrompt(){
  if(!requireEdit())return;
  try{
    await api('/api/hospitais/'+encodeURIComponent(currentHospitalId)+'/importacao-foto',{method:'PUT',body:JSON.stringify({prompt_importacao_foto:$('photoImportPrompt').value})});
    setPhotoStatus('Regras de leitura por foto salvas para este hospital.','ok');
  }catch(e){
    setPhotoStatus('Erro ao salvar regras: '+e.message,'err');
  }
}
async function handlePhotoFile(file){
  if(!file)return;
  if(!requireEdit())return;
  try{
    setPhotoStatus('Preparando a foto para leitura inteligente...','warn');
    var imageDataUrl=await preparePhotoDataUrl(file);
    showPhotoPreview(imageDataUrl);
    setPhotoStatus('Analisando foto com IA. Isso pode levar alguns segundos...','warn');
    var resp=await api('/api/importar-foto-cirurgias?hospital_id='+encodeURIComponent(currentHospitalId),{
      method:'POST',
      body:JSON.stringify({hospital_id:currentHospitalId,data_cirurgia:currentDate,image_data_url:imageDataUrl})
    });
    parsedImport=(resp.cirurgias||[]).map(function(c){
      return {
        data_cirurgia:currentDate,
        horario_inicio:c.horario_inicio||'',
        sala:canonicalRoomName(c.sala||'Nao escaladas'),
        nome_cirurgia:c.nome_cirurgia||'',
        duracao:durToText(c.duracao||'01:00'),
        servico:String(c.servico||'SMA').toLowerCase().includes('particular')?'Particular':'SMA',
        iniciais_paciente:String(c.iniciais_paciente||'NI').replace(/\W/g,'').toUpperCase()||'NI',
        idade_paciente:Number(c.idade_paciente||0),
        observacao:c.observacao||''
      };
    }).filter(function(c){return c.horario_inicio&&c.nome_cirurgia});
    $('surgeryText').value=importItemsToText(parsedImport);
    renderImportPreview();
    var avisos=(resp.avisos||[]).filter(Boolean);
    setPhotoStatus('Foto processada: '+parsedImport.length+' cirurgia(s).'+(avisos.length?'\nAvisos: '+avisos.slice(0,5).join(' | '):''),'ok');
  }catch(e){
    setPhotoStatus('Erro na leitura da foto: '+e.message,'err');
  }finally{
    if($('photoImportInput'))$('photoImportInput').value='';
  }
}

function initRooms(){
  rooms=[{name:"Nao escaladas",type:"virtual"}];
  for(var i=1;i<=10;i++)rooms.push({name:"Oeste "+i,type:"oeste",group:"Oeste"});
  for(var j=1;j<=10;j++)rooms.push({name:"Lane "+j,type:"lane",group:"Lane"});
  rooms.push({name:"CDI",type:"cdi",group:"CDI"});
  rooms.push({name:"HEMO",type:"hemo",group:"Hemodinamica"});
}


function initRoomsFromSalas(salas){
  var list=(salas||[]).filter(function(s){return s && s.ativa!==0}).sort(function(a,b){
    return Number(a.ordem||0)-Number(b.ordem||0) || String(a.nome||'').localeCompare(String(b.nome||''),'pt-BR');
  });
  if(!list.some(function(s){return String(s.tipo||'')==='virtual' || String(s.nome||'').toLowerCase().includes('escalad')})){
    rooms=[{name:"Nao escaladas",type:"virtual",group:"Sem sala"}];
  }else{
    rooms=[];
  }
  list.forEach(function(s){
    var tipo=String(s.tipo||'sala').toLowerCase();
    rooms.push({name:s.nome,type:tipo,group:String(s.bloco||s.setor||'').trim()});
  });
  if(!rooms.length)initRooms();
}

async function loadHospitals(){
  var me=await api('/api/me?data='+encodeURIComponent(currentDate));
  currentUser=me.user;
  renderSession(currentUser);
  var hospitais=me.hospitais||[];
  if(!hospitais.length)throw new Error('Nenhum hospital disponivel para este usuario.');
  var params=new URLSearchParams(location.search);
  var requested=Number(params.get('hospital_id')||0);
  var saved=Number(localStorage.getItem('ccsama_hospital_id')||0);
  currentHospital=hospitais.find(function(h){return Number(h.id)===requested}) || hospitais.find(function(h){return Number(h.id)===saved}) || hospitais[0];
  currentHospitalId=currentHospital.id;
  loadCollapsedRoomGroups();
  currentAccess={pode_editar:Number(currentHospital.pode_editar)===1,papel_dia:currentHospital.papel_dia||roleLabel(currentUser)};
  var sel=$('hospitalSelect');
  if(sel){
    sel.innerHTML=hospitais.map(function(h){
      var label=(h.empresas ? h.empresas+' / ' : '')+h.nome;
      return '<option value="'+html(h.id)+'">'+html(label)+'</option>';
    }).join('');
    sel.value=String(currentHospitalId);
    sel.disabled=hospitais.length<=1;
  }
  await loadRoomsForHospital();
  await loadPhotoPrompt();
  applyAccessMode();
}

async function loadRoomsForHospital(){
  if(!currentHospitalId){initRooms();return}
  var data=await api('/api/hospitais/'+encodeURIComponent(currentHospitalId)+'/salas?data='+encodeURIComponent(currentDate));
  initRoomsFromSalas(data.salas||[]);
}

function dbToItem(r){
  var start=parseTime(r.horario_inicio)||startHour*60;
  var dur=parseDur(r.duracao);
  var row=roomNameToIndex(r.sala);
  if(row<0)row=0;
  return {
    id:r.id,
    dbId:r.id,
    name:r.nome_cirurgia,
    start:start,
    end:start+dur,
    duration:dur,
    room:canonicalRoomName(r.sala),
    row:row,
    servico:r.servico||"SMA",
    anest:r.anestesista_escalado||"",
    initials:r.iniciais_paciente||"",
    age:r.idade_paciente ?? "",
    obs:r.observacao||"",
    finalizado: r.finalizada===1 || r.finalizada===true || r.finalizado===1 || r.finalizado===true || String(r.status||'').toLowerCase().includes('final'),
    preFeito: r.pre_feito===1 || r.pre_feito===true || r.preFeito===1 || r.preFeito===true || String(r.pre_feito||'')==='1',
    preFeitoPor: r.pre_feito_por || r.preFeitoPor || "",
    preFeitoUserId: r.pre_feito_user_id || r.preFeitoUserId || null,
    preFeitoEm: r.pre_feito_em || r.preFeitoEm || ""
  }
}

function itemToPayload(it){
  return {
    data_cirurgia:currentDate,
    horario_inicio:fmtTime(it.start),
    nome_cirurgia:it.name,
    duracao:durToText(it.duration||it.end-it.start),
    sala:it.room || (rooms[it.row]?rooms[it.row].name:"Nao escaladas"),
    servico:it.servico||"SMA",
    anestesista_escalado:(String(it.servico||'')==='Particular'?'':(it.anest||"")),
    iniciais_paciente:String(it.initials||"").toUpperCase(),
    idade_paciente:Number(it.age),
    finalizada:isFinished(it)?1:0,
    observacao:it.obs||"",
    pre_feito:isPreFeito(it)?1:0,
    pre_feito_por:it.preFeitoPor||"",
    pre_feito_user_id:it.preFeitoUserId||null,
    pre_feito_em:it.preFeitoEm||""
  }
}

async function loadDay(){
  var data=await api("/api/dia/"+encodeURIComponent(currentDate));
  currentAccess=data.acesso || currentAccess || {pode_editar:false,papel_dia:'visualizacao'};
  if(currentUser && (currentUser.role === 'admin' || currentUser.admin_plus))currentAccess={pode_editar:true,papel_dia:roleLabel(currentUser),origem:'frontend-admin'};
  items=(data.cirurgias||[]).map(dbToItem);
  anesthetists=(data.anestesistas||[]).map(function(a){return {
    id:a.id,
    user_id:a.user_id||null,
    username:a.username||"",
    name:a.nome_anestesista,
    shift:a.horario_escala||"",
    role:a.funcao||"",
    obs:a.observacao||""
  }});
  selectedId=null;
  await loadRegisteredUsers();
  renderAll();
  applyAccessMode();
  if(canManageAccess())await loadAccessManager();
  status((currentHospital ? currentHospital.nome + " | " : "") + "Data carregada: "+brDate(currentDate)+" | "+items.length+" cirurgia(s). | "+(canEdit()?'edicao liberada':'somente leitura'), canEdit()?"ok":"warn");
}

function renderStats(){
  var active=items.filter(function(it){return !isFinished(it)});
  var assigned=items.filter(isAssignedSma);
  var pending=items.filter(isUnassignedSma);
  var conflicts=items.filter(function(it){return conflictsForItem(it,items).length>0});
  var activeRooms=uniq(active.filter(function(it){return it.row>0}).map(function(it){return it.room})).length;
  $('statCases').textContent=items.length;
  $('statAssigned').textContent=assigned.length;
  $('statPending').textContent=pending.length;
  $('statConflicts').textContent=conflicts.length;
  $('statRooms').textContent=activeRooms;
  $('statAnes').textContent=anesthetists.length;
  renderOpsInsights(active,pending,conflicts,activeRooms);
}

function renderOpsInsights(active,pending,conflicts,activeRooms){
  var box=$('opsInsights'); if(!box)return;
  var now=getTimelineMin();
  var next=active.filter(function(it){return it.start>=now}).sort(function(a,b){return a.start-b.start || a.row-b.row}).slice(0,3);
  var noRoom=active.filter(function(it){return it.row===0}).length;
  var pulseCls=conflicts.length?'danger':(pending.length||noRoom?'warn':'ok');
  var pulseTitle=conflicts.length?'Revisar conflitos':(pending.length?'Escala incompleta':(noRoom?'Cirurgias sem sala':'Plantao controlado'));
  var pulseMeta=conflicts.length?conflicts.length+' cirurgia(s) em vermelho':(pending.length?pending.length+' cirurgia(s) aguardando anestesista':(noRoom?noRoom+' cirurgia(s) aguardando sala':activeRooms+' sala(s) em atividade'));
  var nextHtml=next.length?next.map(function(it){
    var status=conflictsForItem(it,items).length?'conflito':(isExternalCase(it)?'externo':(it.anest?'ok':'pendente'));
    return '<span class="nextCase '+status+'"><b>'+html(fmtTime(it.start))+'</b> '+html(it.room)+' | '+html(it.name)+'</span>';
  }).join(''):'<span class="nextCase muted">Sem proximas cirurgias no horizonte atual</span>';
  box.innerHTML=
    '<div class="opsPulse '+pulseCls+'"><b>'+html(pulseTitle)+'</b><span>'+html(pulseMeta)+'</span></div>'+
    '<div class="opsNext"><div class="opsLabel">Proximos movimentos</div>'+nextHtml+'</div>'+
    '<div class="opsMode"><span>'+html(currentHospital?currentHospital.nome:'Hospital')+'</span><b>'+html(canEdit()?'Edicao ativa':'Somente leitura')+'</b></div>';
}

function renderAll(){
  renderStats();
  renderSectorControls();
  renderMap();
  renderList();
  renderAnes();
  renderImportPreview();
  renderAnesImportPreview();
  refreshAnesDatalist();
}


function isFinished(it){
  return !!(it && (
    it.finished === true || it.finished === 1 ||
    it.finalizado === true || it.finalizado === 1 ||
    it.finalizada === true || it.finalizada === 1 ||
    String(it.status||'').toLowerCase().includes('final') ||
    String(it.obs||'').toUpperCase().includes('[FINALIZADA]')
  ));
}
function isPreFeito(it){
  return !!(it && (
    it.preFeito === true || it.preFeito === 1 ||
    it.pre_feito === true || it.pre_feito === 1 ||
    String(it.preFeito||'') === '1' ||
    String(it.pre_feito||'') === '1'
  ));
}
function userMatchesAnesthetistName(name){
  if(!currentUser || !name)return false;
  var target=normPerson(name);
  return [currentUser.nome_escala,currentUser.username].some(function(v){return normPerson(v)===target});
}
function canTogglePreFeito(it){
  if(canEdit())return true;
  return !!(currentUser && currentUser.role==='plantonista' && it && userMatchesAnesthetistName(it.anest));
}
function isExternalCase(it){
  var s=String(it && it.servico || '').toLowerCase();
  var a=String(it && it.anest || '').toLowerCase();
  return s.includes('particular') || s.includes('externo') || a.includes('particular') || a.includes('externo');
}
function isAssignedSma(it){
  return !!(it && it.anest && !isExternalCase(it) && !isFinished(it));
}
function normSmartText(v){
  return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();
}
function normPerson(v){return normSmartText(v)}
function samePerson(a,b){return normPerson(a) && normPerson(a)===normPerson(b)}
function anestByName(name){
  var key=normPerson(name);
  return anesthetists.find(function(a){return normPerson(a.name)===key}) || null;
}
function roleSmartText(an){return normSmartText((an&&an.role||'')+' '+(an&&an.obs||''))}
function hasSmartWord(text,word){return new RegExp('(^|\\s)'+word+'(\\s|$)').test(String(text||''))}
function isEscaladorAnesthetist(an){return /escal/.test(roleSmartText(an))}
function isCoordinatorAnesthetist(an){return /coord/.test(roleSmartText(an))}
function isPreAnesthetist(an){
  var role=roleSmartText(an);
  return hasSmartWord(role,'pre') || role.includes('pre anest') || role.includes('pre-anest') || role.includes('consulta pre') || role.includes('preop');
}
function isEdaAnesthetist(an){
  var role=roleSmartText(an);
  return hasSmartWord(role,'eda') || role.includes('endoscopia');
}
function isCdiAnesthetist(an){return hasSmartWord(roleSmartText(an),'cdi')}
function isCdiCase(it){return normSmartText(it&&it.room||'').includes('cdi')}
function caseInterval(it){return {start:Number(it&&it.start)||0,end:Number(it&&it.end)||0}}
function rangesOverlap(a,b){return a.start<b.end && b.start<a.end}
function shiftRangeFor(an){
  if(!an || !String(an.shift||'').trim())return null;
  var p=normalizeShift(an.shift).split('-');
  var start=parseTime(p[0]), end=parseTime(p[1]);
  if(start==null || end==null)return null;
  if(end<=start)end+=24*60;
  return {start:start,end:end};
}
function caseHasDefinedRoom(it){
  return !!(it && it.row>0 && !normSmartText(it.room).includes('nao escal'));
}
function isAssignableSma(it){
  return !!(it && !isFinished(it) && !isExternalCase(it));
}
function isUnassignedSma(it){
  return isAssignableSma(it) && !String(it.anest||'').trim();
}
function isEasyCase(it){
  var text=normSmartText((it&&it.name||'')+' '+(it&&it.room||'')+' '+(it&&it.obs||''));
  var dur=Number(it&&it.duration)||Math.max(0,Number(it&&it.end)-Number(it&&it.start));
  return dur<=75 || /endosc|colonosc|biops|cdi|exame|punc|pequeno|curativo/.test(text);
}
function isComplexCase(it){
  var text=normSmartText((it&&it.name||'')+' '+(it&&it.obs||''));
  var dur=Number(it&&it.duration)||Math.max(0,Number(it&&it.end)-Number(it&&it.start));
  return dur>=180 || /artrodese|craniot|gastrect|colect|prostatect|torac|cardiac|vascular|neuro|endometriose|hepatect|esofagect/.test(text);
}
function uniqueSmartMessages(list){
  var seen={}, out=[];
  list.forEach(function(msg){if(msg && !seen[msg]){seen[msg]=1;out.push(msg)}});
  return out;
}
function conflictsForAssignment(anName,it,scheduled){
  if(!it || !String(anName||'').trim() || isExternalCase(it) || isFinished(it))return [];
  var an=anestByName(anName);
  var list=[];
  var interval=caseInterval(it);
  if(!an){
    list.push('Anestesista "'+anName+'" nao esta na escala deste dia');
  }else{
    var shift=shiftRangeFor(an);
    if(!shift){
      list.push('Anestesista sem horario de escala cadastrado');
    }else if(interval.start<shift.start || interval.end>shift.end){
      list.push('Fora da escala de '+fmtTime(shift.start)+'-'+fmtTime(shift.end)+' para cirurgia '+fmtTime(interval.start)+'-'+fmtTime(interval.end));
    }
    if(isEdaAnesthetist(an)){
      list.push('Anestesista em EDA nao pode ser escalado para cirurgia');
    }
    if(isCdiAnesthetist(an) && !isCdiCase(it)){
      list.push('Anestesista do CDI deve ficar reservado para sala CDI');
    }
    if(isEscaladorAnesthetist(an) && !isEasyCase(it)){
      list.push('Escalador em sala somente para caso simples e sem alternativa');
    }
  }
  (scheduled||items).forEach(function(other){
    if(!other || other.id===it.id || !isAssignedSma(other))return;
    if(!samePerson(other.anest,anName))return;
    if(rangesOverlap(interval,caseInterval(other))){
      list.push('Sobreposicao com '+fmtTime(other.start)+'-'+fmtTime(other.end)+' em '+(other.room||'sala')+': '+(other.name||'cirurgia'));
    }
  });
  return uniqueSmartMessages(list);
}
function conflictsForItem(it,scheduled){
  if(!isAssignedSma(it))return [];
  return conflictsForAssignment(it.anest,it,scheduled||items);
}
function gapToOtherCases(anName,it,scheduled){
  var minGap=Infinity;
  (scheduled||items).forEach(function(other){
    if(!other || other.id===it.id || !isAssignedSma(other) || !samePerson(other.anest,anName))return;
    var a=caseInterval(it), b=caseInterval(other);
    if(rangesOverlap(a,b)){minGap=0;return}
    if(b.end<=a.start)minGap=Math.min(minGap,a.start-b.end);
    if(a.end<=b.start)minGap=Math.min(minGap,b.start-a.end);
  });
  return minGap;
}
function scoreCandidate(an,it,scheduled,allowEscalador){
  var name=String(an&&an.name||'').trim();
  if(!name)return {hard:true,score:-999,name:'',reasons:['sem nome']};
  var escalador=isEscaladorAnesthetist(an);
  if(escalador && (!allowEscalador || !isEasyCase(it))){
    return {hard:true,score:-999,name:name,reasons:['preservar escalador fora de sala']};
  }
  var conflicts=conflictsForAssignment(name,it,scheduled).filter(function(msg){
    return !(allowEscalador && escalador && msg.includes('Escalador em sala') && isEasyCase(it));
  });
  if(conflicts.length)return {hard:true,score:-999,name:name,reasons:conflicts};

  var score=100, reasons=[];
  var role=roleSmartText(an);
  var shift=shiftRangeFor(an);
  if(shift){
    var bufferBefore=Math.max(0,it.start-shift.start);
    var bufferAfter=Math.max(0,shift.end-it.end);
    score+=Math.min(10,Math.floor(Math.min(bufferBefore,bufferAfter)/30));
    if(bufferAfter<30){score-=8;reasons.push('termina perto do fim da escala')}
  }
  var gap=gapToOtherCases(name,it,scheduled);
  if(gap!==Infinity){
    if(gap<15){score-=20;reasons.push('intervalo muito curto')}
    else if(gap<30){score-=10;reasons.push('intervalo curto')}
    else if(gap<=60){score+=4;reasons.push('encaixe proximo')}
  }
  if(/sala/.test(role)){score+=12;reasons.push('cargo de sala')}
  if(/noturno/.test(role) && it.start>=19*60){score+=8;reasons.push('plantao noturno')}
  if(/estendido/.test(role) && it.end>19*60){score+=6;reasons.push('cobre horario estendido')}
  if(isPreAnesthetist(an)){score-=45;reasons.push('ultimo recurso: esta no Pre')}
  if(isCdiCase(it) && isCdiAnesthetist(an)){score+=35;reasons.push('reservado para CDI')}
  else if(isCdiCase(it)){score-=12;reasons.push('sala CDI sem reserva dedicada')}
  if(isCoordinatorAnesthetist(an)){score-=18;reasons.push('preserva coordenador')}
  if(escalador){score-=55;reasons.push('uso excepcional do escalador')}
  if(isComplexCase(it) && isCoordinatorAnesthetist(an)){score-=8}
  if(!reasons.length)reasons.push('sem conflito e dentro da escala');
  return {hard:false,name:name,score:Math.max(0,Math.round(score)),reasons:reasons.slice(0,3)};
}
function suggestionsForItem(it,scheduled,limit,allowEscalador){
  if(!it || isFinished(it) || isExternalCase(it))return [];
  return anesthetists.map(function(an){return scoreCandidate(an,it,scheduled||items,!!allowEscalador)})
    .filter(function(c){return !c.hard})
    .sort(function(a,b){return b.score-a.score || a.name.localeCompare(b.name,'pt-BR')})
    .slice(0,limit||5);
}
function analyzeSchedule(){
  var conflicts=[];
  items.forEach(function(it){
    var c=conflictsForItem(it,items);
    if(c.length)conflicts.push(fmtTime(it.start)+' '+it.name+': '+c.join(' | '));
  });
  var pending=items.filter(isUnassignedSma).length;
  var noRoom=items.filter(function(it){return isUnassignedSma(it) && !caseHasDefinedRoom(it)}).length;
  renderAll();
  var msg='Analise inteligente: '+conflicts.length+' conflito(s), '+pending+' cirurgia(s) sem anestesista';
  if(noRoom)msg+=' e '+noRoom+' sem sala definida';
  if(conflicts.length)msg+='\n'+conflicts.slice(0,6).join('\n');
  status(msg,conflicts.length?'warn':'ok');
}
async function persistAssignment(it,name){
  if(!it)return;
  if(name==='Particular'){it.anest='';it.servico='Particular'}
  else {it.anest=name;it.servico='SMA';storeValue('ccsama_anesthetists',name)}
  await api('/api/cirurgias/'+it.id,{method:'PUT',body:JSON.stringify(itemToPayload(it))});
}
async function applySmartSuggestions(){
  if(!requireEdit())return;
  if(!anesthetists.length){status('Cadastre ou importe a escala do dia antes de inserir sugestoes.','warn');return}
  var targets=items.filter(isUnassignedSma).sort(function(a,b){
    return (caseHasDefinedRoom(b)?1:0)-(caseHasDefinedRoom(a)?1:0) || a.start-b.start || b.duration-a.duration;
  });
  if(!targets.length){status('Nao ha cirurgias SMA pendentes para sugerir.','ok');return}
  if(!confirm('Inserir sugestoes em '+targets.length+' cirurgia(s) sem anestesista?'))return;
  status('Calculando melhores sugestoes...','warn');
  var scheduled=items.map(function(x){return Object.assign({},x)});
  var changed=[], skipped=[];
  targets.forEach(function(real){
    var ref=scheduled.find(function(x){return x.id===real.id});
    var sug=suggestionsForItem(ref,scheduled,1,false);
    if(!sug.length && isEasyCase(ref))sug=suggestionsForItem(ref,scheduled,1,true);
    if(sug.length){
      ref.anest=sug[0].name; ref.servico='SMA';
      real.anest=sug[0].name; real.servico='SMA';
      changed.push({it:real,candidate:sug[0]});
    }else{
      skipped.push(real);
    }
  });
  if(!changed.length){
    status('Nao encontrei sugestoes seguras para as cirurgias pendentes.','warn');
    return;
  }
  var ok=0, errors=[];
  for(var i=0;i<changed.length;i++){
    try{await saveItemToDb(changed[i].it);ok++;storeValue('ccsama_anesthetists',changed[i].candidate.name)}
    catch(err){errors.push(changed[i].it.name+': '+err.message)}
  }
  await loadDay();
  var msg='Sugestoes inseridas: '+ok+' cirurgia(s).';
  if(skipped.length)msg+=' Sem sugestao segura: '+skipped.length+'.';
  if(errors.length)msg+='\nErros: '+errors.slice(0,4).join('\n');
  status(msg,errors.length?'warn':'ok');
}
function getBlockClass(it,idx){
  var cls='';
  if(isAssignedSma(it)) cls+=' assigned';
  if(isExternalCase(it)) cls+=' ext';
  if(idx===0) cls+=' virtual';
  if(isFinished(it)) cls+=' finished';
  if(isPreFeito(it)) cls+=' preDone';
  if(conflictsForItem(it,items).length) cls+=' conflict';
  if(it.id===selectedId) cls+=' selected';
  return cls;
}
function calcVirtualLanes(list){
  var laneEnds=[], lanesById={};
  list.slice().sort(function(a,b){return a.start-b.start || a.end-b.end || a.id-b.id}).forEach(function(it){
    var lane=-1;
    for(var i=0;i<laneEnds.length;i++){
      if(it.start>=laneEnds[i]){lane=i;break}
    }
    if(lane<0){lane=laneEnds.length;laneEnds.push(it.end)}
    else laneEnds[lane]=Math.max(laneEnds[lane],it.end);
    lanesById[it.id]=lane;
  });
  return {count:Math.max(1,laneEnds.length),byId:lanesById};
}
async function saveItemToDb(it){
  if(!requireEdit())throw new Error('Somente leitura nesta data.');
  await api('/api/cirurgias/'+it.id,{method:'PUT',body:JSON.stringify(itemToPayload(it))});
}
function updateItemRoomAndTime(it,newRow,newStart){
  var duration=Math.max(15,it.end-it.start);
  newRow=Math.max(0,Math.min(rooms.length-1,newRow));
  newStart=Math.round(newStart/15)*15;
  newStart=Math.max(startHour*60,Math.min(endHour*60-duration,newStart));
  it.row=newRow;
  it.room=rooms[newRow]?rooms[newRow].name:'Nao escaladas';
  it.start=newStart;
  it.end=newStart+duration;
  it.duration=duration;
}

function renderMap(){
  var map=$('map'); if(!map)return;
  var totalHours=endHour-startHour;
  var totalW=labelW+totalHours*hourW;
  var compact=mapExpanded;
  var baseRowH=compact?48:rowH;
  var laneGap=compact?42:58;
  var blockTop=compact?7:9;
  var htmlMap='';
  var virtualItems=items.filter(function(it){return it.row===0 && !isFinished(it)});
  var virtualLane=calcVirtualLanes(virtualItems);
  var rowHeights=rooms.map(function(r,idx){return idx===0?Math.max(baseRowH,16+virtualLane.count*laneGap):baseRowH});
  var visibleRows=[];
  roomGroups().forEach(function(group){
    if(isGroupCollapsed(group)){
      visibleRows.push({kind:'group',group:group});
    }else{
      group.indices.forEach(function(idx){visibleRows.push({kind:'room',idx:idx,group:group})});
    }
  });

  htmlMap+='<div class="timeHeader" style="grid-template-columns:'+labelW+'px repeat('+totalHours+','+hourW+'px);width:'+totalW+'px">';
  htmlMap+='<div></div>';
  for(var h=startHour;h<endHour;h++)htmlMap+='<div class="timeCell">'+String(((h%24)+24)%24).padStart(2,'0')+'h</div>';
  htmlMap+='</div>';

  visibleRows.forEach(function(viewRow){
    if(viewRow.kind==='group'){
      var group=viewRow.group;
      var indices=group.indices||[];
      var groupItems=items.filter(function(it){return !isFinished(it) && indices.includes(it.row)});
      var groupConflicts=groupItems.filter(function(it){return conflictsForItem(it,items).length}).length;
      var groupPending=groupItems.filter(isUnassignedSma).length;
      var groupAssigned=groupItems.filter(isAssignedSma).length;
      var gCls=(groupConflicts?' hasConflict':(groupPending?' hasPending':(groupItems.length?' hasActivity':'')));
      var firstRoom=rooms[indices[0]]||{};
      var summary=groupItems.length+' cirurgia(s) | '+groupAssigned+' escalada(s)';
      if(groupPending)summary+=' | '+groupPending+' pendente(s)';
      if(groupConflicts)summary+=' | '+groupConflicts+' conflito(s)';
      htmlMap+='<div class="roomRow collapsedGroupRow '+gCls+'" data-group="'+html(group.key)+'" style="width:'+totalW+'px;height:'+(compact?42:48)+'px">';
      htmlMap+='<div class="roomLabel collapsed '+(firstRoom.type||group.type||'')+'" style="width:'+labelW+'px;height:'+(compact?42:48)+'px"><span class="roomName">'+html(group.label)+'</span><span class="roomStats">'+html(indices.length+' sala(s) recolhidas')+'</span></div>';
      htmlMap+='<button type="button" class="groupExpandBtn light" data-map-group="'+html(group.key)+'" style="left:'+(labelW+10)+'px">Expandir</button>';
      htmlMap+='<div class="collapsedSummaryText" style="left:'+(labelW+112)+'px">'+html(summary)+'</div>';
      htmlMap+='</div>';
      return;
    }
    var idx=viewRow.idx;
    var room=rooms[idx];
    var rh=rowHeights[idx];
    var rowItems=items.filter(function(it){return it.row===idx && !isFinished(it)});
    var rowConflicts=rowItems.filter(function(it){return conflictsForItem(it,items).length}).length;
    var rowPending=rowItems.filter(isUnassignedSma).length;
    var rowCls=(rowConflicts?' hasConflict':(rowPending?' hasPending':(rowItems.length?' hasActivity':'')));
    var roomStats=idx===0?(rowItems.length+' sem sala'):(rowItems.length?(rowItems.length+' cirurgia(s)'):'livre');
    if(rowConflicts)roomStats+=' | '+rowConflicts+' conflito(s)';
    else if(rowPending)roomStats+=' | '+rowPending+' pendente(s)';
    htmlMap+='<div class="roomRow '+rowCls+'" data-row="'+idx+'" style="width:'+totalW+'px;height:'+rh+'px">';
    htmlMap+='<div class="roomLabel '+room.type+'" style="width:'+labelW+'px;height:'+rh+'px"><span class="roomName">'+html(room.name)+'</span><span class="roomStats">'+html(roomStats)+'</span></div>';
    for(var h=startHour;h<=endHour;h++){
      var x=labelW+(h-startHour)*hourW;
      htmlMap+='<div class="roomGridLine" style="left:'+x+'px"></div>';
    }
    items.filter(function(it){return it.row===idx}).forEach(function(it){
      var x=labelW+((it.start-startHour*60)/60)*hourW;
      var w=Math.max(46,((it.end-it.start)/60)*hourW);
      var laneTop=idx===0 ? blockTop + (virtualLane.byId[it.id]||0)*laneGap : blockTop;
      var cls=getBlockClass(it,idx);
      if(w<124)cls+=' compact';
      if(w>220)cls+=' roomy';
      var preDone=isPreFeito(it);
      var blockStatus=conflictsForItem(it,items).length?'Conflito':(isFinished(it)?'Finalizada':(isExternalCase(it)?'Externo':(it.anest?'Escalada':'Pendente')));
      var badge=(it.anest && !isExternalCase(it) && !isFinished(it))?'<div class="anestBadge">'+html(it.anest)+'</div>':'';
      var preBadge=preDone?'<div class="preBadge" title="'+html('Pre feito'+(it.preFeitoPor?' por '+it.preFeitoPor:''))+'">Pre ok</div>':'';
      htmlMap+='<div class="block '+cls+'" title="'+html(fmtTime(it.start)+'-'+fmtTime(it.end)+' | '+it.room+' | '+blockStatus)+'" style="left:'+x+'px;top:'+laneTop+'px;width:'+w+'px" data-id="'+it.id+'">'+
        badge+
        preBadge+
        '<div class="blockText"><div class="blockTopLine"><span>'+html(fmtTime(it.start)+'-'+fmtTime(it.end))+'</span><span>'+html(durToText(it.duration))+'</span></div><div class="blockName">'+html(it.name)+'</div><div class="blockSub">'+html(it.anest||blockStatus)+'</div></div>'+ 
        '<div class="resizeHandle" data-resize="'+it.id+'"></div>'+ 
      '</div>';
    });
    htmlMap+='</div>';
  });

  var tl=Math.max(startHour*60,Math.min(endHour*60,getTimelineMin()));
  var tlX=minToX(tl);
  htmlMap+='<div id="nowLine" class="nowLine" style="left:'+tlX+'px"></div><div id="nowLabel" class="nowLabel" style="left:'+tlX+'px">'+(timelineCustom?'Simulado ':'Agora ')+fmtTime(tl)+'</div>';

  map.innerHTML=htmlMap;
  bindTimelineDrag();
  buildFixedTimeRuler(totalW,totalHours);
  setupMapScrollSync(totalW);
  updateStickyRulerTop();

  map.querySelectorAll('.block').forEach(function(el){
    bindBlockDrag(el);
    el.addEventListener('click',function(e){
      if(e.target.classList.contains('resizeHandle'))return;
      if(el.dataset.skipClick==='1'){el.dataset.skipClick='0';return}
      if(el.dataset.moved==='1'){el.dataset.moved='0';return}
      selectedId=Number(el.dataset.id);
      openBlockActions(selectedId);
    });
  });
  map.querySelectorAll('.resizeHandle').forEach(function(handle){
    bindResize(handle);
  });
  map.querySelectorAll('[data-map-group]').forEach(function(btn){
    btn.onclick=function(ev){
      ev.preventDefault();
      ev.stopPropagation();
      toggleRoomGroup(btn.dataset.mapGroup);
    };
  });
}

function buildFixedTimeRuler(totalW,totalHours){
  var inner=$('mapTimeInner'); if(!inner)return;
  var out='<div class="fixedTimeCorner" style="width:'+labelW+'px">Salas / horas</div>';
  for(var h=startHour;h<endHour;h++)out+='<div class="fixedTimeCell">'+String(((h%24)+24)%24).padStart(2,'0')+'h</div>';
  inner.style.gridTemplateColumns=labelW+'px repeat('+totalHours+','+hourW+'px)';
  inner.style.width=totalW+'px';
  inner.innerHTML=out;
  var bottomInner=$('mapBottomInner'); if(bottomInner)bottomInner.style.width=totalW+'px';
}

var mapScrollLock=false;
function setupMapScrollSync(totalW){
  var shell=$('mapShell');
  var bar=$('mapBottomScroll');
  var fixed=$('mapTimeInner');
  if(!shell||!bar)return;
  if(!shell.dataset.synced){
    shell.dataset.synced='1';
    shell.addEventListener('scroll',function(){
      if(mapScrollLock)return;
      mapScrollLock=true;
      bar.scrollLeft=shell.scrollLeft;
      if(fixed)fixed.style.transform='translateX('+(-shell.scrollLeft)+'px)';
      mapScrollLock=false;
    });
  }
  if(!bar.dataset.synced){
    bar.dataset.synced='1';
    bar.addEventListener('scroll',function(){
      if(mapScrollLock)return;
      mapScrollLock=true;
      shell.scrollLeft=bar.scrollLeft;
      if(fixed)fixed.style.transform='translateX('+(-shell.scrollLeft)+'px)';
      mapScrollLock=false;
    });
  }
  bar.scrollLeft=shell.scrollLeft;
  if(fixed)fixed.style.transform='translateX('+(-shell.scrollLeft)+'px)';
}

function rowFromClientY(clientY){
  var rows=[].slice.call(document.querySelectorAll('.roomRow[data-row]'));
  if(!rows.length)return null;
  var best=null, bestDist=Infinity;
  rows.forEach(function(r){
    var rect=r.getBoundingClientRect();
    if(clientY>=rect.top && clientY<=rect.bottom){best=r;bestDist=0;return}
    var mid=(rect.top+rect.bottom)/2;
    var d=Math.abs(clientY-mid);
    if(d<bestDist){bestDist=d;best=r}
  });
  return best;
}

function bindBlockDrag(el){
  var startX=0,startY=0,origStart=0,origRow=0,it=null,dragging=false,moved=false,armed=false,holdTimer=null;
  var HOLD_MS=360;
  el.addEventListener('contextmenu',function(e){e.preventDefault()});
  el.addEventListener('pointerdown',function(e){
    if(e.target.classList.contains('resizeHandle'))return;
    it=items.find(function(x){return x.id===Number(el.dataset.id)});
    if(!it || isFinished(it) || !canEdit())return;
    e.preventDefault();
    beginMapInteraction();
    startX=e.clientX;startY=e.clientY;origStart=it.start;origRow=it.row;
    selectedId=it.id;moved=false;armed=false;dragging=true;
    el.setPointerCapture(e.pointerId);
    holdTimer=setTimeout(function(){armed=true;el.classList.add('longPressReady')},HOLD_MS);
  });
  el.addEventListener('pointermove',function(e){
    if(!dragging||!it)return;
    e.preventDefault();
    clearTextSelection();
    var dx=e.clientX-startX,dy=e.clientY-startY;
    if(!armed){
      if(Math.abs(dx)>10||Math.abs(dy)>10){clearTimeout(holdTimer);dragging=false;el.classList.remove('longPressReady');endMapInteraction()}
      return;
    }
    if(Math.abs(dx)>3||Math.abs(dy)>3)moved=true;
    var deltaMin=Math.round((dx/hourW)*4)*15;
    el.classList.add('dragging');
    el.style.transform='translate('+((deltaMin/60)*hourW)+'px,'+dy+'px)';
    document.querySelectorAll('.roomRow').forEach(function(r){r.classList.remove('dropHint')});
    var rowEl=rowFromClientY(e.clientY);
    if(rowEl)rowEl.classList.add('dropHint');
  });
  el.addEventListener('pointerup',async function(e){
    clearTimeout(holdTimer);
    el.classList.remove('longPressReady','dragging');
    if(!dragging||!it){endMapInteraction();return}
    e.preventDefault();
    dragging=false;
    endMapInteraction();
    document.querySelectorAll('.roomRow').forEach(function(r){r.classList.remove('dropHint')});
    if(!armed){
      el.style.transform='';
      if(!moved){
        el.dataset.skipClick='1';
        selectedId=it.id;
        openBlockActions(it.id);
      }
      return;
    }
    var dx=e.clientX-startX;
    var deltaMin=Math.round((dx/hourW)*4)*15;
    var rowEl=rowFromClientY(e.clientY);
    var newRow=rowEl?Number(rowEl.dataset.row):origRow;
    if(moved){
      updateItemRoomAndTime(it,newRow,origStart+deltaMin);
      el.dataset.moved='1';
      try{await saveItemToDb(it);status('Cirurgia movida para '+it.room+' as '+fmtTime(it.start)+'.','ok')}
      catch(err){status('Erro ao salvar movimento: '+err.message,'err')}
    }else{
      el.dataset.skipClick='1';
      selectedId=it.id;
      openBlockActions(it.id);
    }
    el.style.transform='';
    renderAll();
  });
  el.addEventListener('pointercancel',function(){clearTimeout(holdTimer);dragging=false;armed=false;el.classList.remove('longPressReady','dragging');el.style.transform='';endMapInteraction()});
}

function bindResize(handle){
  var startX=0,origEnd=0,it=null,resizing=false,armed=false,holdTimer=null;
  var HOLD_MS=320;
  handle.addEventListener('pointerdown',function(e){
    e.preventDefault();e.stopPropagation();
    it=items.find(function(x){return x.id===Number(handle.dataset.resize)});
    if(!it || isFinished(it) || !canEdit())return;
    beginMapInteraction();
    resizing=true;armed=false;startX=e.clientX;origEnd=it.end;selectedId=it.id;
    handle.setPointerCapture(e.pointerId);
    holdTimer=setTimeout(function(){armed=true;handle.classList.add('longPressReady')},HOLD_MS);
  });
  handle.addEventListener('pointermove',function(e){
    if(!resizing||!it)return;
    e.preventDefault();
    clearTextSelection();
    var dx=e.clientX-startX;
    if(!armed){
      if(Math.abs(dx)>10){clearTimeout(holdTimer);resizing=false;handle.classList.remove('longPressReady');endMapInteraction()}
      return;
    }
    var deltaMin=Math.round((dx/hourW)*4)*15;
    var newEnd=Math.max(it.start+15,Math.min(endHour*60,origEnd+deltaMin));
    var block=handle.closest('.block');
    if(block)block.style.width=Math.max(46,((newEnd-it.start)/60)*hourW)+'px';
  });
  handle.addEventListener('pointerup',async function(e){
    clearTimeout(holdTimer);
    handle.classList.remove('longPressReady');
    if(!resizing||!it){endMapInteraction();return}
    resizing=false;
    endMapInteraction();
    if(!armed){renderAll();return;}
    var dx=e.clientX-startX;
    var deltaMin=Math.round((dx/hourW)*4)*15;
    it.end=Math.max(it.start+15,Math.min(endHour*60,origEnd+deltaMin));
    it.duration=it.end-it.start;
    try{await saveItemToDb(it);status('Duracao atualizada para '+durToText(it.duration)+'.','ok')}
    catch(err){status('Erro ao salvar duracao: '+err.message,'err')}
    renderAll();
  });
  handle.addEventListener('pointercancel',function(){clearTimeout(holdTimer);resizing=false;armed=false;handle.classList.remove('longPressReady');endMapInteraction()});
}


function bindTimelineDrag(){
  var line=$('nowLine'), label=$('nowLabel'), map=$('map');
  if(!line||!map)return;
  function startDrag(e){
    e.preventDefault(); e.stopPropagation();
    beginMapInteraction();
    var rect=map.getBoundingClientRect();
    function move(ev){
      ev.preventDefault();
      clearTextSelection();
      var x=ev.clientX-rect.left;
      var min=startHour*60+((x-labelW)/hourW)*60;
      min=Math.round(min/15)*15;
      min=Math.max(startHour*60,Math.min(endHour*60,min));
      timelineMin=min; timelineCustom=true;
      var nx=minToX(min);
      line.style.left=nx+'px';
      if(label){label.style.left=nx+'px';label.textContent='Simulado '+fmtTime(min)}
    }
    function up(){window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);endMapInteraction()}
    window.addEventListener('pointermove',move);
    window.addEventListener('pointerup',up);
    window.addEventListener('pointercancel',up);
    move(e);
  }
  line.addEventListener('pointerdown',startDrag);
  if(label)label.addEventListener('pointerdown',startDrag);
}

function renderList(){
  var list=$('caseList');
  if(!items.length){list.innerHTML='<div class="card hint">Nenhuma cirurgia cadastrada para este dia.</div>';return}
  list.innerHTML=items.map(function(it){
    var conflicts=conflictsForItem(it,items);
    var preDone=isPreFeito(it);
    var caseCls=(isFinished(it)?' finished':'')+(it.row===0?' virtualCase':'')+(isExternalCase(it)?' externalCase':'')+(conflicts.length?' conflictCase':'')+(preDone?' preDone':'');
    var pillCls=conflicts.length?'conflict':(isFinished(it)?'fin':(isExternalCase(it)?'ext':(it.anest?'sma':'pend')));
    var pillText=conflicts.length?'Conflito':(isFinished(it)?'Finalizada':(isExternalCase(it)?'Externo':(it.anest?'SMA escalada':'Pendente')));
    var preHtml=preDone?'<span class="preMeta" title="'+html(it.preFeitoPor?'Marcado por '+it.preFeitoPor:'Pre feito marcado')+'">Pre ok</span>':'';
    var conflictHtml=conflicts.length?'<div class="conflictNote">'+html(conflicts.join(' | '))+'</div>':'';
    return '<div class="case '+caseCls+'">'+
      '<div class="caseTop"><div><div class="caseName">'+html(fmtTime(it.start)+' | '+it.name)+'</div>'+
      '<div class="caseMeta">'+html(it.room)+' | '+html(durToText(it.duration))+' | '+html(it.initials)+' | '+html(it.age)+' anos</div></div>'+
      '<span class="pill '+pillCls+'">'+html(pillText)+'</span></div>'+
      preHtml+
      '<div class="caseMeta">Anest: <b>'+html(it.anest||'nao definido')+'</b> '+(it.obs?(' | '+html(it.obs)):'')+'</div>'+
      conflictHtml+
      '<div class="tools"><button class="light" data-edit="'+it.id+'">Editar</button><button class="purple" data-assign="'+it.id+'">Escalar</button><button class="gray" data-unassign="'+it.id+'">Desescalar</button><button class="light" data-pre="'+it.id+'">'+(preDone?'Desfazer pre':'Pre feito')+'</button><button class="gray" data-finish="'+it.id+'">Finalizar</button><button class="red" data-del="'+it.id+'">Deletar</button></div>'+
    '</div>'
  }).join('');

  list.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openSurgeryModal(Number(b.dataset.edit)));
  list.querySelectorAll('[data-assign]').forEach(b=>b.onclick=()=>openAssignModal(Number(b.dataset.assign)));
  list.querySelectorAll('[data-unassign]').forEach(b=>b.onclick=()=>unassignSurgery(Number(b.dataset.unassign)));
  list.querySelectorAll('[data-pre]').forEach(b=>b.onclick=()=>togglePreFeito(Number(b.dataset.pre)));
  list.querySelectorAll('[data-finish]').forEach(b=>b.onclick=()=>finishSurgery(Number(b.dataset.finish)));
  list.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>deleteSurgery(Number(b.dataset.del)));
}

function renderAnes(){
  var list=$('anesList');
  if(!anesthetists.length){list.innerHTML='<div class="card hint">Nenhum anestesista cadastrado para este dia.</div>';return}
  list.innerHTML=anesthetists.map(function(a){
    return '<div class="case"><div class="caseTop"><div><div class="caseName">'+html(a.name)+'</div>'+
      '<div class="caseMeta">'+html(a.shift||'sem horario')+' | '+html(a.role||'sem cargo')+' '+(a.obs?(' | '+html(a.obs)):'')+'</div></div>'+
      '<span class="pill pend">escala do dia</span></div>'+
      '<div class="tools"><button class="light" data-edita="'+a.id+'">Editar</button><button class="red" data-dela="'+a.id+'">Remover</button></div></div>'
  }).join('');
  list.querySelectorAll('[data-edita]').forEach(b=>b.onclick=()=>fillAnesForm(Number(b.dataset.edita)));
  list.querySelectorAll('[data-dela]').forEach(b=>b.onclick=()=>deleteAnes(Number(b.dataset.dela)));
}

async function loadRegisteredUsers(){
  try{
    var usersResp=await api('/api/usuarios-opcoes');
    registeredUsers=usersResp.users||[];
    usersForAccess=registeredUsers.map(function(u){return {...u, username:(userScaleName(u)||u.username)+' / '+u.username}});
    refreshAnesDatalist();
    return registeredUsers;
  }catch(err){
    registeredUsers=[];
    refreshAnesDatalist();
    return [];
  }
}

async function loadAccessManager(){
  if(!canManageAccess() || !currentHospitalId)return;
  try{
    if(!usersForAccess.length){
      await loadRegisteredUsers();
      var select=$('accessUser');
      if(select)select.innerHTML=usersForAccess.map(function(u){return '<option value="'+html(u.id)+'">'+html(u.username+' | '+roleLabel(u))+'</option>'}).join('');
    }
    var resp=await api('/api/acessos-dia?data='+encodeURIComponent(currentDate)+'&hospital_id='+encodeURIComponent(currentHospitalId));
    dailyAccess=resp.acessos||[];
    renderAccessList();
  }catch(err){
    var list=$('accessList');
    if(list)list.innerHTML='<div class="hint">Nao foi possivel carregar acessos: '+html(err.message)+'</div>';
  }
}

function renderAccessList(){
  var list=$('accessList');
  if(!list)return;
  if(!dailyAccess.length){list.innerHTML='<div class="hint">Nenhum acesso diario definido para esta data.</div>';return}
  list.innerHTML=dailyAccess.map(function(a){
    return '<div class="case"><div class="caseTop"><div><div class="caseName">'+html(a.nome_escala||a.username)+'</div>'+
      '<div class="caseMeta">login: '+html(a.username)+'</div>'+
      '<div class="caseMeta">'+html(a.papel_dia)+' | '+(Number(a.pode_editar)===1?'pode editar':'somente leitura')+'</div></div>'+
      '<button class="red small" data-del-access="'+a.id+'">Remover</button></div></div>';
  }).join('');
  list.querySelectorAll('[data-del-access]').forEach(function(b){b.onclick=function(){deleteAccess(Number(b.dataset.delAccess))}});
}

async function saveAccess(){
  if(!canManageAccess())return;
  var userId=Number($('accessUser').value||0);
  if(!userId){status('Escolha um usuario para liberar acesso.','warn');return}
  await api('/api/acessos-dia',{method:'POST',body:JSON.stringify({
    data_acesso:currentDate,
    hospital_id:currentHospitalId,
    user_id:userId,
    papel_dia:$('accessRole').value,
    pode_ver:1
  })});
  status('Acesso diario salvo.','ok');
  await loadAccessManager();
}

async function deleteAccess(id){
  if(!confirm('Remover este acesso diario?'))return;
  await api('/api/acessos-dia/'+id,{method:'DELETE'});
  status('Acesso diario removido.','ok');
  await loadAccessManager();
}

function normalizeRole(cargo){
  var s=String(cargo||'').trim();
  var low=s.toLowerCase();
  if(low.includes('coord'))return 'Coordenador';
  if(low.includes('not'))return 'Noturno';
  if(low.includes('20'))return 'Estendido 20h';
  if(low.includes('21'))return 'Estendido 21h';
  if(low.includes('23'))return 'Estendido 23h';
  if(low.includes('sala'))return 'Sala';
  return s||'Sala';
}
function normalizeShift(v){
  var s=String(v||'').trim().replace(/[\u2013\u2014]/g,'-');
  var times=s.match(/\d{1,2}[:hH]?\d{0,2}/g)||[];
  function norm(t,def){var m=String(t||def).match(/(\d{1,2})[:hH]?(\d{2})?/);if(!m)return def;return String(Number(m[1])).padStart(2,'0')+':'+String(Number(m[2]||0)).padStart(2,'0')}
  if(times.length>=2)return norm(times[0],'07:00')+'-'+norm(times[1],'19:00');
  if(times.length===1)return norm(times[0],'07:00')+'-19:00';
  return '07:00-19:00';
}
function splitShift(v){var s=normalizeShift(v).split('-');return {start:s[0]||'07:00',end:s[1]||'19:00'}}
function parseAnesLine(line){
  if(!line)return null;
  var raw=String(line).trim();
  if(!raw || /^nome\s*[|\t]/i.test(raw))return null;
  var p=raw.includes('|')?raw.split('|'):raw.split(/\t+/);
  p=p.map(function(x){return x.trim()});
  if(p.length<2)return null;
  return {data_escala:currentDate,nome_anestesista:p[0],horario_escala:normalizeShift(p[1]),funcao:normalizeRole(p[2]||'Sala'),observacao:p.slice(3).join(' | ')};
}
function parseAnesImport(){
  var text=$('anesText').value.trim();
  if(!text){parsedAnesImport=[];renderAnesImportPreview();return}
  try{
    parsedAnesImport=text.split(/\n+/).map(function(l){return parseAnesLine(l)}).filter(Boolean);
    renderAnesImportPreview();
    status('Escala processada: '+parsedAnesImport.length+' anestesista(s).','ok');
  }catch(e){status('Erro ao processar escala: '+e.message,'err')}
}
function renderAnesImportPreview(){
  var box=$('anesImportPreview'); if(!box)return;
  if(!parsedAnesImport.length){box.innerHTML='Nenhuma escala processada ainda.';return}
  box.innerHTML='<div class="list">'+parsedAnesImport.map(function(a){return '<div class="case"><div class="caseName">'+html(a.nome_anestesista)+'</div><div class="caseMeta">'+html(a.horario_escala)+' | '+html(a.funcao)+'</div></div>'}).join('')+'</div>';
}
async function saveImportedAnes(){
  if(!requireEdit())return;
  if(!parsedAnesImport.length){status('Nada para importar na escala.','warn');return}
  var ok=0,errors=0,msgs=[];
  status('Salvando '+parsedAnesImport.length+' anestesista(s) no SQLite...','warn');
  for(var i=0;i<parsedAnesImport.length;i++){
    try{
      var item=Object.assign({},parsedAnesImport[i]);
      var linkedUser=findRegisteredUserByName(item.nome_anestesista);
      if(linkedUser)item.user_id=linkedUser.id;
      storeValue('ccsama_anesthetists',item.nome_anestesista);
      await api('/api/anestesistas',{method:'POST',body:JSON.stringify(item)});
      ok++;
    }
    catch(err){errors++;msgs.push((i+1)+': '+err.message)}
  }
  status('Escala salva: '+ok+' anestesista(s). Erros: '+errors+(msgs.length?'\n'+msgs.slice(0,5).join('\n'):''), errors?'warn':'ok');
  if(ok){parsedAnesImport=[];$('anesText').value=''}
  await loadDay();
}

function parseLine(line){
  var p=line.split('|').map(s=>s.trim());
  if(p.length<5)return null;
  return {
    data_cirurgia:currentDate,
    horario_inicio:p[0]||"",
    sala:canonicalRoomName(p[1]||"Nao escaladas"),
    nome_cirurgia:p[2]||"",
    duracao:durToText(p[3]||"01:00"),
    servico:(String(p[4]||"").toLowerCase().includes("particular")||String(p[4]||"").toLowerCase().includes("externo"))?"Particular":"SMA",
    iniciais_paciente:(p[5]||"NI").replace(/\W/g,"").toUpperCase()||"NI",
    idade_paciente:Number(p[6]||0),
    observacao:p.slice(7).join(" | ")
  }
}

function parseImport(){
  var text=$('surgeryText').value.trim();
  if(!text){parsedImport=[];renderImportPreview();return}
  try{
    if(text.startsWith('[')){
      var arr=JSON.parse(text);
      parsedImport=arr.map(function(x){
        return {
          data_cirurgia:currentDate,
          horario_inicio:x.horario_inicio||x.inicio||x.hora||"",
          sala:canonicalRoomName(x.sala||"Nao escaladas"),
          nome_cirurgia:x.nome_cirurgia||x.cirurgia||x.nome||"",
          duracao:durToText(x.duracao||x.duration||"01:00"),
          servico:(x.servico||"SMA").toString().toLowerCase().includes("particular")?"Particular":"SMA",
          iniciais_paciente:(x.iniciais_paciente||x.iniciais||"NI").toString().replace(/\W/g,"").toUpperCase(),
          idade_paciente:Number(x.idade_paciente||x.idade||0),
          observacao:x.observacao||x.obs||""
        }
      });
    }else{
      parsedImport=text.split(/\n+/).map(l=>l.trim()).filter(Boolean).map(parseLine).filter(Boolean);
    }
    renderImportPreview();
    status("Processado: "+parsedImport.length+" cirurgia(s).","ok");
  }catch(e){status("Erro ao processar: "+e.message,"err")}
}

function renderImportPreview(){
  var box=$('importPreview');
  if(!parsedImport.length){box.innerHTML='Nenhuma lista processada ainda.';return}
  box.innerHTML='<div class="list">'+parsedImport.map(function(c,i){
    return '<div class="case"><div class="caseName">'+html(c.horario_inicio+' | '+c.nome_cirurgia)+'</div>'+
      '<div class="caseMeta">'+html(c.sala)+' | '+html(c.duracao)+' | '+html(c.servico)+' | '+html(c.iniciais_paciente)+' | '+html(c.idade_paciente)+' anos</div></div>'
  }).join('')+'</div>';
}

function renderImportPreviewEditable(){
  var box=$('importPreview');
  if(!parsedImport.length){box.innerHTML='Nenhuma lista processada ainda.';return}
  var roomsOpts=rooms.map(function(r){return '<option value="'+html(r.name)+'">'+html(r.name)+'</option>'}).join('');
  box.innerHTML='<div class="importReviewNote">Revise cada campo abaixo. Essas linhas ainda nao entraram no mapa; elas so serao gravadas quando voce clicar em "Salvar alteracoes no mapa".</div>'+
    '<div class="importEditGrid importEditHead"><span>Inicio</span><span>Sala</span><span>Cirurgia</span><span>Duracao</span><span>Servico</span><span>Iniciais</span><span>Idade</span><span></span></div>'+
    parsedImport.map(function(c,i){
      return '<div class="importRow" data-import-row="'+i+'"><div class="importEditGrid">'+
        '<input data-import-field="horario_inicio" value="'+html(c.horario_inicio||'')+'" placeholder="07:00">'+
        '<select data-import-field="sala">'+roomsOpts+'</select>'+
        '<input data-import-field="nome_cirurgia" value="'+html(c.nome_cirurgia||'')+'" placeholder="Cirurgia">'+
        '<input data-import-field="duracao" value="'+html(c.duracao||'01:00')+'" placeholder="01:00">'+
        '<select data-import-field="servico"><option value="SMA">SMA</option><option value="Particular">Particular</option></select>'+
        '<input data-import-field="iniciais_paciente" value="'+html(c.iniciais_paciente||'NI')+'" placeholder="AB">'+
        '<input data-import-field="idade_paciente" type="number" min="0" value="'+html(c.idade_paciente||0)+'">'+
        '<button class="red small" data-import-remove="'+i+'" type="button">Remover</button>'+
      '</div></div>';
    }).join('');
  parsedImport.forEach(function(c,i){
    var row=box.querySelector('[data-import-row="'+i+'"]');
    if(!row)return;
    var sala=row.querySelector('[data-import-field="sala"]');
    if(sala)sala.value=c.sala||canonicalRoomName(c.sala||'Nao escaladas');
    var serv=row.querySelector('[data-import-field="servico"]');
    if(serv)serv.value=c.servico||'SMA';
  });
}

renderImportPreview = renderImportPreviewEditable;

function syncImportPreview(){
  $('importPreview').querySelectorAll('[data-import-row]').forEach(function(row){
    var i=Number(row.dataset.importRow);
    if(!parsedImport[i])return;
    row.querySelectorAll('[data-import-field]').forEach(function(el){
      var field=el.dataset.importField;
      parsedImport[i][field]=field==='idade_paciente'?Number(el.value||0):el.value;
    });
  });
}

function importIdentityText(value){
  return String(value||'')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}
function importInitialsKey(value){
  return String(value||'')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g,'')
    .trim();
}
function importDuplicateKey(item){
  return [
    item.data_cirurgia||currentDate,
    importIdentityText(item.nome_cirurgia),
    importInitialsKey(item.iniciais_paciente),
    Number(item.idade_paciente||0)
  ].join('|');
}
function removeDuplicateImportRows(){
  var seen={}, unique=[], skipped=0;
  parsedImport.forEach(function(item){
    var key=importDuplicateKey(item);
    if(!importIdentityText(item.nome_cirurgia) || !importInitialsKey(item.iniciais_paciente)){
      unique.push(item);
      return;
    }
    if(seen[key]){
      skipped++;
      return;
    }
    seen[key]=true;
    unique.push(item);
  });
  parsedImport=unique;
  return skipped;
}

function addImportReviewRow(){
  if(!requireEdit())return;
  syncImportPreview();
  var last=parsedImport.length?parsedImport[parsedImport.length-1]:null;
  parsedImport.push({
    data_cirurgia:currentDate,
    horario_inicio:last && last.horario_inicio ? last.horario_inicio : '07:00',
    sala:last && last.sala ? last.sala : (rooms[0] ? rooms[0].name : 'Nao escaladas'),
    nome_cirurgia:'',
    duracao:'01:00',
    servico:'SMA',
    iniciais_paciente:'NI',
    idade_paciente:0,
    observacao:''
  });
  renderImportPreview();
  var rows=$('importPreview').querySelectorAll('[data-import-row]');
  var row=rows[rows.length-1];
  var input=row && row.querySelector('[data-import-field="nome_cirurgia"]');
  if(input)input.focus();
  status('Linha adicionada para revisao antes de salvar.','ok');
}

async function saveImported(){
  if(!requireEdit())return;
  if(savingImport)return;
  if(!parsedImport.length){status("Nada para importar.","warn");return}
  syncImportPreview();
  var skipped=removeDuplicateImportRows();
  renderImportPreview();
  var btn=$('btnSaveImported');
  savingImport=true;
  if(btn){btn.disabled=true;btn.textContent='Salvando...'}
  var ok=0, inserted=0, updated=0, errors=0, msgs=[];
  try{
  status("Salvando "+parsedImport.length+" cirurgia(s) no SQLite...","warn");
  for(var i=0;i<parsedImport.length;i++){
    try{
      var resp=await api('/api/cirurgias',{method:'POST',body:JSON.stringify(parsedImport[i])});
      ok++;
      if(resp && resp.action==='updated_existing')updated++;
      else inserted++;
    }catch(err){
      errors++;
      msgs.push((i+1)+': '+err.message);
    }
  }
  status("Importacao salva: "+ok+" cirurgia(s). Erros: "+errors+(msgs.length?'\n'+msgs.slice(0,5).join('\n'):''), errors?'warn':'ok');
  status("Importacao salva: "+ok+" cirurgia(s). Novas: "+inserted+". Atualizadas: "+updated+". Duplicadas ignoradas: "+skipped+". Erros: "+errors+(msgs.length?'\n'+msgs.slice(0,5).join('\n'):''), errors?'warn':'ok');
  if(ok){parsedImport=[];$('surgeryText').value="";}
  await loadDay();
  status("Importacao salva: "+ok+" cirurgia(s). Novas: "+inserted+". Atualizadas: "+updated+". Duplicadas ignoradas: "+skipped+". Erros: "+errors+(msgs.length?'\n'+msgs.slice(0,5).join('\n'):''), errors?'warn':'ok');
  }finally{
    savingImport=false;
    if(btn){btn.disabled=false;btn.textContent='Salvar alteracoes no mapa'}
  }
}

function openModal(htmlContent){$('modal').innerHTML=htmlContent;$('modalBg').style.display='flex'}
function closeModal(){$('modalBg').style.display='none';$('modal').innerHTML=''}
$('modalBg').addEventListener('click',function(e){if(e.target===$('modalBg'))closeModal()});

function openSurgeryModal(id){
  if(!requireEdit())return;
  var it=id?items.find(x=>x.id===id):null;
  var opts=['Nao escaladas'].concat(rooms.slice(1).map(r=>r.name));
  var anesOptions='<option value="">Sem anestesista</option>'+allAnesthetistSuggestions().map(a=>'<option>'+html(a)+'</option>').join('');
  var procList=datalistHtml('procedureOptions',allProcedureSuggestions());
  openModal('<h2>'+(it?'Editar':'Nova')+' cirurgia</h2>'+procList+
    '<div class="fieldLabel">Horario</div><div class="timeStepper"><button class="light" id="mMinus15" type="button">-15</button><input id="mHora" placeholder="07:00" value="'+html(it?fmtTime(it.start):'')+'"><button class="light" id="mPlus15" type="button">+15</button></div>'+ 
    '<div class="fieldLabel">Duracao</div><div class="timeStepper"><button class="light" id="mDurMinus15" type="button">-15</button><input id="mDur" placeholder="02:00" value="'+html(it?durToText(it.duration):'')+'"><button class="light" id="mDurPlus15" type="button">+15</button></div>'+ 
    '<div class="fieldLabel">Procedimento</div><input id="mNome" list="procedureOptions" placeholder="Nome da cirurgia" value="'+html(it?it.name:'')+'">'+
    '<div class="grid2" style="margin-top:8px"><div><div class="fieldLabel">Sala</div><select id="mSala">'+opts.map(o=>'<option '+(it&&it.room===o?'selected':'')+'>'+html(o)+'</option>').join('')+'</select></div><div><div class="fieldLabel">Tipo</div><select id="mServ"><option '+(!it||it.servico==='SMA'?'selected':'')+'>SMA</option><option '+(it&&it.servico==='Particular'?'selected':'')+'>Particular</option></select></div></div>'+ 
    '<div class="fieldLabel">Anestesista</div><select id="mAnest">'+anesOptions+'</select><div id="mAnestHint" class="smartHint"></div>'+ 
    '<div class="grid2" style="margin-top:8px"><input id="mIni" placeholder="Iniciais" value="'+html(it?it.initials:'')+'"><input id="mIdade" type="number" placeholder="Idade" value="'+html(it?it.age:'')+'"></div>'+ 
    '<input id="mObs" placeholder="Obs" style="margin-top:8px" value="'+html(it?it.obs:'')+'">'+
    '<div class="row" style="margin-top:12px"><button class="green" id="mSave">Salvar</button><button class="gray" id="mCancel">Cancelar</button></div>');
  if(it && it.servico!=='Particular')$('mAnest').value=it.anest||"";
  function addMinToInput(id,delta,kind){
    var el=$(id); var min=kind==='dur'?parseDur(el.value):(parseTime(el.value)||startHour*60);
    min=Math.max(kind==='dur'?15:startHour*60,Math.min(kind==='dur'?12*60:endHour*60,min+delta));
    el.value=kind==='dur'?durToText(min):fmtTime(min);
  }
  function syncService(){
    var particular=$('mServ').value==='Particular';
    $('mAnest').disabled=particular;
    if(particular){$('mAnest').value='';$('mAnestHint').textContent='Particular selecionado: anestesista fica em branco/nulo.'}
    else {$('mAnestHint').textContent='SMA selecionado: escolha um anestesista do dia ou cadastrado.'}
  }
  $('mMinus15').onclick=function(){addMinToInput('mHora',-15,'time')};
  $('mPlus15').onclick=function(){addMinToInput('mHora',15,'time')};
  $('mDurMinus15').onclick=function(){addMinToInput('mDur',-15,'dur')};
  $('mDurPlus15').onclick=function(){addMinToInput('mDur',15,'dur')};
  $('mServ').onchange=syncService;
  syncService();
  $('mCancel').onclick=closeModal;
  $('mSave').onclick=async function(){
    var payload={
      data_cirurgia:currentDate,
      horario_inicio:$('mHora').value,
      nome_cirurgia:$('mNome').value,
      duracao:$('mDur').value,
      sala:$('mSala').value,
      servico:$('mServ').value,
      anestesista_escalado:$('mServ').value==='Particular'?'':$('mAnest').value,
      iniciais_paciente:$('mIni').value,
      idade_paciente:Number($('mIdade').value),
      observacao:$('mObs').value
    };
    storeValue('ccsama_procedures',payload.nome_cirurgia);
    if(payload.anestesista_escalado)storeValue('ccsama_anesthetists',payload.anestesista_escalado);
    if(it) await api('/api/cirurgias/'+it.id,{method:'PUT',body:JSON.stringify(payload)});
    else await api('/api/cirurgias',{method:'POST',body:JSON.stringify(payload)});
    closeModal();
    await loadDay();
  };
}

function openBlockActions(id){
  var it=items.find(function(x){return x.id===id}); if(!it)return;
  selectedId=id;
  var finished=isFinished(it);
  var preDone=isPreFeito(it);
  var conflicts=conflictsForItem(it,items);
  var conflictHtml=conflicts.length?'<div class="conflictNote">'+html(conflicts.join(' | '))+'</div>':'';
  openModal('<h2>'+html(fmtTime(it.start)+' | '+it.name)+'</h2>'+ 
    '<div class="hint">'+html(it.room)+' | '+html(durToText(it.duration))+' | Anest: '+html(it.anest||'nao definido')+'</div>'+ 
    conflictHtml+
    '<div class="actionGrid">'+
      '<button class="purple" id="actAssign">Escalar / alterar</button>'+ 
      '<button class="gray" id="actUnassign">Desescalar</button>'+ 
      '<button class="green" id="actEdit">Editar cirurgia</button>'+ 
      '<button class="light" id="actPre">'+(preDone?'Desfazer pre feito':'Marcar pre feito')+'</button>'+ 
      '<button class="gray" id="actFinish">'+(finished?'Desfazer finalizacao':'Finalizar')+'</button>'+ 
      '<button class="red" id="actDelete">Deletar</button>'+ 
      '<button class="light" id="actClose">Fechar</button>'+ 
    '</div>'+ 
    '<div class="hint" style="margin-top:10px">Para mover ou redimensionar no mapa: toque e segure o bloco/alca por um instante antes de arrastar.</div>');
  $('actAssign').onclick=function(){closeModal();openAssignModal(id)};
  $('actUnassign').onclick=function(){closeModal();unassignSurgery(id)};
  $('actEdit').onclick=function(){closeModal();openSurgeryModal(id)};
  $('actPre').onclick=function(){closeModal();togglePreFeito(id)};
  $('actFinish').onclick=function(){closeModal(); if(finished)unfinishSurgery(id); else finishSurgery(id)};
  $('actDelete').onclick=function(){closeModal();deleteSurgery(id)};
  $('actClose').onclick=closeModal;
}

function openAssignModal(id){
  if(!requireEdit())return;
  var it=items.find(x=>x.id===id); if(!it)return;
  var conflicts=conflictsForItem(it,items);
  var suggestions=suggestionsForItem(it,items,6,false);
  if(!suggestions.length && isEasyCase(it))suggestions=suggestionsForItem(it,items,6,true);
  var conflictHtml=conflicts.length?'<div class="conflictNote">'+html(conflicts.join(' | '))+'</div>':'';
  var sugHtml=suggestions.length?suggestions.map(function(c,idx){
    var reasonText=c.reasons.join(' ');
    var cls='suggestionBtn '+(idx===0?'best':'')+((reasonText.includes('excepcional')||reasonText.includes('ultimo recurso'))?' warn':'');
    return '<button class="'+cls+'" data-suggest-an="'+html(c.name)+'">'+
      '<span><span class="suggestionName">'+html(c.name)+'</span><div class="suggestionMeta">'+html(c.reasons.join(' | '))+'</div></span>'+
      '<span class="suggestionScore">'+html(c.score)+'</span>'+
    '</button>';
  }).join(''):'<div class="hint">Nao encontrei sugestao segura com a escala atual. Voce ainda pode escolher manualmente.</div>';
  var manualOptions=anesthetists.map(function(a){return '<option value="'+html(a.name)+'">'+html(a.name)+' - '+html(a.role||'sem cargo')+'</option>'}).join('');
  openModal('<h2>Escalar: '+html(it.name)+'</h2>'+
    '<div class="hint">'+html(fmtTime(it.start)+' - '+fmtTime(it.end)+' | '+it.room+' | '+durToText(it.duration))+'</div>'+
    conflictHtml+
    '<div class="fieldLabel">Melhores sugestoes</div><div class="suggestionList">'+sugHtml+'</div>'+
    '<div class="fieldLabel">Escolha manual</div>'+
    '<button class="gray" style="width:100%" id="assignParticular">Particular / externo</button>'+
    '<div class="manualAssignGrid"><select id="assignManual"><option value="">Escolher anestesista</option>'+manualOptions+'</select><button class="light" id="assignManualBtn">Escalar</button></div>'+
    '<button class="gray" style="margin-top:10px" id="mCancel">Cancelar</button>');
  $('mCancel').onclick=closeModal;
  async function doAssign(name){
    try{
      await persistAssignment(it,name);
      closeModal();
      await loadDay();
      status(name==='Particular'?'Cirurgia marcada como externa.':'Cirurgia escalada para '+name+'.','ok');
    }catch(err){status('Erro ao escalar: '+err.message,'err')}
  }
  document.querySelectorAll('[data-suggest-an]').forEach(function(b){
    b.onclick=async function(){
      await doAssign(b.dataset.suggestAn);
    }
  });
  $('assignParticular').onclick=function(){doAssign('Particular')};
  $('assignManualBtn').onclick=function(){
    var name=$('assignManual').value;
    if(!name){status('Escolha um anestesista para escalar.','warn');return}
    doAssign(name);
  };
}

async function togglePreFeito(id){
  var it=items.find(function(x){return x.id===id}); if(!it)return;
  if(!canTogglePreFeito(it)){
    status('Somente o coordenador/escalador ou o anestesista escalado pode marcar o pre feito.','warn');
    return;
  }
  var next=!isPreFeito(it);
  try{
    await api('/api/cirurgias/'+id+'/pre-feito',{method:'POST',body:JSON.stringify({pre_feito:next?1:0})});
    status(next?'Pre feito marcado.':'Pre feito desfeito.','ok');
    await loadDay();
  }catch(err){
    status('Erro ao atualizar pre feito: '+err.message,'err');
  }
}

async function unassignSurgery(id){
  if(!requireEdit())return;
  var it=items.find(function(x){return x.id===id}); if(!it)return;
  it.anest='';
  if(isExternalCase(it))it.servico='SMA';
  try{await saveItemToDb(it);status('Cirurgia desescalada.','ok');await loadDay()}
  catch(err){status('Erro ao desescalar: '+err.message,'err')}
}

async function finishSurgery(id){
  if(!requireEdit())return;
  var it=items.find(function(x){return x.id===id}); if(!it)return;
  if(!confirm('Finalizar esta cirurgia?'))return;
  it.finalizado=true;
  it.finished=true;
  if(!String(it.obs||'').toUpperCase().includes('[FINALIZADA]')){
    it.obs=(it.obs?it.obs+' | ':'')+'[FINALIZADA]';
  }
  try{await saveItemToDb(it);status('Cirurgia finalizada.','ok');await loadDay()}
  catch(err){status('Erro ao finalizar: '+err.message,'err')}
}

async function unfinishSurgery(id){
  if(!requireEdit())return;
  var it=items.find(function(x){return x.id===id}); if(!it)return;
  it.finalizado=false;
  it.finished=false;
  it.obs=String(it.obs||'').replace(/\s*\|?\s*\[FINALIZADA\]\s*/gi,'').trim();
  try{await saveItemToDb(it);status('Finalizacao desfeita.','ok');await loadDay()}
  catch(err){status('Erro ao desfazer finalizacao: '+err.message,'err')}
}

async function deleteSurgery(id){
  if(!requireEdit())return;
  if(!confirm("Deletar cirurgia?"))return;
  await api('/api/cirurgias/'+id,{method:'DELETE'});
  await loadDay();
}

async function addAnes(){
  if(!requireEdit())return;
  var name=$('anesName').value.trim();
  if(!name){status("Nome do anestesista obrigatorio.","warn");return}
  storeValue('ccsama_anesthetists',name);
  var shift=(($('anesShiftStart').value||'07:00')+'-'+($('anesShiftEnd').value||'19:00'));
  $('anesShift').value=shift;
  var linkedUser=findRegisteredUserByName(name);
  var payload={data_escala:currentDate,nome_anestesista:name,horario_escala:shift,funcao:$('anesRole').value,observacao:$('anesObs').value,user_id:linkedUser?linkedUser.id:null};
  var resp=await api('/api/anestesistas',{method:'POST',body:JSON.stringify(payload)});
  status((resp.message||"Anestesista salvo.")+(linkedUser?' Acesso liberado para o login '+linkedUser.username+'.':''),"ok");
  $('anesName').value='';$('anesShiftStart').value='07:00';$('anesShiftEnd').value='19:00';$('anesShift').value='';$('anesRole').value='';$('anesObs').value='';
  await loadDay();
}

function fillAnesForm(id){
  if(!requireEdit())return;
  var a=anesthetists.find(x=>x.id===id); if(!a)return;
  var sh=splitShift(a.shift);
  $('anesName').value=a.name;$('anesShift').value=a.shift;$('anesShiftStart').value=sh.start;$('anesShiftEnd').value=sh.end;$('anesRole').value=a.role;$('anesObs').value=a.obs;
  setTab('escala');
}

async function deleteAnes(id){
  if(!requireEdit())return;
  if(!confirm("Remover anestesista da escala deste dia?"))return;
  await api('/api/anestesistas/'+id,{method:'DELETE'});
  await loadDay();
}

function exportJson(){
  var data={data:currentDate,cirurgias:items.map(itemToPayload),anestesistas:anesthetists};
  openModal('<h2>Exportar JSON</h2><textarea>'+html(JSON.stringify(data,null,2))+'</textarea><button class="gray" onclick="document.getElementById(\'modalBg\').click()">Fechar</button>');
}

function setTab(tab){
  if(tab!=='mapa' && mapExpanded)setMapExpanded(false);
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  document.querySelectorAll('.screen').forEach(s=>s.classList.add('hidden'));
  $('tab-'+tab).classList.remove('hidden');
  if(tab==='mapa')setTimeout(updateStickyRulerTop,0);
}

function bind(){
  document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
  $('btnRefresh').onclick=loadDay;
  $('dateInput').onchange=async function(){
    currentDate=this.value||todayISO();
    timelineMin=nowPlantaoMin();
    timelineCustom=false;
    await loadHospitals();
    await loadRoomsForHospital();
    await loadDay();
  };
  $('hospitalSelect').onchange=async function(){
    currentHospitalId=Number(this.value);
    localStorage.setItem('ccsama_hospital_id',String(currentHospitalId));
    currentHospital={id:currentHospitalId,nome:this.options[this.selectedIndex].textContent};
    loadCollapsedRoomGroups();
    await loadRoomsForHospital();
    await loadPhotoPrompt();
    await loadDay();
  };
  $('btnParse').onclick=parseImport;
  if($('btnPhotoImport'))$('btnPhotoImport').onclick=function(){$('photoImportInput').click()};
  if($('btnPastePhoto'))$('btnPastePhoto').onclick=pastePhotoFromClipboard;
  if($('photoImportInput'))$('photoImportInput').onchange=function(){handlePhotoFile(this.files&&this.files[0])};
  if($('btnSavePhotoPrompt'))$('btnSavePhotoPrompt').onclick=savePhotoPrompt;
  if($('btnReloadPhotoPrompt'))$('btnReloadPhotoPrompt').onclick=loadPhotoPrompt;
  $('btnExample').onclick=function(){$('surgeryText').value='07:00 | Oeste 03 | Colecistectomia | 120 | SMA | FC | 30\n09:30 | Lane 02 | Herniorrafia inguinal | 90 | Particular | AB | 44';parseImport()};
  $('btnClearText').onclick=function(){$('surgeryText').value='';parsedImport=[];renderImportPreview()};
  $('btnSaveImported').onclick=saveImported;
  $('importPreview').onclick=function(ev){
    var btn=ev.target.closest('[data-import-remove]');
    if(!btn)return;
    syncImportPreview();
    parsedImport.splice(Number(btn.dataset.importRemove),1);
    renderImportPreview();
  };
  $('importPreview').onchange=syncImportPreview;
  $('importPreview').oninput=syncImportPreview;
  $('btnAddSurgery').onclick=()=>openSurgeryModal();
  $('btnAddSurgery2').onclick=()=>openSurgeryModal();
  $('btnAddSurgeryImport').onclick=addImportReviewRow;
  if($('btnAnalyzeSchedule'))$('btnAnalyzeSchedule').onclick=analyzeSchedule;
  if($('btnAnalyzeSchedule2'))$('btnAnalyzeSchedule2').onclick=analyzeSchedule;
  if($('btnAutoSuggest'))$('btnAutoSuggest').onclick=applySmartSuggestions;
  if($('btnAutoSuggest2'))$('btnAutoSuggest2').onclick=applySmartSuggestions;
  if($('btnExpandMap'))$('btnExpandMap').onclick=function(){setMapExpanded(!mapExpanded)};
  function goHour(h){var sh=$('mapShell');if(sh)sh.scrollLeft=Math.max(0,labelW+(h-startHour)*hourW-80)}
  $('btnGo7').onclick=function(){goHour(7)};
  $('btnGo13').onclick=function(){goHour(13)};
  $('btnGo19').onclick=function(){goHour(19)};
  $('btnGoNow').onclick=function(){var m=getTimelineMin();goHour(Math.floor(m/60))};
  $('btnExport').onclick=exportJson;
  $('btnAddAnes').onclick=addAnes;
  $('btnParseAnes').onclick=parseAnesImport;
  $('btnExampleAnes').onclick=function(){$('anesText').value='Nome | Escala | Cargo\nRomulo Silva | 07:00-19:00 | Sala\nAna Souza | 19:00-07:00 | Noturno';parseAnesImport()};
  $('btnClearAnesText').onclick=function(){$('anesText').value='';parsedAnesImport=[];renderAnesImportPreview()};
  $('btnSaveImportedAnes').onclick=saveImportedAnes;
  if($('btnSaveAccess'))$('btnSaveAccess').onclick=saveAccess;
  if($('btnSala'))$('btnSala').onclick=function(){location.href='/sala.html?data='+encodeURIComponent(currentDate)};
  if($('btnLogoutTop'))$('btnLogoutTop').onclick=async function(){
    $('btnLogoutTop').textContent='Saindo...';
    $('btnLogoutTop').disabled=true;
    await fetch('/api/logout',{method:'POST'});
    location.href='/login.html?logout=1';
  };
  document.addEventListener('keydown',function(ev){
    if(ev.key==='Escape' && mapExpanded)setMapExpanded(false);
  });
  document.addEventListener('paste',handlePhotoPasteEvent);
}

async function boot(){
  var params=new URLSearchParams(location.search);
  currentDate=params.get('data') || todayISO();
  loadCollapsedRoomGroups();
  timelineMin=nowPlantaoMin();
  timelineCustom=false;
  $('dateInput').value=currentDate;
  bind();
  try{
    await loadHospitals();
    await loadDay();
  }catch(e){
    status("Erro no boot: "+e.message,"err");
    if(String(e.message).toLowerCase().includes('autenticado')) location.href='/login.html?next=/index_graf.html';
  }
}

window.addEventListener('resize',updateStickyRulerTop);
window.addEventListener('orientationchange',function(){setTimeout(updateStickyRulerTop,250)});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot); else boot();

})();
