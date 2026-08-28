const MAX_REPORT_EDGE = 2560;
const MAX_REPORT_PIXELS = 6_000_000;
export const MAX_REPORT_BYTES = 5 * 1024 * 1024;

export interface ReportImageDimensions {
  width: number;
  height: number;
}

export function fitReportImage(width: number, height: number): ReportImageDimensions {
  const edgeScale = Math.min(1, MAX_REPORT_EDGE / Math.max(width, height));
  const pixelScale = Math.min(1, Math.sqrt(MAX_REPORT_PIXELS / (width * height)));
  const scale = Math.min(edgeScale, pixelScale);

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("The browser could not prepare this image."));
        }
      },
      "image/webp",
      quality,
    );
  });
}

export async function sanitizeReportImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);

  try {
    const { width, height } = fitReportImage(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      throw new Error("The browser could not prepare this image.");
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);

    for (const quality of [0.88, 0.78, 0.68, 0.58]) {
      const blob = await canvasToBlob(canvas, quality);
      if (blob.size <= MAX_REPORT_BYTES) {
        return blob;
      }
    }

    throw new Error("The sanitized image is still too large to report.");
  } finally {
    bitmap.close();
  }
}
