import { estimateCostUsd } from '../../src/observability/cost.calculator';

describe('estimateCostUsd', () => {
  it('prices input and output tokens separately', () => {
    expect(estimateCostUsd('gpt-4o-mini', 1_000_000, 0)).toBeCloseTo(0.15);
    expect(estimateCostUsd('gpt-4o-mini', 0, 1_000_000)).toBeCloseTo(0.6);
  });
  it('resolves dated model variants by prefix', () => {
    expect(estimateCostUsd('gpt-4o-2024-08-06', 1_000_000, 0)).toBeCloseTo(2.5);
  });
  it('returns 0 for unknown models instead of throwing', () => {
    expect(estimateCostUsd('some-future-model', 1000, 1000)).toBe(0);
  });
});
