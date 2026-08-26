import { describe, expect, it } from "vitest";

describe("APIperú token integration", () => {
  it("authenticates against the DNI endpoint without consulting a real document", async () => {
    const token = process.env.API_PERU_TOKEN;
    expect(token).toBeTruthy();

    const response = await fetch("https://api.apiperu.dev/dni", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ dni: "00000000" }),
    });
    const payload = (await response.json()) as { code?: string };

    expect(response.status).not.toBe(401);
    expect(response.status).not.toBe(403);
    expect(response.status).toBeLessThan(500);
    expect(payload.code).toBeTypeOf("string");
  }, 20_000);
});
