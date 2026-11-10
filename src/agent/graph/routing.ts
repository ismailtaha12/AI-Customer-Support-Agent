import type { SupportStateType } from './state';

// Routing decisions are PURE functions of the state, so they are trivial to unit-test
// without any LLM. (See test/unit/routing.spec.ts)

// How many times we re-try retrieval (with a rephrased, unfiltered query) before giving up.
export const MAX_RETRIEVAL_RETRIES = 1;

export function routeAfterGuard(s: Pick<SupportStateType, 'blocked'>): 'refuse' | 'classify' {
  return s.blocked ? 'refuse' : 'classify';
}

export function routeAfterClassify(s: Pick<SupportStateType, 'intent'>): 'rewrite' | 'toolAgent' | 'escalate' | 'offTopic' {
  switch (s.intent) {
    case 'account':
      return 'toolAgent';
    case 'complaint':
      return 'escalate';
    case 'off_topic':
      return 'offTopic';
    default:
      return 'rewrite'; // 'faq' (and any unexpected value) goes through RAG
  }
}

export function routeAfterRetrieve(s: Pick<SupportStateType, 'answerSource'>): 'outputGuard' | 'grade' {
  return s.answerSource === 'cache' ? 'outputGuard' : 'grade';
}

export function routeAfterGrade(
  s: Pick<SupportStateType, 'sufficient' | 'attempts'>,
): 'generate' | 'rewrite' | 'escalate' {
  if (s.sufficient) return 'generate';
  // grade increments `attempts` on failure: first failure -> retry once, second -> hand to a human
  return s.attempts <= MAX_RETRIEVAL_RETRIES ? 'rewrite' : 'escalate';
}
