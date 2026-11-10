import { BadRequestException, Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { RateLimitGuard } from '../common/rate-limit.guard';
import { ChatService } from './chat.service';

const ChatDto = z.object({
  // The agent's own input guard enforces the 2000-char limit and replies politely;
  // this outer cap just protects the server from absurd payloads.
  message: z.string().min(1).max(10_000),
  conversationId: z.string().uuid().optional(),
});

@Controller('chat')
@UseGuards(AuthGuard, RateLimitGuard) // order matters: auth first, then per-user rate limit
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  private parse(body: unknown) {
    const dto = ChatDto.safeParse(body);
    if (!dto.success) throw new BadRequestException(dto.error.flatten());
    return dto.data;
  }

  // POST /chat  { "message": "...", "conversationId"?: "..." }  ->  full JSON result
  @Post()
  send(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.chat.execute(req.user, this.parse(body));
  }

  // POST /chat/stream -> Server-Sent Events: a "step" event per graph node, then one "final" event.
  @Post('stream')
  async stream(@Req() req: AuthedRequest, @Body() body: unknown, @Res() res: Response) {
    const dto = this.parse(body);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    try {
      const result = await this.chat.execute(req.user, dto, (node, detail) => send('step', { node, ...detail }));
      send('final', result);
    } catch (err) {
      send('error', { message: (err as Error).message });
    } finally {
      res.end();
    }
  }
}
