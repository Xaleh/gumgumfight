# Apoio ao projeto

O GumGum Fight aceita doação avulsa pelo Pix ("Doe um Cafezim") e apoio mensal na **Apoia.se**, em quatro planos.
Nenhum plano dá vantagem dentro da partida: jogar, montar decks e entrar em torneios continua grátis para todo mundo.
Nada da Bandai, da Toei ou da Shueisha aparece em recompensas, banners ou divulgação.

A Apoia.se foi escolhida porque o público é brasileiro: aceita Pix, boleto e cartão, em reais, numa página em
português. O Ko-fi continua no código, desligado, para quando houver público de fora do Brasil (variável
`KOFI_WEBHOOK_TOKEN`).

## Planos

| Plano | Valor | O que libera |
|---|---|---|
| Grumete | R$ 5/mês | Nome na lista de Apoiadores (se a pessoa quiser) e badge no Discord |
| Tripulante | R$ 15/mês | Tudo do Grumete, Estatísticas Pro (ranqueada, torneios e filtro por faixa de recompensa), homologação e voto no roadmap |
| Capitão | R$ 30/mês | Tudo do Tripulante, organizar até 5 torneios por mês de até 64 jogadores e nome nos créditos |
| Almirante | R$ 50/mês | Tudo do Capitão, prioridade de inscrição nos torneios premiados do time e destaque na lista de Apoiadores |

Os valores ficam em `apps/server/src/support/tiers.ts`; os textos da tela, em `apps/web/src/i18n/support/`.

## Como o plano chega na conta (Apoia.se)

A Apoia.se tem uma API pública, mas não avisa o site quando alguém apoia (não tem webhook). Por isso é o site que
pergunta, pelo e-mail da conta Google, se a pessoa apoia a campanha e quanto pagou no mês:

```
GET https://api.apoia.se/backers/charges/<e-mail>
x-api-key: <APOIASE_API_KEY>
Authorization: Bearer <APOIASE_API_SECRET>
→ { "isBacker": true, "isPaidThisMonth": true, "thisMonthPaidValue": 30 }
```

- **Quando o site pergunta:** no login, quando a pessoa toca em "Já apoio: verificar" no "Apoiar o projeto" (no
  máximo uma vez a cada 30 segundos) e, a cada 6 horas, para quem já tem plano da Apoia.se (`APOIASE_SYNC`).
- **Qual plano:** o do valor pago no mês (R$ 5 Grumete, R$ 15 Tripulante, R$ 30 Capitão, R$ 50 Almirante; valores
  acima de um plano contam como esse plano).
- **Até quando:** até o dia 10 do mês seguinte, às 23:59 de Brasília. A folga cobre o cartão, que é cobrado no 1º
  dia útil, e o boleto, que leva até 3 dias para compensar. No começo do mês a API pode responder "não pago" sem que o
  apoio tenha parado; por isso uma resposta "não pago" não tira o plano. Quem cancela perde o plano sozinho no dia 10.
- **E-mail:** só e-mails confirmados pelo Google. Quem apoia na Apoia.se com outro e-mail recebe o plano à mão.
- **Registro:** cada mês pago aparece em Administração → Apoios recebidos.
- **Plano manual:** Pix mensal, parceria ou cortesia: o admin dá o plano em Administração → Perfis das contas → Apoio,
  com ou sem data de fim. Um plano manual maior não é rebaixado pela Apoia.se.

## Arquivos desta pasta

- [`textos-apoiase.md`](textos-apoiase.md): texto da campanha na Apoia.se, as 4 recompensas e a mensagem de agradecimento.
- [`post-inauguracao.md`](post-inauguracao.md): post de abertura da página, com versões curtas para redes sociais e Discord.
- [`midia/`](midia/README.md): banner, foto de perfil, imagem dos planos, post e story; GIFs e trailers saem de `scripts/divulgacao/gerar.sh`.
- [`regulamento-torneio-da-tripulacao.md`](regulamento-torneio-da-tripulacao.md): modelo do regulamento do torneio do time.
- [`proposta-lojas.md`](proposta-lojas.md): proposta para lojas patrocinadoras, com as regras dos banners.
- [`discord.md`](discord.md): como os planos viram cargos no Discord.

## Passo a passo (o que é feito à mão)

1. Criar uma **chave Pix aleatória** no banco (não use CPF nem telefone: a chave fica pública no site).
2. Criar a campanha **recorrente** na Apoia.se com as 4 recompensas de [`textos-apoiase.md`](textos-apoiase.md).
3. Pedir a **chave da API** na Central de Ajuda da Apoia.se (artigo "API Pública da APOIA.se"). Ela chega no e-mail
   principal da campanha: `APOIASE_API_KEY` e `APOIASE_API_SECRET`.
4. Preencher o `deploy.env` da produção (e o da homologação) e recarregar o pm2: seção 7 de
   [`deploy/HOSTINGER.md`](../../deploy/HOSTINGER.md).
5. Testar: apoiar com o próprio e-mail, entrar no site e tocar em "Já apoio: verificar". Conferir em Administração →
   Apoios recebidos.
6. No celular, abrir "Apoiar o projeto" e ler o QR do "Doe um Cafezim" com o app do banco.
7. Discord: seguir [`discord.md`](discord.md).
8. Lojas: mandar a [proposta](proposta-lojas.md), cadastrar a loja em Administração → Lojas parceiras e escolher a loja
   no formulário do torneio do time.
9. Conferir com um contador: apoios recebidos por pessoa física (Carnê-Leão quando houver imposto; a Apoia.se emite
   informe dos repasses) e nota fiscal do patrocínio das lojas (o MEI resolve).

## Torneios do time

O Torneio da Tripulação é aberto e gratuito para todos e decidido por habilidade. Os Almirantes só têm prioridade:
nas primeiras 48 horas, só eles se inscrevem, e quem se inscreve tem a vaga garantida. Isso mantém o torneio fora da
exigência de autorização da Lei 5.768/71, que vale quando há pagamento para concorrer ao prêmio. O prêmio vem da loja
patrocinadora; sem patrocínio fechado, o torneio acontece com prêmio simbólico (destaque no site e cargo "Campeão do
mês" no Discord). Nunca anuncie uma box sem o patrocínio confirmado.
