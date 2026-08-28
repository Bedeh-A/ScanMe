import type { BarcodePosition, BarcodeResult } from "./types";

export type BarcodeExportFormat = "csv" | "json";

interface ExportedBarcode {
  index: number;
  value: string;
  format: string;
  symbology: string;
  orientation: number;
  isInverted: boolean;
  position: BarcodePosition;
}

const CSV_HEADERS = [
  "index",
  "value",
  "format",
  "symbology",
  "orientation",
  "is_inverted",
  "top_left_x",
  "top_left_y",
  "top_right_x",
  "top_right_y",
  "bottom_right_x",
  "bottom_right_y",
  "bottom_left_x",
  "bottom_left_y",
];

function exportedBarcodes(results: BarcodeResult[]): ExportedBarcode[] {
  return results.map((result, index) => ({
    index: index + 1,
    value: result.text,
    format: result.format,
    symbology: result.symbology,
    orientation: result.orientation,
    isInverted: result.isInverted,
    position: result.position,
  }));
}

function csvText(value: string): string {
  // Prevent spreadsheet applications from evaluating untrusted barcode values.
  const safeValue = /^\s*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safeValue.replaceAll('"', '""')}"`;
}

export function serializeBarcodeResults(
  results: BarcodeResult[],
  format: BarcodeExportFormat,
): string {
  const exported = exportedBarcodes(results);
  if (format === "json") {
    return JSON.stringify(exported, null, 2);
  }

  const rows = exported.map((result) =>
    [
      result.index,
      csvText(result.value),
      csvText(result.format),
      csvText(result.symbology),
      result.orientation,
      result.isInverted,
      result.position.topLeft.x,
      result.position.topLeft.y,
      result.position.topRight.x,
      result.position.topRight.y,
      result.position.bottomRight.x,
      result.position.bottomRight.y,
      result.position.bottomLeft.x,
      result.position.bottomLeft.y,
    ].join(","),
  );
  return [CSV_HEADERS.join(","), ...rows].join("\r\n");
}

export function downloadBarcodeResults(
  results: BarcodeResult[],
  format: BarcodeExportFormat,
): void {
  const content = serializeBarcodeResults(results, format);
  const type = format === "json" ? "application/json" : "text/csv";
  const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `scanme-results.${format}`;
  link.click();
  URL.revokeObjectURL(url);
}
