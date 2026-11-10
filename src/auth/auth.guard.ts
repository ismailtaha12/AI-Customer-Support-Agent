import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { SupabaseService } from '../supabase/supabase.service';
import type { Env } from '../config/env';

export interface AuthedUser {
  id: string;
  email?: string;
  accessToken: string;
}
export type AuthedRequest = Request & { user: AuthedUser };

// Customer endpoints: verifies the Supabase JWT by asking Supabase Auth who it belongs to.
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly supabase: SupabaseService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) throw new UnauthorizedException('Missing bearer token');

    const { data, error } = await this.supabase.admin.auth.getUser(token);
    if (error || !data.user) throw new UnauthorizedException('Invalid token');

    req.user = { id: data.user.id, email: data.user.email, accessToken: token };
    return true;
  }
}

// Operator endpoints (ingest, usage report): static key in the x-admin-key header.
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (req.headers['x-admin-key'] !== this.config.get('ADMIN_API_KEY', { infer: true })) {
      throw new UnauthorizedException('Bad admin key');
    }
    return true;
  }
}
