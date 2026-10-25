const out = {};
for (const n of ['apelido','animacoes','chat','sons','notificacoes','counter','trailer']) {
  const v = require(`./videos/${n}.cjs`);
  out[n] = { ids: v.SEGS.map(s => s.id), text: v.SEGS.map(s => s.say).join(' <break time="1.6s" /> ') };
}
require('fs').writeFileSync('prompts.json', JSON.stringify(out, null, 1));
for (const [k, v] of Object.entries(out)) console.log(k, v.text.length, '\n', v.text, '\n');
