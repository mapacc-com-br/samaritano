const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Permite JSON
app.use(express.json());

// Serve arquivos da pasta public
app.use(express.static(path.join(__dirname, 'public')));

// Página principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Teste da API
app.get('/api/test', (req, res) => {
  res.json({ ok: true });
});

// Inicia servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
