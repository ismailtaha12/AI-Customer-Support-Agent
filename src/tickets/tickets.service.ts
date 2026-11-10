import { Injectable, Logger } from '@nestjs/common';
import { getCtx } from '../common/request-context';

export interface NewTicket {
  subject: string;
  description: string;
  priority: 'low' | 'normal' | 'high';
}

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  // Inserts with the CUSTOMER's Supabase client, so RLS guarantees the ticket belongs to them.
  async create(ticket: NewTicket): Promise<{ id: string | null }> {
    const { userClient, userId, conversationId } = getCtx();
    if (!userClient || !userId) {
      // No logged-in user (e.g. the eval harness): dry run, nothing is written.
      this.logger.warn('create ticket: no user context, dry run');
      return { id: null };
    }
    const { data, error } = await userClient
      .from('tickets')
      .insert({ user_id: userId, conversation_id: conversationId ?? null, ...ticket })
      .select('id')
      .single();
    if (error) throw new Error(`ticket insert failed: ${error.message}`);
    return { id: data.id };
  }
}
