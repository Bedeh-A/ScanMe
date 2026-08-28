/// <reference lib="webworker" />

import {
  prepareZXingModule,
  readBarcodes,
  type ReadResult,
} from "zxing-wasm/reader";
import readerWasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";

import type {
  BarcodeResult,
  ScanStage,
  WorkerRequest,
  WorkerResponse,
} from "../lib/barcodes/types";

const scope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;
const moduleReady = prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) =>
      path.endsWith(".wasm") ? readerWasmUrl : prefix + path,
  },
});

function serializeResult(result: ReadResult, stage: ScanStage, index: number): BarcodeResult {
  return {
    id: `${stage}-${index}`,
    text: result.text,
    format: result.format,
    symbology: result.symbology,
    position: result.position,
    orientation: result.orientation,
    isInverted: result.isInverted,
  };
}

async function runPass(file: File, stage: ScanStage): Promise<BarcodeResult[]> {
  await moduleReady;
  const deep = stage === "deep";
  const results = await readBarcodes(file, {
    formats: ["AllReadable"],
    maxNumberOfSymbols: 0,
    returnErrors: false,
    textMode: "Plain",
    tryHarder: deep,
    tryRotate: true,
    tryInvert: true,
    tryDownscale: deep,
    tryDenoise: deep,
  });

  return results
    .filter((result) => result.isValid)
    .map((result, index) => serializeResult(result, stage, index));
}

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  if (event.data.type !== "scan") {
    return;
  }

  const startedAt = performance.now();

  try {
    const quickResults = await runPass(event.data.file, "quick");
    scope.postMessage({
      type: "results",
      stage: "quick",
      results: quickResults,
      elapsedMs: performance.now() - startedAt,
    } satisfies WorkerResponse);

    const deepResults = await runPass(event.data.file, "deep");
    scope.postMessage({
      type: "results",
      stage: "deep",
      results: deepResults,
      elapsedMs: performance.now() - startedAt,
    } satisfies WorkerResponse);
  } catch {
    scope.postMessage({
      type: "error",
      message: "This image could not be scanned. Try another format or a clearer screenshot.",
    } satisfies WorkerResponse);
  }
};

export {};
