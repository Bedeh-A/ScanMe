// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ANALYTICS_CONSENT_STORAGE_KEY } from "./analytics-consent";

const posthog = vi.hoisted(() => ({
  imports: 0,
  init: vi.fn(),
  capture: vi.fn(),
}));

vi.mock("posthog-js", () => {
  posthog.imports += 1;
  return {
    default: {
      init: posthog.init,
      capture: posthog.capture,
    },
  };
});

type BeforeSend = (event: {
  event: string;
  properties: Record<string, string>;
}) => { event: string; properties: Record<string, string> } | null;

describe("initializeAnalytics", () => {
  beforeEach(() => {
    posthog.imports = 0;
    posthog.init.mockReset();
    posthog.capture.mockReset();
    localStorage.clear();
    vi.stubEnv("VITE_PUBLIC_POSTHOG_KEY", "phc_test");
    vi.stubEnv("VITE_PUBLIC_POSTHOG_HOST", "https://eu.i.posthog.com");
    setPrivacySignals({ doNotTrack: null, globalPrivacyControl: false, legacyDoNotTrack: null });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("does not load PostHog before a visitor accepts", async () => {
    const { initializeAnalytics } = await loadAnalytics();

    initializeAnalytics();
    await flush();

    expect(posthog.imports).toBe(0);
    expect(posthog.init).not.toHaveBeenCalled();
  });

  it("does not load PostHog when the visitor declines", async () => {
    localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, "declined");
    const { initializeAnalytics, track } = await loadAnalytics();

    initializeAnalytics();
    track("scan_started", { source: "paste" });
    await flush();

    expect(posthog.imports).toBe(0);
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it("does not load PostHog when Do Not Track or Global Privacy Control is set", async () => {
    localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, "accepted");
    setPrivacySignals({ doNotTrack: "1" });
    const declinedByDoNotTrack = await loadAnalytics();
    declinedByDoNotTrack.initializeAnalytics();
    await flush();
    expect(posthog.imports).toBe(0);

    vi.resetModules();
    localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, "accepted");
    setPrivacySignals({ doNotTrack: null, globalPrivacyControl: true });
    const declinedByPrivacyControl = await loadAnalytics();
    declinedByPrivacyControl.initializeAnalytics();
    await flush();

    expect(posthog.imports).toBe(0);
    expect(posthog.init).not.toHaveBeenCalled();
  });

  it("does not load PostHog when no project key is configured", async () => {
    vi.stubEnv("VITE_PUBLIC_POSTHOG_KEY", "");
    localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, "accepted");
    const { initializeAnalytics } = await loadAnalytics();

    initializeAnalytics();
    await flush();

    expect(posthog.imports).toBe(0);
  });

  it("loads PostHog after accept and sends nothing after a later decline", async () => {
    const { initializeAnalytics, setAnalyticsConsent, track } = await loadAnalytics();
    let beforeSend: BeforeSend | undefined;
    posthog.init.mockImplementation((_key: string, config: { before_send: BeforeSend }) => {
      beforeSend = config.before_send;
    });

    setAnalyticsConsent("accepted");
    await vi.waitFor(() => expect(posthog.init).toHaveBeenCalledTimes(1));

    expect(posthog.init).toHaveBeenCalledWith(
      "phc_test",
      expect.objectContaining({
        cookieless_mode: "always",
        person_profiles: "never",
      }),
    );
    expect(posthog.capture).toHaveBeenCalledWith("app_opened", {});

    const event = {
      event: "scan_started",
      properties: { source: "paste", $current_url: "https://scan.example/secret" },
    };
    expect(beforeSend?.(event)).toEqual({ event: "scan_started", properties: { source: "paste" } });

    setAnalyticsConsent("declined");
    posthog.capture.mockClear();
    track("scan_completed", { source: "paste" });
    expect(posthog.capture).not.toHaveBeenCalled();
    expect(beforeSend?.(event)).toBeNull();

    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    setAnalyticsConsent("accepted");
    posthog.capture.mockClear();
    track("results_exported", { exportFormat: "csv" });
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it("keeps an offline scanner from waiting on analytics startup", async () => {
    localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, "accepted");
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const { initializeAnalytics, track } = await loadAnalytics();

    initializeAnalytics();
    await vi.waitFor(() => expect(posthog.init).toHaveBeenCalledTimes(1));
    expect(posthog.capture).not.toHaveBeenCalled();

    track("scan_started", { source: "upload" });
    expect(posthog.capture).not.toHaveBeenCalled();
  });
});

async function loadAnalytics() {
  vi.resetModules();
  return import("./analytics");
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 30));
}

function setPrivacySignals({
  doNotTrack = null,
  globalPrivacyControl = false,
  legacyDoNotTrack = null,
}: {
  doNotTrack?: string | null;
  globalPrivacyControl?: boolean;
  legacyDoNotTrack?: string | null;
}) {
  Object.defineProperty(navigator, "doNotTrack", {
    configurable: true,
    get: () => doNotTrack,
  });
  Object.defineProperty(navigator, "globalPrivacyControl", {
    configurable: true,
    get: () => globalPrivacyControl,
  });
  Object.defineProperty(window, "doNotTrack", {
    configurable: true,
    get: () => legacyDoNotTrack,
  });
}
