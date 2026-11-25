// Monitoramento (日本語): a aba "Monitoramento" da Administração e os erros das rotas /api/monitor.

import type monitorPtBR from './pt-BR';

const monitor = {
  'monitor.tab': '監視',
  'monitor.hint':
    'サーバーとブラウザのエラー（同じものはまとめて表示）、対戦のライブチャンネル、稼働中のプロセス。15秒ごとに更新します。サイト停止のアラートは GitHub から届きます（issue「Site fora do ar」）。',
  'monitor.testServer': 'サーバーでエラーを発生させる',
  'monitor.testBrowser': 'ブラウザでエラーを発生させる',
  'monitor.testServerDone': 'サーバーでエラーを発生させました。下の一覧に表示されます。',
  'monitor.testBrowserDone': 'このブラウザでエラーを発生させました。数秒で一覧に表示されます。',
  'monitor.refresh': '更新',
  'monitor.uptime': '稼働時間',
  'monitor.release': 'バージョン {release}',
  'monitor.memory': 'メモリ {rss} MB（ヒープ {heap} MB）',
  'monitor.sseOpen': '開いているライブチャンネル',
  'monitor.sseOpenSplit': '対戦 {online} · Yonko {yonko}',
  'monitor.sse24h': '過去24時間のチャンネル',
  'monitor.sseOpened': '{n|# 件オープン}',
  'monitor.sseDropsReconnects': '切断 {drops} · 再接続 {reconnects}',
  'monitor.errorsOpen': '未解決のエラー',
  'monitor.errors24h': '{n|過去24時間に # 件}',
  'monitor.sseTitle': 'ライブチャンネル（SSE）、1時間ごと',
  'monitor.sseSinceStart':
    'サーバー起動から：オープン {opened}、切断 {drops}（ブラウザかネットワークが閉じた）、サーバーが終了 {ended}、再接続 {reconnects}、平均の長さ {avg}。',
  'monitor.sseEmpty': '過去24時間に開いたチャンネルはありません。',
  'monitor.hour': '時刻',
  'monitor.opened': 'オープン',
  'monitor.drops': '切断',
  'monitor.reconnects': '再接続',
  'monitor.peak': 'ピーク',
  'monitor.errorsTitle': 'エラー',
  'monitor.showResolved': '解決済みも表示',
  'monitor.clearResolved': '解決済みを削除（{n}）',
  'monitor.noErrors': 'エラーはありません。🎉',
  'monitor.sourceServer': 'サーバー',
  'monitor.sourceWeb': 'ブラウザ',
  'monitor.kindTest': 'テスト',
  'monitor.occurrences': '{n|# 回}',
  'monitor.firstSeen': '初回：{when}',
  'monitor.resolve': '解決済みにする',
  'errors.tooManyReports': 'エラー報告が多すぎます。しばらくしてからもう一度お試しください。',
  'errors.badErrorReport': 'エラー報告が正しくありません。',
  'errors.errorNotFound': 'エラーが見つかりません。',
} satisfies Record<keyof typeof monitorPtBR, string>;

export default monitor;
