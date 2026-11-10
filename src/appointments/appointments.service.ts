import { Injectable } from '@nestjs/common';
import { getCtx } from '../common/request-context';
import { SupabaseService } from '../supabase/supabase.service';

export type When = 'upcoming' | 'past' | 'all';

@Injectable()
export class AppointmentsService {
  constructor(private readonly supabase: SupabaseService) {}

  // DEMO ONLY: give a fresh guest user a few appointments so the tool-calling demo has data.
  // Uses the service-role client because customers have no INSERT policy on this table.
  async seedDemo(userId: string): Promise<{ seeded: boolean }> {
    const { count } = await this.supabase.admin.from('appointments').select('id', { count: 'exact', head: true }).eq('user_id', userId);
    if (count) return { seeded: false };
    const day = 86_400_000;
    const at = (days: number) => new Date(Date.now() + days * day).toISOString();
    const { error } = await this.supabase.admin.from('appointments').insert([
      { user_id: userId, doctor: 'Dr. Salma Nabil', starts_at: at(2), status: 'confirmed' },
      { user_id: userId, doctor: 'Dr. Omar Fathy', starts_at: at(9), status: 'confirmed' },
      { user_id: userId, doctor: 'Dr. Salma Nabil', starts_at: at(-20), status: 'completed' },
    ]);
    if (error) throw new Error(`seed failed: ${error.message}`);
    return { seeded: true };
  }

  // Reads with the customer's own client: RLS means they can only ever see their own rows,
  // even if a prompt-injected model tried to ask for someone else's.
  async list(when: When) {
    const { userClient, userId } = getCtx();
    if (!userClient || !userId) return [];

    let query = userClient
      .from('appointments')
      .select('id, doctor, starts_at, status')
      .eq('user_id', userId) // belt and braces: RLS already enforces this
      .order('starts_at', { ascending: true })
      .limit(10);

    const now = new Date().toISOString();
    if (when === 'upcoming') query = query.gte('starts_at', now);
    if (when === 'past') query = query.lt('starts_at', now);

    const { data, error } = await query;
    if (error) throw new Error(`appointments query failed: ${error.message}`);
    return data ?? [];
  }
}
