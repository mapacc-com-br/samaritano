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

O reset por e-mail agora aceita dois provedores:

- `resend`: recomendado no Railway, porque usa HTTPS e evita timeout de porta SMTP.
- `smtp`: fallback para Outlook.com se a hospedagem permitir SMTP.

Variaveis recomendadas para Railway:

- `EMAIL_PROVIDER=resend`
- `RESEND_API_KEY=re_...`
- `RESEND_FROM=MAPA CC <no-reply@mapacc.com.br>`
- `RESEND_REPLY_TO=mapa_cc@outlook.com.br`
- `APP_BASE_URL=https://www.mapacc.com.br`

No Resend, verifique o dominio `mapacc.com.br`. Depois de verificado, o envio pode sair de `no-reply@mapacc.com.br`; o Outlook `mapa_cc@outlook.com.br` fica como resposta.

O fallback SMTP Outlook.com usa os defaults abaixo:

- `SMTP_HOSTS=smtp-mail.outlook.com,smtp.office365.com`
- `SMTP_PORT=587`
- `SMTP_USER=mapa_cc@outlook.com.br`
- `SMTP_FROM=mapa_cc@outlook.com.br`
- `SMTP_REQUIRE_TLS=true`
- `SMTP_TIMEOUT_MS=60000`

Para SMTP, configure `SMTP_PASS` com a senha ou app password dessa conta. Tambem mantenha `APP_BASE_URL` apontando para o dominio publico do app para que o link de recuperacao saia correto.

Para testar o provedor atual pelo proprio Railway, entre como admin e abra:

```text
GET /api/admin-config/email/test
```

Se a resposta indicar `api_key_restricted:true`, a chave do Resend esta restrita apenas a envio. Isso e aceitavel e mais seguro; a rota apenas nao consegue listar dominios com essa chave.

Para testar especificamente SMTP:

```text
GET /api/admin-config/smtp/test
```

Essas rotas tambem aceitam `POST` e exigem login admin. Se o SMTP retornar timeout mesmo com senha correta, a conexao SMTP de saida do ambiente/provedor esta bloqueada ou inacessivel; use `EMAIL_PROVIDER=resend`.

## Importacao de cirurgias

O formato preferencial de importacao e:

```text
Inicio | Sala | Atendimento | Cirurgia | Cirurgiao | Duracao | Servico | Iniciais | Idade | Obs opcional
```

A deduplicacao principal usa `Atendimento + Iniciais + Idade` dentro do hospital. Linhas antigas sem atendimento ainda usam o criterio legado por data, procedimento, iniciais e idade como fallback.
