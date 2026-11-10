// USD per 1M tokens. These are illustrative list prices: check your provider's pricing
// page and update when models change. Unknown models cost 0 (and show up as 0 in reports).
const PRICES_PER_1M: Record<string, { in: number; out: number }> = {
  'gpt-4o': { in: 2.5, out: 10 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'text-embedding-3-small': { in: 0.02, out: 0 },
  'text-embedding-3-large': { in: 0.13, out: 0 },
};

export function estimateCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  // exact match first, then longest-prefix match so dated variants ("gpt-4o-2024-08-06") resolve
  const key =
    PRICES_PER_1M[model] !== undefined
      ? model
      : Object.keys(PRICES_PER_1M)
          .filter((k) => model.startsWith(k))
          .sort((a, b) => b.length - a.length)[0];
  const price = key ? PRICES_PER_1M[key] : undefined;
  if (!price) return 0;
  return (promptTokens * price.in + completionTokens * price.out) / 1_000_000;
}
