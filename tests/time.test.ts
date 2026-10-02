import { describe, expect, it } from "vitest";
import { utcToZonedInput, zonedLocalToUtc } from "@/lib/time";

describe("league timezone conversion", () => {
  it("converts winter and summer wall times in New York", () => {
    expect(zonedLocalToUtc("2026-01-15T20:00", "America/New_York").toISOString()).toBe(
      "2026-01-16T01:00:00.000Z",
    );
    expect(zonedLocalToUtc("2026-07-15T20:00", "America/New_York").toISOString()).toBe(
      "2026-07-16T00:00:00.000Z",
    );
  });
  it("round-trips a deadline across the spring-forward boundary", () => {
    const local = "2026-03-08T09:30";
    const instant = zonedLocalToUtc(local, "America/New_York");
    expect(utcToZonedInput(instant, "America/New_York")).toBe(local);
  });
});
