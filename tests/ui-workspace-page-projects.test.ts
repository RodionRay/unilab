import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** app/app/page.tsx after lead core v2: project fields live only in `project` (REQ-4). */
const page = readFileSync(path.resolve(__dirname, "..", "app/app/page.tsx"), "utf8");

const settingsDefaults = (): string => {
  const start = page.indexOf("  settings:{");
  const end = page.indexOf("\n  },\n};", start);
  expect(start).toBeGreaterThan(0);
  return page.slice(start, end);
};

describe("settings page carries no project fields (REQ-4)", () => {
  it("has no scan depth input: depth is a project card field", () => {
    expect(page).not.toContain("Глубина, дней");
    expect(page).not.toContain("genSettings.scanDepthDays");
  });

  it("default settings have no product / keyword / training fields and no Uniseller texts", () => {
    const defaults = settingsDefaults();
    for (const key of [
      "product", "projectUrl", "audience", "leadCriteria", "keywords", "minusKeywords", "tone", "cta", "pains",
      "valueProps", "avoidTopics", "hotSignals", "productNotes", "learnExamples", "aiQualify", "lastMinusAdded",
      "lastMinusAddedAt", "scanDepthDays",
    ]) {
      expect(defaults, key).not.toMatch(new RegExp(`\\b${key}:`));
    }
    expect(page).not.toContain("МойСклад, 1С");
  });

  it("a general settings save sends only settings fields, not the stored project fields", () => {
    const start = page.indexOf("async function saveGeneralSettings");
    const body = page.slice(start, page.indexOf("async function testNotify", start));
    expect(body).not.toContain("...(settings?.data||{})");
    expect(body).not.toContain("...defaults.settings");
  });
});
