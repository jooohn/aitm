export class DomainError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id?: string) {
    super(id ? `${entity} not found: ${id}` : `${entity} not found`, 404);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super(message, 409);
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super(message, 422);
  }
}

export class ServiceUnavailableError extends DomainError {
  constructor(message: string) {
    super(message, 503);
  }
}

export function isDomainError(err: unknown): err is DomainError {
  return err instanceof DomainError;
}
