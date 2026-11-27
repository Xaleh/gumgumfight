// Gera as imagens do kit de Instagram (perfil, posts e stories) a partir de HTML.
//   node marketing/instagram/src/build.mjs            → todas
//   node marketing/instagram/src/build.mjs 03 stories → só as que têm "03" ou "stories" no caminho
// Precisa do Playwright (Chromium) e de internet para as fontes do Google (Bangers e Nunito).
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const SRC = dirname(fileURLToPath(import.meta.url));
const OUT = join(SRC, '..');
const ICONS = JSON.parse(readFileSync(join(SRC, 'icons.json'), 'utf8'));

const URL_TEXT = 'gumgumfight.app';
const DISCLAIMER = 'Projeto de fã, sem vínculo com a Bandai, Toei Animation ou Shueisha.';

const icon = (name) => `<svg viewBox="0 0 24 24">${ICONS[name]}</svg>`;
const foot = (right = `<span class="url">${URL_TEXT}</span>`) => `<div class="foot"><img src="logo.svg" alt="">${right}</div>`;
const count = (i, n) => `<div class="count">${i}/${n}</div>`;
const chips = (list, cls = '') => `<div class="chips ${cls}">${list.map((c) => `<span class="chip">${c}</span>`).join('')}</div>`;
const phone = (img, { w = 470, rot = 4, top = '0' } = {}) =>
  `<div class="phone" style="--pw:${w}px;--rot:${rot}deg;--top:${top}"><div><img src="shots/${img}" alt=""></div></div>`;

/** Slide com título em cima, texto e chips à esquerda e o celular à direita. */
function phoneSlide({ eyebrow, title, lead, list, img, top, n }) {
  return `
  <div class="layer pad col" style="gap:26px">
    <div class="eyebrow">${eyebrow}</div>
    <div class="h h2">${title}</div>
    <div class="lead" style="margin-top:10px;max-width:900px">${lead}</div>
  </div>
  <div class="layer" style="top:600px;left:80px;right:auto;bottom:auto;width:400px">
    <div class="chips" style="flex-direction:column;align-items:flex-start">${list.map((c) => `<span class="chip">${c}</span>`).join('')}</div>
  </div>
  <div class="layer" style="left:auto;right:96px;top:570px;bottom:auto">${phone(img, { top })}</div>
  ${n ? count(n[0], n[1]) : ''}
  ${foot('')}`;
}

/** Slide de um modo de jogo, com a cor que ele tem na tela inicial do app. */
function modeSlide({ color, ico, tag, title, lead, list, n }) {
  return `
  <div class="layer pad col" style="justify-content:center;padding-top:150px;padding-bottom:200px">
    <div class="mode col" style="--c:${color};gap:30px">
      <div class="ico">${icon(ico)}</div>
      <div class="tag" style="margin-top:10px">${tag}</div>
      <div class="h h2" style="margin-top:-6px">${title}</div>
      <div class="lead" style="margin-top:8px">${lead}</div>
      ${chips(list)}
    </div>
  </div>
  ${count(n[0], n[1])}
  ${foot()}`;
}

const flag = {
  br: '<rect width="3" height="2" fill="#239b4a"/><path d="M1.5 .22 2.72 1 1.5 1.78 .28 1Z" fill="#f7cd48"/><circle cx="1.5" cy="1" r=".42" fill="#2a4fa8"/>',
  gb: '<rect width="3" height="2" fill="#24408e"/><path d="M0 0 3 2M3 0 0 2" stroke="#fff" stroke-width=".4"/><path d="M0 0 3 2M3 0 0 2" stroke="#c9322b" stroke-width=".16"/><path d="M1.5 0V2M0 1H3" stroke="#fff" stroke-width=".6"/><path d="M1.5 0V2M0 1H3" stroke="#c9322b" stroke-width=".34"/>',
  es: '<rect width="3" height="2" fill="#c9322b"/><rect y=".5" width="3" height="1" fill="#f7cd48"/>',
  jp: '<rect width="3" height="2" fill="#fff"/><circle cx="1.5" cy="1" r=".6" fill="#c9322b"/>',
  fr: '<rect width="3" height="2" fill="#fff"/><rect width="1" height="2" fill="#24408e"/><rect x="2" width="1" height="2" fill="#c9322b"/>',
  de: '<rect width="3" height="2" fill="#c9322b"/><rect width="3" height=".667" fill="#1c1c1c"/><rect y="1.333" width="3" height=".667" fill="#f7cd48"/>',
};
const lang = (code, name, hello) => `<div class="lang"><div class="flag"><svg viewBox="0 0 3 2" preserveAspectRatio="none">${flag[code]}</svg></div><b>${name}</b><span>${hello}</span></div>`;

const highlight = (ico, label) => ({
  cls: 'story burst vignette',
  html: `<div class="layer col center" style="justify-content:center;gap:54px;--bx:50%;--by:50%">
    <div class="ico big round">${icon(ico)}</div>
    <div class="h h3 y">${label}</div>
  </div>`,
});

