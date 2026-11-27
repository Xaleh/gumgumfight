import { describe, expect, it } from 'vitest';
import { searchFriends } from '../src/friendSearch';

const friends = [{ name: 'Xuxu' }, { name: 'Capitão Zé' }, { name: 'Pirata 77CA' }, { name: 'pirata c61a' }];
const names = (query: string) => searchFriends(friends, query).map((f) => f.name);

describe('busca de amigos', () => {
  it('busca vazia (ou só espaços) devolve todos, na mesma ordem', () => {
    expect(searchFriends(friends, '')).toBe(friends);
    expect(names('   ')).toEqual(friends.map((f) => f.name));
  });

  it('acha pelo pedaço do apelido, sem diferenciar maiúsculas nem acentos', () => {
    expect(names('xu')).toEqual(['Xuxu']);
    expect(names('CAPITAO')).toEqual(['Capitão Zé']);
    expect(names('zé')).toEqual(['Capitão Zé']);
    expect(names('pirata')).toEqual(['Pirata 77CA', 'pirata c61a']);
  });

  it('com várias palavras, o apelido precisa ter todas', () => {
    expect(names('pirata 77')).toEqual(['Pirata 77CA']);
    expect(names('ze capitao')).toEqual(['Capitão Zé']);
    expect(names('pirata xuxu')).toEqual([]);
  });
});
