import { describe, expect, it } from "vitest";

import {
  inspectWebP,
  isMetadataKeyForReport,
  isReportId,
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

function structuralWebP(width = 2, height = 2): Uint8Array {
  const bytes = new Uint8Array(26);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
  bytes.set(new TextEncoder().encode("WEBPVP8L"), 8);
  new DataView(bytes.buffer).setUint32(16, 5, true);
  bytes[20] = 0x2f;
  new DataView(bytes.buffer).setUint32(
    21,
    (width - 1) | ((height - 1) << 14),
    true,
  );
  return bytes;
}

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

  it("validates WebP structure and dimensions instead of trusting magic bytes", () => {
    expect(inspectWebP(structuralWebP(1200, 800))).toEqual({
      width: 1200,
      height: 800,
    });
    expect(inspectWebP(new TextEncoder().encode("RIFF1234WEBPpayload"))).toBeNull();
    expect(inspectWebP(structuralWebP(3000, 1))).toBeNull();
    expect(inspectWebP(structuralWebP(2560, 2560))).toBeNull();
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