const slides = {
  // ---------------------------------------------------------------- perfil
  'perfil/avatar': { cls: 'square', html: `<img src="app-icon.svg" style="width:1080px;height:1080px;display:block" alt="">` },
  'perfil/destaque-jogar': highlight('swords', 'Jogar'),
  'perfil/destaque-decks': highlight('deck', 'Decks'),
  'perfil/destaque-torneios': highlight('crown', 'Torneios'),
  'perfil/destaque-aprender': highlight('learn', 'Aprender'),
  'perfil/destaque-novidades': highlight('star', 'Novidades'),
  'perfil/destaque-apoiar': highlight('heart', 'Apoiar'),

  // ------------------------------------------------- 01: carrossel de apresentação
  'posts/01-apresentacao-1': {
    cls: 'burst vignette',
    html: `<div class="layer pad col center" style="--by:36%;justify-content:flex-start;gap:0">
      <img src="mark.svg" style="height:430px;margin-top:6px;filter:drop-shadow(14px 18px 0 #1f0904)" alt="">
      <div class="eyebrow" style="margin-top:44px">One Piece Card Game</div>
      <div class="h h1" style="margin-top:20px">Direto do<br><em>navegador</em></div>
      <div class="chips" style="margin-top:56px"><span class="chip solid">Grátis</span><span class="chip solid">Sem instalar</span><span class="chip solid">Celular ou PC</span></div>
    </div>
    ${foot('<span class="swipe">arrasta ➜</span>')}`,
  },
  'posts/01-apresentacao-2': {
    cls: 'deep burst',
    html: phoneSlide({ eyebrow: 'Treino', title: 'Treine<br>contra o <em>bot</em>', lead: 'Qualquer deck, sem fila e sem pressa.', list: ['3 níveis de bot', 'Desfazer jogada', 'Sem login'], img: 'mesa.jpg', n: [2, 6] }),
  },
  'posts/01-apresentacao-3': {
    cls: 'deep burst',
    html: phoneSlide({ eyebrow: 'Online', title: 'Jogue contra<br><em>gente de verdade</em>', lead: 'Fila casual, ranqueada com bounty ou sala privada com os amigos.', list: ['Partida rápida', 'Ranqueada', 'Sala privada'], img: 'modos.jpg', n: [3, 6] }),
  },
  'posts/01-apresentacao-4': {
    cls: 'deep burst',
    html: phoneSlide({ eyebrow: 'Decks', title: 'Monte e teste<br><em>seus decks</em>', lead: 'Mais de 3.000 cartas, decks prontos e importação de lista.', list: ['Curva de custo', 'Importar lista', 'Decks da comunidade'], img: 'decks.jpg', n: [4, 6] }),
  },
  'posts/01-apresentacao-5': {
    cls: 'deep burst',
    html: `<div class="layer pad col" style="gap:26px">
      <div class="eyebrow">Eventos</div>
      <div class="h h2">Torneios da<br><em>comunidade</em></div>
      <div class="lead" style="margin-top:10px">Com chave, rodadas e relógio. Tudo dentro do app.</div>
      ${chips(['Suíço com top cut', 'Mata-mata', 'Melhor de 1, 3 ou 5'])}
      <div class="bracket" style="margin-top:36px;align-self:center;transform:scale(1.12);transform-origin:top center">
        <div class="r"><div class="m w"></div><div class="m"></div><div class="m"></div><div class="m w"></div></div>
        <div class="r" style="gap:108px"><div class="l" style="height:88px"></div><div class="l" style="height:88px"></div></div>
        <div class="r" style="gap:108px"><div class="m w"></div><div class="m"></div></div>
        <div class="r"><div class="l" style="height:172px"></div></div>
        <div class="r"><div class="m w" style="display:grid;place-items:center;height:96px;width:220px;color:#3d1308">${icon('crown').replace('<svg', '<svg width="56" height="56" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"')}</div></div>
      </div>
    </div>
    ${count(5, 6)}${foot('')}`,
  },
  'posts/01-apresentacao-6': {
    cls: 'burst vignette',
    html: `<div class="layer pad col center" style="--by:40%;justify-content:center;gap:40px;padding-bottom:230px">
      <div class="h h1 y">Bora<br>jogar?</div>
      <div class="lead" style="max-width:820px">Abra no navegador e jogue agora.<br>É de graça.</div>
      <div class="btn" style="margin-top:14px">${URL_TEXT}</div>
      <div class="chip" style="margin-top:6px">Link na bio</div>
    </div>
    <div class="foot" style="justify-content:center;flex-direction:column;gap:22px"><img src="logo.svg" alt=""><div class="note">${DISCLAIMER}</div></div>`,
  },

  // ------------------------------------------------------ 02: carrossel dos modos
  'posts/02-modos-1': {
    cls: 'burst vignette',
    html: `<div class="layer pad col center" style="--by:42%;justify-content:center;gap:36px;padding-bottom:210px">
      <div class="eyebrow">Escolha seu modo</div>
      <div class="h h1"><em>5 jeitos</em><br>de jogar</div>
      <div style="display:flex;gap:22px;margin-top:30px">
        ${[['trophy', '#d23b2e'], ['swords', '#239062'], ['key', '#2f6db5'], ['bot', '#9b59b6'], ['crown', '#d3a80d']].map(([i, c]) => `<div class="ico" style="--c:${c};background:#182c44;border:4px solid ${c}">${icon(i)}</div>`).join('')}
      </div>
    </div>
    ${foot('<span class="swipe">arrasta ➜</span>')}`,
  },
  'posts/02-modos-2': { cls: 'deep burst', html: modeSlide({ color: '#e0523f', ico: 'trophy', tag: 'Competitivo', title: 'Ranqueada', lead: 'Vale bounty. Você enfrenta quem está perto do seu nível e sobe de East Blue até Yonkou.', list: ['Login com Google', 'Só cartas lançadas'], n: [2, 6] }) },
  'posts/02-modos-3': { cls: 'deep burst', html: modeSlide({ color: '#2fae78', ico: 'swords', tag: 'Casual', title: 'Partida rápida', lead: 'Sem bounty em jogo. Ideal para testar um deck novo.', list: ['Qualquer deck válido', 'Relógio de 17:30'], n: [3, 6] }) },
  'posts/02-modos-4': { cls: 'deep burst', html: modeSlide({ color: '#4d8fe0', ico: 'key', tag: 'Com amigos', title: 'Sala privada', lead: 'Crie uma sala e mande o código, ou entre na sala de um amigo.', list: ['Código de sala', 'Dá para transmitir'], n: [4, 6] }) },
  'posts/02-modos-5': { cls: 'deep burst', html: modeSlide({ color: '#a765c9', ico: 'bot', tag: 'Treino', title: 'Contra o bot', lead: 'Treine com qualquer deck, sem fila e sem pressa.', list: ['Roda no seu navegador', 'Sem login'], n: [5, 6] }) },
  'posts/02-modos-6': { cls: 'deep burst', html: modeSlide({ color: '#e6bb1e', ico: 'crown', tag: 'Eventos', title: 'Torneios', lead: 'Torneios da comunidade, com chave, rodadas e relógio.', list: ['Suíço e mata-mata', 'Melhor de 1, 3 ou 5'], n: [6, 6] }) },

  // ------------------------------------------------------------ posts avulsos
  'posts/03-aprenda-do-zero': {
    cls: 'burst',
    html: `<div class="layer pad col" style="gap:26px;--bx:78%;--by:70%">
      <div class="eyebrow">Novo no One Piece Card Game?</div>
      <div class="h h2">Aprenda<br><em>do zero</em></div>
      <div class="lead" style="margin-top:10px;max-width:900px">Lições curtas, jogadas na mesa de verdade, com um deck pronto.</div>
    </div>
    <div class="layer" style="top:600px;left:80px;right:auto;bottom:auto;width:390px">
      <div class="col" style="gap:18px">
        <div class="kpi"><b>14</b><span>lições</span></div>
        <div class="kpi"><b>~57</b><span>minutos no total</span></div>
        <div class="kpi"><b>0</b><span>cadastros (sem login)</span></div>
      </div>
    </div>
    <div class="layer" style="left:auto;right:96px;top:580px;bottom:auto">${phone('aprender.jpg')}</div>
    ${foot('')}`,
  },
  'posts/04-ranqueada-bounty': {
    cls: 'deep burst',
    html: `<div class="layer pad col" style="gap:26px;--bx:28%;--by:66%">
      <div class="eyebrow">Ranqueada</div>
      <div class="h h2">Qual é a sua<br><em>recompensa?</em></div>
      <div class="lead sm" style="margin-top:10px">Cada vitória aumenta o seu bounty. Suba de liga até virar Yonkou.</div>
      <div style="display:flex;gap:44px;align-items:center;margin-top:30px">
        <div class="wanted"><div class="w">WANTED</div><div class="pic"><img src="mark.svg" alt=""></div><div class="n">Seu apelido aqui</div><div class="b">฿ 250.001</div></div>
        <div class="ladder">
          <div class="top">Yonkou <span>฿ 250.001+</span></div>
          <div>Shichibukai <span>฿ 100.001+</span></div>
          <div>Supernova <span>฿ 50.001+</span></div>
          <div>Novo Mundo <span>฿ 20.001+</span></div>
          <div>Paradise <span>฿ 5.001+</span></div>
          <div>East Blue <span>começo</span></div>
        </div>
      </div>
    </div>
    ${foot()}`,
  },
  'posts/05-monte-seu-deck': {
    cls: 'burst',
    html: phoneSlide({ eyebrow: 'Montar decks', title: 'Seu deck,<br><em>sem achismo</em>', lead: 'Curva de custo, counters e tipos de carta calculados na hora.', list: ['Copiar e importar lista', 'Baixar imagem do deck', 'Decks da comunidade'], img: 'decklist.jpg' }),
  },
  'posts/06-idiomas': {
    cls: 'deep burst',
    html: `<div class="layer pad col center" style="gap:26px;--by:30%">
      <div class="eyebrow">Para a tripulação do mundo todo</div>
      <div class="h h2">Em <em>6 idiomas</em></div>
      <div class="lead" style="margin:10px 0 40px;max-width:860px">A interface inteira no idioma que você escolher. Cartas em português ou inglês.</div>
      <div class="flags">
        ${lang('br', 'Português', 'Bora jogar!')}${lang('gb', 'English', "Let's play!")}${lang('es', 'Español', '¡A jugar!')}
        ${lang('jp', '日本語', '対戦しよう！')}${lang('fr', 'Français', 'On joue !')}${lang('de', 'Deutsch', "Los geht's!")}
      </div>
    </div>
    ${foot()}`,
  },
  'posts/07-instale-no-celular': {
    cls: 'burst',
    html: phoneSlide({ eyebrow: 'No celular', title: 'Instale<br><em>no celular</em>', lead: 'Adicione à tela de início: abre em tela cheia e avisa quando for a sua vez.', list: ['Android e iPhone', 'Sem loja de apps', 'Notificações'], img: 'home.jpg' }),
  },
  'posts/08-assista-e-reveja': {
    cls: 'deep burst',
    html: phoneSlide({ eyebrow: 'Assistir e replays', title: 'Veja de novo<br><em>cada jogada</em>', lead: 'Assista a partidas ao vivo e reveja as suas, turno a turno.', list: ['Partidas ao vivo', 'Replay por link', 'Histórico da partida'], img: 'ataque.jpg' }),
  },
  'posts/09-projeto-de-fa': {
    cls: 'burst vignette',
    html: `<div class="layer pad col center" style="--by:34%;justify-content:center;gap:34px;padding-bottom:220px">
      <div class="ico big round">${icon('heart')}</div>
      <div class="h h2" style="margin-top:20px">Feito por fã,<br><em>grátis pra todos</em></div>
      <div class="lead" style="max-width:860px">Jogar, montar decks e entrar em torneios é de graça. Nenhum plano de apoio dá vantagem na partida.</div>
      <div class="chips"><span class="chip solid">Quer ajudar? Link na bio</span></div>
    </div>
    <div class="foot" style="justify-content:center;flex-direction:column;gap:22px"><img src="logo.svg" alt=""><div class="note">${DISCLAIMER}</div></div>`,
  },

  // ---------------------------------------------------------------- stories
  // Nos stories, 250 px do topo e 340 px do rodapé ficam livres (a interface do Instagram cobre).
  'stories/01-chegamos': {
    cls: 'story burst vignette',
    html: `<div class="layer col center" style="--by:38%;padding:270px 80px 360px;justify-content:center;gap:0">
      <img src="mark.svg" style="height:470px;filter:drop-shadow(14px 18px 0 #1f0904)" alt="">
      <div class="eyebrow" style="margin-top:56px">GumGum Fight</div>
      <div class="h h1" style="margin-top:22px">Chegamos<br>ao <em>Insta!</em></div>
      <div class="lead" style="margin-top:50px;max-width:840px">One Piece Card Game direto do navegador. Grátis, no celular ou no PC.</div>
      <div class="chips" style="margin-top:44px"><span class="chip solid">Segue a gente</span></div>
    </div>`,
  },
  'stories/02-bora-jogar': {
    cls: 'story deep burst',
    html: `<div class="layer col center" style="--by:60%;padding:270px 80px 0;gap:22px">
      <div class="eyebrow">Tem 10 minutos?</div>
      <div class="h h2">Bora uma<br><em>partida?</em></div>
      <div style="margin-top:54px">${phone('mesa2.jpg', { w: 520, rot: -3 })}</div>
    </div>
    <div class="layer col center" style="top:auto;bottom:350px;z-index:6;gap:18px"><span class="swipe">toque no link ↓</span><div class="btn" style="font-size:58px">${URL_TEXT}</div></div>`,
  },
  'stories/03-enquete-lider': {
    cls: 'story burst vignette',
    html: `<div class="layer col center" style="--by:44%;padding:290px 80px 360px;gap:26px">
      <img src="mark.svg" style="height:260px;filter:drop-shadow(10px 12px 0 #1f0904)" alt="">
      <div class="eyebrow" style="margin-top:30px">Enquete da tripulação</div>
      <div class="h h2" style="margin-top:24px">Qual Líder<br>você está<br><em>jogando?</em></div>
      <div style="margin-top:60px;width:760px;height:420px"></div>
    </div>`,
  },
  'stories/04-aprenda-a-jogar': {
    cls: 'story deep burst',
    html: `<div class="layer col center" style="--by:62%;padding:270px 80px 0;gap:22px">
      <div class="eyebrow">Nunca jogou?</div>
      <div class="h h2">Aprenda em<br><em>14 lições</em></div>
      <div class="lead sm" style="max-width:800px;margin-top:8px">Na mesa de verdade, com deck pronto e sem login.</div>
      <div style="margin-top:44px">${phone('aprender.jpg', { w: 500, rot: 3 })}</div>
    </div>
    <div class="layer col center" style="top:auto;bottom:350px;z-index:6;gap:18px"><span class="swipe">toque no link ↓</span><div class="btn" style="font-size:58px">${URL_TEXT}</div></div>`,
  },
  'stories/05-torneio-modelo': {
    cls: 'story burst vignette',
    html: `<div class="layer col center" style="--by:40%;padding:280px 80px 360px;gap:28px">
      <div class="ico big round">${icon('crown')}</div>
      <div class="eyebrow" style="margin-top:34px">Inscrições abertas</div>
      <div class="h h2">Torneio da<br><em>tripulação</em></div>
      <div class="paper" style="margin-top:36px;width:820px;height:330px"></div>
      <div class="chips" style="margin-top:30px"><span class="chip solid">Aberto e gratuito</span></div>
    </div>`,
  },

  // ---------------------------------------------------------------- banners
  // Horizontal (1,91:1): a imagem mais larga que o feed e os anúncios do Instagram aceitam.
  'banner/banner-horizontal': {
    cls: 'wide burst vignette',
    html: `<div class="layer col" style="--bx:34%;--by:52%;padding:42px 54px;gap:0">
      <img src="logo.svg" style="height:62px;align-self:flex-start" alt="">
      <div class="eyebrow" style="font-size:23px;letter-spacing:5px;margin-top:26px">One Piece Card Game</div>
      <div class="h" style="font-size:112px;-webkit-text-stroke-width:11px;text-shadow:6px 8px 0 var(--ink);margin-top:10px">Direto do<br><em>navegador</em></div>
      <div class="chips" style="margin-top:26px;gap:12px"><span class="chip solid" style="font-size:23px;padding:9px 20px">Grátis</span><span class="chip solid" style="font-size:23px;padding:9px 20px">Sem instalar</span><span class="chip solid" style="font-size:23px;padding:9px 20px">Celular ou PC</span></div>
    </div>
    <div class="layer" style="left:auto;right:92px;top:44px;bottom:auto">${phone('mesa.jpg', { w: 318, rot: 5 })}</div>
    <div class="layer" style="left:auto;right:40px;top:auto;bottom:34px;z-index:6"><div class="btn" style="font-size:44px;padding:13px 32px 10px;border-width:6px;border-radius:20px;box-shadow:0 8px 0 var(--ink)">${URL_TEXT}</div></div>`,
  },
  // Painel da grade: uma arte de 3240x1350 cortada em três posts que formam uma faixa no perfil.
  // Cada terço também funciona sozinho no feed; só o fundo atravessa os cortes.
  'banner/grade': {
    cls: 'pano burst vignette',
    split: ['banner/grade-1-esquerda', 'banner/grade-2-meio', 'banner/grade-3-direita'],
    html: `<div class="layer" style="--bx:50%;--by:46%;display:grid;grid-template-columns:repeat(3,1080px)">
      <div class="col center" style="padding:84px 80px;justify-content:center;gap:0">
        <img src="mark.svg" style="height:470px;filter:drop-shadow(14px 18px 0 #1f0904)" alt="">
        <div class="eyebrow" style="margin-top:56px">One Piece Card Game</div>
        <div class="h h1" style="margin-top:20px">Direto do<br><em>navegador</em></div>
      </div>
      <div class="col center" style="padding:84px 60px;justify-content:center;gap:44px">
        <img src="logo.svg" style="width:940px;filter:drop-shadow(0 16px 0 rgba(11,23,38,.55))" alt="">
        <div class="lead" style="max-width:800px;margin-top:10px">Treine contra o bot, jogue online e dispute torneios.</div>
        <div class="chips"><span class="chip solid">Grátis</span><span class="chip solid">Sem instalar</span><span class="chip solid">Celular ou PC</span></div>
        <div class="btn" style="margin-top:16px">${URL_TEXT}</div>
      </div>
      <div class="col center" style="padding:84px 80px 0;justify-content:flex-start;gap:30px;overflow:hidden">
        <div class="h h2 y">Bora jogar?</div>
        ${phone('mesa.jpg', { w: 600, rot: 4 })}
      </div>
    </div>`,
  },
};

