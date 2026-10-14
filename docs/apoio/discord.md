# Planos de apoio no Discord

A Apoia.se não tem integração com o Discord. Há dois caminhos, do mais simples ao automático.

## 1. Começo: cargos à mão (sem código)

1. No servidor do Discord, crie os cargos `Grumete`, `Tripulante`, `Capitão`, `Almirante` e `Campeão do mês`.
2. Crie o canal de enquetes do roadmap visível só para `Tripulante`, `Capitão` e `Almirante`.
3. Uma vez por semana, confira Administração → Apoios recebidos e ajuste os cargos.

Serve enquanto houver poucos apoiadores.

## 2. Automático: Linked Roles (recomendado)

O Discord tem os **Linked Roles**: o cargo exige um dado vindo de um aplicativo conectado, e o próprio Discord dá e tira
o cargo quando o dado muda. Não precisa de um bot rodando o tempo todo.

Como fica para o apoiador:

1. No Discord, ele abre o menu do servidor → **Linked Roles** → GumGum Fight.
2. O Discord abre o site; ele entra com a conta Google (a mesma do plano) e autoriza.
3. O site manda ao Discord o nível do plano (`tier`: 1 Grumete, 2 Tripulante, 3 Capitão, 4 Almirante) e o Discord dá
   os cargos cuja exigência ele cumpre.
4. Quando o plano muda ou vence (sincronização da Apoia.se, plano manual ou dia 10), o site atualiza o nível e o
   Discord tira ou troca o cargo sozinho.

O que é feito à mão, uma vez:

1. No [Discord Developer Portal](https://discord.com/developers/applications), criar o aplicativo "GumGum Fight".
2. Em **General Information**, preencher **Linked Roles Verification URL** com
   `https://gumgumfight.app/api/discord/linked-role`.
3. Em **OAuth2**, adicionar o redirect `https://gumgumfight.app/api/discord/callback` e copiar Client ID e Client
   Secret; em **Bot**, gerar o token (usado só para registrar o campo `tier`).
4. Colocar no `deploy.env` da produção: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`.
5. No servidor do Discord, em cada cargo → **Links** → GumGum Fight → "tier é maior ou igual a" 1, 2, 3 ou 4.

O que fica com o código (próxima etapa, depois que o servidor do Discord existir):

- Registrar o campo `tier` no aplicativo (`PUT /applications/<id>/role-connections/metadata`).
- Rotas `/api/discord/linked-role` e `/api/discord/callback` (OAuth2 com os escopos `identify` e
  `role_connections.write`), ligando a conta do Discord à conta Google logada.
- Guardar o token de atualização do Discord e enviar o novo `tier`
  (`PUT /users/@me/applications/<id>/role-connection`) sempre que o plano mudar ou vencer.
- Na Administração, mostrar quem ligou o Discord.
