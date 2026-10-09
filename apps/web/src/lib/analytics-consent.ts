export const ANALYTICS_CONSENT_STORAGE_KEY = "scanme:analytics-consent";

export type AnalyticsConsent = "accepted" | "declined";
export type AnalyticsDecision = "accepted" | "declined" | "prompt" | "off";

export type PrivacySignals = {
  doNotTrack?: string | null;
  legacyDoNotTrack?: string | null;
  globalPrivacyControl?: boolean;
};

type ConsentStorage = Pick<Storage, "getItem" | "setItem">;

const preferenceListeners = new Set<() => void>();

export function analyticsConfigured(
  key: string | undefined = import.meta.env.VITE_PUBLIC_POSTHOG_KEY,
): boolean {
  return typeof key === "string" && key.trim().length > 0;
}

export function privacySignalDeclines(signals: PrivacySignals = readBrowserPrivacySignals()): boolean {
  const values = [signals.doNotTrack, signals.legacyDoNotTrack];
  for (const value of values) {
    const normalized = value?.trim().toLowerCase();
    if (normalized === "1" || normalized === "yes") return true;
  }
  return signals.globalPrivacyControl === true;
}

export function parseStoredConsent(value: string | null): AnalyticsConsent | null {
  if (value === "accepted" || value === "declined") return value;
  return null;
}

export function analyticsDecision(input: {
  configured: boolean;
  stored: AnalyticsConsent | null;
  privacyDeclined: boolean;
}): AnalyticsDecision {
  if (!input.configured) return "off";
  if (input.privacyDeclined) return "declined";
  if (input.stored) return input.stored;
  return "prompt";
}

export function createConsentStore(storage: ConsentStorage | null): {
  read: () => AnalyticsConsent | null;
  write: (choice: AnalyticsConsent) => void;
} {
  let memory: AnalyticsConsent | null = null;
  let useMemory = storage === null;

  return {
    read() {
      if (useMemory) return memory;
      if (!storage) return null;
      try {
        return parseStoredConsent(storage.getItem(ANALYTICS_CONSENT_STORAGE_KEY));
      } catch {
        return memory;
      }
    },
    write(choice) {
      memory = choice;
      if (!storage) {
        useMemory = true;
        return;
      }
      try {
        storage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, choice);
        useMemory = false;
      } catch {
        useMemory = true;
      }
    },
  };
}

const browserStore = createConsentStore(browserStorage());

export function readStoredConsent(): AnalyticsConsent | null {
  return browserStore.read();
}

export function writeStoredConsent(choice: AnalyticsConsent): void {
  browserStore.write(choice);
}

export function currentAnalyticsDecision(): AnalyticsDecision {
  return analyticsDecision({
    configured: analyticsConfigured(),
    stored: readStoredConsent(),
    privacyDeclined: privacySignalDeclines(),
  });
}

export function requestAnalyticsPreferences(): void {
  for (const listener of preferenceListeners) listener();
}

export function onAnalyticsPreferencesRequest(listener: () => void): () => void {
  preferenceListeners.add(listener);
  return () => {
    preferenceListeners.delete(listener);
  };
}

function browserStorage(): ConsentStorage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function readBrowserPrivacySignals(): PrivacySignals {
  if (typeof navigator === "undefined") return {};
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  const legacy =
    typeof window === "undefined"
      ? null
      : (window as Window & { doNotTrack?: string | null }).doNotTrack;
  return {
    doNotTrack: nav.doNotTrack,
    legacyDoNotTrack: legacy,
    globalPrivacyControl: nav.globalPrivacyControl === true,
  };
}
