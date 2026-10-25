const { session } = require('./lib/rec.cjs');
const fs = require('fs');
(async () => {
  const name = process.argv[2];
  const v = require(`./videos/${name}.cjs`);
  let durations = {};
  try { durations = JSON.parse(fs.readFileSync(`${__dirname}/narr/${name}.json`, 'utf8')).durations; } catch {}
  const S = await session({ id: v.id, title: v.title, settings: v.settings, localStorage: v.localStorage, startPath: v.startPath, durations, beforeLoad: v.beforeLoad, prepare: v.prepare });
  try { await v.run(S); } catch (e) { console.error('ERRO', e); await S.page.screenshot({ path: `${__dirname}/out/${name}-error.png` }); }
  await S.finish();
})();
