import { createFileRoute } from "@tanstack/react-router";
import {
  Barcode,
  Check,
  Clipboard,
  Copy,
  ExternalLink,
  FileImage,
  History,
  LoaderCircle,
  LockKeyhole,
  MessageSquareWarning,
  ScanLine,
  ScanText,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
  Zap,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";

import { ReportScanDialog } from "@/components/report-scan-dialog";
import { countBucket, durationBucket, textLengthBucket, track } from "@/lib/analytics";
import {
  ImageInputError,
  imageFromClipboard,
  prepareImage,
} from "@/lib/barcodes/image-input";
import { mergeBarcodeResults, safeExternalUrl } from "@/lib/barcodes/merge-results";
import type {
  BarcodeResult,
  ImageDetails,
  ScanSource,
  WorkerResponse,
} from "@/lib/barcodes/types";
import {
  clearHistory,
  deleteHistoryEntry,
  isHistoryEnabled,
  loadHistory,
  retainedHistory,
  saveHistoryEntry,
  setHistoryEnabled as persistHistoryEnabled,
  type HistoryEntry,
} from "@/lib/history";
import { recognizeText, type OcrWorkerHandle } from "@/lib/ocr";
import { APP_VERSION } from "@/lib/version";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

type ScanStatus = "idle" | "quick" | "deep" | "done" | "error";
type OcrStatus = "idle" | "loading" | "recognizing" | "done" | "error";

function HomeComponent() {
  const [image, setImage] = useState<ImageDetails | null>(null);
  const [results, setResults] = useState<BarcodeResult[]>([]);
  const [status, setStatus] = useState<ScanStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [historyEnabled, setHistoryEnabled] = useState(() => {
    try {
      return isHistoryEnabled();
    } catch {
      return false;
    }
  });
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [ocrStatus, setOcrStatus] = useState<OcrStatus>("idle");
  const [ocrText, setOcrText] = useState("");
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const ocrWorkerRef = useRef<OcrWorkerHandle | null>(null);
  const ocrGenerationRef = useRef(0);
  const autoOcrRef = useRef<() => void>(() => undefined);
  const imageRef = useRef<ImageDetails | null>(null);
  const resultsRef = useRef<BarcodeResult[]>([]);
  const historyEnabledRef = useRef(historyEnabled);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    historyEnabledRef.current = historyEnabled;
  }, [historyEnabled]);

  const stopCurrentScan = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  const cancelOcr = useCallback(() => {
    ocrGenerationRef.current += 1;
    void ocrWorkerRef.current?.terminate();
    ocrWorkerRef.current = null;
    setOcrStatus("idle");
    setOcrText("");
    setOcrProgress(0);
    setOcrError(null);
  }, []);

  const startScan = useCallback(
    (nextImage: ImageDetails) => {
      stopCurrentScan();
      resultsRef.current = [];
      setResults([]);
      setError(null);
      setElapsedMs(0);
      setStatus("quick");
      track("scan_started", { source: nextImage.source });

      const worker = new Worker(
        new URL("../workers/barcode-scanner.worker.ts", import.meta.url),
        { type: "module" },
      );
      workerRef.current = worker;

      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        if (workerRef.current !== worker) return;

        if (event.data.type === "error") {
          setError(event.data.message);
          setStatus("error");
          track("scan_failed", { source: nextImage.source, reason: "decode-error" });
          worker.terminate();
          workerRef.current = null;
          return;
        }

        const response = event.data;
        setElapsedMs(response.elapsedMs);
        const merged = mergeBarcodeResults(resultsRef.current, response.results);
        resultsRef.current = merged;
        setResults(merged);

        if (response.stage === "quick") {
          setStatus("deep");
        } else {
          track("scan_completed", {
            source: nextImage.source,
            duration: durationBucket(response.elapsedMs),
            resultCount: countBucket(merged.length),
            formats: [...new Set(merged.map((result) => result.format))],
          });
          if (historyEnabledRef.current && merged.length > 0) {
            void saveHistoryEntry(merged, nextImage.source)
              .then((entry) => {
                setHistoryEntries((current) => retainedHistory([entry, ...current]));
              })
              .catch(() => {
                setHistoryError("History could not be saved in this browser.");
              });
          }
          setStatus("done");
          if (merged.length === 0) {
            window.setTimeout(() => autoOcrRef.current(), 0);
          }
          worker.terminate();
          workerRef.current = null;
        }
      };

      worker.onerror = () => {
        if (workerRef.current !== worker) return;
        setError("The scanner stopped unexpectedly. Please try the image again.");
        setStatus("error");
        track("scan_failed", { source: nextImage.source, reason: "decode-error" });
        worker.terminate();
        workerRef.current = null;
      };

      worker.postMessage({ type: "scan", file: nextImage.file });
    },
    [stopCurrentScan],
  );

  const useImage = useCallback(
    async (file: File, source: ScanSource) => {
      try {
        const nextImage = await prepareImage(file, source);
        cancelOcr();
        if (imageRef.current) URL.revokeObjectURL(imageRef.current.url);
        imageRef.current = nextImage;
        setImage(nextImage);
        setSelectedId(null);
        startScan(nextImage);
      } catch (caught) {
        const message =
          caught instanceof ImageInputError
            ? caught.message
            : "That image could not be opened.";
        setError(message);
        setStatus("error");
        track("scan_failed", { source, reason: "invalid-file" });
      }
    },
    [cancelOcr, startScan],
  );

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA")
      ) {
        return;
      }

      const file = event.clipboardData
        ? imageFromClipboard(event.clipboardData.items)
        : null;
      if (file) {
        event.preventDefault();
        void useImage(file, "paste");
      }
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [useImage]);

  useEffect(
    () => () => {
      stopCurrentScan();
      ocrGenerationRef.current += 1;
      void ocrWorkerRef.current?.terminate();
      if (imageRef.current) URL.revokeObjectURL(imageRef.current.url);
    },
    [stopCurrentScan],
  );

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void useImage(file, "upload");
    event.target.value = "";
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void useImage(file, "drop");
  };

  const clearImage = () => {
    stopCurrentScan();
    cancelOcr();
    if (imageRef.current) URL.revokeObjectURL(imageRef.current.url);
    imageRef.current = null;
    setImage(null);
    resultsRef.current = [];
    setResults([]);
    setError(null);
    setStatus("idle");
    setSelectedId(null);
  };

  const openHistory = async () => {
    setHistoryOpen(true);
    setHistoryError(null);
    try {
      setHistoryEntries(await loadHistory());
    } catch {
      setHistoryError("History is unavailable in this browser.");
    }
  };

  const toggleHistory = () => {
    const next = !historyEnabled;
    try {
      persistHistoryEnabled(next);
      setHistoryEnabled(next);
      track("scan_history_toggled", { enabled: next });
    } catch {
      setHistoryError("The history preference could not be saved.");
    }
  };

  const removeHistoryEntry = async (id: string) => {
    try {
      await deleteHistoryEntry(id);
      setHistoryEntries((current) => current.filter((entry) => entry.id !== id));
    } catch {
      setHistoryError("That history item could not be deleted.");
    }
  };

  const removeAllHistory = async () => {
    try {
      await clearHistory();
      setHistoryEntries([]);
    } catch {
      setHistoryError("History could not be cleared.");
    }
  };

  const runOcr = async () => {
    if (!imageRef.current) return;

    cancelOcr();
    const generation = ocrGenerationRef.current;
    const sourceImage = imageRef.current;
    let taskWorker: OcrWorkerHandle | null = null;

    setOcrStatus("loading");
    setOcrError(null);

    try {
      const text = await recognizeText(
        sourceImage.file,
        ({ progress, status: nextStatus }) => {
          if (ocrGenerationRef.current !== generation) return;
          setOcrProgress(Math.max(0, Math.min(1, progress || 0)));
          setOcrStatus(nextStatus === "recognizing text" ? "recognizing" : "loading");
        },
        (worker) => {
          taskWorker = worker;
          if (ocrGenerationRef.current === generation) {
            ocrWorkerRef.current = worker;
          } else {
            void worker.terminate();
          }
        },
      );

      if (ocrGenerationRef.current === generation) {
        setOcrText(text);
        setOcrProgress(1);
        setOcrStatus("done");
        track("ocr_completed", { textLength: textLengthBucket(text.length) });
      }
    } catch (caught) {
      console.error("OCR failed", caught);
      if (ocrGenerationRef.current === generation) {
        setOcrError("Text extraction failed. Try a sharper or higher-resolution image.");
        setOcrStatus("error");
        track("ocr_failed");
      }
    } finally {
      await (taskWorker as OcrWorkerHandle | null)?.terminate();
      if (ocrWorkerRef.current === taskWorker) ocrWorkerRef.current = null;
    }
  };

  autoOcrRef.current = () => {
    void runOcr();
  };

  const copyValue = async (id: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1600);
  };

  const copyAll = async () => {
    const text = results
      .map((result, index) => `${index + 1}. [${humanizeFormat(result.format)}] ${result.text}`)
      .join("\n");
    await copyValue("all", text);
  };

  return (
    <main className="min-h-screen bg-[#f5f4ee] text-[#17352b]">
      <header className="border-b border-[#17352b]/10 px-5 py-4 sm:px-8">
        <div className="mx-auto flex max-w-360 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-[#17352b] text-[#f5f4ee] shadow-[0_6px_16px_rgba(23,53,43,0.18)]">
              <ScanLine className="size-5" strokeWidth={2.4} />
            </div>
            <div>
              <p className="text-lg font-black tracking-[-0.04em]">scanme</p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#567166]">
                local barcode reader
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 rounded-full border border-[#17352b]/10 bg-white/60 px-3 py-2 text-xs font-semibold text-[#476157] sm:flex">
              <LockKeyhole className="size-3.5 text-[#f35f32]" />
              Images stay on your device
            </div>
            <button
              type="button"
              onClick={() => void openHistory()}
              className="inline-flex h-9 items-center gap-2 rounded-full border border-[#17352b]/10 bg-white/70 px-3 text-xs font-bold text-[#476157] transition hover:border-[#17352b]/25 hover:bg-white"
            >
              <History className="size-3.5" />
              History
              {historyEnabled && (
                <span className="size-1.5 rounded-full bg-[#f35f32]" aria-label="History enabled" />
              )}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-360 px-5 py-10 sm:px-8 lg:py-14">
        <section className="mb-10 max-w-3xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-[#e7ff9e] px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-[#294536]">
            <Sparkles className="size-3.5" />
            QR, retail, industrial &amp; more
          </div>
          <h1 className="text-balance text-4xl font-black leading-[0.98] tracking-[-0.055em] sm:text-6xl">
            Find every barcode
            <br />
            <span className="text-[#f35f32]">in one screenshot.</span>
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-[#567166] sm:text-lg">
            Paste, drop, or upload an image. Scanme searches for all common 1D and
            2D codes—without uploading the image anywhere.
          </p>
        </section>

        {!image ? (
          <section>
            <div
              className={`group relative flex min-h-90 flex-col items-center justify-center overflow-hidden rounded-[2rem] border-2 border-dashed px-6 text-center transition-all ${
                isDragging
                  ? "scale-[1.01] border-[#f35f32] bg-[#fff1ea]"
                  : "border-[#17352b]/20 bg-white/70 hover:border-[#17352b]/45 hover:bg-white"
              }`}
              onDragEnter={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                  setIsDragging(false);
                }
              }}
              onDrop={onDrop}
            >
              <div className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full border-44 border-[#e7ff9e]/70" />
              <div className="pointer-events-none absolute -bottom-28 -left-16 size-64 rounded-full border-36 border-[#ffd7c8]/60" />
              <div className="relative mb-6 grid size-20 place-items-center rounded-[1.6rem] bg-[#17352b] text-white shadow-[0_18px_40px_rgba(23,53,43,0.22)] transition-transform group-hover:-translate-y-1">
                <FileImage className="size-9" strokeWidth={1.8} />
                <span className="absolute -right-2 -top-2 grid size-8 place-items-center rounded-full bg-[#f35f32] ring-4 ring-white">
                  <Upload className="size-4" />
                </span>
              </div>
              <h2 className="relative text-2xl font-black tracking-[-0.035em]">
                Drop a screenshot here
              </h2>
              <p className="relative mt-2 text-sm text-[#6e827a]">
                or use the quickest option below
              </p>
              <div className="relative mt-7 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#17352b] px-6 text-sm font-bold text-white shadow-[0_8px_20px_rgba(23,53,43,0.18)] transition hover:-translate-y-0.5 hover:bg-[#244b3c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f35f32]"
                >
                  <Upload className="size-4" />
                  Choose an image
                </button>
                <div className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-[#17352b]/15 bg-[#f5f4ee] px-6 text-sm font-bold text-[#476157]">
                  <Clipboard className="size-4" />
                  Press Ctrl + V
                </div>
              </div>
              <p className="relative mt-6 text-xs text-[#84948e]">
                PNG, JPEG, WebP, GIF or BMP · up to 25 MB
              </p>
            </div>
            {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
          </section>
        ) : (
          <section className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.75fr)]">
            <div className="overflow-hidden rounded-[1.75rem] border border-[#17352b]/10 bg-[#17352b] shadow-[0_24px_70px_rgba(23,53,43,0.14)]">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-white sm:px-5">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/10">
                    <FileImage className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">
                      {image.file.name || "Pasted screenshot"}
                    </p>
                    <p className="text-[11px] text-white/55">
                      {image.width.toLocaleString()} × {image.height.toLocaleString()} px
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={clearImage}
                  className="grid size-9 place-items-center rounded-full text-white/65 transition hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e7ff9e]"
                  aria-label="Remove image"
                >
                  <X className="size-4" />
                </button>
              </div>
              <div className="flex min-h-105 items-center justify-center bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.09)_0,transparent_70%)] p-3 sm:p-6">
                <div className="relative max-h-[72vh] max-w-full overflow-hidden rounded-lg shadow-2xl">
                  <img
                    src={image.url}
                    alt="Screenshot being scanned"
                    className="block max-h-[72vh] max-w-full object-contain"
                  />
                  <svg
                    className="pointer-events-none absolute inset-0 size-full"
                    viewBox={`0 0 ${image.width} ${image.height}`}
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    {results.map((result) => (
                      <polygon
                        key={result.id}
                        points={polygonPoints(result)}
                        fill={selectedId === result.id ? "rgba(243,95,50,.18)" : "rgba(231,255,158,.12)"}
                        stroke={selectedId === result.id ? "#f35f32" : "#e7ff9e"}
                        strokeWidth={selectedId === result.id ? 5 : 3}
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}
                  </svg>
                  {results.map((result, index) => (
                    <button
                      key={result.id}
                      type="button"
                      onClick={() => setSelectedId(result.id)}
                      className={`absolute grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-xs font-black shadow-lg ring-2 ring-[#17352b] transition ${
                        selectedId === result.id
                          ? "scale-110 bg-[#f35f32] text-white"
                          : "bg-[#e7ff9e] text-[#17352b]"
                      }`}
                      style={{
                        left: `${(result.position.topLeft.x / image.width) * 100}%`,
                        top: `${(result.position.topLeft.y / image.height) * 100}%`,
                      }}
                      aria-label={`Select barcode ${index + 1}`}
                    >
                      {index + 1}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <aside className="overflow-hidden rounded-[1.75rem] border border-[#17352b]/10 bg-white shadow-[0_18px_50px_rgba(23,53,43,0.08)] lg:sticky lg:top-6">
              <div className="border-b border-[#17352b]/10 p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#789087]">
                      Results
                    </p>
                    <h2 className="mt-1 text-2xl font-black tracking-[-0.04em]">
                      {status === "quick" && "Looking for codes…"}
                      {status === "deep" && `Found ${results.length} so far`}
                      {status === "done" && `${results.length} barcode${results.length === 1 ? "" : "s"}`}
                      {status === "error" && "Scan interrupted"}
                    </h2>
                  </div>
                  {(status === "quick" || status === "deep") && (
                    <LoaderCircle className="size-6 animate-spin text-[#f35f32]" />
                  )}
                  {status === "done" && results.length > 0 && (
                    <div className="grid size-10 place-items-center rounded-full bg-[#e7ff9e]">
                      <Check className="size-5" strokeWidth={3} />
                    </div>
                  )}
                </div>
                <p className="mt-2 text-xs text-[#789087]" aria-live="polite">
                  {status === "quick" && "Running a fast scan across all formats."}
                  {status === "deep" && "Checking rotations, contrast, and smaller details."}
                  {status === "done" && `Deep scan finished in ${(elapsedMs / 1000).toFixed(1)}s.`}
                </p>
              </div>

              {error ? (
                <div className="p-5">
                  <ErrorBanner message={error} onDismiss={clearImage} />
                </div>
              ) : results.length > 0 ? (
                <>
                  <div className="max-h-[54vh] divide-y divide-[#17352b]/8 overflow-y-auto">
                    {results.map((result, index) => (
                      <ResultCard
                        key={result.id}
                        result={result}
                        index={index}
                        selected={selectedId === result.id}
                        copied={copiedId === result.id}
                        onSelect={() => setSelectedId(result.id)}
                        onCopy={() => void copyValue(result.id, result.text)}
                      />
                    ))}
                  </div>
                  <div className="border-t border-[#17352b]/10 p-4">
                    <button
                      type="button"
                      onClick={() => void copyAll()}
                      className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#17352b] text-sm font-bold text-white transition hover:bg-[#244b3c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f35f32]"
                    >
                      {copiedId === "all" ? <Check className="size-4" /> : <Copy className="size-4" />}
                      {copiedId === "all" ? "Copied all results" : "Copy all results"}
                    </button>
                  </div>
                </>
              ) : status === "done" ? (
                <div className="p-8 text-center">
                  <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-[#f5f4ee]">
                    <Barcode className="size-6 text-[#789087]" />
                  </div>
                  <h3 className="mt-4 font-black">No readable barcodes found</h3>
                  <p className="mt-2 text-sm leading-6 text-[#789087]">
                    Try a sharper screenshot, more contrast, or a version with more space
                    around each code.
                  </p>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="mt-5 text-sm font-bold text-[#f35f32] underline decoration-2 underline-offset-4"
                  >
                    Choose another image
                  </button>
                </div>
              ) : (
                <div className="space-y-3 p-5">
                  {[0, 1, 2].map((item) => (
                    <div key={item} className="h-20 animate-pulse rounded-xl bg-[#f5f4ee]" />
                  ))}
                </div>
              )}

              {status === "done" && (
                <div className="border-t border-[#17352b]/10 bg-[#faf9f5] p-4">
                  {ocrStatus === "idle" ? (
                    <div>
                      <button
                        type="button"
                        onClick={() => void runOcr()}
                        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#17352b]/15 bg-white text-sm font-bold transition hover:border-[#17352b]/30 hover:bg-[#f5f4ee]"
                      >
                        <ScanText className="size-4 text-[#f35f32]" />
                        Extract text from image
                      </button>
                      <p className="mt-2 text-center text-[10px] leading-4 text-[#84948e]">
                        Runs locally. The first use loads the English OCR model.
                      </p>
                    </div>
                  ) : ocrStatus === "loading" || ocrStatus === "recognizing" ? (
                    <div>
                      <div className="flex items-center justify-between gap-3 text-xs font-bold">
                        <span className="flex items-center gap-2">
                          <LoaderCircle className="size-3.5 animate-spin text-[#f35f32]" />
                          {ocrStatus === "recognizing" ? "Reading text…" : "Preparing OCR…"}
                        </span>
                        <span>{Math.round(ocrProgress * 100)}%</span>
                      </div>
                      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#dfe5e1]">
                        <div
                          className="h-full rounded-full bg-[#f35f32] transition-[width]"
                          style={{ width: `${Math.max(4, ocrProgress * 100)}%` }}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={cancelOcr}
                        className="mt-3 text-xs font-bold text-[#789087] underline underline-offset-4"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : ocrStatus === "error" ? (
                    <div>
                      <p className="text-xs leading-5 text-[#b34c2d]">{ocrError}</p>
                      <button
                        type="button"
                        onClick={() => void runOcr()}
                        className="mt-3 text-xs font-bold underline underline-offset-4"
                      >
                        Try again
                      </button>
                    </div>
                  ) : (
                    <div>
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-[#789087]">
                            Extracted text
                          </p>
                          <p className="mt-0.5 text-xs text-[#84948e]">
                            English model · layout approximated
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void copyValue("ocr", ocrText)}
                          disabled={!ocrText}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#17352b]/10 bg-white px-2.5 text-xs font-bold disabled:opacity-40"
                        >
                          {copiedId === "ocr" ? (
                            <Check className="size-3.5 text-[#2f7d52]" />
                          ) : (
                            <Copy className="size-3.5" />
                          )}
                          {copiedId === "ocr" ? "Copied" : "Copy"}
                        </button>
                      </div>
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-xl border border-[#17352b]/8 bg-white p-3 font-mono text-[11px] leading-5 text-[#24483b]">
                        {ocrText || "No readable text found."}
                      </pre>
                      <button
                        type="button"
                        onClick={() => void runOcr()}
                        className="mt-3 text-xs font-bold text-[#789087] underline underline-offset-4"
                      >
                        Run OCR again
                      </button>
                    </div>
                  )}
                </div>
              )}
              {status === "done" && (
                <div className="border-t border-[#17352b]/10 p-4">
                  <button
                    type="button"
                    onClick={() => setReportOpen(true)}
                    className="flex h-10 w-full items-center justify-center gap-2 rounded-xl text-xs font-bold text-[#789087] transition hover:bg-[#f5f4ee] hover:text-[#17352b]"
                  >
                    <MessageSquareWarning className="size-3.5" />
                    Missing a barcode? Report this image
                  </button>
                </div>
              )}
            </aside>
          </section>
        )}

        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          <Feature icon={<Zap className="size-4" />} title="Progressive scan" text="Fast results first, deep search second." />
          <Feature
            icon={<ShieldCheck className="size-4" />}
            title="Private by default"
            text="Images stay local unless you explicitly send a bug report."
          />
          <Feature icon={<Barcode className="size-4" />} title="Broad support" text="Common linear and matrix formats." />
        </div>

        <footer className="mt-12 flex flex-col gap-4 border-t border-[#17352b]/10 pt-5 text-xs leading-5 text-[#789087] sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p>Scans happen locally—even offline. Bug reports upload only with your consent.</p>
            <p>Anonymous scan-performance metrics may be collected. Never images or decoded values.</p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="font-mono text-[11px]" aria-label={`Scanme version ${APP_VERSION}`}>
              {APP_VERSION}
            </span>
            <span aria-hidden="true">·</span>
            <a
              href="https://github.com/Bedeh-A/ScanMe"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-bold text-[#567166] transition hover:text-[#17352b]"
            >
              GitHub
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          </div>
        </footer>
      </div>

      {historyOpen && (
        <HistoryPanel
          entries={historyEntries}
          enabled={historyEnabled}
          error={historyError}
          onClose={() => setHistoryOpen(false)}
          onToggle={toggleHistory}
          onDelete={(id) => void removeHistoryEntry(id)}
          onClear={() => void removeAllHistory()}
          onCopy={(id, value) => void copyValue(`history-${id}`, value)}
          copiedId={copiedId}
        />
      )}

      {reportOpen && image && (
        <ReportScanDialog
          file={image.file}
          source={image.source}
          detectedCount={results.length}
          detectedFormats={[...new Set(results.map((result) => result.format))]}
          onClose={() => setReportOpen(false)}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
        onChange={onFileChange}
        className="sr-only"
        aria-label="Choose a screenshot"
      />
    </main>
  );
}

function HistoryPanel({
  entries,
  enabled,
  error,
  copiedId,
  onClose,
  onToggle,
  onDelete,
  onClear,
  onCopy,
}: {
  entries: HistoryEntry[];
  enabled: boolean;
  error: string | null;
  copiedId: string | null;
  onClose: () => void;
  onToggle: () => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  onCopy: (id: string, value: string) => void;
}) {
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Scan history">
      <button
        type="button"
        className="absolute inset-0 bg-[#17352b]/35 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close scan history"
      />
      <section className="relative flex h-full w-full max-w-md flex-col bg-[#f5f4ee] shadow-[-24px_0_70px_rgba(23,53,43,0.2)]">
        <div className="flex items-start justify-between border-b border-[#17352b]/10 p-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#789087]">
              Private &amp; local
            </p>
            <h2 className="mt-1 text-2xl font-black tracking-[-0.04em]">Scan history</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-9 place-items-center rounded-full transition hover:bg-[#17352b]/8"
            aria-label="Close history"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="border-b border-[#17352b]/10 p-5">
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={onToggle}
            className="flex w-full items-center justify-between gap-4 rounded-2xl border border-[#17352b]/10 bg-white p-4 text-left"
          >
            <span>
              <span className="block text-sm font-black">Save future scans</span>
              <span className="mt-1 block text-xs leading-5 text-[#789087]">
                Barcode values and formats only. Screenshots are never stored.
              </span>
            </span>
            <span
              className={`relative h-7 w-12 shrink-0 rounded-full transition ${
                enabled ? "bg-[#17352b]" : "bg-[#cdd5d1]"
              }`}
            >
              <span
                className={`absolute top-1 size-5 rounded-full bg-white shadow transition ${
                  enabled ? "left-6" : "left-1"
                }`}
              />
            </span>
          </button>
          <p className="mt-3 text-[11px] leading-5 text-[#84948e]">
            Stored in this browser for up to 30 days, with a maximum of 50 scans.
            Anyone using this browser profile can view it.
          </p>
          {error && <p className="mt-3 text-xs font-semibold text-[#b34c2d]">{error}</p>}
        </div>

        <div className="flex-1 overflow-y-auto">
          {entries.length === 0 ? (
            <div className="grid min-h-64 place-items-center p-8 text-center">
              <div>
                <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-white">
                  <History className="size-6 text-[#789087]" />
                </div>
                <h3 className="mt-4 font-black">No saved scans yet</h3>
                <p className="mt-2 text-sm leading-6 text-[#789087]">
                  Enable history, then complete a scan to see its results here.
                </p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-[#17352b]/10">
              {entries.map((entry) => (
                <article key={entry.id} className="p-5">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-black">
                        {entry.results.length} barcode{entry.results.length === 1 ? "" : "s"}
                      </p>
                      <p className="mt-0.5 text-[11px] text-[#789087]">
                        {formatHistoryDate(entry.createdAt)} · {entry.source}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onDelete(entry.id)}
                      className="grid size-8 place-items-center rounded-lg text-[#789087] transition hover:bg-[#ffe5dc] hover:text-[#b34c2d]"
                      aria-label={`Delete scan from ${formatHistoryDate(entry.createdAt)}`}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                  <div className="space-y-2">
                    {entry.results.map((result, index) => {
                      const copyId = `${entry.id}-${index}`;
                      return (
                        <div
                          key={copyId}
                          className="flex items-center gap-3 rounded-xl border border-[#17352b]/8 bg-white p-3"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-[9px] font-black uppercase tracking-widest text-[#789087]">
                              {humanizeFormat(result.format)}
                            </p>
                            <p className="mt-1 truncate font-mono text-xs text-[#24483b]" title={result.text}>
                              {result.text || "(empty value)"}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => onCopy(copyId, result.text)}
                            className="grid size-8 shrink-0 place-items-center rounded-lg border border-[#17352b]/10"
                            aria-label="Copy saved barcode"
                          >
                            {copiedId === `history-${copyId}` ? (
                              <Check className="size-3.5 text-[#2f7d52]" />
                            ) : (
                              <Copy className="size-3.5" />
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        {entries.length > 0 && (
          <div className="border-t border-[#17352b]/10 p-4">
            <button
              type="button"
              onClick={() => {
                if (confirmClear) {
                  onClear();
                  setConfirmClear(false);
                } else {
                  setConfirmClear(true);
                  window.setTimeout(() => setConfirmClear(false), 3000);
                }
              }}
              className={`flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold transition ${
                confirmClear
                  ? "bg-[#b34c2d] text-white"
                  : "border border-[#17352b]/10 bg-white text-[#6f3930] hover:bg-[#fff1ea]"
              }`}
            >
              <Trash2 className="size-4" />
              {confirmClear ? "Click again to clear everything" : "Clear all history"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function ResultCard({
  result,
  index,
  selected,
  copied,
  onSelect,
  onCopy,
}: {
  result: BarcodeResult;
  index: number;
  selected: boolean;
  copied: boolean;
  onSelect: () => void;
  onCopy: () => void;
}) {
  const externalUrl = safeExternalUrl(result.text);

  return (
    <article
      className={`group p-4 transition ${selected ? "bg-[#fff1ea]" : "hover:bg-[#faf9f5]"}`}
      onMouseEnter={onSelect}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onSelect}
          className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-black transition ${
            selected ? "bg-[#f35f32] text-white" : "bg-[#e7ff9e] text-[#17352b]"
          }`}
          aria-label={`Highlight barcode ${index + 1}`}
        >
          {index + 1}
        </button>
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="rounded-md bg-[#edf1ed] px-2 py-1 text-[10px] font-black uppercase tracking-widest text-[#567166]">
              {humanizeFormat(result.format)}
            </span>
            {result.isInverted && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#9aaaa4]">
                inverted
              </span>
            )}
          </div>
          <p className="max-h-24 overflow-auto break-all font-mono text-[13px] leading-5 text-[#24483b]">
            {result.text || "(empty value)"}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={onCopy}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#17352b]/10 px-2.5 text-xs font-bold transition hover:border-[#17352b]/25 hover:bg-white"
            >
              {copied ? <Check className="size-3.5 text-[#2f7d52]" /> : <Copy className="size-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
            {externalUrl && (
              <a
                href={externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#17352b]/10 px-2.5 text-xs font-bold transition hover:border-[#17352b]/25 hover:bg-white"
              >
                <ExternalLink className="size-3.5" />
                Open
              </a>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      className="mt-4 flex items-start justify-between gap-4 rounded-2xl border border-[#f35f32]/25 bg-[#fff1ea] p-4 text-left text-sm text-[#7b3924]"
      role="alert"
    >
      <p>{message}</p>
      <button type="button" onClick={onDismiss} aria-label="Dismiss error">
        <X className="size-4" />
      </button>
    </div>
  );
}

function Feature({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-[#17352b]/10 bg-white/55 p-4">
      <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#e7ff9e]">{icon}</div>
      <div>
        <p className="text-sm font-black">{title}</p>
        <p className="mt-0.5 text-xs leading-5 text-[#789087]">{text}</p>
      </div>
    </div>
  );
}

function polygonPoints(result: BarcodeResult): string {
  const { topLeft, topRight, bottomRight, bottomLeft } = result.position;
  return [topLeft, topRight, bottomRight, bottomLeft]
    .map((point) => `${point.x},${point.y}`)
    .join(" ");
}

function humanizeFormat(format: string): string {
  const aliases: Record<string, string> = {
    QRCode: "QR Code",
    MicroQRCode: "Micro QR",
    RMQRCode: "rMQR",
    DataMatrix: "Data Matrix",
    PDF417: "PDF417",
    UPCA: "UPC-A",
    UPCE: "UPC-E",
    EAN13: "EAN-13",
    EAN8: "EAN-8",
  };
  return aliases[format] ?? format.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function formatHistoryDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}
