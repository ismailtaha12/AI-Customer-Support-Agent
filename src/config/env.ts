import { z } from 'zod';

// "true"/"false" strings from .env -> real booleans
const bool = (def: 'true' | 'false') => z.enum(['true', 'false']).default(def).transform((v) => v === 'true');

// Every env var the app needs, validated once at startup (fail fast, not at the first request).
export const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  ADMIN_API_KEY: z.string().min(8),

  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  OPENAI_API_KEY: z.string().min(1),
  CHAT_MODEL: z.string().default('gpt-4o'),
  FAST_MODEL: z.string().default('gpt-4o-mini'),
  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),

  CONTEXTUAL_RETRIEVAL: bool('true'),
  LLM_INPUT_GUARD: bool('true'),
  SEMANTIC_CACHE: bool('true'),
  CACHE_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.95),
  CACHE_TTL_HOURS: z.coerce.number().default(24),

  DEMO_MODE: bool('true'), // enables POST /demo/seed (fake appointments for guest users)

  VECTOR_STORE: z.enum(['pgvector', 'chroma']).default('pgvector'),
  CHROMA_URL: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

// Used by ConfigModule.forRoot({ validate })
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Invalid environment:\n  ${issues}`);
  }
  return parsed.data;
}
