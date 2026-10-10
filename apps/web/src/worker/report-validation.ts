import {
  REPORT_NOTE_MAX_LENGTH,
  type ReportSubmissionMetadata,
} from "../lib/reports/types";
import {
  MAX_REPORT_EDGE,
  MAX_REPORT_PIXELS,
} from "../lib/reports/report-image";

const ALLOWED_SOURCES = new Set(["paste", "upload", "drop"]);
const ALLOWED_WEBP_CHUNKS = new Set(["ALPH", "VP8 ", "VP8L", "VP8X"]);
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

export interface WebPDimensions {
  width: number;
  height: number;
}

function chunkName(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  );
}

function safeDimensions(width: number, height: number): WebPDimensions | null {
  if (
    width < 1 ||
    height < 1 ||
    width > MAX_REPORT_EDGE ||
    height > MAX_REPORT_EDGE ||
    width * height > MAX_REPORT_PIXELS
  ) {
    return null;
  }
  return { width, height };
}

function dimensionsForChunk(
  type: string,
  bytes: Uint8Array,
  dataOffset: number,
  size: number,
  view: DataView,
): WebPDimensions | null {
  if (type === "VP8X") {
    if (size !== 10) return null;
    const width =
      1 +
      (bytes[dataOffset + 4] ?? 0) +
      ((bytes[dataOffset + 5] ?? 0) << 8) +
      ((bytes[dataOffset + 6] ?? 0) << 16);
    const height =
      1 +
      (bytes[dataOffset + 7] ?? 0) +
      ((bytes[dataOffset + 8] ?? 0) << 8) +
      ((bytes[dataOffset + 9] ?? 0) << 16);
    return safeDimensions(width, height);
  }

  if (type === "VP8 ") {
    if (
      size < 10 ||
      ((bytes[dataOffset] ?? 1) & 1) !== 0 ||
      bytes[dataOffset + 3] !== 0x9d ||
      bytes[dataOffset + 4] !== 0x01 ||
      bytes[dataOffset + 5] !== 0x2a
    ) {
      return null;
    }
    const width = view.getUint16(dataOffset + 6, true) & 0x3fff;
    const height = view.getUint16(dataOffset + 8, true) & 0x3fff;
    return safeDimensions(width, height);
  }

  if (type === "VP8L") {
    if (size < 5 || bytes[dataOffset] !== 0x2f) return null;
    const bits = view.getUint32(dataOffset + 1, true);
    if (bits >>> 29 !== 0) return null;
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >>> 14) & 0x3fff) + 1;
    return safeDimensions(width, height);
  }

  return null;
}

export function inspectWebP(bytes: Uint8Array): WebPDimensions | null {
  if (
    bytes.length < 20 ||
    chunkName(bytes, 0) !== "RIFF" ||
    chunkName(bytes, 8) !== "WEBP"
  ) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) + 8 !== bytes.length) return null;

  let offset = 12;
  let dimensions: WebPDimensions | null = null;
  let extendedChunks = 0;
  let imageChunks = 0;

  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) return null;
    const type = chunkName(bytes, offset);
    if (!ALLOWED_WEBP_CHUNKS.has(type)) return null;
    const size = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;
    const dataEnd = dataOffset + size;
    const paddedEnd = dataEnd + (size % 2);
    if (dataEnd > bytes.length || paddedEnd > bytes.length) return null;

    if (type === "VP8X" || type === "VP8 " || type === "VP8L") {
      const chunkDimensions = dimensionsForChunk(type, bytes, dataOffset, size, view);
      if (!chunkDimensions) return null;
      if (
        dimensions &&
        (dimensions.width !== chunkDimensions.width ||
          dimensions.height !== chunkDimensions.height)
      ) {
        return null;
      }
      dimensions = chunkDimensions;
      if (type === "VP8X") extendedChunks += 1;
      if (type === "VP8 " || type === "VP8L") imageChunks += 1;
      if (extendedChunks > 1 || imageChunks > 1) return null;
    }

    offset = paddedEnd;
  }

  return offset === bytes.length && imageChunks === 1 ? dimensions : null;
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
