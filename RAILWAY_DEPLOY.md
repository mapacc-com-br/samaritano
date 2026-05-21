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
   - `EMAIL_PROVIDER`: use `resend` no Railway quando SMTP der timeout.
   - `RESEND_API_KEY`: chave criada no Resend.
   - `RESEND_FROM`: `MAPA CC <no-reply@mapacc.com.br>`.
   - `RESEND_REPLY_TO`: `mapa_cc@outlook.com.br`.
   - `SMTP_PASS`: opcional, senha ou app password do e-mail `mapa_cc@outlook.com.br`, apenas se usar `EMAIL_PROVIDER=smtp`.
   - O fallback SMTP usa por padrao `SMTP_HOSTS=smtp-mail.outlook.com,smtp.office365.com`, `SMTP_PORT=587`, `SMTP_USER=mapa_cc@outlook.com.br`, `SMTP_FROM=mapa_cc@outlook.com.br`, `SMTP_REQUIRE_TLS=true` e `SMTP_TIMEOUT_MS=60000`.
4. Crie um volume persistente no servico e monte em `/data`.
5. Deixe `DB_FILE` vazio, ou use `/data/database.db`.
6. O Railway deve iniciar com `npm start`. O arquivo `railway.toml` tambem fixa esse comando.

## Como conferir

Depois do deploy, abra:

```text
https://SEU-DOMINIO.up.railway.app/api/health
```

Se estiver tudo certo, a resposta deve trazer `ok: true`.

Para conferir a configuracao de e-mail, entre como admin e abra:

```text
https://SEU-DOMINIO.up.railway.app/api/config-check
```

Confira `email_provider`, `email_configurado`, `resend_configurado` e `smtp_configurado`.

Para testar o provedor de e-mail ativo pelo proprio Railway, abra autenticado como admin:

```text
https://SEU-DOMINIO.up.railway.app/api/admin-config/email/test
```

Se aparecer `api_key_restricted:true`, a chave do Resend esta restrita apenas a envio. Isso e valido para reset de senha; a rota de teste apenas nao consegue listar dominios com essa chave.

Para testar especificamente SMTP:

```text
https://SEU-DOMINIO.up.railway.app/api/admin-config/smtp/test
```

Essas rotas aceitam `GET` pelo navegador e `POST` por ferramentas de API. Se SMTP retornar timeout mesmo com a senha correta, a porta SMTP de saida esta bloqueada ou o Outlook esta recusando conexoes do ambiente. Nesse caso, use `EMAIL_PROVIDER=resend`, que envia pela API HTTPS do Resend.

## Importante

O banco SQLite precisa ficar no volume. Se o volume nao estiver montado em `/data`, o servidor vai falhar de proposito para evitar perda de dados em redeploy.
