import { summarizeStep } from '../../src/agent/graph/step-summary';

describe('summarizeStep', () => {
  it('describes routing decisions', () => {
    expect(summarizeStep('classify', { intent: 'faq', category: 'billing' }).text).toBe('intent = faq · category = billing');
  });

  it('returns trimmed sources for retrieval, never full content', () => {
    const long = 'word '.repeat(200);
    const d = summarizeStep('retrieve', { answerSource: 'rag', contexts: [{ title: 'Doc', score: 0.03278688, content: long }] });
    expect(d.sources).toHaveLength(1);
    expect(d.sources![0].snippet.length).toBeLessThanOrEqual(150);
    expect(d.sources![0].score).toBe(0.0328);
  });

  it('flags cache hits and retries', () => {
    expect(summarizeStep('retrieve', { answerSource: 'cache' }).text).toContain('cache hit');
    expect(summarizeStep('grade', { sufficient: false, attempts: 1 }).text).toContain('retrying');
    expect(summarizeStep('grade', { sufficient: false, attempts: 2 }).text).toContain('human');
  });

  it('is safe on unknown nodes and empty updates', () => {
    expect(summarizeStep('mystery').text).toBe('');
    expect(summarizeStep('inputGuard', {}).text).toContain('passed');
  });
});
