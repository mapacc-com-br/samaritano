(function(){
  const buildLabel = '18/05/2026 22:10 BRT';
  const buildId = '2026-05-18-2210-revert-map-zoom';

  function showBadge(){
    if(document.getElementById('mapaccUpdateBadge')) return;

    const page = location.pathname.split('/').pop() || 'index.html';
    const badge = document.createElement('div');
    badge.id = 'mapaccUpdateBadge';
    badge.textContent = 'Atualizado: ' + buildLabel + ' | ' + page;
    badge.title = 'Build ' + buildId;
    badge.style.position = 'fixed';
    badge.style.left = '10px';
    badge.style.bottom = '10px';
    badge.style.zIndex = '2147483647';
    badge.style.padding = '6px 9px';
    badge.style.borderRadius = '999px';
    badge.style.background = '#0f172a';
    badge.style.color = '#fff';
    badge.style.font = '700 11px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif';
    badge.style.boxShadow = '0 8px 22px rgba(15,23,42,.22)';
    badge.style.opacity = '.88';
    badge.style.pointerEvents = 'none';
    document.body.appendChild(badge);
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', showBadge);
  }else{
    showBadge();
  }
})();
