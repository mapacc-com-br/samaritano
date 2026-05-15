# SQLite Railway Pro

Projeto completo para Railway com Node.js, Express e SQLite.

## Estrutura correta

```txt
server.js
package.json
public/
  index.html
```

## Rotas de teste

Depois do deploy, teste:

```txt
/api/health
/api/routes
/api/pessoas
/api/db-inspector
```

Exemplo:

```txt
https://SEU-DOMINIO.up.railway.app/api/health
```

Se `/api/health` mostrar `Cannot GET /api/health`, então o Railway não está executando este `server.js`.

## Rodar local

```bash
npm install
npm start
```

Abrir:

```txt
http://localhost:3000
```

## Railway

O comando de start é:

```bash
npm start
```

O arquivo `database.db` será criado automaticamente.