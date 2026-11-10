// Turns a node's state update into a short, human-readable description for the live UI.
// Deliberately small: only titles, scores and short snippets leave the server, never full state.

export interface StepSource {
  title: string;
  score: number;
  snippet: string;
}

export interface StepDetail {
  text: string;
  sources?: StepSource[];
}

export function summarizeStep(node: string, u: Record<string, any> = {}): StepDetail {
  switch (node) {
    case 'inputGuard':
      if (u.blocked) return { text: `blocked: ${u.blocked}` };
      return { text: u.flags?.includes('pii_redacted_input') ? 'PII redacted before reaching the model, then passed' : 'passed all checks' };
    case 'classify':
      return { text: `intent = ${u.intent}${u.category ? ` · category = ${u.category}` : ''}` };
    case 'rewrite':
      return { text: `search query: "${u.standaloneQuery}"` };
    case 'retrieve':
      if (u.answerSource === 'cache') return { text: 'semantic cache hit: no retrieval or generation needed' };
      return {
        text: `${u.contexts?.length ?? 0} passages (hybrid: vector + keyword, fused with RRF)`,
        sources: (u.contexts ?? []).map((c: any) => ({
          title: c.title,
          score: Number(c.score.toFixed(4)),
          snippet: String(c.content).replace(/\s+/g, ' ').slice(0, 150),
        })),
      };
    case 'grade':
      return { text: u.sufficient ? 'context is sufficient to answer' : `context too weak, attempt ${u.attempts}: ${u.attempts <= 1 ? 'rewriting the query and retrying' : 'handing over to a human'}` };
    case 'generate':
      return { text: `answer drafted from ${u.contexts?.length ?? 0} passages` };
    case 'toolAgent':
      return { text: u.toolCalls?.length ? `tools called: ${u.toolCalls.map((t: any) => t.name).join(', ')}` : 'answered without tools' };
    case 'escalate':
      return { text: u.ticketId ? `ticket ${String(u.ticketId).slice(0, 8)} created for a human agent` : 'ticket drafted (dry run)' };
    case 'outputGuard':
      return { text: u.grounded === false ? `answer replaced: ${u.flags?.filter((f: string) => f !== 'pii_redacted_input').join(', ')}` : 'grounded and cited: passed' };
    case 'refuse':
      return { text: 'request refused before any answer was generated' };
    case 'offTopic':
      return { text: 'outside support scope: redirected' };
    default:
      return { text: '' };
  }
}
