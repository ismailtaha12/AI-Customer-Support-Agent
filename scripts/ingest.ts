import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import * as path from 'node:path';
import { AppModule } from '../src/app.module';
import { IngestionService } from '../src/ingestion/ingestion.service';

// npm run ingest [-- --force]   ->  chunk, contextualise, embed and store everything in data/kb
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'warn', 'error'] });
  const force = process.argv.includes('--force');
  const results = await app.get(IngestionService).ingestDirectory(path.resolve(__dirname, '../data/kb'), { force });
  console.table(results);
  await app.close();
}
void main();
