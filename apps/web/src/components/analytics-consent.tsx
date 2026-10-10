import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { setAnalyticsConsent } from "@/lib/analytics";
import {
  analyticsConfigured,
  currentAnalyticsDecision,
  onAnalyticsPreferencesRequest,
  privacySignalDeclines,
  readStoredConsent,
  type AnalyticsConsent,
} from "@/lib/analytics-consent";

type BannerMode = "hidden" | "prompt" | "preferences";

export function AnalyticsConsentBanner() {
  const titleId = useId();
  const descriptionId = useId();
  const statusId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<BannerMode>(() =>
    currentAnalyticsDecision() === "prompt" ? "prompt" : "hidden",
  );

  useEffect(() => {
    return onAnalyticsPreferencesRequest(() => {
      if (!analyticsConfigured()) return;
      setMode("preferences");
    });
  }, []);

  useEffect(() => {
    if (mode === "hidden") return;
    const dialog = dialogRef.current;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && mode === "preferences") {
        event.preventDefault();
        setMode("hidden");
        return;
      }
      if (event.key !== "Tab" || mode !== "preferences" || !dialog) return;

      const focusable = [...dialog.querySelectorAll<HTMLElement>("button:not(:disabled)")];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (mode === "preferences" && previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [mode]);

  if (!analyticsConfigured() || mode === "hidden") return null;

  const stored = readStoredConsent();
  const privacyDeclined = privacySignalDeclines();
  const choose = (choice: AnalyticsConsent) => {
    setAnalyticsConsent(choice);
    setMode("hidden");
  };

  return (
    <>
      {mode === "preferences" && (
        <div
          className="fixed inset-0 z-[60] bg-[#17352b]/35 backdrop-blur-sm"
          onClick={() => setMode("hidden")}
          aria-hidden="true"
        />
      )}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[61] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal={mode === "preferences"}
          aria-labelledby={titleId}
          aria-describedby={mode === "preferences" ? `${descriptionId} ${statusId}` : descriptionId}
          tabIndex={-1}
          className="pointer-events-auto relative mx-auto flex max-w-3xl flex-col gap-4 rounded-[1.75rem] border border-[#17352b]/10 bg-white p-5 shadow-[0_18px_50px_rgba(23,53,43,0.16)] outline-none sm:flex-row sm:items-end sm:justify-between"
        >
          <div className={mode === "preferences" ? "pr-10" : undefined}>
            <h2 id={titleId} className="text-sm font-black tracking-[-0.03em]">
              Anonymous usage analytics
            </h2>
            <p id={descriptionId} className="mt-1 max-w-xl text-xs leading-5 text-[#567166]">
              Count anonymous events, such as whether a scan finished, to improve Scanme. No
              images, filenames, barcode values, or cookies. PostHog loads only if you accept. The
              choice is saved in this browser.
            </p>
            {mode === "preferences" && (
              <p id={statusId} className="mt-2 text-xs leading-5 font-semibold text-[#24483b]">
                {statusMessage(stored, privacyDeclined)}
              </p>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => choose("declined")}
              className="inline-flex h-11 flex-1 items-center justify-center rounded-full border border-[#17352b]/15 bg-white px-5 text-sm font-bold text-[#17352b] transition hover:bg-[#f5f4ee] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f35f32] sm:flex-none"
            >
              Decline
            </button>
            <button
              type="button"
              onClick={() => choose("accepted")}
              disabled={privacyDeclined}
              className="inline-flex h-11 flex-1 items-center justify-center rounded-full bg-[#17352b] px-5 text-sm font-bold text-white transition hover:bg-[#244b3c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f35f32] disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
            >
              Accept
            </button>
          </div>
          {mode === "preferences" && (
            <button
              type="button"
              onClick={() => setMode("hidden")}
              className="absolute top-3 right-3 grid size-9 place-items-center rounded-full text-[#789087] transition hover:bg-[#17352b]/8 hover:text-[#17352b] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f35f32]"
              aria-label="Close analytics preferences"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function statusMessage(stored: AnalyticsConsent | null, privacyDeclined: boolean): string {
  if (privacyDeclined && stored === "accepted") {
    return "You allowed analytics in this browser, but nothing is sent while it asks not to be tracked.";
  }
  if (privacyDeclined) {
    return "This browser asked not to be tracked, so nothing is sent.";
  }
  if (stored === "accepted") return "Analytics are on for this browser.";
  return "Analytics are off for this browser.";
}
