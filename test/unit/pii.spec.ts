import { PiiRedactor } from '../../src/guardrails/pii.redactor';

describe('PiiRedactor', () => {
  const pii = new PiiRedactor();

  it('redacts emails and phone numbers', () => {
    const r = pii.redact('Mail me at sara.k@example.com or call +20 100 123 4567');
    expect(r.text).toBe('Mail me at [REDACTED_EMAIL] or call [REDACTED_PHONE]');
    expect(r.found.sort()).toEqual(['email', 'phone']);
  });

  it('redacts a valid card number but not a random digit string', () => {
    expect(pii.redact('card 4111 1111 1111 1111').text).toContain('[REDACTED_CARD]');
    expect(pii.redact('order 1234 5678 9012 3456').text).not.toContain('[REDACTED_CARD]'); // fails Luhn
  });

  it('redacts a 14-digit national id', () => {
    expect(pii.redact('my id is 29801011234567').text).toContain('[REDACTED_ID]');
  });

  it('leaves normal text untouched', () => {
    const r = pii.redact('What is the late cancellation fee for 24 hours?');
    expect(r.text).toBe('What is the late cancellation fee for 24 hours?');
    expect(r.found).toEqual([]);
  });
});
