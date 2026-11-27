import { describe, expect, it } from 'vitest';
import { friendLinkFrom } from '../src/friendLink';

describe('endereços dos amigos', () => {
  it('link de amigo: abre a folha com o código e tira o parâmetro da URL', () => {
    const url = new URL('https://gumgumfight.app/?amigo=abcd2345&x=1');
    expect(friendLinkFrom(url)).toMatchObject({ add: 'ABCD2345', open: true });
    expect(url.search).toBe('?x=1');
  });

  it('aviso de pedido abre a folha; convite entra na sala do código', () => {
    expect(friendLinkFrom(new URL('https://x.app/?amigos=1'))).toMatchObject({ open: true });
    const invite = friendLinkFrom(new URL('https://x.app/?convite=ab12cd'));
    expect(invite).toMatchObject({ invite: 'AB12CD' });
    expect(invite?.open).toBeUndefined();
  });

  it('convite para a mesa do Yonko: senta na mesa do código; o link da mesa, sem convite, fica para o App', () => {
    const url = new URL('https://x.app/?yonko=ab12cd&convite=1');
    const invite = friendLinkFrom(url);
    expect(invite).toMatchObject({ yonko: 'AB12CD' });
    expect(invite?.invite).toBeUndefined();
    expect(url.search).toBe('');
    const link = new URL('https://x.app/?yonko=AB12CD');
    expect(friendLinkFrom(link)).toBeNull();
    expect(link.search).toBe('?yonko=AB12CD');
    expect(friendLinkFrom(new URL('https://x.app/?yonko=../x&convite=1'))?.yonko).toBeUndefined();
  });

  it('ignora códigos inválidos e endereços sem os parâmetros', () => {
    expect(friendLinkFrom(new URL('https://x.app/?sala=ABC123'))).toBeNull();
    const bad = friendLinkFrom(new URL('https://x.app/?amigo=OOOO0000&convite=../x'));
    expect(bad?.add).toBeUndefined();
    expect(bad?.invite).toBeUndefined();
  });
});
