// Kit de divulgação do torneio encerrado: as peças para redes sociais (PNG, na ordem do
// carrossel), tudo num ZIP e o mesmo conteúdo num PDF A4. Gerado no navegador de quem
// organiza, a partir de GET /api/tournaments/:id/recap. Carregado sob demanda (fora do
// bundle principal), junto com o desenho e os geradores de ZIP/PDF.

import { formatLabel } from '@gumgum/engine';
import { useEffect, useMemo, useState } from 'react';
import { api, type RecapRound, type TournamentRecap as Recap } from '../api';
import { type Locale, type Translate, useLocale, useT } from '../i18n';
import { fmtDate } from '../i18n/format';
import { FORMAT_SIZE, type RecapAssets, type RecapFormat, recapPieces, type RecapTexts } from '../recap/draw';
import { makePdf, makeZip, saveFile } from '../recap/export';
import { slug } from '../recap/layout';
import { phaseName } from './Tournaments';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Logo do GumGum: o SVG ganha largura e altura (sem elas, alguns navegadores não o desenham no canvas). */
async function loadLogo(): Promise<HTMLImageElement | null> {
  try {
    const svg = await (await fetch('/brand/header-logo-dark-bg.svg')).text();
    const sized = svg.replace('<svg ', '<svg width="1854" height="448" ');
    const url = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' }));
    const img = await loadImage(url);
    URL.revokeObjectURL(url);
    return img;
  } catch {
    return null;
  }
}

/** Fontes da marca prontas antes de desenhar (o canvas não espera por elas). */
async function loadFonts() {
  try {
    await Promise.all(['64px Bangers', '900 32px Nunito', '800 32px Nunito', '700 32px Nunito'].map((f) => document.fonts.load(f)));
  } catch {
    // Sem as fontes, o canvas usa as alternativas da pilha.
  }
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), type, quality));

function texts(tr: Translate, recap: Recap, locale: Locale): RecapTexts {
  const date = recap.tournament.finishedAt ?? recap.tournament.startedAt;
  return {
    champion: tr('recap.img.champion'),
    campaignTitle: tr('recap.img.campaignTitle'),
    leadersTitle: tr('recap.img.leadersTitle'),
    top8: tr('recap.img.top8'),
    allPlayers: tr('recap.img.allPlayers'),
    othersN: (n) => tr('recap.img.othersN', { n }),
    players: (n) => tr('recap.img.players', { n }),
    place: (rank) => tr(rank === 1 ? 'recap.img.place1' : rank === 2 ? 'recap.img.place2' : rank === 3 ? 'recap.img.place3' : 'recap.img.place4'),
    swissRecord: (wins, losses) => tr('recap.img.swissRecord', { wins, losses }),
    elimRecord: (wins, losses) => tr('recap.img.elimRecord', { wins, losses }),
    bracketRecord: (wins, losses) => tr('recap.img.bracketRecord', { wins, losses }),
    earlyFinish: tr('recap.img.earlyFinish'),
    play: tr('recap.img.play'),
    draw: tr('recap.img.draw'),
    playDrawLegend: tr('recap.img.playDrawLegend'),
    game: (n) => tr('recap.img.game', { n }),
    bye: tr('recap.img.bye'),
    noShow: tr('recap.img.noShow'),
    doubleNoShow: tr('recap.img.doubleNoShow'),
    reported: tr('recap.img.reported'),
    dropWin: tr('recap.img.dropWin'),
    pending: tr('recap.img.pending'),
    round: (r: RecapRound) => (r.stage === 'elim' ? phaseName(tr, r.size) : tr('tour.roundN', { n: r.round })),
    cards: (n) => tr('recap.img.cards', { n }),
    date: date ? fmtDate(date, locale) : null,
    format: formatLabel(recap.tournament.format as never),
    site: window.location.host,
  };
}

interface Output {
  id: string;
  label: string;
  file: string;
  blob: Blob;
  url: string;
}

