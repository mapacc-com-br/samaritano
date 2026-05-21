# Relatorio da refatoracao

Data: 2026-05-21

## Objetivo

Reduzir tamanho e complexidade aparente do projeto, separar HTML/CSS/JS, mover versoes antigas para `backups_legacy`, modularizar a inicializacao do backend e preservar as URLs atuais.

## Removido do fluxo principal

- `index.html` da raiz foi movido para `backups_legacy/frontend/index-root-legacy.html`.
- `auth_patch_para_server.js` foi movido para `backups_legacy/backend/auth_patch_para_server.js`.
- `README_LOGIN.txt` foi movido para `backups_legacy/docs/README_LOGIN.txt`.
- As copias completas `public/usuarios1.html` e `public/reg.html` foram substituidas por redirecionamentos pequenos para `public/usuarios.html`.
- `public/mapacc-theme.css` e `public/mapacc-version.js` foram movidos para `public/assets/`.

## Unificado

- `usuarios.html`, `usuarios1.html` e `reg.html`: `usuarios.html` virou a tela canonica; as outras URLs redirecionam.
- Tema global e badge de versao: agora ficam em `public/assets/css/theme.css` e `public/assets/js/version.js`.
- Servico de arquivos estaticos: centralizado em `src/server/static-assets.js`.
- Inicializacao e encerramento do servidor: centralizados em `src/server/runtime.js`.
- Rotas alias de usuarios (`/api/users-update`, `/api/users/update`, `/api/users-delete`, `/api/users/delete`) agora usam handlers compartilhados.
- Entry point: `server.js` agora apenas carrega `src/server/app.js` e inicia o runtime.

## Separacao frontend

- `public/index_graf.html` agora referencia:
  - `public/assets/css/mapa.css`
  - `public/assets/js/mapa.js`
- `public/sala.html` agora referencia:
  - `public/assets/css/sala.css`
  - `public/assets/js/sala.js`
- `public/login.html`, `public/reset_senha.html`, `public/sem_escala.html`, `public/index.html` e `public/usuarios.html` tambem tiveram CSS/JS extraidos.

## Estrutura resultante

- `server.js`: entry point pequeno.
- `src/server/app.js`: aplicacao Express e rotas atuais.
- `src/server/runtime.js`: boot/shutdown do servidor.
- `src/server/static-assets.js`: headers, cache e fallback 404.
- `public/*.html`: HTMLs curtos preservando URLs.
- `public/assets/css`: estilos por tela e tema global.
- `public/assets/js`: scripts por tela e badge de versao.
- `backups_legacy`: arquivos antigos preservados.

## Validacoes executadas

- `node --check` em `server.js`, `src/server/app.js`, `src/server/runtime.js`, `src/server/static-assets.js`.
- `node --check` em todos os arquivos `public/assets/js/*.js`.
- Servidor local em `PORT=3003`.
- `GET /api/health` retornou `200`.
- Rotas HTML principais retornaram `200` com `text/html; charset=utf-8`.
- Assets CSS/JS retornaram `200` com `charset=utf-8`.
- Varredura de caracteres quebrados retornou `bad=0` nas paginas e assets testados.

## Riscos

- `src/server/app.js` ainda concentra muitas rotas e regras de negocio. Ele foi tirado da raiz e a inicializacao foi modularizada, mas uma segunda etapa pode dividir rotas por dominio.
- Links para `/admin_clinicas.html` ja aparecem no projeto, mas esse arquivo nao existe neste workspace. Mantive o comportamento atual e registrei como risco.
- Os redirecionamentos de `/usuarios1.html` e `/reg.html` usam meta refresh. Funcionam para preservar URLs antigas, mas o ideal futuro e remover referencias antigas.
- Nao ha suite automatizada de testes de API/UI; a validacao foi sintatica e por requisicoes HTTP.

## Melhorias futuras

- Separar `src/server/app.js` em `routes/auth`, `routes/cirurgias`, `routes/hospitais`, `routes/users`, `services` e `repositories`.
- Adicionar testes automatizados para login, acesso por hospital, importacao, CRUD de cirurgias e CRUD de usuarios.
- Criar build/minificacao para `public/assets/js/mapa.js`.
- Remover handlers inline de HTML restantes, como `onclick`, quando houver tempo para revisar tela por tela.
- Criar a tela ausente `/admin_clinicas.html` ou remover links que apontam para ela.
