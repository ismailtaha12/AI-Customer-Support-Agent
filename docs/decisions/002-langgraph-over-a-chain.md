# ADR 002: LangGraph state machine instead of a linear chain

**Context.** The support flow has branches (FAQ vs account lookup vs complaint), a loop (retry retrieval once) and
early exits (blocked input, cache hit).

**Decision.** Model it as a LangGraph `StateGraph`. Each node does one job and returns a partial state update; routing
functions are pure and unit-tested.

**Consequences.**
- The retry loop is bounded (`MAX_RETRIEVAL_RETRIES`) and the tool loop is capped (`MAX_TOOL_STEPS`): no runaway agents.
- The agent can say "I don't know" structurally: weak context after one retry goes to a human, never to generation.
- Every node shows up as a span in LangSmith.
- Cost: more moving parts than a prompt chain. Worth it because behaviour is testable path-by-path.
