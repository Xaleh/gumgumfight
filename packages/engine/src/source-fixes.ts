// Correções de nome, de tipos e de texto das cartas que vêm da optcgapi.com.
//
// A API corta nomes e tipos ("Gum-Gum Giant Rifl", "Straw Hat Cre"), formata nomes de outro jeito
// ("Mr.3 (Galdino)" no lugar de "Mr.3(Galdino)", que é como os textos das cartas os citam), perde
// ou troca tipos. A referência é a lista oficial da Bandai (https://en.onepiece-cardgame.com/cardlist/).
// Não é errata (a carta impressa já está certa): é o dado da fonte que está errado.
//
// Tabela gerada com `npm run cards:check-official -w @gumgum/server` em 07/10/2026 e revisada à mão;
// o comentário de cada linha mostra o que a API trazia.
// A lista oficial tem um erro conhecido, já tratado pelo comando: ST11-005 traz o tipo em
// japonês ("音楽"); o certo é {Music}.
//
// SOURCE_TEXT_FIXES corrige o texto que a API traz estragado (hífen colado, frase repetida). O
// comando acima não confere texto: estas entradas foram conferidas à mão (lista oficial ou, para as
// promos que ainda não estão nela, o texto das outras versões da carta).

import type { CardData } from './types';

export interface SourceFix {
  name?: string;
  types?: string[];
}

