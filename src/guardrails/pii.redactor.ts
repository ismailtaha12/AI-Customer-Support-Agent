import { Injectable } from '@nestjs/common';

export interface RedactionResult {
  text: string;
  found: string[]; // which kinds of PII were removed, e.g. ['email', 'phone']
}

// Luhn checksum: separates real card numbers from random digit strings (fewer false positives)
function luhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alt && (n *= 2) > 9) n -= 9;
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

// Regex-based PII scrubbing. Runs on user input BEFORE it reaches the LLM or the database,
// and on model output before it reaches the user. Order matters: most specific patterns first.
@Injectable()
export class PiiRedactor {
  redact(input: string): RedactionResult {
    const found = new Set<string>();
    let text = input;

    // payment cards: 13-19 digits, optional spaces/dashes, must pass Luhn
    text = text.replace(/\b(?:\d[ -]?){13,19}\b/g, (m) => {
      const digits = m.replace(/\D/g, '');
      if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) {
        found.add('card');
        return '[REDACTED_CARD]';
      }
      return m;
    });

    // Egyptian national ID: exactly 14 digits
    text = text.replace(/\b[23]\d{13}\b/g, () => (found.add('national_id'), '[REDACTED_ID]'));
    // US SSN
    text = text.replace(/\b\d{3}-\d{2}-\d{4}\b/g, () => (found.add('ssn'), '[REDACTED_SSN]'));
    // email
    text = text.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, () => (found.add('email'), '[REDACTED_EMAIL]'));
    // phone: international or local formats with at least 9 digits
    text = text.replace(/(?<![\w-])\+?\d[\d\s().-]{7,}\d(?![\w-])/g, (m) => {
      if (m.replace(/\D/g, '').length < 9) return m;
      found.add('phone');
      return '[REDACTED_PHONE]';
    });

    return { text, found: [...found] };
  }
}
