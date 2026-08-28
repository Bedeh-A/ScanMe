import { describe, expect, it } from "vitest";

import {
  isMetadataKeyForReport,
  isReportId,
  isWebP,
  metadataKeyFor,
  parseReportMetadata,
} from "./report-validation";

const validMetadata = {
  detectedCount: 2,
  detectedFormats: ["QRCode", "EAN13"],
  source: "paste",
  appVersion: "1.0.0",
  note: "The lower code was missed.",
};

describe("parseReportMetadata", () => {
  it("accepts bounded non-sensitive metadata", () => {
    expect(parseReportMetadata(JSON.stringify(validMetadata))).toEqual(validMetadata);
  });

  it("rejects decoded values and other unexpected fields", () => {
    expect(
      parseReportMetadata(JSON.stringify({ ...validMetadata, decodedValues: ["secret"] })),
    ).toBeNull();
  });

  it("rejects invalid counts, sources, notes, and formats", () => {
    expect(
      parseReportMetadata(JSON.stringify({ ...validMetadata, detectedCount: -1 })),
    ).toBeNull();
    expect(
      parseReportMetadata(JSON.stringify({ ...validMetadata, source: "camera" })),
    ).toBeNull();
    expect(
      parseReportMetadata(JSON.stringify({ ...validMetadata, note: "x".repeat(501) })),
    ).toBeNull();
    expect(
      parseReportMetadata(
        JSON.stringify({ ...validMetadata, detectedFormats: ["QR<script>"] }),
      ),
    ).toBeNull();
  });
});

describe("report object validation", () => {
  const id = "34ea99b2-d755-4c09-9f0c-a9d71af85948";

  it("validates WebP magic bytes instead of trusting MIME type", () => {
    expect(isWebP(new TextEncoder().encode("RIFF1234WEBP"))).toBe(true);
    expect(isWebP(new TextEncoder().encode("<html></html>"))).toBe(false);
  });

  it("requires random UUID report identifiers", () => {
    expect(isReportId(id)).toBe(true);
    expect(isReportId("../../metadata")).toBe(false);
  });

  it("binds deletion metadata keys to the report identifier", () => {
    const key = metadataKeyFor(id, Date.UTC(2026, 7, 28));
    expect(isMetadataKeyForReport(key, id)).toBe(true);
    expect(
      isMetadataKeyForReport(
        key,
        "8df0e0f5-7d9f-410f-8fb2-8fbf2c7cd233",
      ),
    ).toBe(false);
  });
});
