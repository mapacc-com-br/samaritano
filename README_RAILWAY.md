# CC Sama Bolso — versão SQLite

Arquivos principais:
- `Celv1_sqlite.html`: interface do mapa, agora lendo/salvando pela API.
- `server.js`: servidor Node/Express com SQLite.
- `package.json`: dependências e comando de start.

## Rodar localmente
```bash
npm install
npm start
```
Depois abrir:
```txt
http://localhost:3000
```

## Subir no Railway
1. Coloque estes arquivos no repositório GitHub.
2. No Railway, conecte esse repo.
3. O Railway deve detectar Node.js.
4. Start command: `npm start`.

Observação: em produção, configure um volume/pasta persistente no Railway para o SQLite não ser perdido em redeploys. Você pode usar a variável:
```txt
DATA_DIR=/data
```
