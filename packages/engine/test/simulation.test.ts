import { describeMatchups } from './sim';
import { crocodile, kaido, kid, luffy, shanks } from './helpers';

describeMatchups('simulação bot x bot (ST01–ST05)', [
  [luffy, kid],
  [crocodile, luffy],
  [kid, crocodile],
  [kaido, luffy],
  [crocodile, kaido],
  [shanks, kid],
  [kaido, shanks],
]);
