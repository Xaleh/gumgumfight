# Apoio ao projeto

O GumGum Fight aceita doação avulsa ("me pague um café") e apoio mensal em quatro planos. Nenhum plano dá vantagem
dentro da partida: jogar, montar decks e entrar em torneios continua grátis para todo mundo. Nada da Bandai, da Toei
ou da Shueisha aparece em recompensas, banners ou divulgação.

## Planos

| Plano | Valor | O que libera |
|---|---|---|
| Grumete | R$ 5/mês | Nome na lista de Apoiadores (se a pessoa quiser) e badge no Discord |
| Tripulante | R$ 15/mês | Tudo do Grumete, Estatísticas Pro (ranqueada, torneios e filtro por faixa de recompensa), homologação e voto no roadmap |
| Capitão | R$ 30/mês | Tudo do Tripulante, organizar até 5 torneios por mês de até 64 jogadores e nome nos créditos |
| Almirante | R$ 50/mês | Tudo do Capitão, prioridade de inscrição nos torneios premiados do time e destaque na lista de Apoiadores |

Os valores e os textos dos planos ficam em `apps/server/src/support/tiers.ts`.

## Como o plano chega na conta

- **Ko-fi**: a assinatura chega pelo webhook e liga o plano na conta Google com o mesmo e-mail, por 35 dias a partir
  de cada pagamento. Se a pessoa assinar antes de entrar no site, o plano entra no primeiro login. O Ko-fi não avisa
  cancelamento: o plano vence sozinho quando os pagamentos param.
- **Pix mensal, parceria ou cortesia**: o admin dá o plano à mão em Administração → Perfis das contas → Apoio, com ou
  sem data de fim.
- O plano é reconhecido pelo **nome** no Ko-fi (Grumete, Tripulante, Capitão, Almirante; com ou sem acento). Se o nome
  não bater, vale o valor em reais.

## Arquivos desta pasta

- [`textos-ko-fi.md`](textos-ko-fi.md): descrição da página, os 4 planos e a mensagem de agradecimento, prontos para colar.
- [`regulamento-torneio-da-tripulacao.md`](regulamento-torneio-da-tripulacao.md): modelo do regulamento do torneio do time.
- [`proposta-lojas.md`](proposta-lojas.md): proposta para lojas patrocinadoras, com as regras dos banners.

## Passo a passo (o que é feito à mão)

1. Criar uma **chave Pix aleatória** no banco (não use CPF nem telefone: a chave fica pública no site).
2. Criar a conta no **Ko-fi**, conectar PayPal ou Stripe e ativar **Memberships** com os 4 planos de
   [`textos-ko-fi.md`](textos-ko-fi.md). Os nomes dos planos precisam ser exatamente Grumete, Tripulante, Capitão e Almirante.
3. No Ko-fi, em **Settings → API**, colar a Webhook URL `https://gumgumfight.app/api/support/kofi` e copiar o
   *Verification Token*.
4. Preencher o `deploy.env` da produção e da homologação e recarregar o pm2 (veja a seção 7 de
   [`deploy/HOSTINGER.md`](../../deploy/HOSTINGER.md)).
5. No Ko-fi, usar "Send Test" no webhook e conferir em Administração → Apoios recebidos.
6. No celular, abrir "Apoiar o projeto" e ler o QR do Pix com o app do banco (confere nome, cidade e valor).
7. Discord: cargos Grumete, Tripulante, Capitão, Almirante e "Campeão do mês"; canal de enquetes do roadmap só para
   Tripulante ou acima.
8. Lojas: mandar a [proposta](proposta-lojas.md), cadastrar a loja em Administração → Lojas parceiras e escolher a loja
   no formulário do torneio do time.
9. Conferir com um contador: doações e assinaturas recebidas por pessoa física (Carnê-Leão quando houver imposto) e
   nota fiscal do patrocínio das lojas (o MEI resolve).

## Torneios do time

O Torneio da Tripulação é aberto e gratuito para todos e decidido por habilidade. Os Almirantes só têm prioridade:
nas primeiras 48 horas, só eles se inscrevem, e quem se inscreve tem a vaga garantida. Isso mantém o torneio fora da
exigência de autorização da Lei 5.768/71, que vale quando há pagamento para concorrer ao prêmio. O prêmio vem da loja
patrocinadora; sem patrocínio fechado, o torneio acontece com prêmio simbólico (destaque no site e cargo "Campeão do
mês" no Discord). Nunca anuncie uma box sem o patrocínio confirmado.
