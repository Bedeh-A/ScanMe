export type ScanSource = "paste" | "upload" | "drop";

export interface Point {
  x: number;
  y: number;
}

export interface BarcodePosition {
  topLeft: Point;
  topRight: Point;
  bottomRight: Point;
  bottomLeft: Point;
}

export interface BarcodeResult {
  id: string;
  text: string;
  format: string;
  symbology: string;
  position: BarcodePosition;
  orientation: number;
  isInverted: boolean;
}

export interface ImageDetails {
  file: File;
  source: ScanSource;
  width: number;
  height: number;
  url: string;
}

export type ScanStage = "quick" | "deep";

export type WorkerRequest = {
  type: "scan";
  file: File;
};

export type WorkerResponse =
  | {
      type: "results";
      stage: ScanStage;
      results: BarcodeResult[];
      elapsedMs: number;
    }
  | {
      type: "error";
      message: string;
    };
