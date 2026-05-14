const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Pasta pública
const publicDir = path.join(__dirname, 'public');

// Servir arquivos estáticos
app.use(express.static(publicDir));

// Página principal
app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'celv4.html'));
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