// ------------------------------------------------------- novos modos de jogo
const MODOS = 7;
const modo = (opts, i) => ({ cls: i % 2 ? 'deep burst' : 'burst', html: phoneSlide({ ...opts, n: [i, MODOS] }) });
Object.assign(slides, {
  'novos-modos/posts/novos-modos-1': {
    cls: 'burst vignette',
    html: `<div class="layer pad col center" style="--by:30%;justify-content:flex-start;gap:0">
      <div style="display:flex;align-items:flex-end;height:470px;margin-top:10px">
        <img src="boosters/RUSH.webp" style="height:400px;transform:rotate(-11deg) translate(34px,14px);filter:drop-shadow(10px 14px 0 #1f0904)" alt="">
        <img src="boosters/DRAFT.webp" style="height:460px;position:relative;z-index:2;filter:drop-shadow(10px 14px 0 #1f0904)" alt="">
        <img src="boosters/CUBE.webp" style="height:400px;transform:rotate(11deg) translate(-34px,14px);filter:drop-shadow(10px 14px 0 #1f0904)" alt="">
      </div>
      <div class="eyebrow" style="margin-top:52px">Novidade no GumGum Fight</div>
      <div class="h h1" style="margin-top:20px"><em>5 modos</em><br>novos</div>
      <div class="chips" style="margin-top:44px;gap:12px">${['Selado', 'Pack Rush', 'Draft', 'Draft Cubo', 'All Blue'].map((c) => `<span class="chip solid" style="font-size:29px;padding:11px 22px">${c}</span>`).join('')}</div>
    </div>
    ${foot('<span class="swipe">arrasta ➜</span>')}`,
  },
  'novos-modos/posts/novos-modos-2': modo({ eyebrow: 'Limitado · Pré-release', title: '<em>Selado</em>', lead: 'Abra 6 boosters de uma coleção, monte um deck de 40 e jogue.', list: ['Qualquer cor', 'Qualquer Líder', 'Sem lista de banidas'], img: 'modos-selado.jpg' }, 2),
  'novos-modos/posts/novos-modos-3': modo({ eyebrow: 'Limitado', title: 'Pack <em>Rush</em>', lead: 'O Selado com várias coleções: cada booster é sorteado entre as que você escolher.', list: ['De 2 a 12 coleções', '6 boosters', 'Deck de 40'], img: 'modos-rush.jpg' }, 3),
  'novos-modos/posts/novos-modos-4': modo({ eyebrow: 'Limitado · Pod de 8', title: '<em>Draft</em>', lead: 'Cada um abre um booster, fica com 1 carta e passa o resto.', list: ['4 boosters por jogador', '48 escolhas', 'Lugar vazio vira bot'], img: 'modos-draft.jpg' }, 4),
  'novos-modos/posts/novos-modos-5': modo({ eyebrow: 'Draft', title: 'Draft <em>Cubo</em>', lead: 'O Cubo GumGum: as 420 cartas mais usadas de One Piece, uma cópia de cada.', list: ['70 por cor', 'Nada se repete no pod', 'Qualquer Líder do jogo'], img: 'modos-cubo.jpg' }, 5),
  'novos-modos/posts/novos-modos-6': modo({ eyebrow: 'Formato da comunidade', title: 'All <em>Blue</em>', lead: 'Só cartas C, UC, R e promo. As SR e as SEC ficam de fora.', list: ['Líder livre', 'Fila casual própria', 'Bot, salas e torneios'], img: 'modos-allblue.jpg' }, 6),
  'novos-modos/posts/novos-modos-7': {
    cls: 'burst vignette',
    html: `<div class="layer pad col center" style="--by:40%;justify-content:center;gap:40px;padding-bottom:230px">
      <div class="h h2 y">Qual você joga<br>primeiro?</div>
      <div class="lead" style="max-width:820px">Os cinco já estão no app.<br>É de graça.</div>
      <div class="btn" style="margin-top:14px">${URL_TEXT}</div>
      <div class="chip" style="margin-top:6px">Link na bio</div>
    </div>
    ${count(MODOS, MODOS)}
    <div class="foot" style="justify-content:center;flex-direction:column;gap:22px"><img src="logo.svg" alt=""><div class="note">${DISCLAIMER}</div></div>`,
  },
});

