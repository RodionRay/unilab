import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(path.resolve(__dirname, "..", "app/app/page.tsx"), "utf8");

function functionBody(name: string): string {
  const start = page.indexOf(`async function ${name}(`);
  expect(start, `${name} is defined`).toBeGreaterThan(-1);
  const next = page.indexOf("\n  async function ", start + 1);
  return page.slice(start, next === -1 ? undefined : next);
}

describe("group row: manual join of a channel's discussion", () => {
  it("row shows «Вступить в обсуждение» only for needDiscussionJoin, locked while a join runs", () => {
    const button = /\{r\.data\.needDiscussionJoin&&[\s\S]{0,400}?disabled=\{[^}]*joinInFlight[^}]*\}[\s\S]{0,120}?onClick=\{\(\)=>joinDiscussion\(r\)\}[\s\S]{0,120}?Вступить в обсуждение/;
    expect(page).toMatch(button);
  });

  it("joinDiscussion posts join_group with target discussion under the shared join lock", () => {
    const body = functionBody("joinDiscussion");
    expect(body).toMatch(/if\(joinLock\.current\)/);
    expect(body).toMatch(/action:'join_group',id:item\.id,target:'discussion'/);
    expect(body).toMatch(/joinLock\.current=false/);
    expect(body).toMatch(/setJoinInFlight\(false\)/);
  });
});
