import { BadRequestException, Body, Controller, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AdminGuard } from '../auth/auth.guard';
import { IngestionService } from './ingestion.service';

const IngestDto = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  markdown: z.string().min(1).max(200_000),
  force: z.boolean().optional(),
});

@Controller('ingest')
@UseGuards(AdminGuard)
export class IngestionController {
  constructor(private readonly ingestion: IngestionService) {}

  // POST /ingest  { "slug": "refund-policy", "markdown": "---\ntitle: ...\n---\n# ..." }
  @Post()
  ingest(@Body() body: unknown) {
    const dto = IngestDto.safeParse(body);
    if (!dto.success) throw new BadRequestException(dto.error.flatten());
    return this.ingestion.ingestDocument(dto.data.slug, dto.data.markdown, { force: dto.data.force });
  }
}
