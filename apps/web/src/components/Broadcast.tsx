// Tela de transmissão (`/?transmissao=<chave>`): a fonte de navegador do OBS. Mostra a
// partida que o streamer escolheu no app (Assistir partidas → Transmitir), sem menus nem
// botões, com o destaque da carta jogada. Consulta a escolha a cada poucos segundos: o
// endereço no OBS nunca muda. Com as mãos, a mesa chega atrasada (ver online/room.ts).

import { useEffect, useRef, useState } from 'react';
import { api, ApiError, type WatchTarget } from '../api';
import { useT } from '../i18n';
import { type TableBroadcast, WatchGameScreen } from './GameScreen';
import { BroadcastIdle } from './Online';

/** Intervalo entre as consultas da partida escolhida no app. */
const POLL_MS = 3000;

export function Broadcast({ broadcastKey }: { broadcastKey: string }) {
  const t = useT();
  const [target, setTarget] = useState<WatchTarget | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [options, setOptions] = useState<TableBroadcast>({ chat: true });
  /**
   * Última versão vista no servidor (muda a cada troca de partida ou de opção). A tela só
   * reconecta quando ela muda: na revanche segue sozinha para a sala nova (no ritmo da mesa
   * atrasada), sem voltar.
   */
  const chosen = useRef<string | null>(null);

  useEffect(() => {
    let stop = false;
    const load = () =>
      api.broadcast
        .byKey(broadcastKey)
        .then((b) => {
          if (stop) return;
          setInvalid(false);
          setLoaded(true);
          setOptions((o) => (o.chat === b.chat ? o : { chat: b.chat }));
          const id = b.roomId ? `${b.roomId}|${b.rev}` : '';
          if (id === chosen.current) return;
          chosen.current = id;
          // A chave decide o que a conexão vê (mãos, a visão do streamer, atraso): ver online/broadcast.ts.
          setTarget(b.roomId ? { roomId: b.roomId, hands: false, key: broadcastKey } : null);
        })
        .catch((e) => {
          if (stop || !(e instanceof ApiError && e.status === 404)) return; // fora do ar: tenta de novo
          setInvalid(true);
          setLoaded(true);
          chosen.current = null;
          setTarget(null);
        });
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [broadcastKey]);

  // Fonte do OBS: a página não rola nem mostra barras.
  useEffect(() => {
    document.documentElement.classList.add('broadcast-page');
    return () => document.documentElement.classList.remove('broadcast-page');
  }, []);

  if (invalid) return <BroadcastIdle title={t('broadcast.invalid')} text={t('broadcast.invalidHint')} />;
  if (!target) return <BroadcastIdle title={loaded ? t('broadcast.waiting') : t('common.loading')} text={loaded ? t('broadcast.waitingHint') : undefined} />;
  return (
    <WatchGameScreen
      key={`${target.roomId}|${chosen.current}`}
      target={target}
      canHands={false}
      broadcast={options}
      onExit={() => setTarget(null)}
      onSwitch={setTarget}
    />
  );
}
