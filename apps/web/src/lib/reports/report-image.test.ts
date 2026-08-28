import { describe, expect, it } from "vitest";

import { fitReportImage } from "./report-image";

describe("fitReportImage", () => {
  it("leaves safe images unchanged", () => {
    expect(fitReportImage(1200, 800)).toEqual({ width: 1200, height: 800 });
  });

  it("limits the longest edge while preserving aspect ratio", () => {
    expect(fitReportImage(5120, 2560)).toEqual({ width: 2560, height: 1280 });
  });

  it("limits total pixels for unusually square images", () => {
    const result = fitReportImage(4000, 4000);
    expect(result.width).toBe(result.height);
    expect(result.width * result.height).toBeLessThanOrEqual(6_000_000);
  });
});
