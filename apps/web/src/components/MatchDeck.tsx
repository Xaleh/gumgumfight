// Decklist de um jogador no fim da partida (o oponente, normalmente): a lista como imagem
// (a mesma peça das decklists do kit de divulgação, 1080 × 1350) para baixar e compartilhar,
// e em texto para copiar e importar no construtor. Desenhada no navegador, a partir do estado
// da partida encerrada. Carregado sob demanda, junto com o desenho do kit.

import type { GameState, PlayerId } from '@gumgum/engine';
import { useEffect, useState } from 'react';
import { useLocale, useT } from '../i18n';
import { fmtDate } from '../i18n/format';
import { errorText, loadFonts, loadImage, loadLogo, type RecapImage, release, shrink, toBlob } from '../recap/assets';
import { DECK_TILE_MAX_W, drawMatchDeck, FORMAT_SIZE, type RecapAssets } from '../recap/draw';
import { saveFile } from '../recap/export';
import { slug } from '../recap/layout';
import { matchDeck } from '../recap/matchDeck';
import { useSettings } from '../settings';

interface Output {
  blob: Blob;
  url: string;
}

export default function MatchDeck({ state, player, onClose }: { state: GameState; player: PlayerId; onClose: () => void }) {
  const t = useT();
  const locale = useLocale();
  const settings = useSettings();
  // Calculada uma vez: o estado online é trocado a cada evento da sala (revanche pedida…) e a lista não muda.
  const [deck] = useState(() => matchDeck(state, player, { images: settings.showImages }));
  const [assets, setAssets] = useState<(RecapAssets & { missing: number }) | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [output, setOutput] = useState<Output | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Todas as imagens carregadas antes de desenhar (com progresso); a que falhar vira carta sem arte.
  useEffect(() => {
    if (!deck) return;
    let alive = true;
    const urls = [...new Set([deck.leader.image, ...deck.cards.map((c) => c.image)].filter((u): u is string => Boolean(u)))];
    const images = new Map<string, RecapImage | null>();
    let done = 0;
    setProgress({ done, total: urls.length });
    const tick = () => alive && setProgress({ done: ++done, total: urls.length });
    void Promise.all([
      loadFonts(),
      loadLogo(),
      ...urls.map((u) =>
        loadImage(u).then((img) => {
          // Só o Líder fica em tamanho cheio; as demais são miniaturas da grade.
          images.set(u, img && u !== deck.leader.image ? shrink(img, DECK_TILE_MAX_W) : img);
          tick();
        }),
      ),
    ]).then(([, logo]) => {
      if (!alive) return;
      setAssets({
        image: (u) => (u ? (images.get(u) ?? null) : null),
        logo: logo ?? null,
        sponsorLogo: null,
        missing: [...images.values()].filter((img) => !img).length,
      });
    });
    return () => {
      alive = false;
    };
  }, [deck]);

  // Desenha a peça e guarda o PNG.
  useEffect(() => {
    if (!deck || !assets) return;
    let alive = true;
    let made: Output | null = null;
    setOutput(null);
    void (async () => {
      try {
        const { width, height } = FORMAT_SIZE.feed;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        drawMatchDeck(
          canvas.getContext('2d')!,
          'feed',
          deck,
          {
            kicker: t('matchDeck.img.kicker'),
            vs: t('matchDeck.img.vs', { name: deck.opponent }),
            date: fmtDate(Date.now(), locale),
            cards: (n) => t('recap.img.cards', { n }),
            site: window.location.host,
          },
          assets,
        );
        const blob = await toBlob(canvas, 'image/png').finally(() => release(canvas));
        if (!alive) return;
        made = { blob, url: URL.createObjectURL(blob) };
        setOutput(made);
      } catch (e) {
        // Canvas "contaminado" (imagem de outro domínio sem CORS) ou falta de memória.
        if (alive) setError(t('recap.renderError', { reason: errorText(e) }));
      }
    })();
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made.url);
    };
  }, [deck, assets, t, locale]);

  const copy = () => {
    if (!deck) return;
    const clip = navigator.clipboard;
    if (!clip) {
      setCopied('fail');
      return;
    }
    clip
      .writeText(deck.text)
      .then(() => setCopied('ok'))
      .catch(() => setCopied('fail'));
  };
  useEffect(() => {
    if (copied !== 'ok') return;
    const timer = setTimeout(() => setCopied(null), 2500);
    return () => clearTimeout(timer);
  }, [copied]);

  const name = deck?.name ?? state.players[player].name;
  const file = deck ? `decklist-${slug(name)}-${deck.leader.id}.png` : 'decklist.png';
  return (
    <div className="modal-backdrop sheet-backdrop page-sheet centered deck-backdrop" onClick={onClose}>
      <div className="sheet deck-sheet" role="dialog" aria-modal="true" aria-label={t('matchDeck.title', { name })} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>{t('matchDeck.title', { name })}</h3>
          <button className="zoom-close static" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </div>
        <div className="sheet-body">
          {!deck ? (
            <p className="muted">{t('matchDeck.unavailable')}</p>
          ) : (
            <>
              <p className="muted small deck-intro">{t('matchDeck.intro')}</p>
              {error && <div className="error">{error}</div>}
              {!settings.showImages && <p className="small recap-warn">{t('matchDeck.noArt')}</p>}
              {assets && assets.missing > 0 && <p className="small recap-warn">{t('recap.missingArt', { n: assets.missing })}</p>}
              {!error && !output && (
                <p className="muted">
                  {progress && !assets ? t('recap.loadingImages', { done: progress.done, total: progress.total }) : t('recap.rendering')}
                </p>
              )}
              <div className="btn-row">
                <button className="btn primary" disabled={!output} onClick={() => output && saveFile(output.blob, file)}>
                  {t('matchDeck.download')}
                </button>
                <button className="btn" onClick={copy}>
                  {copied === 'ok' ? t('deck.copied') : t('matchDeck.copy')}
                </button>
              </div>
              {copied === 'fail' && <p className="small recap-warn">{t('matchDeck.copyFailed')}</p>}
              {output && (
                <figure className="deck-preview">
                  <img src={output.url} alt={t('matchDeck.title', { name })} />
                </figure>
              )}
              <details className="deck-text" open={copied === 'fail'}>
                <summary>{t('matchDeck.text')}</summary>
                <textarea value={deck.text} readOnly rows={Math.min(20, deck.cards.length + 1)} onFocus={(e) => e.currentTarget.select()} />
              </details>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
