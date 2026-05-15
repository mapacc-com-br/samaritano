# Mapa de Cirurgias por Dia

Sistema Node + Express + SQLite para Railway.

## Recursos

- Banco persistente em `/data/database.db`
- Cirurgias com data
- Escala de anestesistas por data
- Navegação por data no topo
- CRUD de cirurgias
- CRUD de anestesistas do dia
- DB inspector
- Proteção contra duplicidade por data + iniciais + idade

## Estrutura

```txt
server.js
package.json
public/
  index.html
```

## Railway

Crie um Volume com mount path:

```txt
/data
```

Depois faça deploy normalmente.
