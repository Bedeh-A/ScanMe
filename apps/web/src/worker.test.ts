// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import worker, { matchesAdminEmail, type WorkerEnv } from "./worker";

function webpFile(): File {
  const bytes = new Uint8Array(26);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
  bytes.set(new TextEncoder().encode("WEBPVP8L"), 8);
  new DataView(bytes.buffer).setUint32(16, 5, true);
  bytes[20] = 0x2f;
  new DataView(bytes.buffer).setUint32(21, 1 | (1 << 14), true);
  return new File([bytes], "report.webp", {
    type: "image/webp",
  });
}

function reportRequest(
  extraMetadata: Record<string, unknown> = {},
): Request<unknown, IncomingRequestCfProperties<unknown>> {
  const form = new FormData();
  form.set("image", webpFile());
  form.set(
    "metadata",
    JSON.stringify({
      detectedCount: 0,
      detectedFormats: [],
      source: "paste",
      appVersion: "test",
      ...extraMetadata,
    }),
  );
  form.set("turnstileToken", "test-token");
  return new Request("https://scan.bedeh.ro/api/reports", {
    method: "POST",
    headers: {
      "CF-Connecting-IP": "192.0.2.1",
      Origin: "https://scan.bedeh.ro",
      "Content-Length": "1024",
    },
    body: form,
  }) as Request<unknown, IncomingRequestCfProperties<unknown>>;
}

function environment() {
  const writes: Array<{ key: string; value: unknown }> = [];
  const deletes: Array<string | string[]> = [];
  const rateLimit = vi.fn().mockResolvedValue({ success: true });
  const reports = {
    async put(key: string, value: unknown) {
      writes.push({ key, value });
      return null;
    },
    async delete(key: string | string[]) {
      deletes.push(key);
    },
  };
  const env = {
    REPORTS: reports,
    REPORT_RATE_LIMITER: { limit: rateLimit },
    ASSETS: { fetch: vi.fn() },
    ADMIN_EMAIL: "owner@example.com",
    POLICY_AUD: "replace-after-access-provisioning",
    REPORT_HOSTNAME: "scan.bedeh.ro",
    TEAM_DOMAIN: "https://replace-me.cloudflareaccess.com",
    VITE_SERVER_URL: "",
    TURNSTILE_SECRET: "test-secret",
  } as unknown as WorkerEnv;
  return { env, writes, deletes, rateLimit };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("report upload Worker", () => {
  it("stores a sanitized image and privacy-limited metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          success: true,
          action: "report_scan",
          hostname: "scan.bedeh.ro",
        }),
      ),
    );
    const { env, writes } = environment();

    const response = await worker.fetch(reportRequest(), env);

    expect(response.status).toBe(201);
    expect(writes).toHaveLength(2);
    expect(writes[0]?.key).toMatch(/^images\/[0-9a-f-]+\.webp$/);
    expect(writes[1]?.key).toMatch(/^metadata\/\d{13}-[0-9a-f-]+\.json$/);
    const metadata = JSON.parse(String(writes[1]?.value)) as Record<string, unknown>;
    expect(metadata).toMatchObject({
      detectedCount: 0,
      detectedFormats: [],
      source: "paste",
      appVersion: "test",
    });
    expect(metadata).not.toHaveProperty("decodedValues");
    expect(metadata).not.toHaveProperty("filename");
    expect(metadata).not.toHaveProperty("ocrText");
  });

  it("rejects unexpected sensitive metadata before writing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { env, writes } = environment();

    const response = await worker.fetch(
      reportRequest({ decodedValues: ["private-value"] }),
      env,
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it("fails closed when Turnstile rejects the token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          success: false,
          action: "report_scan",
          hostname: "scan.bedeh.ro",
        }),
      ),
    );
    const { env, writes } = environment();

    const response = await worker.fetch(reportRequest(), env);

    expect(response.status).toBe(403);
    expect(writes).toHaveLength(0);
  });

  it("rate limits before parsing or Turnstile verification", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { env, writes, rateLimit } = environment();
    rateLimit.mockResolvedValue({ success: false });

    const response = await worker.fetch(reportRequest(), env);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it("fails closed when the rate limiter is unavailable", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { env, writes, rateLimit } = environment();
    rateLimit.mockRejectedValue(new Error("Rate limiter unavailable"));

    const response = await worker.fetch(reportRequest(), env);

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });
});

describe("Access identity validation", () => {
  it("fails closed for missing configuration and email-less tokens", () => {
    expect(matchesAdminEmail(undefined, undefined)).toBe(false);
    expect(matchesAdminEmail(undefined, "owner@example.com")).toBe(false);
    expect(matchesAdminEmail("owner@example.com", undefined)).toBe(false);
    expect(matchesAdminEmail("owner@example.com", " owner@example.com ")).toBe(false);
  });

  it("accepts only the exact configured email", () => {
    expect(matchesAdminEmail("owner@example.com", "owner@example.com")).toBe(true);
    expect(matchesAdminEmail("other@example.com", "owner@example.com")).toBe(false);
  });
});
