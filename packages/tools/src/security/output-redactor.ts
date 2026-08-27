export class OutputRedactor {
  private secrets = new Set<string>();

  constructor(initialSecrets?: string[]) {
    if (initialSecrets) {
      initialSecrets.forEach(s => this.addSecret(s));
    }
  }

  public addSecret(secret: string): void {
    if (secret && secret.length > 3) {
      this.secrets.add(secret);
    }
  }

  public redact(text: string): string {
    if (!text || this.secrets.size === 0) return text;
    let redacted = text;
    for (const secret of this.secrets) {
      // Escape for regex
      const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      redacted = redacted.replace(new RegExp(escaped, 'g'), '[REDACTED]');
    }
    return redacted;
  }
}