export default function TournamentRecap({ id, onClose }: { id: string; onClose: () => void }) {
  const tr = useT();
  const locale = useLocale();
  const [recap, setRecap] = useState<Recap | null>(null);
  const [assets, setAssets] = useState<(RecapAssets & { missing: number }) | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [format, setFormat] = useState<RecapFormat>('feed');
  const [outputs, setOutputs] = useState<Output[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    api.tournaments
      .recap(id)
      .then(setRecap)
      .catch((e) => setError(errorText(e)));
  }, [id]);

  // Todas as imagens carregadas antes de desenhar (com progresso); a que falhar vira carta sem arte.
  useEffect(() => {
    if (!recap) return;
    let alive = true;
    const urls = [
      ...new Set(
        [
          ...recap.top.flatMap((p) => [p.leader.image, ...p.cards.map((c) => c.image)]),
          ...recap.campaign.map((r) => r.opponent?.leader.image),
          ...recap.leadersAll.map((l) => l.leader.image),
        ].filter((u): u is string => Boolean(u)),
      ),
    ];
    const images = new Map<string, HTMLImageElement | null>();
    let done = 0;
    setProgress({ done, total: urls.length });
    const tick = () => alive && setProgress({ done: ++done, total: urls.length });
    void Promise.all([
      loadFonts(),
      loadLogo(),
      recap.tournament.sponsor?.logoUrl ? loadImage(recap.tournament.sponsor.logoUrl) : Promise.resolve(null),
      ...urls.map((u) =>
        loadImage(u).then((img) => {
          images.set(u, img);
          tick();
        }),
      ),
    ]).then(([, logo, sponsorLogo]) => {
      if (!alive) return;
      setAssets({
        image: (u) => (u ? (images.get(u) ?? null) : null),
        logo: logo ?? null,
        sponsorLogo: sponsorLogo ?? null,
        missing: [...images.values()].filter((img) => !img).length,
      });
    });
    return () => {
      alive = false;
    };
  }, [recap]);

  const pieces = useMemo(
    () =>
      recap && assets
        ? recapPieces(recap, texts(tr, recap, locale), assets, {
            champion: tr('recap.piece.champion'),
            campaign: tr('recap.piece.campaign'),
            deck: (rank) => tr('recap.piece.deck', { n: rank }),
            leadersTop8: tr('recap.piece.leadersTop8'),
            leadersAll: tr('recap.piece.leadersAll'),
          })
        : null,
    [recap, assets, tr, locale],
  );

  // Desenha as peças no formato escolhido e guarda cada uma como PNG.
  useEffect(() => {
    if (!pieces) return;
    let alive = true;
    const made: Output[] = [];
    setOutputs(null);
    void (async () => {
      try {
        const { width, height } = FORMAT_SIZE[format];
        for (const [i, p] of pieces.entries()) {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          p.draw(canvas.getContext('2d')!, format);
          const blob = await toBlob(canvas, 'image/png');
          if (!alive) return;
          made.push({ id: p.id, label: p.label, file: `${String(i + 1).padStart(2, '0')}-${p.id}.png`, blob, url: URL.createObjectURL(blob) });
        }
        if (alive) setOutputs([...made]);
      } catch (e) {
        // Canvas "contaminado" (imagem de outro domínio sem CORS) ou falta de memória.
        if (alive) setError(tr('recap.renderError', { reason: errorText(e) }));
      }
    })();
    return () => {
      alive = false;
      for (const o of made) URL.revokeObjectURL(o.url);
    };
  }, [pieces, format, tr]);

  const base = recap ? `kit-${slug(recap.tournament.name)}-${format === 'feed' ? '1080x1350' : '1080x1920'}` : 'kit';

  const downloadZip = async () => {
    if (!outputs) return;
    setBusy(true);
    try {
      const files = await Promise.all(outputs.map(async (o) => ({ name: o.file, data: new Uint8Array(await o.blob.arrayBuffer()) })));
      saveFile(new Blob([makeZip(files)], { type: 'application/zip' }), `${base}.zip`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  /** PDF A4: cada peça vira JPEG (o PDF fica leve) numa página. */
  const downloadPdf = async () => {
    if (!outputs || !recap) return;
    setBusy(true);
    try {
      const pages = [];
      for (const o of outputs) {
        const bitmap = await createImageBitmap(o.blob);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
        bitmap.close();
        const jpeg = new Uint8Array(await (await toBlob(canvas, 'image/jpeg', 0.9)).arrayBuffer());
        pages.push({ jpeg, width: canvas.width, height: canvas.height });
      }
      saveFile(new Blob([makePdf(pages, { title: recap.tournament.name })], { type: 'application/pdf' }), `${base}.pdf`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const ready = Boolean(outputs);
  return (
    <div className="modal-backdrop sheet-backdrop page-sheet centered" onClick={onClose}>
      <div className="sheet recap-sheet" role="dialog" aria-modal="true" aria-label={tr('recap.title')} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>{tr('recap.title')}</h3>
          <button className="zoom-close static" onClick={onClose} aria-label={tr('common.close')}>
            ✕
          </button>
        </div>
        <div className="sheet-body">
          <p className="muted small recap-intro">{tr('recap.intro')}</p>
          <div className="seg recap-format">
            {(['feed', 'story'] as const).map((f) => (
              <button key={f} className={format === f ? 'on' : ''} onClick={() => setFormat(f)} disabled={!ready}>
                {tr(f === 'feed' ? 'recap.formatFeed' : 'recap.formatStory')}
              </button>
            ))}
          </div>
          {error && <div className="error">{error}</div>}
          {recap && !recap.cardImages && <p className="small recap-warn">{tr('recap.noArt')}</p>}
          {assets && assets.missing > 0 && <p className="small recap-warn">{tr('recap.missingArt', { n: assets.missing })}</p>}
          {!error && !ready && (
            <p className="muted">
              {progress && !assets ? tr('recap.loadingImages', { done: progress.done, total: progress.total }) : recap ? tr('recap.rendering') : tr('common.loading')}
            </p>
          )}
          {outputs && (
            <>
              <div className="btn-row">
                <button className="btn primary" disabled={busy} onClick={() => void downloadZip()}>
                  {tr('recap.downloadAll')}
                </button>
                <button className="btn" disabled={busy} onClick={() => void downloadPdf()}>
                  {tr('recap.downloadPdf')}
                </button>
              </div>
              <div className={['recap-grid', format].join(' ')}>
                {outputs.map((o, i) => (
                  <figure key={o.id} className="recap-piece">
                    <img src={o.url} alt={o.label} loading="lazy" />
                    <figcaption>
                      <span className="small">
                        {i + 1}. {o.label}
                      </span>
                      <button className="btn small" onClick={() => saveFile(o.blob, `${base}-${o.file}`)}>
                        {tr('recap.downloadPng')}
                      </button>
                    </figcaption>
                  </figure>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
