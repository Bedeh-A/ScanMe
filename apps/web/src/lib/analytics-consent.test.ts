import { describe, expect, it, vi } from "vitest";

import {
  ANALYTICS_CONSENT_STORAGE_KEY,
  analyticsConfigured,
  analyticsDecision,
  createConsentStore,
  onAnalyticsPreferencesRequest,
  parseStoredConsent,
  privacySignalDeclines,
  requestAnalyticsPreferences,
} from "./analytics-consent";

describe("privacySignalDeclines", () => {
  it("treats Do Not Track and Global Privacy Control as decline", () => {
    expect(privacySignalDeclines({ doNotTrack: "1" })).toBe(true);
    expect(privacySignalDeclines({ doNotTrack: "yes" })).toBe(true);
    expect(privacySignalDeclines({ doNotTrack: " YES " })).toBe(true);
    expect(privacySignalDeclines({ legacyDoNotTrack: "1" })).toBe(true);
    expect(privacySignalDeclines({ globalPrivacyControl: true })).toBe(true);
  });

  it("ignores an absent or negative privacy signal", () => {
    expect(privacySignalDeclines({})).toBe(false);
    expect(privacySignalDeclines({ doNotTrack: "0" })).toBe(false);
    expect(privacySignalDeclines({ doNotTrack: "unspecified" })).toBe(false);
    expect(privacySignalDeclines({ doNotTrack: null, globalPrivacyControl: false })).toBe(false);
  });
});

describe("analyticsDecision", () => {
  it("stays off and does not prompt when analytics are not configured", () => {
    expect(analyticsConfigured(undefined)).toBe(false);
    expect(analyticsConfigured("")).toBe(false);
    expect(analyticsConfigured("  ")).toBe(false);
    expect(
      analyticsDecision({ configured: false, stored: null, privacyDeclined: false }),
    ).toBe("off");
  });

  it("prompts only when a key is set and there is no choice or privacy signal", () => {
    expect(analyticsConfigured("phc_test")).toBe(true);
    expect(analyticsDecision({ configured: true, stored: null, privacyDeclined: false })).toBe(
      "prompt",
    );
  });

  it("uses an explicit stored choice", () => {
    expect(analyticsDecision({ configured: true, stored: "accepted", privacyDeclined: false })).toBe(
      "accepted",
    );
    expect(analyticsDecision({ configured: true, stored: "declined", privacyDeclined: false })).toBe(
      "declined",
    );
  });

  it("lets a privacy signal decline even after a stored accept", () => {
    expect(analyticsDecision({ configured: true, stored: "accepted", privacyDeclined: true })).toBe(
      "declined",
    );
    expect(analyticsDecision({ configured: true, stored: null, privacyDeclined: true })).toBe(
      "declined",
    );
  });
});

describe("consent storage", () => {
  it("stores the choice in the provided storage, not a cookie", () => {
    const storage = memoryStorage();
    const store = createConsentStore(storage);

    expect(parseStoredConsent(null)).toBeNull();
    expect(parseStoredConsent("maybe")).toBeNull();
    expect(store.read()).toBeNull();

    store.write("accepted");
    expect(storage.getItem(ANALYTICS_CONSENT_STORAGE_KEY)).toBe("accepted");
    expect(store.read()).toBe("accepted");

    store.write("declined");
    expect(store.read()).toBe("declined");
  });

  it("keeps the choice in memory when storage is unavailable", () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error("blocked");
      }),
      setItem: vi.fn(() => {
        throw new Error("blocked");
      }),
    };
    const store = createConsentStore(storage);

    store.write("declined");
    expect(store.read()).toBe("declined");

    const memoryOnly = createConsentStore(null);
    expect(memoryOnly.read()).toBeNull();
    memoryOnly.write("accepted");
    expect(memoryOnly.read()).toBe("accepted");
  });
});

describe("analytics preferences", () => {
  it("notifies listeners when preferences are requested", () => {
    const listener = vi.fn();
    const unsubscribe = onAnalyticsPreferencesRequest(listener);

    requestAnalyticsPreferences();
    unsubscribe();
    requestAnalyticsPreferences();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> & {
  getItem: (key: string) => string | null;
} {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}
