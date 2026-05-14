// server.js simples e limpo para Railway

const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// API teste
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    version: "v4-limpo"
  });
});

// Servir arquivos estáticos
app.use(express.static(__dirname));

// Sempre abrir index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Fallback
app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({
      ok: false,
      error: "API não encontrada"
    });
  }

  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log("Servidor rodando porta " + PORT);
});
