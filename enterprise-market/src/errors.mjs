export class MarketError extends Error {
  constructor(code, message, status = 400, details) {
    super(message);
    this.name = 'MarketError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
export function assert(condition, code, message, status = 400, details) {
  if (!condition) throw new MarketError(code, message, status, details);
}