// ------------------------------------------ stories: novidades e treino de Selado
// Stories (1080x1920): o topo (250 px) e o rodapé (340 px) ficam livres para a interface do Instagram.
/** Três boosters em silhueta, com brilho: mostra que vem booster sem dizer qual. */
const mysteryPacks = `<div class="mystery">
  ${['RUSH', 'DRAFT', 'CUBE'].map((b, i) => `<div class="mp mp${i}"><img src="boosters/${b}.webp" alt=""><span>?</span></div>`).join('')}
</div>`;
const step = (n, title, sub) => `<div class="step"><b>${n}</b><div><div class="t">${title}</div><div class="s">${sub}</div></div></div>`;
Object.assign(slides, {
  'novos-modos/stories/teaser-novidades': {
    cls: 'story deep burst vignette',
    html: `<div class="layer col center" style="--by:28%;padding:240px 70px 0;gap:0">
      ${mysteryPacks}
      <div class="eyebrow" style="font-size:40px;margin-top:48px">Vem aí</div>
      <div class="h h2" style="margin-top:26px;font-size:126px">Preparados<br>para as <em>novidades</em><br>do GumGum Fight?</div>
      <div class="chip" style="margin-top:50px;font-size:34px">Fique de olho nos próximos stories</div>
      <img src="logo.svg" style="height:90px;margin-top:44px" alt="">
    </div>`,
  },
  'novos-modos/stories/selado-treino-1': {
    cls: 'story burst vignette',
    html: `<div class="layer col center" style="--by:62%;padding:262px 70px 0;gap:18px">
      <div class="eyebrow" style="font-size:38px">Pré-release chegando?</div>
      <div class="h h2">Treine antes<br>no <em>Selado</em></div>
      <div class="lead" style="max-width:900px;margin-top:8px">Abra boosters, monte o deck e jogue quantas vezes quiser. De graça, no navegador.</div>
      <div style="margin-top:40px">${phone('modos-selado.jpg', { w: 560, rot: -3 })}</div>
    </div>`,
  },
  'novos-modos/stories/selado-treino-2': {
    cls: 'story deep burst',
    html: `<div class="layer col" style="--by:20%;padding:262px 80px 0;gap:18px">
      <div class="eyebrow" style="font-size:38px">Selado · como funciona</div>
      <div class="h h2">Em <em>4 passos</em></div>
      <div class="col" style="gap:30px;margin-top:50px">
        ${step(1, 'Escolha a coleção', 'As coleções de booster, OP e EB.')}
        ${step(2, 'Abra 6 boosters', '12 cartas cada, com taxas tiradas de aberturas de caixas.')}
        ${step(3, 'Monte um deck de 40', 'Com o que sair: qualquer cor, qualquer Líder, sem banidas.')}
        ${step(4, 'Jogue', 'Contra o bot ou numa sala privada com um amigo.')}
      </div>
    </div>`,
  },
  'novos-modos/stories/selado-treino-3': {
    cls: 'story burst',
    html: `<div class="layer col" style="--bx:80%;--by:70%;padding:262px 70px 0;gap:18px">
      <div class="eyebrow" style="font-size:38px">O que dá para treinar</div>
      <div class="h h2">Chegue no<br><em>pré-release</em><br>afiado</div>
    </div>
    <div class="layer" style="top:860px;left:70px;right:auto;bottom:auto;width:470px">
      <div class="col tips" style="gap:22px">
        <div><b>Escolher o Líder</b>Um que sair ou o Luffy de 6 cores, que todo mundo tem.</div>
        <div><b>Curva e Counters</b>O app conta enquanto você monta.</div>
        <div><b>Montar sozinho</b>Um deck jogável para começar e ajustar.</div>
        <div><b>Abrir de novo</b>Cada abertura sai diferente.</div>
      </div>
    </div>
    <div class="layer" style="left:auto;right:56px;top:840px;bottom:auto">${phone('modos-selado-deck.jpg', { w: 430, rot: 4 })}</div>`,
  },
  'novos-modos/stories/selado-treino-4': {
    cls: 'story burst vignette',
    html: `<div class="layer col center" style="--by:42%;padding:0 70px 360px;justify-content:center;gap:40px">
      <div class="h h1 y">Bora<br>treinar?</div>
      <div class="lead" style="max-width:860px">Na tela inicial, em <b>Modos especiais</b>, toque em <b>Abrir boosters</b>.</div>
      <span class="swipe" style="margin-top:10px">toque no link ↓</span>
      <div class="btn">${URL_TEXT}</div>
      <img src="logo.svg" style="height:84px;margin-top:20px" alt="">
    </div>`,
  },
});

