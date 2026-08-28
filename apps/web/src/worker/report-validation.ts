import {
  REPORT_NOTE_MAX_LENGTH,
  type ReportSubmissionMetadata,
} from "../lib/reports/types";

const ALLOWED_SOURCES = new Set(["paste", "upload", "drop"]);
const FORMAT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 .+_-]{0,63}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseReportMetadata(value: string): ReportSubmissionMetadata | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;
  const allowedKeys = new Set([
    "note",
    "detectedCount",
    "detectedFormats",
    "source",
    "appVersion",
  ]);
  if (Object.keys(parsed).some((key) => !allowedKeys.has(key))) return null;

  const { note, detectedCount, detectedFormats, source, appVersion } = parsed;
  if (
    !Number.isInteger(detectedCount) ||
    (detectedCount as number) < 0 ||
    (detectedCount as number) > 100 ||
    !Array.isArray(detectedFormats) ||
    detectedFormats.length > 32 ||
    !detectedFormats.every(
      (format) => typeof format === "string" && FORMAT_PATTERN.test(format),
    ) ||
    typeof source !== "string" ||
    !ALLOWED_SOURCES.has(source) ||
    typeof appVersion !== "string" ||
    appVersion.length === 0 ||
    appVersion.length > 64 ||
    (note !== undefined &&
      (typeof note !== "string" ||
        note.trim().length === 0 ||
        note.length > REPORT_NOTE_MAX_LENGTH))
  ) {
    return null;
  }

  return {
    detectedCount: detectedCount as number,
    detectedFormats: [...new Set(detectedFormats as string[])],
    source: source as ReportSubmissionMetadata["source"],
    appVersion,
    ...(typeof note === "string" ? { note: note.trim() } : {}),
  };
}

export function isWebP(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  return (
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  );
}

export function isReportId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function metadataKeyFor(id: string, timestamp: number): string {
  const reverseTimestamp = String(9_999_999_999_999 - timestamp).padStart(13, "0");
  return `metadata/${reverseTimestamp}-${id}.json`;
}

export function isMetadataKeyForReport(key: string, id: string): boolean {
  return new RegExp(`^metadata/\\d{13}-${id.replaceAll("-", "\\-")}\\.json$`, "i").test(
    key,
  );
}
