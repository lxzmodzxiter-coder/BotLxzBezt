import { describe, expect, it } from "vitest";
import {
  isQuotaLimitReached,
  isValidTelegramUpdateId,
  shouldRetryApiPeru,
  shouldTemporarilyBlock,
  shouldWarnForQuota,
} from "./policies";

describe("authorization and consumption policies", () => {
  it("enforces limits before a new provider request is sent", () => {
    expect(isQuotaLimitReached(30, 30)).toBe(true);
    expect(isQuotaLimitReached(29, 30)).toBe(false);
    expect(shouldWarnForQuota(24, 30, 80)).toBe(true);
    expect(shouldWarnForQuota(23, 30, 80)).toBe(false);
  });

  it("blocks repeated unauthorized attempts and validates update identifiers for deduplication", () => {
    expect(shouldTemporarilyBlock(2, 3)).toBe(false);
    expect(shouldTemporarilyBlock(3, 3)).toBe(true);
    expect(isValidTelegramUpdateId(123456)).toBe(true);
    expect(isValidTelegramUpdateId(-1)).toBe(false);
    expect(isValidTelegramUpdateId("123456")).toBe(false);
  });
});

describe("APIperú retry policy", () => {
  it("retries only the documented transient provider condition", () => {
    expect(shouldRetryApiPeru({ code: "upstream_unavailable", retryable: true })).toBe(true);
    expect(shouldRetryApiPeru({ code: "document_not_found", retryable: false })).toBe(false);
    expect(shouldRetryApiPeru({ code: "invalid_input", retryable: false })).toBe(false);
    expect(shouldRetryApiPeru({ code: "quota_exceeded", retryable: false })).toBe(false);
  });
});
