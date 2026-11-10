import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../config/env';

@Injectable()
export class SupabaseService {
  // Service-role client: bypasses RLS. Only for server jobs (ingestion, usage logging, cache).
  readonly admin: SupabaseClient;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.admin = createClient(
      this.config.get('SUPABASE_URL', { infer: true }),
      this.config.get('SUPABASE_SERVICE_ROLE_KEY', { infer: true }),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }

  // Client that acts as the logged-in customer: anon key + their JWT, so RLS policies apply.
  forUser(accessToken: string): SupabaseClient {
    return createClient(
      this.config.get('SUPABASE_URL', { infer: true }),
      this.config.get('SUPABASE_ANON_KEY', { infer: true }),
      {
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
  }
}
