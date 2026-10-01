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

describe("groups view moves groups between projects (REQ-3)", () => {
  const groupsView = (): string => {
    const start = page.indexOf("const renderConnectedGroups");
    expect(start).toBeGreaterThan(0);
    return page.slice(start, page.indexOf("const allLeads=", start));
  };
  const actionbar = (): string => {
    const start = page.indexOf('<div className={`groups-actionbar');
    expect(start).toBeGreaterThan(0);
    return page.slice(start, page.indexOf('<section className="panel groups-list-panel">', start));
  };

  it("one action sends set_group_project with the group ids and the project", () => {
    const start = page.indexOf("async function moveGroupsToProject");
    expect(start).toBeGreaterThan(0);
    const body = page.slice(start, page.indexOf("\n  }\n", start));
    expect(body).toContain("action:'set_group_project',groupIds,projectId");
  });

  it("each row has a project select only when there are at least 2 projects", () => {
    const view = groupsView();
    expect(view).toMatch(/projects\.length>=2&&\(/);
    expect(view).toContain("projectIdOf(r.data,projects)");
    expect(view).toContain("moveGroupsToProject([r.id],");
  });

  it("the action bar moves the selected groups, only with at least 2 projects", () => {
    const bar = actionbar();
    expect(bar).toMatch(/projects\.length>=2&&\(/);
    expect(bar).toContain("moveGroupsToProject(groupSelected,");
  });
});
