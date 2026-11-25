# Plano: editor de desafios do dia (roadmap B4.1)

O Desafio do dia (B4) nasceu com um catálogo em código (`apps/server/src/daily/catalog.ts`), testado com as cartas do
repositório (que vão só até OP02 e alguns Starter Decks). As coleções atuais (OP17, OP18…) só existem no banco de
produção, importadas da optcgapi e da lista oficial no dia do lançamento. Por isso, para usar os decks do meta, o
desafio passa a ser montado e conferido numa tela da Administração, com as cartas reais do servidor.

**Regras que não mudam em nenhuma fase:** o servidor confere todo desafio antes de ele entrar na fila (a solução tem que
resolver e a linha errada tem que falhar, com as cartas e os textos do motor de produção); a solução nunca vai para o
navegador de quem joga; a mesa de quem joga continua sendo só a visão dele (`viewFor`).

## Fases

### Fase 1 — Desafios no banco e o editor de mesa

- Tabela `daily_challenges`: o desafio (`spec`, o `ChallengeSpec` com as listas dos dois decks congeladas no momento
  de salvar), a solução e a linha errada gravadas como ações, o nível, uma nota interna, quem criou e quando.
- A fila passa a ser o catálogo em código (a semente) mais os desafios do banco, na ordem de criação; os ainda não
  publicados vão primeiro, como antes.
- Rotas de admin: listar os desafios (do catálogo e do banco, com os dias em que saíram), salvar (o servidor monta a mesa,
  joga a solução e a linha errada e recusa o que não confere, ou que usa carta ⚙ na mesa) e apagar um desafio que
  ainda não saiu.
- Tela **Administração › Desafio do dia**: a lista e o editor. No editor: objetivo, nível, turno, o deck de cada lado
  (qualquer deck: do meta, pronto ou de jogador), as áreas de cada lado (mão, Personagens virados, com DON!! ou
  recém-jogados, Stage, Líder, Vida em quantidade ou cartas exatas, topo do deck, descarte, DON!! ativos e virados),
  a mão revelada e, no "sobreviva", o roteiro de ataques. A mesa aparece montada ao lado. Depois, **gravar jogando**: o
  admin joga na mesa (com o oponente respondendo pelas regras do desafio) e marca a tentativa como solução ou como
  linha errada.

### Fase 2 — Fila com datas e números

- Datas fixas ("este desafio no dia do torneio") e reordenar a fila arrastando.
- Por dia publicado: quantos abriram, tentaram e resolveram, e a média de tentativas.
- Editar um desafio que ainda não saiu; despublicar o de amanhã.
- Duplicar um desafio como ponto de partida de outro.

### Fase 3 — Defensor configurável

- O defensor de hoje só usa o Counter dos Personagens da mão. Com decks atuais pesam também os Eventos de Counter
  (pagando DON!!), os Blockers com efeito e o [Trigger]. Cada desafio escolhe o que o defensor pode fazer (Eventos de
  Counter, ativar Trigger, ou respostas fixas), sempre determinístico e dito no enunciado.
- Texto livre do enunciado por desafio, nos seis idiomas quando houver tradução.
