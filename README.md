# MAPA CC

Aplicacao Node/Express para mapa cirurgico, escala de anestesistas, salas, acessos por hospital e importacao assistida por imagem.

## Estrutura

- `server.js`: ponto de entrada do Railway/local.
- `src/server/`: backend Express, runtime e servico de arquivos estaticos.
- `public/`: paginas HTML servidas nas URLs atuais.
- `public/assets/css/`: estilos separados por tela e tema global.
- `public/assets/js/`: scripts separados por tela.
- `backups_legacy/`: versoes antigas e patches preservados fora do caminho principal.

## Desenvolvimento

```text
npm start
```

Por padrao o app sobe em `http://localhost:3000`.

## Deploy

O Railway inicia com `npm start`. Depois de subir as alteracoes para o GitHub, o Railway deve redeployar automaticamente quando o repositorio estiver conectado ao servico.

## Reset de senha

O reset por e-mail usa Outlook.com com os defaults abaixo:

- `SMTP_HOSTS=smtp-mail.outlook.com,smtp.office365.com`
- `SMTP_PORT=587`
- `SMTP_USER=mapa_cc@outlook.com.br`
- `SMTP_FROM=mapa_cc@outlook.com.br`
- `SMTP_REQUIRE_TLS=true`
- `SMTP_TIMEOUT_MS=60000`

No Railway, configure `SMTP_PASS` com a senha ou app password dessa conta. Tambem mantenha `APP_BASE_URL` apontando para o dominio publico do app para que o link de recuperacao saia correto.

Se o envio retornar `Connection timeout`, teste a conectividade no proprio Railway com:

```text
POST /api/admin-config/smtp/test
```

Essa rota exige login admin. Se tambem der timeout, a conexao SMTP de saida do ambiente/provedor esta bloqueada ou inacessivel; nesse caso use um provedor transacional com SMTP/API compativel e ajuste `SMTP_HOSTS`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e `SMTP_FROM`.
