// Página do replay embutido (`/replay/<id>?t=<token>`, ver `embed.ts`): baixa o replay com o link
// assinado e abre a mesa direto em modo replay, sem menu nem chat. Com `embed=1` (dentro do iframe de
// um parceiro) também some a saída; sem ele, "Voltar" leva ao site.

import { useEffect, useState } from 'react';
import { api } from '../api';
import { parseReplayEmbed } from '../embed';
import { setupFromReplay } from '../game/setup';
import type { GameSetup, ReplayFile } from '../game/useGame';
import { useT } from '../i18n';
import { GameScreen } from './GameScreen';
import { BroadcastIdle } from './Online';

export function ReplayEmbed() {
  const t = useT();
  const [link] = useState(() => parseReplayEmbed(location.pathname, location.search));
  const [loaded, setLoaded] = useState<{ setup: GameSetup; origins: string[] } | null>(null);
  const [error, setError] = useState<string | null>(link ? null : t('errors.replay_link_invalid'));

  useEffect(() => {
    if (!link) return;
    let stop = false;
    api.matches
      .embedReplay(link.matchId, link.token)
      .then(async ({ replay, cards, origins }) => {
        const setup = await setupFromReplay(replay as unknown as ReplayFile, cards);
        if (!stop) setLoaded({ setup: { ...setup, replayStart: { paused: !link.autoplay, speed: 1 } }, origins });
      })
      .catch((e: unknown) => !stop && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      stop = true;
    };
  }, [link]);

  if (error || !link) return <BroadcastIdle title={t('replay.embedFailed')} text={error ?? undefined} />;
  if (!loaded) return <BroadcastIdle title={t('common.loading')} />;
  return (
    <GameScreen
      setup={loaded.setup}
      onExit={() => location.assign('/')}
      embed={{ bare: link.embed, layout: link.layout, origins: loaded.origins }}
    />
  );
}