// ------------------------------------------------------------ modo espectador
const ESP = 8;
const monitor = (img, w = 940, rot = 0) => `<div class="monitor" style="--mw:${w}px;--rot:${rot}deg"><div class="scr"><img src="shots/${img}" alt=""></div></div>`;
const head = (eyebrow, title, lead) => `<div class="eyebrow">${eyebrow}</div><div class="h h2">${title}</div><div class="lead sm" style="margin-top:6px;max-width:920px">${lead}</div>`;
Object.assign(slides, {
  'espectador/posts/espectador-1': {
    cls: 'burst vignette',
    html: `<div class="layer pad col center" style="--by:58%;gap:18px">
      <div class="eyebrow">Assistir partidas</div>
      <div class="h h1" style="font-size:150px">Modo<br><em>espectador</em></div>
      <div style="margin-top:40px">${monitor('espectador-lateral.jpg', 900, -2)}</div>
      <div class="chips" style="margin-top:42px;gap:14px"><span class="chip solid">Ao vivo</span><span class="chip solid">Mãos só se liberar</span><span class="chip solid">Do seu jeito</span></div>
    </div>
    ${foot('<span class="swipe">arrasta ➜</span>')}`,
  },
  'espectador/posts/espectador-2': {
    cls: 'deep burst',
    html: `<div class="layer pad col" style="gap:18px">${head('Ao vivo', 'Assista a <em>qualquer partida</em>', 'As partidas online ficam em Assistir partidas, com ou sem login. Sala privada: é só ter o código.')}
      <div style="margin-top:40px;align-self:center">${monitor('espectador-zoom.jpg', 860)}</div>
      <div class="chips" style="margin-top:40px">${['Sem login', 'Sala privada pelo código', 'Toque na carta para ler'].map((c) => `<span class="chip">${c}</span>`).join('')}</div>
    </div>${count(2, ESP)}`,
  },
  'espectador/posts/espectador-3': {
    cls: 'burst',
    html: `<div class="layer pad col" style="--bx:50%;--by:75%;gap:18px">${head('As mãos', 'Quem cria a sala <em>decide</em>', 'Ao criar a sala privada, marque "Liberar as mãos para transmissão". Sem marcar, ninguém vê a mão de ninguém.')}</div>
    <div class="layer" style="top:640px;bottom:auto;display:flex;justify-content:center;gap:40px">
      <div class="col center" style="gap:26px">${phone('espectador-celular-sala.jpg', { w: 340, rot: -4, top: '-20px' })}<span class="chip solid">Na hora de criar</span></div>
      <div class="col center" style="gap:26px">${phone('espectador-celular-mesa.jpg', { w: 340, rot: 4 })}<span class="chip solid">Os dois veem o aviso</span></div>
    </div>${count(3, ESP)}`,
  },
  'espectador/posts/espectador-4': {
    cls: 'deep burst',
    html: `<div class="layer pad col" style="gap:18px">${head('Mãos liberadas', 'As duas mãos, <em>com atraso</em>', 'Quem transmite vê as mãos dos dois jogadores, sempre com pelo menos 1 minuto de atraso. Assim ninguém espia o oponente pela live.')}
      <div style="margin-top:34px;align-self:center">${monitor('espectador-maos.jpg', 840)}</div>
      <div class="chips" style="margin-top:36px">${['Pelo menos 1 min de atraso', 'Torneios e salas liberadas', 'Perfil Streamer'].map((c) => `<span class="chip">${c}</span>`).join('')}</div>
    </div>${count(4, ESP)}`,
  },
  'espectador/posts/espectador-5': {
    cls: 'burst',
    html: `<div class="layer pad col" style="--by:62%;gap:18px">${head('Do seu jeito', 'Escolha o <em>playmat</em>', 'Quatro cores para a mesa de quem assiste, com a bússola dourada no meio.')}
      <div class="mats">
        ${[['espectador-lateral.jpg', 'Azul'], ['espectador-vermelho.jpg', 'Vermelho'], ['espectador-verde.jpg', 'Verde'], ['espectador-branco.jpg', 'Branco']].map(([img, n]) => `<div>${monitor(img, 440)}<span class="chip solid">${n}</span></div>`).join('')}
      </div>
    </div>${count(5, ESP)}`,
  },
  'espectador/posts/espectador-6': {
    cls: 'deep burst',
    html: `<div class="layer pad col" style="gap:18px">${head('Do seu jeito', 'Mesa lateral <em>ou em pé</em>', 'Os jogadores à esquerda e à direita, como na câmera de cima, ou a mesa em pé, como no celular.')}
      <div class="col center" style="gap:34px;margin-top:34px">
        <div style="display:flex;gap:26px;align-items:center">${monitor('espectador-lateral.jpg', 560)}<span class="chip solid">Lateral</span></div>
        <div style="display:flex;gap:26px;align-items:center">${monitor('espectador-em-pe.jpg', 560)}<span class="chip solid">Em pé</span></div>
      </div>
    </div>${count(6, ESP)}`,
  },
  'espectador/posts/espectador-7': {
    cls: 'burst',
    html: `<div class="layer pad col" style="--by:60%;gap:18px">${head('Modo transmissão', 'Leve para <em>a live</em>', 'Um link para pôr no OBS como Fonte de navegador. A carta jogada aparece grande, em destaque.')}
      <div style="margin-top:40px;align-self:center">${monitor('espectador-obs.jpg')}</div>
      <div class="chips" style="margin-top:44px">${['Atraso de até 10 min', 'Chat na live: você escolhe', 'Sua mão nas suas partidas'].map((c) => `<span class="chip">${c}</span>`).join('')}</div>
    </div>${count(7, ESP)}`,
  },
  'espectador/posts/espectador-8': {
    cls: 'burst vignette',
    html: `<div class="layer pad col center" style="--by:40%;justify-content:center;gap:40px;padding-bottom:230px">
      <div class="h h2 y">Bora<br>assistir?</div>
      <div class="lead" style="max-width:860px">No menu, toque em <b>Assistir</b>. Para transmitir com as mãos, fale com a gente.</div>
      <div class="btn" style="margin-top:14px">${URL_TEXT}</div>
      <div class="chip" style="margin-top:6px">Link na bio</div>
    </div>
    ${count(ESP, ESP)}
    <div class="foot" style="justify-content:center;flex-direction:column;gap:22px"><img src="logo.svg" alt=""><div class="note">${DISCLAIMER}</div></div>`,
  },
});

