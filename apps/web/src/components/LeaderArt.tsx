import { useState } from 'react';
import { useSettings } from '../settings';

/**
 * Arte do Líder em círculo, recortada no rosto, com a borda na cor da carta
 * (ou a inicial, sem imagens). Usada no menu e nas estatísticas.
 */
export function LeaderArt({
  name,
  image,
  colors,
  size,
}: {
  name?: string;
  image?: string | null;
  colors?: string[];
  /** Sem nome: círculo "?" do sorteio. */
  size?: 'small' | 'tiny';
}) {
  const { showImages } = useSettings();
  const [failed, setFailed] = useState(false);
  if (name === undefined) {
    return <div className={['leader-art', 'random', size ?? ''].join(' ')}>?</div>;
  }
  const color = colors?.[0] === 'blue' ? 'blue-card' : (colors?.[0] ?? 'red');
  return (
    <div className={['leader-art', size ?? ''].join(' ')} style={{ ['--card-color' as string]: `var(--${color})` }}>
      {showImages && image && !failed ? (
        <img src={image} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        name.slice(0, 1)
      )}
    </div>
  );
}
