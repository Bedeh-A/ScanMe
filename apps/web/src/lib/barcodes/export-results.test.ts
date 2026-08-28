import { describe, expect, it } from "vitest";

import { serializeBarcodeResults } from "./export-results";
import type { BarcodeResult } from "./types";

function result(text: string): BarcodeResult {
  return {
    id: "quick-0",
    text,
    format: "QRCode",
    symbology: "QRCode",
    orientation: 90,
    isInverted: false,
    position: {
      topLeft: { x: 10, y: 20 },
      topRight: { x: 110, y: 20 },
      bottomRight: { x: 110, y: 120 },
      bottomLeft: { x: 10, y: 120 },
    },
  };
}

describe("serializeBarcodeResults", () => {
  it("exports exact values and positions as JSON without internal IDs", () => {
    const exported = JSON.parse(
      serializeBarcodeResults([result("https://example.com/a?b=1")], "json"),
    ) as Array<Record<string, unknown>>;

    expect(exported).toEqual([
      {
        index: 1,
        value: "https://example.com/a?b=1",
        format: "QRCode",
        symbology: "QRCode",
        orientation: 90,
        isInverted: false,
        position: {
          topLeft: { x: 10, y: 20 },
          topRight: { x: 110, y: 20 },
          bottomRight: { x: 110, y: 120 },
          bottomLeft: { x: 10, y: 120 },
        },
      },
    ]);
    expect(exported[0]).not.toHaveProperty("id");
  });

  it("quotes CSV values, doubles quotes, and preserves positions", () => {
    const exported = serializeBarcodeResults([result('part "A", shelf 2')], "csv");

    expect(exported).toContain('"part ""A"", shelf 2"');
    expect(exported).toContain(",90,false,10,20,110,20,110,120,10,120");
  });

  it("prevents spreadsheet formulas from executing", () => {
    const exported = serializeBarcodeResults([result("=HYPERLINK(\"https://bad\")")], "csv");

    expect(exported).toContain('"\'=HYPERLINK(""https://bad"")"');
  });
});
