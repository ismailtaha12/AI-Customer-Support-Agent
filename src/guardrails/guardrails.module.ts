import { Module } from '@nestjs/common';
import { InputGuard } from './input.guard';
import { OutputGuard } from './output.guard';
import { PiiRedactor } from './pii.redactor';

@Module({ providers: [PiiRedactor, InputGuard, OutputGuard], exports: [PiiRedactor, InputGuard, OutputGuard] })
export class GuardrailsModule {}