// ------------------------------------------------------------------- amigos
const AMG = 7;
const twoPhones = (a, b, la, lb, top = 600) => `<div class="layer" style="top:${top}px;bottom:auto;display:flex;justify-content:center;gap:40px">
  <div class="col center" style="gap:26px">${phone(a, { w: 360, rot: -4 })}${la ? `<span class="chip solid">${la}</span>` : ''}</div>
  <div class="col center" style="gap:26px">${phone(b, { w: 360, rot: 4 })}${lb ? `<span class="chip solid">${lb}</span>` : ''}</div>
</div>`;
const statusDot = (c, t) => `<span class="chip" style="display:inline-flex;align-items:center;gap:12px"><i style="width:22px;height:22px;border-radius:50%;background:${c};display:inline-block"></i>${t}</span>`;
Object.assign(slides, {
  'amigos/posts/amigos-1': {
    cls: 'burst vignette',
    html: `<div class="layer pad col" style="--bx:72%;--by:62%;gap:18px">
      <div class="eyebrow">Novidade no GumGum Fight</div>
      <div class="h h1" style="font-size:150px">Jogue com<br>os <em>amigos</em></div>
    </div>
    <div class="layer" style="top:620px;left:80px;right:auto;bottom:auto;width:400px">
      <div class="chips" style="flex-direction:column;align-items:flex-start;gap:18px"><span class="chip solid">Código de amigo</span><span class="chip solid">Quem está online</span><span class="chip solid">Convite direto</span></div>
    </div>
    <div class="layer" style="left:auto;right:90px;top:470px;bottom:auto">${phone('amigos-lista.jpg', { w: 450, rot: 4 })}</div>
    ${foot('<span class="swipe">arrasta ➜</span>')}`,
  },
  'amigos/posts/amigos-2': {
    cls: 'deep burst',
    html: `<div class="layer pad col" style="gap:18px">${head('Passo 1', 'Mande o seu <em>código</em>', 'Cada conta tem um código de amigo de 8 letras e um link. O amigo digita o código em "Adicionar pelo código".')}</div>
    ${twoPhones('amigos-codigo.jpg', 'amigos-pedido-enviado.jpg', 'Seu código', 'O amigo adiciona')}${count(2, AMG)}`,
  },
  'amigos/posts/amigos-3': {
    cls: 'burst',
    html: `<div class="layer pad col" style="--by:70%;gap:18px">${head('Passo 2', 'Aceite <em>o pedido</em>', 'O pedido aparece em "Pedidos recebidos". Um toque em Aceitar e vocês são amigos.')}</div>
    ${twoPhones('amigos-pedido.jpg', 'amigos-aceito.jpg', 'Pedido recebido', 'Agora são amigos')}${count(3, AMG)}`,
  },
  'amigos/posts/amigos-4': {
    cls: 'deep burst',
    html: `<div class="layer pad col" style="gap:18px">${head('Na lista', 'Veja quem está <em>online</em>', 'Cada amigo aparece com o status, a foto e a recompensa. Nunca com a partida nem o código da sala.')}
      <div class="chips" style="margin-top:22px;gap:14px">${statusDot('#f2b733', 'Jogando')}${statusDot('#3bc985', 'Online')}${statusDot('#7d8aa0', 'Offline')}</div>
    </div>
    <div class="layer" style="top:720px;bottom:auto;display:flex;justify-content:center">${phone('amigos-lista.jpg', { w: 360, rot: -3, top: '-40px' })}</div>${count(4, AMG)}`,
  },
  'amigos/posts/amigos-5': {
    cls: 'burst',
    html: `<div class="layer pad col" style="--by:72%;gap:18px">${head('Passo 3', 'Escolha <em>o formato</em>', 'Toque em Convidar e escolha: Standard, Extra Grand Battle, All Blue ou Livre. A sala sai com o seu deck equipado.')}</div>
    <div class="layer" style="top:660px;bottom:auto;display:flex;justify-content:center">${phone('amigos-formato.jpg', { w: 360, rot: 3 })}</div>${count(5, AMG)}`,
  },
  'amigos/posts/amigos-6': {
    cls: 'deep burst',
    html: `<div class="layer pad col" style="gap:18px">${head('Do outro lado', 'O amigo entra <em>com um toque</em>', 'O convite chega como notificação e como faixa na tela inicial. É tocar em Entrar e a partida começa.')}</div>
    ${twoPhones('amigos-faixa.jpg', 'amigos-partida.jpg', 'O convite chega', 'E é jogar')}${count(6, AMG)}`,
  },
  'amigos/posts/amigos-7': {
    cls: 'burst vignette',
    html: `<div class="layer pad col center" style="--by:40%;justify-content:center;gap:40px;padding-bottom:230px">
      <div class="h h2 y">Chama<br>a galera!</div>
      <div class="lead" style="max-width:860px">Entre com o Google e abra <b>Amigos</b> no menu.</div>
      <div class="btn" style="margin-top:14px">${URL_TEXT}</div>
      <div class="chip" style="margin-top:6px">Link na bio</div>
    </div>
    ${count(AMG, AMG)}
    <div class="foot" style="justify-content:center;flex-direction:column;gap:22px"><img src="logo.svg" alt=""><div class="note">${DISCLAIMER}</div></div>`,
  },
  // Stories (o topo e o rodapé ficam livres para a interface do Instagram)
  'amigos/stories/amigos-meu-codigo': {
    cls: 'story burst vignette',
    html: `<div class="layer col center" style="--by:44%;padding:280px 80px 360px;gap:26px">
      <div class="ico big round">${icon('user')}</div>
      <div class="eyebrow" style="margin-top:30px">GumGum Fight</div>
      <div class="h h2">Me adiciona<br>como <em>amigo!</em></div>
      <div class="lead sm" style="margin-top:6px">Meu código de amigo:</div>
      <div class="paper" style="width:820px;height:190px"></div>
      <div class="lead sm" style="max-width:820px;margin-top:16px">No app: Menu › Amigos › Adicionar pelo código</div>
    </div>`,
  },
  'amigos/stories/amigos-3-passos': {
    cls: 'story deep burst',
    html: `<div class="layer col" style="--by:20%;padding:262px 80px 0;gap:18px">
      <div class="eyebrow" style="font-size:38px">Jogar com os amigos</div>
      <div class="h h2">Em <em>3 passos</em></div>
      <div class="col" style="gap:30px;margin-top:50px">
        ${step(1, 'Abra Amigos no menu', 'Com o login do Google.')}
        ${step(2, 'Troque os códigos', 'Digite o código do amigo ou mande o seu link.')}
        ${step(3, 'Toque em Convidar', 'Escolha o formato. O amigo recebe o aviso e entra direto.')}
      </div>
    </div>`,
  },
  'amigos/stories/amigos-revanche': {
    cls: 'story burst vignette',
    html: `<div class="layer col center" style="--by:40%;padding:300px 80px 360px;gap:26px">
      <div class="ico big round">${icon('swords')}</div>
      <div class="eyebrow" style="margin-top:34px">Desafio</div>
      <div class="h h2">Marca aquele<br>amigo que te deve<br>uma <em>revanche</em></div>
      <div style="width:760px;height:300px;margin-top:40px"></div>
    </div>`,
  },
});

