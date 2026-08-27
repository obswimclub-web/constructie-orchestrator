import { describe, it, expect } from 'vitest';
import { OutputRedactor } from '@co/tools';

describe('OutputRedactor Behavioral', () => {
  it('redacts known secrets from output', () => {
    const redactor = new OutputRedactor();
    redactor.addSecret('SECRET_123');
    redactor.addSecret('PASSWORD_456');
    const output = 'Here is my SECRET_123 and my PASSWORD_456 in logs.';
    const redacted = redactor.redact(output);
    expect(redacted).not.toContain('SECRET_123');
    expect(redacted).not.toContain('PASSWORD_456');
    expect(redacted).toContain('[REDACTED]');
  });
});
