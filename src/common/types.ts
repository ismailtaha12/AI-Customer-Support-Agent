// Shared types used across modules.

export type ChatTurn = { role: 'user' | 'assistant'; content: string };

export interface Citation {
  n: number; // the [n] marker used in the answer
  chunkId: string;
  documentId: string;
  title: string;
}

export interface ToolCallLog {
  name: string;
  args: unknown;
}
