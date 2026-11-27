// Com que deck o jogador abriu a sala privada em que espera um oponente: a sala de espera oferece a mão de teste
// desse deck (o servidor não devolve o id do deck de quem espera). Vale só nesta aba e só para a última sala.

const KEY = 'gumgum.roomDeck';

export function rememberRoomDeck(roomId: string, deckId: string) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ roomId, deckId }));
  } catch {
    /* sem armazenamento: a sala de espera fica sem a mão de teste */
  }
}

/** O deck guardado para a sala (null: outra sala, outra aba, ou a sala foi aberta por outro caminho). */
export function roomDeck(roomId: string): string | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as { roomId?: unknown; deckId?: unknown } | null;
    return saved && saved.roomId === roomId && typeof saved.deckId === 'string' ? saved.deckId : null;
  } catch {
    return null;
  }
}
