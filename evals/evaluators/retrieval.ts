// Retrieval metrics. A "hit" means the expected document appears among the top results.

export interface RetrievalScore {
  hit1: boolean;
  hit3: boolean;
  rr: number; // reciprocal rank: 1 for rank 1, 0.5 for rank 2, ... 0 if missing
}

export function scoreRetrieval(hits: { title: string }[], expectedTitle: string): RetrievalScore {
  const rank = hits.findIndex((h) => h.title === expectedTitle) + 1; // 0 = not found
  return { hit1: rank === 1, hit3: rank >= 1 && rank <= 3, rr: rank ? 1 / rank : 0 };
}

export function summarize(scores: RetrievalScore[]) {
  const n = scores.length || 1;
  const mean = (f: (s: RetrievalScore) => number) => scores.reduce((a, s) => a + f(s), 0) / n;
  return {
    n: scores.length,
    'hit@1': mean((s) => Number(s.hit1)),
    'hit@3': mean((s) => Number(s.hit3)),
    MRR: mean((s) => s.rr),
  };
}