export const SOURCE_FIXES: Readonly<Record<string, SourceFix>> = {
  'EB01-027': { name: "Mr.1(Daz.Bonez)" }, // API: nome "Mr. 1 (Daz.Bonez)"
  'EB01-036': { types: ["Impel Down", "Jailer Beast"] }, // API: tipos ["Baroque Works","Impel Down","Jailer Beast"]
  'EB01-061': { name: "Mr.2.Bon.Kurei(Bentham)" }, // API: nome "Mr.2.Bon.Kurei (Bentham)"
  'EB03-034': { types: ["Rocks Pirates"] }, // API: tipos ["Big Mom Pirates"]
  'EB03-038': { name: "Thanks for the Treat. ♡" }, // API: nome "Thanks for the Treat."
  'EB04-014': { name: "Kozuki Sukiyaki" }, // API: nome "Kouzuki Sukiyaki"
  'EB04-050': { name: "I'll Whip You Into Shape. ♡" }, // API: nome "I'll Whip You Into Shape."
  'EB04-059': { name: "Black Rope Dragon Twister" }, // API: nome "Black Rope Dragon Twiste"
  'OP01-005': { types: ["FILM"] }, // API: tipos ["Film"]
  'OP01-011': { types: ["FILM"] }, // API: tipos ["Film"]
  'OP01-018': { types: ["Giant", "New Giant Pirates"] }, // API: tipos ["Giant","New Giant Pirate Crew"]
  'OP01-019': { types: ["Supernovas", "Barto Club"] }, // API: tipos ["Barto Club Pirates","Supernovas"]
  'OP01-034': { types: ["Minks", "Land of Wano", "The Akazaya Nine"] }, // API: tipos ["Former Whitebeard Pirates","Land of Wano","Minks","The Akazaya Nine"]
  'OP01-083': { name: "Mr.1(Daz.Bonez)" }, // API: nome "Mr.1 (Daz.Bonez)"
  'OP01-084': { name: "Mr.2.Bon.Kurei(Bentham)" }, // API: nome "Mr.2.Bon.Kurei (Bentham)"
  'OP01-085': { name: "Mr.3(Galdino)" }, // API: nome "Mr.3 (Galdino)"
  'OP02-028': { types: ["FILM", "Straw Hat Crew"] }, // API: tipos ["Film","Straw Hat Crew"]
  'OP02-033': { types: ["FILM", "Fish-Man", "Straw Hat Crew"] }, // API: tipos ["Film","Fish-Man","Straw Hat Crew"]
  'OP02-034': { types: ["FILM", "Animal", "Straw Hat Crew"] }, // API: tipos ["Animal","Film","Straw Hat Crew"]
  'OP02-035': { types: ["FILM", "Supernovas", "Heart Pirates"] }, // API: tipos ["Film","Heart Pirates","Supernovas"]
  'OP02-036': { types: ["FILM", "Straw Hat Crew"] }, // API: tipos ["Film","Straw Hat Crew"]
  'OP02-037': { types: ["FILM", "Straw Hat Crew"] }, // API: tipos ["Film","Straw Hat Crew"]
  'OP02-039': { types: ["FILM", "Straw Hat Crew"] }, // API: tipos ["Film","Straw Hat Crew"]
  'OP02-040': { types: ["FILM", "Straw Hat Crew"] }, // API: tipos ["Straw Hat Crew"]
  'OP02-041': { types: ["FILM", "Supernovas", "Straw Hat Crew"] }, // API: tipos ["Straw Hat Crew","Supernovas"]
  'OP02-043': { types: ["FILM", "Supernovas", "Straw Hat Crew"] }, // API: tipos ["Film","Straw Hat Crew","Supernovas"]
  'OP02-045': { types: ["FILM", "Supernovas", "Straw Hat Crew"] }, // API: tipos ["Film","Straw Hat Crew","Supernovas"]
  'OP02-046': { types: ["FILM", "Straw Hat Crew"] }, // API: tipos ["Film","Straw Hat Crew"]
  'OP02-063': { name: "Mr.1(Daz.Bonez)" }, // API: nome "Mr.1 (Daz.Bonez)"
  'OP02-064': { name: "Mr.2.Bon.Kurei(Bentham)" }, // API: nome "Mr.2.Bon.Kurei (Bentham)"
  'OP02-065': { name: "Mr.3(Galdino)" }, // API: nome "Mr.3 (Galdino)"
  'OP02-072': { types: ["FILM", "Neo Navy"] }, // API: tipos ["Film","Neo Navy"]
  'OP02-112': { name: "Bell-mère" }, // API: nome "Bell-mere"
  'OP03-036': { types: ["East Blue", "Black Cat Pirates"] }, // API: tipos []
  'OP03-038': { types: ["East Blue", "Krieg Pirates"] }, // API: tipos []
  'OP03-051': { name: "Bell-mère" }, // API: nome "Bell-mere"
  'OP03-114': { types: ["The Four Emperors", "Big Mom Pirates"] }, // API: tipos ["Big Mom Pirates"]
  'OP04-069': { name: "Mr.2.Bon.Kurei(Bentham)" }, // API: nome "Mr.2.Bon.Kurei (Bentham)"
  'OP04-070': { name: "Mr.3(Galdino)" }, // API: nome "Mr.3 (Galdino)"
  'OP04-071': { name: "Mr.4(Babe)" }, // API: nome "Mr.4 (Babe)"
  'OP04-072': { name: "Mr.5(Gem)" }, // API: nome "Mr.5"
  'OP04-088': { types: ["Giant", "Dressrosa", "New Giant Pirates"] }, // API: tipos ["Giant","New Giant Pirate Crew","Dressrosa"]
  'OP05-040': { types: ["Donquixote Pirates"] }, // API: tipos []
  'OP05-059': { name: "Let Us Begin the World of Violence!!!" }, // API: nome "Let Us Begin the World of Violence!!"
  'OP05-075': { name: "Mr.1(Daz.Bonez)" }, // API: nome "Mr.1 (Daz.Bonez)"
  'OP05-094': { name: "Haute Couture Patch★Work" }, // API: nome "Haute Couture Patch Work"
  'OP05-096': { types: ["Celestial Dragons"] }, // API: tipos []
  'OP06-115': { name: "You're the One Who Should Disappear." }, // API: nome "You're the One Who Should Disappear"
  'OP07-004': { types: ["Mountain Bandits"] }, // API: tipos ["Mountain Bandits","Mountain Bandits"]
  'OP07-009': { types: ["Mountain Bandits"] }, // API: tipos ["Mountain Bandits","Mountain Bandits"]
  'OP07-018': { name: "KEEP OUT" }, // API: nome "Keep Out"
  'OP08-076': { name: "It's to Die For..." }, // API: nome "It's to Die For"
  'OP08-091': { name: "Who's.Who" }, // API: nome "Whos.Who"
  'OP10-064': { types: ["Kingdom of GERMA"] }, // API: tipos ["The Vinsmoke Family","Kingdom of GERMA"]
  'OP11-012': { types: ["Straw Hat Crew"] }, // API: tipos ["Navy","SWORD"]
  'OP11-031': { types: ["Fish-Man", "Fish-Man Island", "The Sun Pirates"] }, // API: tipos ["The Sun Pirates","Merfolk","Fish-Man Island"]
  'OP12-016': { types: ["Former Roger Pirates"] }, // API: tipos []
  'OP12-017': { types: ["Former Roger Pirates"] }, // API: tipos []
  'OP12-018': { types: ["Former Roger Pirates"] }, // API: tipos []
  'OP12-019': { types: ["Former Roger Pirates"] }, // API: tipos []
  'OP13-009': { types: ["Mountain Bandits"] }, // API: tipos ["Mountain Bandits","Mountain Bandits"]
  'OP13-013': { types: ["Mountain Bandits"] }, // API: tipos ["Mountain Bandits","Mountain Bandits"]
  'OP13-018': { types: ["Evil Black Drum Kingdom"] }, // API: tipos ["Evil Black","Drum Kingdom"]
  'OP13-079': { types: ["?"] }, // API: tipos []
  'OP14-091': { name: "Mr.2.Bon.Kurei(Bentham)" }, // API: nome "Mr.2.Bon.Kurei (Bentham)"
  'OP14-094': { name: "Mr.5(Gem)" }, // API: nome "Mr.5"
  'OP14-118': { name: "You'll Frighten Me... ♡" }, // API: nome "You'll Frighten Me..."
  'OP15-015': { types: ["East Blue", "Mountain Bandits"] }, // API: tipos ["Mountain Bandits","East Blue","Mountain Bandits"]
  'OP16-003': { types: ["The Four Emperors", "Whitebeard Pirates"] }, // API: tipos ["Whitebeard Pirates"]
  'OP16-020': { name: "If You're Coming with Me... Kiss Your Lives Goodbye!!" }, // API: nome "If You're Coming with Me...Kiss Your Lives Goodbye!!"
  'OP16-038': { name: "Let's Go!! To the Navy Headquarters!!" }, // API: nome "Let's Go!! To the Navy Headquarters.."
  'OP16-065': { name: "Sakazuki" }, // API: nome "Sakazuk"
  'OP17-021': { name: "Crone Oli" }, // API: nome "Crone Oil"
  'OP17-037': { name: "Are You That Afraid of the New Era?!!" }, // API: nome "Are You That Afraid of the New Era?!"
  'OP17-099': { types: ["The Four Emperors", "Big Mom Pirates"] }, // API: tipos ["Special"]
  'P-002': { name: "I Smell Adventure!!!" }, // API: nome "I Smell Adventure Ahead!"
  'P-011': { types: ["FILM"] }, // API: tipos ["Special"]
  'P-012': { types: ["FILM", "Jellyfish Pirates"] }, // API: tipos ["Film","Jellyfish Pirates"]
  'P-013': { types: ["FILM"] }, // API: tipos ["Film"]
  'P-014': { types: ["FILM", "Navy"] }, // API: tipos ["Film","Navy"]
  'P-015': { types: ["FILM", "Straw Hat Crew"] }, // API: tipos ["Film","Straw Hat Crew"]
  'P-016': { types: ["FILM", "The Four Emperors", "Red-Haired Pirates"] }, // API: tipos ["Film","The Four Emperors","Red-Haired Pirates"]
  'P-017': { types: ["FILM", "Supernovas", "Heart Pirates"] }, // API: tipos ["Film","Heart Pirates","Supernovas"]
  'P-018': { types: ["FILM", "Supernovas", "Barto Club"] }, // API: tipos ["Barto Club Pirates","Film","Supernovas"]
  'P-019': { types: ["FILM", "Minks", "Heart Pirates"] }, // API: tipos ["Film","Heart Pirates","Minks"]
  'P-020': { types: ["FILM", "Navy"] }, // API: tipos ["Film","Navy"]
  'P-021': { types: ["FILM", "Red-Haired Pirates"] }, // API: tipos ["Film","Red-Haired Pirates"]
  'P-023': { types: ["FILM", "Red-Haired Pirates"] }, // API: tipos ["Film","Red-Haired Pirates"]
  'P-072': { types: ["MONSTERS"] }, // API: tipos ["Monsters"]
  // P-147 e P-148 ainda não estão na lista oficial em inglês: nome no formato das outras versões (OP04-066, OP01-085)
  'P-147': { name: "Miss.Valentine(Mikita)" }, // API: nome "Miss.Valentine (Mikita)"
  'P-148': { name: "Mr.3(Galdino)" }, // API: nome "Mr.3 (Galdino)"
  'PRB02-004': { name: "Jewelry Bonney" }, // API: nome "Jewelry Bonney -PRB02-004"
  'ST04-007': { types: ["Animal Kingdom Pirates", "Smile"] }, // API: tipos ["Animal Kingdom Pirates","SMILE"]
  'ST04-009': { types: ["Animal Kingdom Pirates", "Smile"] }, // API: tipos ["Animal Kingdom Pirates","SMILE"]
  'ST04-010': { types: ["Animal Kingdom Pirates"] }, // API: tipos ["Animal Kingdom Pirates","Smile"]
  'ST05-001': { types: ["FILM", "The Four Emperors", "Red-Haired Pirates"] }, // API: tipos ["Film","The Four Emperors","Red-Haired Pirates"]
  'ST05-002': { types: ["FILM", "Neo Navy"] }, // API: tipos ["Film","Neo Navy"]
  'ST05-003': { types: ["FILM", "The Pirates Fest"] }, // API: tipos ["Film","The Pirates Fest"]
  'ST05-004': { types: ["FILM"] }, // API: tipos ["Film"]
  'ST05-005': { types: ["FILM", "Grantesoro"] }, // API: tipos ["Film","Grantesoro"]
  'ST05-006': { types: ["FILM", "Grantesoro"] }, // API: tipos ["Film","Grantesoro"]
  'ST05-007': { types: ["FILM"] }, // API: tipos ["Film"]
  'ST05-008': { types: ["FILM", "Golden Lion Pirates"] }, // API: tipos ["Film","Golden Lion Pirates"]
  'ST05-009': { types: ["FILM", "Animal", "Golden Lion Pirates"] }, // API: tipos ["Animal","Film","Golden Lion Pirates"]
  'ST05-010': { types: ["FILM", "Neo Navy"] }, // API: tipos ["Film","Neo Navy"]
  'ST05-011': { types: ["FILM", "The Pirates Fest"] }, // API: tipos ["Film","The Pirates Fest"]
  'ST05-012': { types: ["FILM", "Grantesoro"] }, // API: tipos ["Film","Grantesoro"]
  'ST05-013': { types: ["FILM", "Neo Navy"] }, // API: tipos ["Film","Neo Navy"]
  'ST05-014': { types: ["FILM", "The Pirates Fest"] }, // API: tipos ["Film","The Pirates Fest"]
  'ST05-015': { types: ["FILM", "Scientist", "Golden Lion Pirates"] }, // API: tipos ["Film","Scientist","Golden Lion Pirates"]
  'ST05-016': { types: ["FILM", "Golden Lion Pirates"] }, // API: tipos ["Film","Golden Lion Pirates"]
  'ST05-017': { types: ["FILM", "The Pirates Fest"] }, // API: tipos ["Film","The Pirates Fest"]
  'ST07-009': { name: "Charlotte Mont-d'or" }, // API: nome "Charlotte Mont-d'Or"
  'ST08-013': { name: "Mr.2.Bon.Kurei(Bentham)" }, // API: nome "Mr.2.Bon.Kurei (Bentham)"
  'ST11-002': { types: ["Music", "FILM"] }, // API: tipos ["FILM"]
  'ST14-014': { name: "Gum-Gum Giant Rifle", types: ["Straw Hat Crew"] }, // API: nome "Gum-Gum Giant Rifl", tipos ["Straw Hat Cre"]
  'ST30-009': { types: ["Giant", "Whitebeard Pirates Allies"] }, // API: tipos ["Giant","Whitebeard Pirates"]
};

