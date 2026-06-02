export class NetworkRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkRequestError";
  }
}

export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}
