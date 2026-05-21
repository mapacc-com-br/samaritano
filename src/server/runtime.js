"use strict";

function startServer({ app, db, initDb, port }) {
  return initDb()
    .then(() => {
      const server = app.listen(port, "0.0.0.0", () => {
        console.log(`Servidor rodando na porta ${port}`);
      });

      server.on("error", (err) => {
        if (err.code === "EADDRINUSE") {
          console.error("");
          console.error(`Porta ${port} ja esta em uso.`);
          console.error("Provavelmente existe outro servidor do MAPA CC aberto.");
          console.error(`Feche o outro terminal/processo Node ou inicie com outra porta: $env:PORT='3010'; npm start`);
        } else {
          console.error("Erro no servidor:", err);
        }
        db.close(() => process.exit(1));
      });

      return server;
    })
    .catch((err) => {
      console.error("Erro ao iniciar:", err);
      process.exit(1);
    });
}

function registerShutdown(db) {
  process.on("SIGINT", () => db.close(() => process.exit(0)));
  process.on("SIGTERM", () => db.close(() => process.exit(0)));
}

module.exports = {
  startServer,
  registerShutdown
};
