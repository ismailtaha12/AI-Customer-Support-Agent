import { ChunkerService } from '../../src/ingestion/chunker.service';

const md = `# Refunds

## Eligibility
You get a full refund if you cancel at least 24 hours before the visit.

## Timing
Refunds take 5 to 10 business days. ${'Banks differ in how fast they process refunds. '.repeat(40)}
`;

describe('ChunkerService', () => {
  const chunker = new ChunkerService();

  it('keeps the heading path on every chunk', () => {
    const chunks = chunker.chunk(md);
    expect(chunks[0].headingPath).toBe('Refunds > Eligibility');
    expect(chunks.some((c) => c.headingPath === 'Refunds > Timing')).toBe(true);
  });

  it('never crosses a section boundary', () => {
    const chunks = chunker.chunk(md);
    const eligibility = chunks.find((c) => c.headingPath.endsWith('Eligibility'))!;
    expect(eligibility.content).not.toContain('business days');
  });

  it('splits long sections to respect maxChars (with overlap allowance)', () => {
    const chunks = chunker.chunk(md, { maxChars: 500, overlapChars: 80 });
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(500 + 80 + 2);
  });

  it('numbers chunks sequentially', () => {
    expect(chunker.chunk(md).map((c) => c.index)).toEqual(chunker.chunk(md).map((_, i) => i));
  });
});