// ------------------------------------------- série "Mihawk aprende a jogar"
// Sobreposições com fundo transparente, para pôr por cima do vídeo do cosplay no editor.
const MIHAWK_EPISODES = [
  ['Banido', 'Baniram o Líder Mihawk.<br><em>Sobrou o palhaço.</em>'],
  ['O aluno', 'Quem ensina<br><em>o mestre?</em>'],
  ['Ordens do palhaço', 'Mihawk joga de Buggy.<br><em>Contra o Zoro.</em>'],
  ['Shichibukai no East Blue', 'De ฿ 3.590.000.000<br><em>para ฿ 0.</em>'],
  ['Um oponente digno', 'Procura-se um<br><em>oponente digno.</em>'],
];
const sticker = (html) => ({ cls: 'clear', html: `<div class="col center" style="padding:44px 50px;gap:20px">${html}</div>` });
slides['mihawk/sobreposicoes/selo-serie'] = sticker(`<div class="h h4 y" style="font-size:92px">Mihawk<br>aprende a jogar</div><img src="logo.svg" style="height:70px;margin-top:10px" alt="">`);
MIHAWK_EPISODES.forEach(([title, hook], i) => {
  slides[`mihawk/sobreposicoes/ep-${i + 1}`] = sticker(`<span class="swipe" style="font-size:46px;padding:16px 40px;border-width:6px">Ep. ${i + 1} · ${title}</span>`);
  slides[`mihawk/sobreposicoes/gancho-ep${i + 1}`] = sticker(`<div class="h h3" style="font-size:${hook.length > 60 ? 96 : 112}px">${hook}</div>`);
});

