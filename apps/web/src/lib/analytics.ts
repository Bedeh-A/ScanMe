import posthog from "posthog-js";

import type { ScanSource } from "./barcodes/types";

type AnalyticsEvent =
  | "app_opened"
  | "scan_started"
  | "scan_completed"
  | "scan_failed"
  | "ocr_completed"
  | "ocr_failed"
  | "scan_history_toggled"
  | "report_submitted";

type AnalyticsProperties = {
  source?: ScanSource;
  duration?: "<1s" | "1-3s" | "3-8s" | "8s+";
  resultCount?: "0" | "1" | "2-5" | "6+";
  formats?: string[];
  reason?: "invalid-file" | "decode-error";
  textLength?: "0" | "1-100" | "101-500" | "501+";
  enabled?: boolean;
};

let initialized = false;

export function initializeAnalytics(): void {
  const key = import.meta.env.VITE_PUBLIC_POSTHOG_KEY;
  const host = import.meta.env.VITE_PUBLIC_POSTHOG_HOST;

  if (!key || !host) {
    if (import.meta.env.DEV) {
      const variable = key ? "VITE_PUBLIC_POSTHOG_HOST" : "VITE_PUBLIC_POSTHOG_KEY";
      throw new Error(
        `${variable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${variable} is configured`,
      );
    }
    return;
  }

  if (initialized) return;

  posthog.init(key, {
    api_host: host,
    autocapture: false,
    capture_heatmaps: false,
    capture_dead_clicks: false,
    capture_performance: {
      web_vitals: true,
      network_timing: false,
    },
    capture_exceptions: {
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: false,
    },
  });
  initialized = true;
  track("app_opened");
}

export function track(event: AnalyticsEvent, properties: AnalyticsProperties = {}): void {
  if (!initialized) return;
  posthog.capture(event, properties);
}

export function durationBucket(milliseconds: number): AnalyticsProperties["duration"] {
  if (milliseconds < 1000) return "<1s";
  if (milliseconds < 3000) return "1-3s";
  if (milliseconds < 8000) return "3-8s";
  return "8s+";
}

export function countBucket(count: number): AnalyticsProperties["resultCount"] {
  if (count === 0) return "0";
  if (count === 1) return "1";
  if (count <= 5) return "2-5";
  return "6+";
}

export function textLengthBucket(length: number): AnalyticsProperties["textLength"] {
  if (length === 0) return "0";
  if (length <= 100) return "1-100";
  if (length <= 500) return "101-500";
  return "501+";
}
