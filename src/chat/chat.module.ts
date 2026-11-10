import { Module } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AgentModule } from '../agent/agent.module';
import { RateLimitGuard } from '../common/rate-limit.guard';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({
  imports: [AgentModule],
  controllers: [ChatController],
  providers: [ChatService, AuthGuard, RateLimitGuard],
})
export class ChatModule {}
