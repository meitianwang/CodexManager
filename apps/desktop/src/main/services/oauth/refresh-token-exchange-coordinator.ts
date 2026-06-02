import type { ChatGPTOAuthTokens } from "../../../shared/models/auth";

interface CachedExchange {
  tokens: ChatGPTOAuthTokens;
  expiresAt: number;
}

export class ChatGPTRefreshTokenExchangeCoordinator {
  private readonly inFlight = new Map<string, Promise<ChatGPTOAuthTokens>>();
  private readonly cachedExchanges = new Map<string, CachedExchange>();
  private readonly cacheOrder: string[] = [];

  constructor(
    private readonly cacheTTLMilliseconds = 60_000,
    private readonly maxCachedExchanges = 32,
    private readonly now: () => number = () => Date.now()
  ) {}

  async refresh(
    refreshToken: string,
    operation: () => Promise<ChatGPTOAuthTokens>
  ): Promise<ChatGPTOAuthTokens> {
    const now = this.now();
    this.pruneExpiredExchanges(now);

    const cached = this.cachedExchanges.get(refreshToken);
    if (cached && cached.expiresAt > now) {
      return cached.tokens;
    }

    const existing = this.inFlight.get(refreshToken);
    if (existing) {
      return existing;
    }

    const task = operation();
    this.inFlight.set(refreshToken, task);
    try {
      const tokens = await task;
      this.inFlight.delete(refreshToken);
      this.remember(tokens, refreshToken, this.now());
      return tokens;
    } catch (error) {
      this.inFlight.delete(refreshToken);
      throw error;
    }
  }

  private remember(tokens: ChatGPTOAuthTokens, refreshToken: string, now: number): void {
    if (!this.cachedExchanges.has(refreshToken)) {
      this.cacheOrder.push(refreshToken);
    }
    this.cachedExchanges.set(refreshToken, {
      tokens,
      expiresAt: now + this.cacheTTLMilliseconds
    });
    this.trimCache();
  }

  private pruneExpiredExchanges(now: number): void {
    for (const token of this.cacheOrder) {
      const cached = this.cachedExchanges.get(token);
      if (cached && cached.expiresAt <= now) {
        this.cachedExchanges.delete(token);
      }
    }

    for (let index = this.cacheOrder.length - 1; index >= 0; index -= 1) {
      const token = this.cacheOrder[index];
      if (token && !this.cachedExchanges.has(token)) {
        this.cacheOrder.splice(index, 1);
      }
    }
  }

  private trimCache(): void {
    const maxEntries = Math.max(1, this.maxCachedExchanges);
    while (this.cacheOrder.length > maxEntries) {
      const token = this.cacheOrder.shift();
      if (token) {
        this.cachedExchanges.delete(token);
      }
    }
  }
}
