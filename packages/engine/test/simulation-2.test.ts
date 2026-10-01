import { describeMatchups } from './sim';
import { bigMom, crocodile, kaido, kid, luffy, luffyBlack, sakazuki, yamato } from './helpers';

describeMatchups('simulação bot x bot (ST06–ST09)', [
  [sakazuki, luffy],
  [crocodile, sakazuki],
  [bigMom, kid],
  [sakazuki, bigMom],
  [luffyBlack, yamato],
  [yamato, kaido],
]);
