"use strict";

const express = require("express");
const path = require("path");

function noStore(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml; charset=utf-8";
  return "";
}

function configureStaticAssets(app, { publicDir }) {
  app.use(express.static(publicDir, {
    index: "index.html",
    setHeaders(res, filePath) {
      const contentType = contentTypeFor(filePath);
      if (contentType) res.setHeader("Content-Type", contentType);
      if (/\.(html|js|css)$/i.test(filePath)) noStore(res);
    }
  }));

  app.use("/api", (req, res) => {
    res.status(404).json({ error: "API nao encontrada." });
  });

  app.use((req, res) => {
    noStore(res);
    res.status(404).type("text/plain").send("Pagina nao encontrada.");
  });
}

module.exports = {
  configureStaticAssets,
  noStore
};
