export function isQuotaLimitReached(currentCount: number, dailyLimit: number) {
  return currentCount >= dailyLimit;
}

export function shouldWarnForQuota(
  currentCount: number,
  dailyLimit: number,
  warningPercent: number,
) {
  return currentCount === Math.ceil(dailyLimit * (warningPercent / 100));
}

export function shouldTemporarilyBlock(
  unauthorizedAttempts: number,
  threshold: number,
) {
  return unauthorizedAttempts >= threshold;
}

export function isValidTelegramUpdateId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function shouldRetryApiPeru(result: { retryable: boolean; code: string }) {
  return result.retryable && result.code === "upstream_unavailable";
}
