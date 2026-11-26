// Treino contra o Bot do Time: as jogadas do bot que o jogador marcou como erradas (painel do treinador) e o
// relatório da partida que sai delas.

import { type BotLevel, cardDef, type PlayerId } from '@gumgum/engine';
import { useCallback, useMemo, useState } from 'react';
import { buildReport, type CoachMark, sameMark } from '../../game/botReport';
import { describeReplayAction } from '../../game/replayCue';
import type { OnlineGame } from '../../game/useOnlineGame';
import { hasKey, type Locale, type MessageKey, type Translate } from '../../i18n';
import { fmtNumber } from '../../i18n/format';
import type { TableGame } from '../GameScreen';

/** Nome de cada nível do bot (o relatório do Bot do Time cita o nível). */
const BOT_LEVEL_LABEL: Record<BotLevel, MessageKey> = { easy: 'menu.botEasy', normal: 'menu.botNormal', hard: 'menu.botHard', team: 'menu.botTeam' };

export function useBotCoach({
  game,
  t,
  locale,
  isOnline,
  online,
  botDeckId,
  botDeckName,
  reportMatch,
  effectiveBotLevel,
  coachOn,
}: {
  game: TableGame;
  t: Translate;
  locale: Locale;
  isOnline: boolean;
  online: OnlineGame | undefined;
  /** Partida contra o bot no navegador: o deck que o bot joga (online vem da sala). */
  botDeckId: string | undefined;
  botDeckName: string | undefined;
  /** A partida gravada no servidor, se o relato pode apontar para ela. */
  reportMatch: number | null;
  effectiveBotLevel: BotLevel | undefined;
  /** O painel do treinador vale nesta partida. */
  coachOn: boolean;
}) {
  const { state, human } = game;
  /** Passos das jogadas do bot marcados como errados (painel do treinador); viram o relatório da partida. */
  const [marks, setMarks] = useState<CoachMark[]>([]);
  const toggleMark = useCallback(
    (index: number, step: number) =>
      setMarks((list) => (list.some((m) => sameMark(m, { index, step })) ? list.filter((m) => !sameMark(m, { index, step })) : [...list, { index, step }])),
    [],
  );
  const updateMark = useCallback(
    (index: number, step: number, patch: Partial<Pick<CoachMark, 'alt' | 'why'>>) =>
      setMarks((list) => list.map((m) => (sameMark(m, { index, step }) ? { ...m, ...patch } : m))),
    [],
  );
  const coachEntries = (isOnline ? online?.coach : game.coach) ?? [];
  /** O relatório da partida (markdown) com as jogadas marcadas; `rating`/`comment` vêm do bloco do fim da partida. */
  const buildBotReport = useCallback(
    (rating = 0, comment = '') => {
      if (human === null) return '';
      const botSeat: PlayerId = human === 0 ? 1 : 0;
      const leaderOf = (p: PlayerId) => {
        const uid = state.players[p].leader.uid;
        return { leaderName: state.cards[uid] ? cardDef(state, uid).name : '?', leaderId: state.cards[uid]?.cardId ?? '?' };
      };
      const tr = (key: string, params?: Record<string, string | number>) => (hasKey(key) ? t(key, params) : key);
      return buildReport({
        entries: coachEntries,
        marks,
        tr,
        describe: (a) => describeReplayAction(state, a, locale).title,
        termLabel: (key) => tr(`coach.term.${key}`),
        num: (n) => fmtNumber(n, locale),
        bot: {
          deckId: (isOnline ? online?.room?.botDeckId : botDeckId) ?? null,
          deckName: (isOnline ? online?.room?.botDeckName : botDeckName) ?? null,
          ...leaderOf(botSeat),
        },
        opponent: { name: state.players[human].name, ...leaderOf(human) },
        result: { turn: state.turn, over: state.phase === 'gameover', ...(state.phase === 'gameover' ? { botWon: state.winner === null ? null : state.winner === botSeat } : {}) },
        matchId: reportMatch,
        level: effectiveBotLevel ? t(BOT_LEVEL_LABEL[effectiveBotLevel]) : null,
        rating,
        comment,
      });
    },
    [human, state, coachEntries, marks, t, locale, isOnline, online?.room?.botDeckId, online?.room?.botDeckName, botDeckId, botDeckName, reportMatch, effectiveBotLevel],
  );
  const coachReport = useMemo(() => (coachOn ? buildBotReport() : ''), [coachOn, buildBotReport]);
  return { marks, toggleMark, updateMark, coachEntries, buildBotReport, coachReport };
}
