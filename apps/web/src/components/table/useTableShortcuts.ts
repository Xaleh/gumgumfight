// Os atalhos de teclado da mesa: o que cada tecla faz (que tecla é que atalho fica em ../../game/shortcuts.ts).

import type { Action, GameState, Pending, PlayerId } from '@gumgum/engine';
import { audio } from '../../audio';
import { type Shortcut, useShortcuts } from '../../game/shortcuts';
import type { Mode, Sheet } from './shared';

export function useTableShortcuts(
  /** Os atalhos valem agora (a opção está ligada e não há janela por cima da mesa). */
  active: boolean,
  table: {
    /** A mesa na página: os botões com `data-hotkey` são procurados dentro dela. */
    gameRef: { current: HTMLDivElement | null };
    state: GameState;
    human: PlayerId | null;
    /** O jogador de baixo na tela. */
    bottom: PlayerId;
    myTurnIdle: boolean;
    has: (pred: (a: Action) => boolean) => boolean;
    legal: Action[];
    myPending: Pending | null;
    mode: Mode;
    /** A carta ampliada e a carta escolhida. */
    zoom: string | null;
    selected: string | null;
    sheet: Sheet;
    dispatch: (a: Action) => void;
    setMode: (m: Mode) => void;
    setSelected: (uid: string | null) => void;
    setZoom: (uid: string | null) => void;
    setSheet: (s: Sheet) => void;
    canReceiveDon: (uid: string) => boolean;
    canAttackWith: (uid: string) => boolean;
    attachDons: (target: string, count: number) => void;
    onCard: (uid: string) => void;
  },
) {
  const { gameRef, state, human, bottom, myTurnIdle, has, legal, myPending, mode, zoom, selected, sheet } = table;
  const { dispatch, setMode, setSelected, setZoom, setSheet, canReceiveDon, canAttackWith, attachDons, onCard } = table;
  /**
   * Atalhos de teclado (opção "Atalhos de teclado"; a lista para quem joga está em `ShortcutsHelp`).
   *
   * As teclas de carta (Q W E R T e L) escolhem a carta sem abri-la; A, H e X agem sobre a carta escolhida (ou a
   * aberta). Numa escolha de alvo (ataque, efeito, bloqueio, DON!! marcados) a tecla vale como o toque na carta,
   * e passa para a do oponente quando a sua não é uma opção. Enter, o cancelar do Esc e os números numa lista de
   * opções e o M ("Ver a mesa") apertam o botão que está na tela (`data-hotkey`), para valerem só quando ele vale e
   * com as mesmas proteções.
   */
  const onShortcut = (s: Shortcut): boolean => {
    const click = (selector: string) => {
      const button = gameRef.current?.querySelector<HTMLButtonElement>(`${selector}:not(:disabled)`);
      button?.click();
      return Boolean(button);
    };
    const top: PlayerId = bottom === 0 ? 1 : 0;
    const marking = human !== null && myTurnIdle && has((a) => a.type === 'attachDon') ? state.players[human].donActive : 0;
    const markDons = (count: number) => {
      audio.play('don-pick', { pitch: Math.min(6, count - 1) });
      setMode({ kind: 'don', picked: Array.from({ length: count }, (_, i) => i) });
    };
    /** A carta sobre a qual o A, o H e o X agem: a aberta, ou a escolhida pela tecla ou pelo clique. */
    const card = zoom ?? selected;
    switch (s.kind) {
      case 'endTurn':
        if (!myTurnIdle) return false;
        dispatch({ type: 'endTurn', player: human! });
        setMode(null);
        setSelected(null);
        setZoom(null);
        setSheet(null);
        return true;
      case 'confirm':
        // Vale para o que está por cima: a carta aberta, a folha da mão ou, sem nada aberto, a pergunta ou a faixa central.
        if (zoom) return click('.zoom [data-hotkey~="confirm"]');
        if (sheet) return sheet === 'hand' && click('.sheet [data-hotkey~="confirm"]');
        return click('[data-hotkey~="confirm"]');
      case 'cancel':
        if (zoom || sheet || mode) {
          setMode(null);
          setSelected(null);
          setZoom(null);
          setSheet(null);
          return true;
        }
        setSelected(null);
        return click('[data-hotkey~="cancel"]') || selected !== null;
      case 'trash': {
        const player = s.opponent ? top : bottom;
        const open = sheet !== null && typeof sheet === 'object' && sheet.trash === player;
        setZoom(null);
        setSheet(open ? null : { trash: player });
        return true;
      }
      case 'number': {
        if (zoom || sheet) return false;
        // Pergunta com uma lista de opções (qual DON!! devolver, que efeito usar…): o número escolhe a opção.
        const options = gameRef.current?.querySelectorAll<HTMLButtonElement>('[data-hotkey~="option"]');
        if (options?.length) {
          options[s.n - 1]?.click();
          return s.n <= options.length;
        }
        if (marking === 0) return false;
        markDons(Math.min(s.n, marking));
        return true;
      }
      case 'attachAll':
        if (sheet || !myTurnIdle) return false;
        if (card && canReceiveDon(card)) {
          attachDons(card, state.players[human!].donActive);
          setMode(null);
          setZoom(null);
          return true;
        }
        // Sem carta escolhida: marca todos, e a tecla da carta os anexa.
        if (marking === 0) return false;
        markDons(marking);
        return true;
      case 'peek':
        // "Ver a mesa" da pergunta aberta, ou "Voltar à pergunta" quando ela já está recolhida.
        return !zoom && !sheet && click('[data-hotkey~="peek"]');
      case 'attack':
        if (sheet || !card || !canAttackWith(card)) return false;
        setMode({ kind: 'attack', attacker: card });
        setZoom(null);
        return true;
      case 'ability': {
        if (sheet) return false;
        if (zoom) return click('.zoom .ability-plate');
        if (!selected || !myTurnIdle) return false;
        const abilities = legal.filter((a) => a.type === 'activate' && a.uid === selected);
        if (abilities.length === 0) return false;
        // Mais de uma habilidade: a carta abre para a escolha.
        if (abilities.length > 1) setZoom(selected);
        else {
          dispatch(abilities[0]);
          setSelected(null);
        }
        return true;
      }
      case 'card': {
        if (sheet) return false;
        const at = (p: PlayerId) => (s.slot === 'leader' ? state.players[p].leader.uid : (state.players[p].characters[s.slot]?.uid ?? null));
        /** A carta é um dos alvos que o jogo espera agora (de um efeito, do bloqueio, do ataque ou dos DON!! marcados). */
        const choosable = (uid: string | null): uid is string =>
          uid !== null &&
          (((myPending?.kind === 'selectTargets' || myPending?.kind === 'block') && myPending.options.includes(uid)) ||
            (mode?.kind === 'attack' && has((a) => a.type === 'attack' && a.attacker === mode.attacker && a.target === uid)) ||
            (mode?.kind === 'don' && canReceiveDon(uid)));
        const mine = at(bottom);
        const theirs = at(top);
        const uid = s.opponent || (choosable(theirs) && !choosable(mine)) ? theirs : mine;
        if (uid === null) return false;
        if (choosable(uid)) {
          setZoom(null);
          onCard(uid);
          return true;
        }
        // Fora de uma escolha a tecla só escolhe a carta (o toque também sai do modo de ataque); de novo, abre ou fecha a carta.
        if (mode?.kind === 'attack') setMode(null);
        setZoom(uid === selected && zoom !== uid ? uid : null);
        setSelected(uid);
        return true;
      }
    }
  };
  useShortcuts(active, human !== null, onShortcut);
}
