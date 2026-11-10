import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './config/env';

@Controller()
export class AppController {
  constructor(private readonly config: ConfigService<Env, true>) {}

  @Get('health')
  health() {
    return { ok: true };
  }

  // Lets the demo page (public/index.html) log in to Supabase.
  // The anon key is PUBLIC by design (RLS protects the data); the service-role key is never exposed.
  @Get('demo-config')
  demoConfig() {
    return {
      supabaseUrl: this.config.get('SUPABASE_URL', { infer: true }),
      anonKey: this.config.get('SUPABASE_ANON_KEY', { infer: true }),
    };
  }
}
