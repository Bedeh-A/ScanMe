import { describe, expect, it } from "vitest";

import { retainedHistory, type HistoryEntry } from "./history";

function entry(id: string, createdAt: number): HistoryEntry {
  return {
    id,
    createdAt,
    source: "paste",
    results: [{ text: id, format: "QRCode" }],
  };
}

describe("retainedHistory", () => {
  it("drops scans older than 30 days and sorts newest first", () => {
    const now = Date.UTC(2026, 7, 28);
    const day = 24 * 60 * 60 * 1000;

    expect(
      retainedHistory(
        [entry("yesterday", now - day), entry("expired", now - 31 * day), entry("today", now)],
        now,
      ).map(({ id }) => id),
    ).toEqual(["today", "yesterday"]);
  });

  it("keeps at most 50 scans", () => {
    const now = Date.now();
    const entries = Array.from({ length: 60 }, (_, index) => entry(String(index), now - index));

    expect(retainedHistory(entries, now)).toHaveLength(50);
  });
});
