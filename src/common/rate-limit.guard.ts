import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { AuthedRequest } from '../auth/auth.guard';

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 10; // per user per minute: bounds both abuse and spend

// Sliding-window limiter, in memory. Fine for one instance; use Redis if you scale out.
// Must run AFTER AuthGuard (it keys on the user id).
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, number[]>();

  canActivate(ctx: ExecutionContext): boolean {
    const userId = ctx.switchToHttp().getRequest<AuthedRequest>().user.id;
    const now = Date.now();
    const recent = (this.hits.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);

    if (recent.length >= MAX_REQUESTS) {
      throw new HttpException('Too many messages, slow down a little.', HttpStatus.TOO_MANY_REQUESTS);
    }
    recent.push(now);
    this.hits.set(userId, recent);
    return true;
  }
}
