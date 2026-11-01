// チームボットの文言（日本語）。

import type { TeamMessages } from './pt-BR';

export default {
  'team.tag': 'チーム',
  'team.tagTitle': 'ボットチームのメンバー',
  'admin.teamHelpLabel': 'チーム',
  'admin.teamHelp': 'チームボット（環境デッキ）と対戦し、ボットのプレイの修正を送ります。',
  'admin.team': 'ボットチーム',
  'admin.teamOn': 'チームに参加中',
  'admin.teamOff': 'チーム外',
  'errors.invalidTeam': 'アカウントをチームに入れるか外すかを指定してください。',
  'labels.deckGroup.meta': '環境デッキ',
  'decks.empty.meta': '環境デッキはありません。',
  'decks.tab.meta': '環境デッキ',
  'menu.botTeam': 'チーム',
  'menu.botTeamTitle': 'チームボット：デッキの知識を使って環境デッキをプレイします。チームのメンバー専用です。',
  'menu.botTeamServer': 'チームボットはサーバーでプレイし、対戦は「観戦」に表示されます。',
  'errors.invalidBotLevel': 'ボットのレベルが無効です。',
  'botFeedback.title': 'ボットを評価',
  'botFeedback.star1': '下手だった',
  'botFeedback.star2': '期待以下',
  'botFeedback.star3': 'まずまず',
  'botFeedback.star4': '上手かった',
  'botFeedback.star5': '強いプレイヤー並み',
  'botFeedback.commentPlaceholder': '何が間違っていた（または良かった）か。ターンを書いてください。',
  'botFeedback.marks': '{n|# 件のプレイをマーク}',
  'botFeedback.send': 'チームに送る',
  'botFeedback.sent': 'ありがとうございます！評価はボットの修正ボックスに送られました。',
  'errors.teamOnly': 'チームボットはチームのメンバー専用です。',
} satisfies TeamMessages;
