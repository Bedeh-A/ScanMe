export interface OcrProgress {
  progress: number;
  status: string;
}

export interface OcrWorkerHandle {
  terminate(): Promise<unknown>;
}

function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return new URL(`${base}ocr/${path}`, window.location.origin).href;
}

export async function recognizeText(
  image: File,
  onProgress: (progress: OcrProgress) => void,
  onWorkerReady: (worker: OcrWorkerHandle) => void,
): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    workerPath: assetUrl("worker.min.js"),
    corePath: assetUrl("core"),
    langPath: assetUrl("lang"),
    workerBlobURL: false,
    logger: ({ progress, status }: OcrProgress) => onProgress({ progress, status }),
  });

  onWorkerReady(worker);
  const {
    data: { text },
  } = await worker.recognize(image, {}, { text: true });
  return text.trim();
}
