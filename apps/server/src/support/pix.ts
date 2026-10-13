// "Pix copia e cola" estático (BR Code), no padrão EMV QRCPS-MPM do Banco Central.
// O mesmo texto vira o QR code: qualquer app de banco lê e preenche chave, nome e valor.

/** Campo EMV: id de 2 dígitos + tamanho de 2 dígitos + valor. */
const field = (id: string, value: string) => `${id}${String(value.length).padStart(2, '0')}${value}`;

/** CRC16-CCITT (polinômio 0x1021, valor inicial 0xFFFF), em 4 dígitos hexadecimais maiúsculos. */
export function crc16(text: string): string {
  let crc = 0xffff;
  for (const byte of Buffer.from(text, 'utf8')) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Nome e cidade só aceitam ASCII: tira acentos e símbolos e corta no tamanho máximo. */
const plain = (s: string, max: number) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 .-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, max)
    .trim();

export interface PixInput {
  /** Chave Pix (aleatória, e-mail, telefone ou CPF/CNPJ). */
  key: string;
  /** Nome de quem recebe (até 25 caracteres). */
  name: string;
  /** Cidade de quem recebe (até 15 caracteres). */
  city: string;
  /** Valor em reais (sem valor: quem paga digita). */
  amount?: number | null;
  /** Mensagem que aparece para quem paga (opcional, curta). */
  message?: string;
}

/** Texto do Pix copia e cola. Lança erro se a chave, o nome ou a cidade não servirem. */
export function pixPayload({ key, name, city, amount, message }: PixInput): string {
  const k = key.trim();
  if (!k || k.length > 77) throw new Error('Chave Pix inválida.');
  const n = plain(name, 25);
  const c = plain(city, 15);
  if (!n || !c) throw new Error('Nome e cidade do recebedor são obrigatórios.');
  const info = field('00', 'br.gov.bcb.pix') + field('01', k) + (message ? field('02', plain(message, 40)) : '');
  if (info.length > 99) throw new Error('Chave Pix e mensagem longas demais.');
  if (amount !== undefined && amount !== null && (!Number.isFinite(amount) || amount <= 0 || amount > 99_999)) {
    throw new Error('Valor inválido.');
  }
  const body =
    field('00', '01') +
    field('26', info) +
    field('52', '0000') +
    field('53', '986') +
    (amount ? field('54', amount.toFixed(2)) : '') +
    field('58', 'BR') +
    field('59', n) +
    field('60', c) +
    field('62', field('05', '***')) +
    '6304';
  return body + crc16(body);
}
