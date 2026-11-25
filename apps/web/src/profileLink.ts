// Link do perfil público (roadmap E1): `/?perfil=<id do jogador>`. O id é o do jogador
// (`p-` + 12 hex), o mesmo de `GET /api/players/me`; qualquer outra coisa é ignorada.

export const PROFILE_PARAM = 'perfil';

const PLAYER_ID = /^p-[0-9a-f]{12}$/;

/** O id do perfil no endereço (null = não há, ou não é um id de jogador). */
export function parseProfileParam(params: URLSearchParams): string | null {
  const v = params.get(PROFILE_PARAM)?.trim().toLowerCase() ?? '';
  return PLAYER_ID.test(v) ? v : null;
}

/** Endereço para compartilhar o perfil. */
export function profileUrl(id: string, origin = typeof location === 'undefined' ? '' : location.origin): string {
  return `${origin}/?${PROFILE_PARAM}=${encodeURIComponent(id)}`;
}
