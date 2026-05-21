# Deploy no Railway

Este projeto esta pronto para deploy como app Node/Express.

## Estrutura atual

- `server.js` e o ponto de entrada.
- `src/server/` contem o backend.
- `public/` contem as paginas HTML.
- `public/assets/` contem CSS e JS separados por tela.
- `backups_legacy/` guarda versoes antigas que nao entram no fluxo principal.

## GitHub

Suba apenas os arquivos do projeto. Nao suba:

- `node_modules/`
- `.env`
- `*.db`, `*.db-wal`, `*.db-shm`
- `*.log`

Esses arquivos ja estao protegidos pelo `.gitignore`.

## Railway

1. No Railway, crie um novo projeto a partir do repositorio do GitHub.
2. Selecione o servico do app Node.
3. Em `Variables`, configure:
   - `OPENAI_API_KEY`: sua chave da OpenAI, se for usar importacao por foto.
   - `OPENAI_VISION_MODEL`: `gpt-5.4-mini` ou outro modelo de visao que voce use.
   - `APP_BASE_URL`: dominio publico do app no Railway, depois que ele existir.
   - `INITIAL_ADMIN_USER`: usuario admin inicial, por exemplo `godofredo`.
   - `INITIAL_ADMIN_PASSWORD`: senha forte para o admin inicial.
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`: somente se for usar reset de senha por e-mail.
4. Crie um volume persistente no servico e monte em `/data`.
5. Deixe `DB_FILE` vazio, ou use `/data/database.db`.
6. O Railway deve iniciar com `npm start`. O arquivo `railway.toml` tambem fixa esse comando.

## Como conferir

Depois do deploy, abra:

```text
https://SEU-DOMINIO.up.railway.app/api/health
```

Se estiver tudo certo, a resposta deve trazer `ok: true`.

## Importante

O banco SQLite precisa ficar no volume. Se o volume nao estiver montado em `/data`, o servidor vai falhar de proposito para evitar perda de dados em redeploy.
