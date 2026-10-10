// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnalyticsConsentBanner } from "./analytics-consent";
import { ANALYTICS_CONSENT_STORAGE_KEY, requestAnalyticsPreferences } from "@/lib/analytics-consent";

vi.mock("posthog-js", () => ({
  default: {
    init: vi.fn(),
    capture: vi.fn(),
  },
}));

describe("AnalyticsConsentBanner", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubEnv("VITE_PUBLIC_POSTHOG_KEY", "phc_test");
    setPrivacySignals({ doNotTrack: null, globalPrivacyControl: false });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("shows no banner when no PostHog key is configured", async () => {
    vi.stubEnv("VITE_PUBLIC_POSTHOG_KEY", "");
    const { AnalyticsConsentBanner: Banner } = await import("./analytics-consent");
    render(<Banner />);

    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => requestAnalyticsPreferences());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks once and stores decline without treating it as a cookie", () => {
    render(<AnalyticsConsentBanner />);

    const dialog = screen.getByRole("dialog", { name: "Anonymous usage analytics" });
    expect(dialog).toBeTruthy();
    expect(screen.getByRole("button", { name: "Decline" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accept" })).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Decline" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY)).toBe("declined");
    expect(document.cookie).toBe("");
  });

  it("hides the banner when Do Not Track or Global Privacy Control is set", () => {
    setPrivacySignals({ doNotTrack: "1" });
    const { unmount } = render(<AnalyticsConsentBanner />);
    expect(screen.queryByRole("dialog")).toBeNull();
    unmount();

    localStorage.clear();
    setPrivacySignals({ doNotTrack: null, globalPrivacyControl: true });
    render(<AnalyticsConsentBanner />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lets the visitor change the choice later", () => {
    localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, "declined");
    render(<AnalyticsConsentBanner />);
    expect(screen.queryByRole("dialog")).toBeNull();

    act(() => requestAnalyticsPreferences());

    expect(screen.getByText("Analytics are off for this browser.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY)).toBe("accepted");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps Accept unavailable while the browser asks not to be tracked", () => {
    localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, "accepted");
    setPrivacySignals({ doNotTrack: "yes" });
    render(<AnalyticsConsentBanner />);

    act(() => requestAnalyticsPreferences());

    expect(screen.getByRole("button", { name: "Accept" })).toHaveProperty("disabled", true);
    expect(screen.getByText(/nothing is sent while it asks not to be tracked/)).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

function setPrivacySignals({
  doNotTrack,
  globalPrivacyControl = false,
}: {
  doNotTrack: string | null;
  globalPrivacyControl?: boolean;
}) {
  Object.defineProperty(navigator, "doNotTrack", {
    configurable: true,
    get: () => doNotTrack,
  });
  Object.defineProperty(navigator, "globalPrivacyControl", {
    configurable: true,
    get: () => globalPrivacyControl,
  });
}