const page = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><link rel="stylesheet" href="kit.css"></head><body>
${Object.entries(slides).map(([id, s]) => `<section class="slide ${s.cls}" data-out="${id}"${s.split ? ` data-split="${s.split.join(',')}"` : ''}>${s.html}</section>`).join('\n')}
</body></html>`;
writeFileSync(join(SRC, 'kit.html'), page);

const filters = process.argv.slice(2);
const { chromium } = require('playwright');
const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 3240, height: 1920 }, deviceScaleFactor: 1 });
await tab.goto(pathToFileURL(join(SRC, 'kit.html')).href, { waitUntil: 'networkidle' });
await tab.evaluate(() => document.fonts.ready);
for (const el of await tab.locator('.slide').all()) {
  const id = await el.getAttribute('data-out');
  if (filters.length && !filters.some((f) => id.includes(f))) continue;
  // O avatar e as sobreposições (fundo transparente) saem em PNG; o resto em JPEG.
  const clear = id.includes('/sobreposicoes/');
  const png = clear || id === 'perfil/avatar';
  const file = join(OUT, `${id}.${png ? 'png' : 'jpg'}`);
  mkdirSync(dirname(file), { recursive: true });
  await el.screenshot(png ? { path: file, omitBackground: clear } : { path: file, type: 'jpeg', quality: 93 });
  console.log(id);
  // Painel da grade: além da arte inteira, um arquivo por terço.
  const split = (await el.getAttribute('data-split'))?.split(',') ?? [];
  if (split.length) await el.evaluate((node) => node.scrollIntoView({ block: 'start' }));
  const box = await el.boundingBox();
  for (const [i, part] of split.entries()) {
    const width = box.width / split.length;
    await tab.screenshot({ path: join(OUT, `${part}.jpg`), type: 'jpeg', quality: 93, clip: { x: box.x + i * width, y: box.y, width, height: box.height } });
    console.log(part);
  }
}
await browser.close();
