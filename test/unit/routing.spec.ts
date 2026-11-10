import { INTENT_TOOL_ALLOWLIST } from '../../src/agent/tools/tool-registry';
import { routeAfterClassify, routeAfterGrade, routeAfterGuard, routeAfterRetrieve } from '../../src/agent/graph/routing';

describe('graph routing', () => {
  it('blocked input goes to refuse', () => {
    expect(routeAfterGuard({ blocked: 'prompt_injection' })).toBe('refuse');
    expect(routeAfterGuard({ blocked: null })).toBe('classify');
  });

  it('each intent takes its own branch', () => {
    expect(routeAfterClassify({ intent: 'faq' })).toBe('rewrite');
    expect(routeAfterClassify({ intent: 'account' })).toBe('toolAgent');
    expect(routeAfterClassify({ intent: 'complaint' })).toBe('escalate');
    expect(routeAfterClassify({ intent: 'off_topic' })).toBe('offTopic');
  });

  it('cache hits skip grading', () => {
    expect(routeAfterRetrieve({ answerSource: 'cache' })).toBe('outputGuard');
    expect(routeAfterRetrieve({ answerSource: 'rag' })).toBe('grade');
  });

  it('retries retrieval once, then escalates', () => {
    expect(routeAfterGrade({ sufficient: true, attempts: 0 })).toBe('generate');
    expect(routeAfterGrade({ sufficient: false, attempts: 1 })).toBe('rewrite');
    expect(routeAfterGrade({ sufficient: false, attempts: 2 })).toBe('escalate');
  });
});

describe('tool allowlist', () => {
  it('only account questions may use tools', () => {
    expect(INTENT_TOOL_ALLOWLIST.account.length).toBeGreaterThan(0);
    expect(INTENT_TOOL_ALLOWLIST.complaint).toEqual([]);
    expect(INTENT_TOOL_ALLOWLIST.faq).toEqual([]);
    expect(INTENT_TOOL_ALLOWLIST.off_topic).toEqual([]);
  });
});
