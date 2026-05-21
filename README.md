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
