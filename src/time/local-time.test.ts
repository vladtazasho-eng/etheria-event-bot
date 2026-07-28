import assert from "node:assert/strict";
import test from "node:test";
import { parseLocalStartTime } from "./local-time.js";

test("parses a Kyiv summer time", () => {
  const result = parseLocalStartTime("31.07.2026", "20:00", "Europe/Kyiv");
  assert.equal(new Date(result.timestamp).toISOString(), "2026-07-31T17:00:00.000Z");
});

test("accepts ISO-like date input", () => {
  const result = parseLocalStartTime("2026-12-15", "19:30", "Europe/Kyiv");
  assert.equal(new Date(result.timestamp).toISOString(), "2026-12-15T17:30:00.000Z");
});

test("rejects impossible dates", () => {
  assert.throws(
    () => parseLocalStartTime("31.02.2026", "20:00", "Europe/Kyiv"),
    /Невірна дата/,
  );
});
