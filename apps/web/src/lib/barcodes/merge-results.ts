import type { BarcodePosition, BarcodeResult } from "./types";

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function getBounds(position: BarcodePosition): Bounds {
  const points = [
    position.topLeft,
    position.topRight,
    position.bottomRight,
    position.bottomLeft,
  ];

  return {
    left: Math.min(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
    right: Math.max(...points.map((point) => point.x)),
    bottom: Math.max(...points.map((point) => point.y)),
  };
}

function intersectionArea(a: Bounds, b: Bounds): number {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return width * height;
}

function area(bounds: Bounds): number {
  return Math.max(1, (bounds.right - bounds.left) * (bounds.bottom - bounds.top));
}

function intersectionOverUnion(a: Bounds, b: Bounds): number {
  const intersection = intersectionArea(a, b);
  const areaA = Math.max(1, (a.right - a.left) * (a.bottom - a.top));
  const areaB = Math.max(1, (b.right - b.left) * (b.bottom - b.top));
  return intersection / (areaA + areaB - intersection);
}

function isSameDetection(a: BarcodeResult, b: BarcodeResult): boolean {
  const boundsA = getBounds(a.position);
  const boundsB = getBounds(b.position);
  const containment =
    intersectionArea(boundsA, boundsB) / Math.min(area(boundsA), area(boundsB));

  return (
    a.format === b.format &&
    a.text === b.text &&
    (intersectionOverUnion(boundsA, boundsB) > 0.2 || containment > 0.7)
  );
}

export function mergeBarcodeResults(
  current: BarcodeResult[],
  incoming: BarcodeResult[],
): BarcodeResult[] {
  const merged = [...current];

  for (const result of incoming) {
    const existingIndex = merged.findIndex((candidate) => isSameDetection(candidate, result));
    if (existingIndex >= 0) {
      merged[existingIndex] = { ...result, id: merged[existingIndex].id };
    } else {
      merged.push({ ...result, id: `barcode-${merged.length + 1}` });
    }
  }

  return merged;
}

export function safeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
