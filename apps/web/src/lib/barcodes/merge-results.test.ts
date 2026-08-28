import { describe, expect, it } from "vitest";

import { mergeBarcodeResults, safeExternalUrl } from "./merge-results";
import type { BarcodeResult } from "./types";

function result(id: string, text: string, left: number, top: number): BarcodeResult {
  return {
    id,
    text,
    format: "QRCode",
    symbology: "QRCode",
    orientation: 0,
    isInverted: false,
    position: {
      topLeft: { x: left, y: top },
      topRight: { x: left + 100, y: top },
      bottomRight: { x: left + 100, y: top + 100 },
      bottomLeft: { x: left, y: top + 100 },
    },
  };
}

describe("mergeBarcodeResults", () => {
  it("merges the same code detected in the same location", () => {
    const merged = mergeBarcodeResults(
      [result("quick-0", "hello", 10, 10)],
      [result("deep-0", "hello", 14, 12)],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("quick-0");
    expect(merged[0].position.topLeft).toEqual({ x: 14, y: 12 });
  });

  it("keeps repeated payloads in separate physical locations", () => {
    const merged = mergeBarcodeResults(
      [result("quick-0", "same value", 10, 10)],
      [result("deep-0", "same value", 400, 300)],
    );

    expect(merged).toHaveLength(2);
  });

  it("merges a thin 1D scan strip contained by a full barcode region", () => {
    const full = result("quick-0", "034163541390", 129, 42);
    full.position.topRight.x = 265;
    full.position.bottomRight.x = 265;
    full.position.bottomRight.y = 373;
    full.position.bottomLeft.y = 373;

    const strip = result("deep-0", "034163541390", 239, 42);
    strip.position.topRight.x = 241;
    strip.position.bottomRight.x = 241;
    strip.position.bottomRight.y = 373;
    strip.position.bottomLeft.y = 373;

    const merged = mergeBarcodeResults([full], [strip]);

    expect(merged).toHaveLength(1);
  });

  it("keeps overlapping barcodes when their values differ", () => {
    const merged = mergeBarcodeResults(
      [result("quick-0", "first", 10, 10)],
      [result("deep-0", "second", 10, 10)],
    );

    expect(merged).toHaveLength(2);
  });
});

describe("safeExternalUrl", () => {
  it("allows only HTTP and HTTPS links", () => {
    expect(safeExternalUrl("https://example.com/path")).toBe("https://example.com/path");
    expect(safeExternalUrl("http://example.com")).toBe("http://example.com/");
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("WIFI:T:WPA;S:network;P:secret;;")).toBeNull();
  });
});
