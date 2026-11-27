// Busca na lista de amigos (a folha "Amigos" e o painel "Chamar amigos" da mesa do Yonko): pelo apelido, sem
// diferenciar maiúsculas nem acentos.

/** A lista só ganha o campo de busca a partir de tantos amigos: com menos, cabe num olhar. */
export const FRIEND_SEARCH_MIN = 6;

const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/** Os amigos cujo apelido tem todas as palavras da busca, na ordem em que vieram. Busca vazia: todos. */
export function searchFriends<T extends { name: string }>(friends: T[], query: string): T[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return friends;
  return friends.filter((f) => {
    const name = fold(f.name);
    return words.every((w) => name.includes(w));
  });
}
