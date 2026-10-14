// Arquivos do kit de divulgação, sem dependências: ZIP (as peças em PNG, numeradas na
// ordem do carrossel) e PDF A4 (uma peça por página, em JPEG). Os PNGs já vêm
// comprimidos, então o ZIP só guarda ("stored"); o PDF embute o JPEG como está
// (DCTDecode), o que basta para imagens e mantém o arquivo leve.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const utf8 = (s: string) => new TextEncoder().encode(s);

/** Junta pedaços binários num só. */
function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** ZIP sem compressão; os nomes vão em UTF-8 (bit 11). */
export function makeZip(files: Array<{ name: string; data: Uint8Array }>, date = new Date()): Uint8Array<ArrayBuffer> {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = utf8(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    locals.push(new Uint8Array(local.buffer), name, f.data);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, time, true);
    central.setUint16(14, day, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, f.data.length, true);
    central.setUint32(24, f.data.length, true);
    central.setUint16(28, name.length, true);
    central.setUint32(42, offset, true);
    centrals.push(new Uint8Array(central.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const dir = concat(centrals);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, dir.length, true);
  end.setUint32(16, offset, true);
  return concat([...locals, dir, new Uint8Array(end.buffer)]);
}

/** Texto do PDF em UTF-16BE (aceita acentos, japonês…). */
const pdfText = (s: string) =>
  `<FEFF${Array.from(s)
    .flatMap((ch) => {
      const code = ch.codePointAt(0)!;
      if (code <= 0xffff) return [code];
      const v = code - 0x10000;
      return [0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff)];
    })
    .map((u) => u.toString(16).padStart(4, '0').toUpperCase())
    .join('')}>`;

/** A4 em pontos. */
export const A4 = { width: 595.28, height: 841.89 };

/**
 * PDF com uma imagem JPEG por página A4, centralizada sobre um fundo da cor `background`
 * (r, g, b de 0 a 1), com margem de `margin` pontos.
 */
export function makePdf(
  pages: Array<{ jpeg: Uint8Array; width: number; height: number }>,
  { title = '', background = [0.05, 0.13, 0.21] as [number, number, number], margin = 24 } = {},
): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const push = (p: Uint8Array | string) => {
    const b = typeof p === 'string' ? utf8(p) : p;
    parts.push(b);
    size += b.length;
  };
  // Objetos: 1 catálogo, 2 páginas, 3 informações; depois 3 por página (página, conteúdo, imagem).
  const obj = (n: number, body: () => void) => {
    offsets[n] = size;
    push(`${n} 0 obj\n`);
    body();
    push('\nendobj\n');
  };
  const first = 4;
  const ids = pages.map((_, i) => first + i * 3);
  push('%PDF-1.4\n');
  // Comentário com bytes altos: avisa os leitores de que o arquivo é binário.
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Kids [${ids.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`));
  obj(3, () => push(`<< /Title ${pdfText(title)} /Producer (GumGum Fight) >>`));
  const n = (v: number) => (Math.round(v * 100) / 100).toString();
  pages.forEach((pg, i) => {
    const id = ids[i];
    const scale = Math.min((A4.width - 2 * margin) / pg.width, (A4.height - 2 * margin) / pg.height);
    const w = pg.width * scale;
    const h = pg.height * scale;
    const x = (A4.width - w) / 2;
    const y = (A4.height - h) / 2;
    const content = `${background.map(n).join(' ')} rg 0 0 ${n(A4.width)} ${n(A4.height)} re f\nq ${n(w)} 0 0 ${n(h)} ${n(x)} ${n(y)} cm /Im0 Do Q`;
    obj(id, () =>
      push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(A4.width)} ${n(A4.height)}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`,
      ),
    );
    obj(id + 1, () => {
      push(`<< /Length ${utf8(content).length} >>\nstream\n`);
      push(content);
      push('\nendstream');
    });
    obj(id + 2, () => {
      push(
        `<< /Type /XObject /Subtype /Image /Width ${pg.width} /Height ${pg.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.jpeg.length} >>\nstream\n`,
      );
      push(pg.jpeg);
      push('\nendstream');
    });
  });
  const count = first + pages.length * 3;
  const xref = size;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let i = 1; i < count; i++) push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return concat(parts);
}

/** Baixa um arquivo gerado no navegador. */
export function saveFile(data: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(data);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