/**
 * Texto estragado na fonte: trocas de trecho [como a API traz, como está na carta]. Como na errata,
 * a troca só acontece se o trecho estragado estiver no texto (a API pode corrigir um dia) e aplicar
 * de novo não muda nada. Conferido em 07/10/2026 em todas as cartas da optcgapi: o hífen colado no
 * lugar do espaço ("Play-up", "1-rested", "Character-gains") só aparece nestas três promos.
 */
export const SOURCE_TEXT_FIXES: Readonly<Record<string, ReadonlyArray<readonly [string, string]>>> = {
  'P-091': [['Play-up to 1', 'Play up to 1']], // Shirahoshi (lista oficial)
  'P-115': [['Give up to 1-rested DON!! card', 'Give up to 1 rested DON!! card']], // Boa Hancock (lista oficial)
  // P-142 e P-147 ainda não estão na lista oficial em inglês: o texto é o das outras cartas com o
  // mesmo efeito (OP14-090 Miss.Valentine: "this Character gains +2000 power").
  'P-142': [['with 8000 base If your Straw Hat Crew power or less', 'with 8000 base power or less']], // Merry Go: frase repetida
  'P-147': [['this Character-gains +2000 power', 'this Character gains +2000 power']], // Miss.Valentine(Mikita)
};

function patchText(text: string, swaps: ReadonlyArray<readonly [string, string]>): string {
  let out = text;
  for (const [from, to] of swaps) if (out.includes(from)) out = out.split(from).join(to);
  return out;
}

/** A carta com o nome, os tipos e o texto da lista oficial (o mesmo objeto, se não houver o que corrigir). */
export function applySourceFixes<T extends CardData>(card: T): T {
  const fix = SOURCE_FIXES[card.id];
  const textFix = SOURCE_TEXT_FIXES[card.id];
  if (!fix && !textFix) return card;
  const name = fix?.name ?? card.name;
  const types = fix?.types ?? card.types;
  const text = textFix && card.text ? patchText(card.text, textFix) : card.text;
  const sameTypes = types.length === card.types.length && types.every((t, i) => t === card.types[i]);
  if (name === card.name && sameTypes && text === card.text) return card;
  return { ...card, name, types: sameTypes ? card.types : [...types], text };
}
