import { createRemoteJWKSet, jwtVerify } from "jose";

import { MAX_REPORT_BYTES } from "./lib/reports/report-image";
import type {
  ReportListResponse,
  ReportUploadResponse,
  StoredReportMetadata,
} from "./lib/reports/types";
import {
  isMetadataKeyForReport,
  isReportId,
  isWebP,
  metadataKeyFor,
  parseReportMetadata,
} from "./worker/report-validation";

export type WorkerEnv = Env & { TURNSTILE_SECRET: string };

const MAX_REQUEST_BYTES = MAX_REPORT_BYTES + 128 * 1024;
const ADMIN_PREFIX = "/api/admin/reports";
const REPORT_ACTION = "report_scan";
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksDomain = "";

function json(data: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

function error(message: string, status: number): Response {
  return json({ error: message }, status);
}

function noIndex(response: Response): Response {
  const next = new Response(response.body, response);
  next.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  next.headers.set("Cache-Control", "no-store");
  return next;
}

async function verifyAccess(request: Request, env: WorkerEnv): Promise<boolean> {
  if (
    !env.POLICY_AUD ||
    env.POLICY_AUD.startsWith("replace-") ||
    !env.TEAM_DOMAIN ||
    env.TEAM_DOMAIN.includes("replace-me")
  ) {
    return false;
  }

  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return false;

  try {
    if (!jwks || jwksDomain !== env.TEAM_DOMAIN) {
      jwks = createRemoteJWKSet(new URL(`${env.TEAM_DOMAIN}/cdn-cgi/access/certs`));
      jwksDomain = env.TEAM_DOMAIN;
    }
    const { payload } = await jwtVerify(token, jwks, {
      issuer: env.TEAM_DOMAIN,
      audience: env.POLICY_AUD,
    });
    return payload.email === env.ADMIN_EMAIL;
  } catch {
    return false;
  }
}

async function verifyTurnstile(
  request: Request,
  env: WorkerEnv,
  token: string,
): Promise<boolean> {
  if (!env.TURNSTILE_SECRET || token.length === 0 || token.length > 2048) return false;

  const body = new URLSearchParams({
    secret: env.TURNSTILE_SECRET,
    response: token,
  });
  const remoteIp = request.headers.get("CF-Connecting-IP");
  if (remoteIp) body.set("remoteip", remoteIp);

  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) return false;

    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) return false;
    const verification = result as {
      success?: unknown;
      action?: unknown;
      hostname?: unknown;
    };
    return (
      verification.success === true &&
      verification.action === REPORT_ACTION &&
      verification.hostname === env.REPORT_HOSTNAME
    );
  } catch {
    return false;
  }
}

async function submitReport(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (
    request.method !== "POST" ||
    url.hostname !== env.REPORT_HOSTNAME ||
    origin !== url.origin
  ) {
    return error("Forbidden.", 403);
  }

  const length = Number(request.headers.get("Content-Length"));
  if (!Number.isFinite(length) || length <= 0 || length > MAX_REQUEST_BYTES) {
    return error("The report is too large.", 413);
  }
  if (!request.headers.get("Content-Type")?.startsWith("multipart/form-data;")) {
    return error("Unsupported report format.", 415);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return error("Invalid report.", 400);
  }

  const image = form.get("image");
  const metadataValue = form.get("metadata");
  const turnstileToken = form.get("turnstileToken");
  if (
    !(image instanceof File) ||
    image.type !== "image/webp" ||
    image.size === 0 ||
    image.size > MAX_REPORT_BYTES ||
    typeof metadataValue !== "string" ||
    metadataValue.length > 4096 ||
    typeof turnstileToken !== "string"
  ) {
    return error("Invalid report.", 400);
  }

  const metadata = parseReportMetadata(metadataValue);
  const header = new Uint8Array(await image.slice(0, 12).arrayBuffer());
  if (!metadata || !isWebP(header)) {
    return error("Invalid report.", 400);
  }
  if (!(await verifyTurnstile(request, env, turnstileToken))) {
    return error("Verification failed. Please try again.", 403);
  }

  const id = crypto.randomUUID();
  const createdAt = new Date();
  const imageKey = `images/${id}.webp`;
  const storageKey = metadataKeyFor(id, createdAt.getTime());
  const stored: StoredReportMetadata = {
    ...metadata,
    id,
    createdAt: createdAt.toISOString(),
    imageBytes: image.size,
    storageKey,
  };

  await env.REPORTS.put(imageKey, image.stream(), {
    httpMetadata: { contentType: "image/webp" },
  });
  try {
    await env.REPORTS.put(storageKey, JSON.stringify(stored), {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
    });
  } catch {
    await env.REPORTS.delete(imageKey);
    return error("The report could not be stored.", 500);
  }

  return json({ reference: id } satisfies ReportUploadResponse, 201);
}

