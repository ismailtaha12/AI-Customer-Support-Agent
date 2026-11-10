import { LlmService } from '../../src/llm/llm.service';
import { PROMPTS } from '../../src/llm/prompts';
import { JudgeSchema } from '../../src/llm/schemas';

// LLM-as-judge. Uses the "smart" tier: the grader should be at least as strong as the system it grades.
export async function judgeAnswer(
  llm: LlmService,
  input: { question: string; reference: string; context: string; answer: string },
) {
  return llm.structured({
    tier: 'smart',
    purpose: 'eval_judge',
    schemaName: 'judge',
    schema: JudgeSchema,
    system: PROMPTS.judge,
    user:
      `Question: ${input.question}\n\nReference answer: ${input.reference}\n\n` +
      `Retrieved context:\n${input.context || '(none)'}\n\nCandidate answer: ${input.answer}`,
  });
}
