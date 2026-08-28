import { Check, LoaderCircle, Send, ShieldAlert, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { track } from "@/lib/analytics";
import type { ScanSource } from "@/lib/barcodes/types";
import { sanitizeReportImage } from "@/lib/reports/report-image";
import {
  REPORT_NOTE_MAX_LENGTH,
  type ReportSubmissionMetadata,
  type ReportUploadResponse,
} from "@/lib/reports/types";

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      theme: "light";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let turnstileLoader: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (turnstileLoader) return turnstileLoader;

  const loader = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("Verification did not initialize."));
    };
    script.onerror = () => reject(new Error("Verification could not be loaded."));
    document.head.appendChild(script);
  }).catch((error) => {
    turnstileLoader = null;
    throw error;
  });

  turnstileLoader = loader;
  return loader;
}

export function ReportScanDialog({
  file,
  source,
  detectedFormats,
  detectedCount,
  onClose,
}: {
  file: File;
  source: ScanSource;
  detectedFormats: string[];
  detectedCount: number;
  onClose: () => void;
}) {
  const [sanitizedImage, setSanitizedImage] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [consented, setConsented] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [status, setStatus] = useState<"preparing" | "ready" | "submitting" | "sent">(
    "preparing",
  );
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const turnstileContainerRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetRef = useRef<string | null>(null);
  const consentId = useId();

  const configuredSiteKey = import.meta.env.VITE_PUBLIC_TURNSTILE_SITE_KEY;
  const siteKey =
    configuredSiteKey || (import.meta.env.DEV ? "1x00000000000000000000AA" : "");

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && status !== "submitting") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, status]);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    void sanitizeReportImage(file)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setSanitizedImage(blob);
        setPreviewUrl(objectUrl);
        setStatus("ready");
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "The image could not be prepared.");
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  useEffect(() => {
    if (!siteKey || !turnstileContainerRef.current) return;
    let active = true;

    void loadTurnstile()
      .then((turnstile) => {
        if (!active || !turnstileContainerRef.current) return;
        turnstileWidgetRef.current = turnstile.render(turnstileContainerRef.current, {
          sitekey: siteKey,
          action: "report_scan",
          theme: "light",
          callback: setTurnstileToken,
          "expired-callback": () => setTurnstileToken(""),
          "error-callback": () => {
            setTurnstileToken("");
            setError("Verification failed to load. Please try again.");
          },
        });
      })
      .catch((caught) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : "Verification could not be loaded.");
        }
      });

    return () => {
      active = false;
      if (turnstileWidgetRef.current && window.turnstile) {
        window.turnstile.remove(turnstileWidgetRef.current);
        turnstileWidgetRef.current = null;
      }
    };
  }, [siteKey]);

  const submitReport = async () => {
    if (!sanitizedImage || !consented || !turnstileToken) return;

    setStatus("submitting");
    setError(null);

    const metadata: ReportSubmissionMetadata = {
      detectedCount,
      detectedFormats,
      source,
      appVersion: import.meta.env.VITE_APP_VERSION || "development",
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    const body = new FormData();
    body.set("image", sanitizedImage, "sanitized-report.webp");
    body.set("metadata", JSON.stringify(metadata));
    body.set("turnstileToken", turnstileToken);

    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        body,
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      const payload = (await response.json().catch(() => null)) as
        | ReportUploadResponse
        | { error?: string }
        | null;

      if (!response.ok || !payload || !("reference" in payload)) {
        throw new Error(
          payload && "error" in payload && payload.error
            ? payload.error
            : "The report could not be sent.",
        );
      }

      setReference(payload.reference);
      setStatus("sent");
      track("report_submitted");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The report could not be sent.");
      setStatus("ready");
      setTurnstileToken("");
      if (turnstileWidgetRef.current) window.turnstile?.reset(turnstileWidgetRef.current);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#17352b]/45 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-dialog-title"
    >
      <section className="my-auto w-full max-w-2xl overflow-hidden rounded-3xl bg-[#f5f4ee] shadow-[0_30px_100px_rgba(9,30,23,0.35)]">
        <div className="flex items-start justify-between border-b border-[#17352b]/10 p-5 sm:p-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#f35f32]">
              Optional report
            </p>
            <h2 id="report-dialog-title" className="mt-1 text-2xl font-black tracking-[-0.04em]">
              Help us find a missed barcode
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={status === "submitting"}
            className="grid size-9 place-items-center rounded-full transition hover:bg-[#17352b]/8 disabled:opacity-40"
            aria-label="Close report dialog"
          >
            <X className="size-4" />
          </button>
        </div>

        {status === "sent" ? (
          <div className="p-8 text-center sm:p-10">
            <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-[#e7ff9e]">
              <Check className="size-7" strokeWidth={3} />
            </div>
            <h3 className="mt-5 text-xl font-black">Report received</h3>
            <p className="mt-2 text-sm leading-6 text-[#567166]">
              Thank you. The sanitized image will be automatically deleted after 30 days.
            </p>
            <p className="mt-4 font-mono text-xs text-[#789087]">Reference: {reference}</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-6 h-11 rounded-xl bg-[#17352b] px-6 text-sm font-bold text-white"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="grid gap-5 p-5 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] sm:p-6">
              <div>
                <p className="mb-2 text-xs font-black uppercase tracking-widest text-[#789087]">
                  Exact image sent
                </p>
                <div className="grid min-h-52 place-items-center overflow-hidden rounded-2xl bg-[#17352b] p-3">
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt="Sanitized report preview"
                      className="max-h-72 max-w-full rounded-lg object-contain"
                    />
                  ) : (
                    <LoaderCircle className="size-6 animate-spin text-[#e7ff9e]" />
                  )}
                </div>
                <p className="mt-2 text-[10px] leading-4 text-[#84948e]">
                  Re-encoded as WebP to remove filename and embedded image metadata.
                </p>
              </div>

              <div>
                <label htmlFor="report-note" className="text-xs font-black uppercase tracking-widest text-[#789087]">
                  What should have been found? <span className="font-medium normal-case">(optional)</span>
                </label>
                <textarea
                  id="report-note"
                  value={note}
                  maxLength={REPORT_NOTE_MAX_LENGTH}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="For example: the small QR code in the lower-right corner."
                  className="mt-2 h-28 w-full resize-none rounded-xl border border-[#17352b]/15 bg-white p-3 text-sm outline-none transition focus:border-[#f35f32]"
                />
                <p className="mt-1 text-right text-[10px] text-[#84948e]">
                  {note.length}/{REPORT_NOTE_MAX_LENGTH}
                </p>

                <div className="mt-4 rounded-xl border border-[#f35f32]/20 bg-[#fff1ea] p-3">
                  <div className="flex gap-2.5">
                    <ShieldAlert className="mt-0.5 size-4 shrink-0 text-[#f35f32]" />
                    <p className="text-xs leading-5 text-[#6f493c]">
                      The image may contain private information. Scanme sends no decoded values,
                      OCR text, filename, history, cookies, or analytics identifiers. Cloudflare
                      still processes normal network information such as your IP address.
                    </p>
                  </div>
                </div>

                <label
                  htmlFor={consentId}
                  className="mt-4 flex cursor-pointer items-start gap-3 text-sm font-semibold leading-5"
                >
                  <input
                    id={consentId}
                    type="checkbox"
                    checked={consented}
                    onChange={(event) => setConsented(event.target.checked)}
                    className="mt-0.5 size-4 accent-[#17352b]"
                  />
                  I reviewed the preview and consent to sending this image for debugging.
                </label>

                {siteKey ? (
                  <div ref={turnstileContainerRef} className="mt-4 min-h-16" />
                ) : (
                  <p className="mt-4 text-xs font-semibold text-[#b34c2d]">
                    Reporting is not configured on this deployment.
                  </p>
                )}
              </div>
            </div>

            {error && (
              <p className="mx-5 mb-4 rounded-xl bg-[#ffe5dc] px-4 py-3 text-xs font-semibold text-[#8f3e28] sm:mx-6">
                {error}
              </p>
            )}

            <div className="flex items-center justify-end gap-3 border-t border-[#17352b]/10 p-4 sm:px-6">
              <button
                type="button"
                onClick={onClose}
                disabled={status === "submitting"}
                className="h-11 rounded-xl border border-[#17352b]/15 bg-white px-5 text-sm font-bold disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitReport()}
                disabled={
                  status !== "ready" || !sanitizedImage || !consented || !turnstileToken
                }
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#17352b] px-5 text-sm font-bold text-white transition hover:bg-[#244b3c] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {status === "submitting" ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                {status === "submitting" ? "Sending…" : "Send report"}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