async function listReports(request: Request, env: WorkerEnv): Promise<Response> {
  const cursor = new URL(request.url).searchParams.get("cursor") || undefined;
  const listed = await env.REPORTS.list({
    prefix: "metadata/",
    limit: 25,
    ...(cursor ? { cursor } : {}),
  });

  const reports: StoredReportMetadata[] = [];
  for (const item of listed.objects) {
    const object = await env.REPORTS.get(item.key);
    if (!object) continue;
    try {
      reports.push(await object.json<StoredReportMetadata>());
    } catch {
      // Skip malformed administrative metadata without exposing object contents.
    }
  }

  return json({
    reports,
    ...(listed.truncated && listed.cursor ? { cursor: listed.cursor } : {}),
  } satisfies ReportListResponse);
}

async function getReportImage(
  id: string,
  env: WorkerEnv,
  download: boolean,
): Promise<Response> {
  const object = await env.REPORTS.get(`images/${id}.webp`);
  if (!object) return error("Report not found.", 404);

  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "Content-Type": "image/webp",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  });
  if (download) {
    headers.set("Content-Disposition", `attachment; filename="scanme-report-${id}.webp"`);
  }
  return new Response(object.body, { headers });
}

async function deleteReport(request: Request, id: string, env: WorkerEnv): Promise<Response> {
  const length = Number(request.headers.get("Content-Length"));
  if (!Number.isFinite(length) || length <= 0 || length > 2048) {
    return error("Invalid request.", 400);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error("Invalid request.", 400);
  }
  const storageKey =
    typeof body === "object" && body !== null && "storageKey" in body
      ? (body as { storageKey?: unknown }).storageKey
      : null;
  if (typeof storageKey !== "string" || !isMetadataKeyForReport(storageKey, id)) {
    return error("Invalid request.", 400);
  }

  await env.REPORTS.delete([storageKey, `images/${id}.webp`]);
  return new Response(null, {
    status: 204,
    headers: {
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}

async function handleAdmin(request: Request, env: WorkerEnv): Promise<Response> {
  if (!(await verifyAccess(request, env))) return error("Forbidden.", 403);

  const url = new URL(request.url);
  if (url.pathname === ADMIN_PREFIX && request.method === "GET") {
    return listReports(request, env);
  }

  const match = url.pathname.match(
    /^\/api\/admin\/reports\/([^/]+)(?:\/(image|download))?$/,
  );
  if (!match || !isReportId(match[1])) return error("Not found.", 404);
  const [, id, action] = match;

  if (request.method === "GET" && (action === "image" || action === "download")) {
    return getReportImage(id, env, action === "download");
  }
  if (request.method === "DELETE" && !action) {
    return deleteReport(request, id, env);
  }
  return error("Method not allowed.", 405);
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/reports") {
      return submitReport(request, env);
    }
    if (url.pathname.startsWith(ADMIN_PREFIX)) {
      return noIndex(await handleAdmin(request, env));
    }
    if (url.pathname === "/robots.txt") {
      return new Response(
        ["User-agent: *", "Disallow: /reports", "Disallow: /api/admin/", ""].join("\n"),
        {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        },
      );
    }
    if (url.pathname === "/reports" || url.pathname.startsWith("/reports/")) {
      if (!(await verifyAccess(request, env))) {
        return noIndex(error("Forbidden.", 403));
      }
      return noIndex(await env.ASSETS.fetch(request));
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<WorkerEnv>;
