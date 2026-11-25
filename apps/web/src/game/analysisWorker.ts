// Web Worker da análise da partida: refaz o replay e analisa cada decisão (analysis.ts) fora da página,
// mandando o progresso a cada decisão. Para cancelar, a página encerra o worker.

import { type AnalysisMessage, type AnalysisRequest, runAnalysis } from './analysis';

// O tsconfig do web usa a lib DOM: aqui `self` é o escopo do worker.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<AnalysisRequest>) => void) | null;
  postMessage(m: AnalysisMessage): void;
};

scope.onmessage = (e) => runAnalysis(e.data, (m) => scope.postMessage(m));
