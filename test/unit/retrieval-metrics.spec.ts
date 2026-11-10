import { scoreRetrieval, summarize } from '../../evals/evaluators/retrieval';

describe('retrieval metrics', () => {
  const hits = [{ title: 'A' }, { title: 'B' }, { title: 'C' }];

  it('scores by rank of the expected document', () => {
    expect(scoreRetrieval(hits, 'A')).toEqual({ hit1: true, hit3: true, rr: 1 });
    expect(scoreRetrieval(hits, 'C')).toEqual({ hit1: false, hit3: true, rr: 1 / 3 });
    expect(scoreRetrieval(hits, 'Z')).toEqual({ hit1: false, hit3: false, rr: 0 });
  });

  it('averages across questions', () => {
    const s = summarize([scoreRetrieval(hits, 'A'), scoreRetrieval(hits, 'Z')]);
    expect(s['hit@1']).toBe(0.5);
    expect(s.MRR).toBe(0.5);
  });
});
