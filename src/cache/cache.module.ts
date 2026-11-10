import { Module } from '@nestjs/common';
import { SemanticCacheService } from './semantic-cache.service';

@Module({ providers: [SemanticCacheService], exports: [SemanticCacheService] })
export class CacheModule {}
