"use strict";

const { app, db, initDb, config } = require("./src/server/app");
const { registerShutdown, startServer } = require("./src/server/runtime");

registerShutdown(db);
startServer({
  app,
  db,
  initDb,
  port: config.PORT
});
