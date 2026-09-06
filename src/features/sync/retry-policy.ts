type GoogleError = { code?: unknown; status?: number; response?: { status?: number; data?: { error?: string | { status?: string } } } };
export function classifySyncError(error: unknown): { code: string; retryable: boolean } {
  const value = (error ?? {}) as GoogleError;
  const status = Number(value.response?.status ?? value.status ?? value.code);
  if (value.response?.data?.error === "invalid_grant" || status === 401) return { code: "authorization_revoked", retryable: false };
  if (status === 404 || status === 400) return { code: "invalid_spreadsheet", retryable: false };
  if (status === 429 || status >= 500 && status <= 599) return { code: `google_${status}`, retryable: true };
  if (status === 403) return { code: "access_denied", retryable: false };
  return { code: typeof value.code === "string" && ["sync_busy", "lease_lost", "connection_not_found"].includes(value.code) ? value.code : "sync_failed", retryable: false };
}
export async function withRetry<T>(operation: () => Promise<T>, options: { sleep?: (ms: number) => Promise<void>; random?: () => number } = {}): Promise<T> {
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (!classifySyncError(error).retryable || attempt >= 5) throw error;
      await sleep(1000 * 2 ** attempt * (0.5 + (options.random ?? Math.random)()));
    }
  }
}
