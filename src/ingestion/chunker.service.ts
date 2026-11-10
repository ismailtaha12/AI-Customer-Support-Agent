import { Injectable } from '@nestjs/common';

export interface Chunk {
  index: number;
  headingPath: string; // e.g. "Refunds > Duplicate charges"
  content: string;
}

export interface ChunkOptions {
  maxChars: number; // ~4 chars per token, so 1200 chars is roughly 300 tokens
  overlapChars: number;
}

const DEFAULTS: ChunkOptions = { maxChars: 1200, overlapChars: 150 };

// Heading-aware chunking: a chunk never crosses a section boundary, so each chunk is about
// ONE topic and carries its heading path. Long sections are split on paragraphs with overlap.
@Injectable()
export class ChunkerService {
  chunk(markdown: string, options: Partial<ChunkOptions> = {}): Chunk[] {
    const { maxChars, overlapChars } = { ...DEFAULTS, ...options };
    const chunks: Chunk[] = [];

    for (const section of this.splitSections(markdown)) {
      const paragraphs = section.text
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean)
        .flatMap((p) => this.splitLong(p, maxChars)); // paragraphs longer than the limit

      let current = '';
      for (const p of paragraphs) {
        if (current && current.length + p.length + 2 > maxChars) {
          chunks.push({ index: chunks.length, headingPath: section.path, content: current });
          current = this.tail(current, overlapChars); // carry a little context into the next chunk
        }
        current = current ? `${current}\n\n${p}` : p;
      }
      if (current.trim()) chunks.push({ index: chunks.length, headingPath: section.path, content: current });
    }
    return chunks;
  }

  // Walk the lines, tracking the heading stack (# / ## / ###), and group body text per section.
  private splitSections(markdown: string): { path: string; text: string }[] {
    const sections: { path: string; text: string }[] = [];
    const stack: string[] = [];
    let buffer: string[] = [];
    let path = '';

    const flush = () => {
      const text = buffer.join('\n').trim();
      if (text) sections.push({ path, text });
      buffer = [];
    };

    for (const line of markdown.split(/\r?\n/)) {
      const heading = line.match(/^(#{1,3})\s+(.*)$/);
      if (heading) {
        flush();
        const level = heading[1].length;
        stack.length = level - 1; // pop deeper levels
        stack[level - 1] = heading[2].trim();
        path = stack.filter(Boolean).join(' > ');
      } else {
        buffer.push(line);
      }
    }
    flush();
    return sections;
  }

  // Break an oversized paragraph on sentence ends, hard-cutting only as a last resort.
  private splitLong(text: string, max: number): string[] {
    if (text.length <= max) return [text];
    const parts: string[] = [];
    let current = '';
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      if ((current + ' ' + sentence).trim().length > max && current) {
        parts.push(current.trim());
        current = '';
      }
      current += (current ? ' ' : '') + sentence;
    }
    if (current.trim()) parts.push(current.trim());
    return parts.flatMap((p) => (p.length > max ? p.match(new RegExp(`.{1,${max}}`, 'gs')) ?? [p] : [p]));
  }

  // Last `n` chars, starting at a word boundary
  private tail(text: string, n: number): string {
    if (n <= 0 || text.length <= n) return n <= 0 ? '' : text;
    const slice = text.slice(-n);
    const firstSpace = slice.indexOf(' ');
    return firstSpace > 0 ? slice.slice(firstSpace + 1) : slice;
  }
}
