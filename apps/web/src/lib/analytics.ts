import type { PostHog } from "posthog-js";

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

const allowedEvents = new Set<AnalyticsEvent>([
  "app_opened",
  "scan_started",
  "scan_completed",
  "scan_failed",
  "ocr_completed",
  "ocr_failed",
  "scan_history_toggled",
  "report_submitted",
]);

let client: PostHog | null = null;
let initializing = false;

export function initializeAnalytics(): void {
  const key = import.meta.env.VITE_PUBLIC_POSTHOG_KEY;
  if (!key || client || initializing) {
    return;
  }

  initializing = true;
  void import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.init(key, {
        api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com",
        ui_host: "https://eu.posthog.com",
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        capture_heatmaps: false,
        capture_dead_clicks: false,
        capture_performance: false,
        capture_exceptions: false,
        disable_session_recording: true,
        person_profiles: "never",
        cookieless_mode: "always",
        advanced_disable_flags: true,
        before_send(event) {
          if (!event || !allowedEvents.has(event.event as AnalyticsEvent)) {
            return null;
          }

          delete event.properties.$current_url;
          delete event.properties.$pathname;
          delete event.properties.$referrer;
          delete event.properties.$referring_domain;
          return event;
        },
      });
      client = posthog;
      track("app_opened");
    })
    .catch(() => {
      // Analytics must never interfere with the scanner.
    })
    .finally(() => {
      initializing = false;
    });
}

export function track(event: AnalyticsEvent, properties: AnalyticsProperties = {}): void {
  if (!client || !navigator.onLine) return;
  client.capture(event, properties);
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
