import { createFileRoute } from "@tanstack/react-router";
import {
  Download,
  FileWarning,
  ImageIcon,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type {
  ReportListResponse,
  StoredReportMetadata,
} from "@/lib/reports/types";

export const Route = createFileRoute("/reports")({
  component: ReportsComponent,
  head: () => ({
    meta: [
      { title: "Private reports — Scanme" },
      { name: "robots", content: "noindex, nofollow, noarchive" },
    ],
  }),
});

function ReportsComponent() {
  const [reports, setReports] = useState<StoredReportMetadata[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const loadReports = useCallback(async (nextCursor?: string) => {
    nextCursor ? setLoadingMore(true) : setLoading(true);
    setError(null);

    try {
      const url = new URL("/api/admin/reports", window.location.origin);
      if (nextCursor) url.searchParams.set("cursor", nextCursor);
      const response = await fetch(url, {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("Reports could not be loaded.");
      const payload = (await response.json()) as ReportListResponse;
      setReports((current) => (nextCursor ? [...current, ...payload.reports] : payload.reports));
      setCursor(payload.cursor);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Reports could not be loaded.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const deleteReport = async (report: StoredReportMetadata) => {
    if (confirmId !== report.id) {
      setConfirmId(report.id);
      window.setTimeout(
        () => setConfirmId((current) => (current === report.id ? null : current)),
        3000,
      );
      return;
    }

    setDeletingId(report.id);
    setError(null);
    try {
      const response = await fetch(`/api/admin/reports/${report.id}`, {
        method: "DELETE",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ storageKey: report.storageKey }),
      });
      if (!response.ok) throw new Error("The report could not be deleted.");
      setReports((current) => current.filter((item) => item.id !== report.id));
      setConfirmId(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The report could not be deleted.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <main className="min-h-screen bg-[#f5f4ee] text-[#17352b]">
      <header className="border-b border-[#17352b]/10 bg-white/60 px-5 py-4 sm:px-8">
        <div className="mx-auto flex max-w-360 items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-[#17352b] text-[#e7ff9e]">
              <ShieldCheck className="size-5" />
            </div>
            <div>
              <p className="text-lg font-black tracking-[-0.04em]">Scanme reports</p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#789087]">
                Access-protected review
              </p>
            </div>
          </div>
          <a
            href="/"
            className="rounded-full border border-[#17352b]/10 bg-white px-4 py-2 text-xs font-bold transition hover:border-[#17352b]/25"
          >
            Open scanner
          </a>
        </div>
      </header>

      <div className="mx-auto max-w-360 px-5 py-8 sm:px-8">
        <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#f35f32]">
              Private R2 storage
            </p>
            <h1 className="mt-1 text-4xl font-black tracking-tighter">Missed-barcode reports</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#567166]">
              Sanitized images and optional notes. Reports expire automatically after 30 days.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadReports()}
            disabled={loading}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#17352b]/15 bg-white px-4 text-xs font-bold disabled:opacity-50"
          >
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {error && (
          <div role="alert" className="mb-5 rounded-xl border border-[#f35f32]/20 bg-[#fff1ea] px-4 py-3 text-sm text-[#8f3e28]">
            {error}
          </div>
        )}

        {loading ? (
          <div className="grid min-h-72 place-items-center rounded-3xl border border-[#17352b]/10 bg-white">
            <div className="text-center">
              <LoaderCircle className="mx-auto size-7 animate-spin text-[#f35f32]" />
              <p className="mt-3 text-sm font-bold">Loading private reports…</p>
            </div>
          </div>
        ) : reports.length === 0 ? (
          <div className="grid min-h-72 place-items-center rounded-3xl border border-[#17352b]/10 bg-white p-8 text-center">
            <div>
              <FileWarning className="mx-auto size-8 text-[#789087]" />
              <h2 className="mt-4 text-xl font-black">No reports waiting</h2>
              <p className="mt-2 text-sm text-[#789087]">New submissions will appear here.</p>
            </div>
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {reports.map((report) => (
              <article
                key={report.id}
                className="overflow-hidden rounded-2xl border border-[#17352b]/10 bg-white shadow-[0_12px_35px_rgba(23,53,43,0.07)]"
              >
                <a
                  href={`/api/admin/reports/${report.id}/image`}
                  target="_blank"
                  rel="noreferrer"
                  className="grid aspect-video place-items-center overflow-hidden bg-[#17352b]"
                >
                  <img
                    src={`/api/admin/reports/${report.id}/image`}
                    alt={`Submitted report ${report.id}`}
                    loading="lazy"
                    className="size-full object-contain"
                  />
                </a>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black">
                        {report.detectedCount} detected barcode
                        {report.detectedCount === 1 ? "" : "s"}
                      </p>
                      <p className="mt-1 text-[10px] text-[#789087]">
                        {formatDate(report.createdAt)} · {report.source} ·{" "}
                        {formatBytes(report.imageBytes)}
                      </p>
                    </div>
                    <ImageIcon className="size-4 shrink-0 text-[#789087]" />
                  </div>

                  <div className="mt-3 flex min-h-6 flex-wrap gap-1.5">
                    {report.detectedFormats.length > 0 ? (
                      report.detectedFormats.map((format) => (
                        <span
                          key={format}
                          className="rounded-md bg-[#edf1ed] px-2 py-1 text-[9px] font-black uppercase tracking-wider text-[#567166]"
                        >
                          {format}
                        </span>
                      ))
                    ) : (
                      <span className="text-[10px] font-semibold text-[#9aaaa4]">
                        No formats detected
                      </span>
                    )}
                  </div>

                  <p className="mt-3 min-h-12 rounded-xl bg-[#f5f4ee] p-3 text-xs leading-5 text-[#476157]">
                    {report.note || "No note was provided."}
                  </p>
                  <p className="mt-3 truncate font-mono text-[9px] text-[#9aaaa4]" title={report.id}>
                    {report.id}
                  </p>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <a
                      href={`/api/admin/reports/${report.id}/download`}
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[#17352b]/10 text-xs font-bold"
                    >
                      <Download className="size-3.5" />
                      Download
                    </a>
                    <button
                      type="button"
                      onClick={() => void deleteReport(report)}
                      disabled={deletingId === report.id}
                      className={`inline-flex h-9 items-center justify-center gap-2 rounded-lg text-xs font-bold transition disabled:opacity-50 ${
                        confirmId === report.id
                          ? "bg-[#b34c2d] text-white"
                          : "border border-[#f35f32]/20 text-[#9a432b] hover:bg-[#fff1ea]"
                      }`}
                    >
                      {deletingId === report.id ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="size-3.5" />
                      )}
                      {confirmId === report.id ? "Confirm delete" : "Delete"}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}

        {cursor && (
          <button
            type="button"
            onClick={() => void loadReports(cursor)}
            disabled={loadingMore}
            className="mx-auto mt-7 flex h-11 items-center gap-2 rounded-xl bg-[#17352b] px-6 text-sm font-bold text-white disabled:opacity-50"
          >
            {loadingMore && <LoaderCircle className="size-4 animate-spin" />}
            {loadingMore ? "Loading…" : "Load older reports"}
          </button>
        )}
      </div>
    </main>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
