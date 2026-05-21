const params = new URLSearchParams(location.search);
const hospital = params.get('hospital') || 'este hospital';
const data = params.get('data') || '';
document.getElementById('message').textContent = hospital+' aparece na sua empresa, mas seu login nao esta escalado para '+(data || 'a data selecionada')+'.';
