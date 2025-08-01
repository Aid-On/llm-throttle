export class RateLimitError extends Error {
  constructor(
    message: string,
    public readonly reason: 'rpm_limit' | 'tpm_limit',
    public readonly availableIn: number
  ) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class InvalidConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidConfigError';
  }
}