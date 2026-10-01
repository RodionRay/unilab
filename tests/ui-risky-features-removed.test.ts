import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_NAV,
  parseWorkspaceView,
} from "@/components/product/workspace-nav";
import {
  aboutLong,
  contactTasks,
  faqs,
  fitHas,
  SITE_DESCRIPTION,
  tasks,
} from "@/components/marketing/content";

const root = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("workspace UI without bulk Telegram actions (REQ-9)", () => {
  it("nav has no audience, invite or mailing sections", () => {
    const names = DEFAULT_NAV.map((n) => n.name as string);
    expect(names).not.toContain("Сбор аудитории");
    expect(names).not.toContain("Инвайтинг");
    expect(names).not.toContain("Рассылка");
    expect(names).toContain("Группы и каналы");
  });

  it("old deep links to removed sections fall back to the overview", () => {
    expect(parseWorkspaceView("audience")).toBe("Обзор");
    expect(parseWorkspaceView("invite")).toBe("Обзор");
    expect(parseWorkspaceView("mailing")).toBe("Обзор");
    expect(parseWorkspaceView("groups")).toBe("Группы и каналы");
  });

  it("workspace page calls no removed API actions and keeps per-group join", () => {
    const page = read("app/app/page.tsx");
    for (const action of [
      "enqueue_joins",
      "heal_dead_group_accounts",
      "refill_mailing_ai_pool",
      "tick_audience",
      "tick_invite",
      "tick_mailing",
      "start_audience",
      "start_invite",
      "start_mailing",
      "export_audience",
    ]) {
      expect(page, action).not.toContain(`'${action}'`);
    }
    expect(page).not.toContain("mode:'mix'");
    expect(page).not.toContain("Вступить во все");
    expect(page).not.toContain("unilab.joinQueue");
    expect(page).toContain("action:'join_group'");
    expect(page).toContain("action:'poll_dm_replies'");
  });

  it("join states of the removed background queue have no UI (no hidden «Вступить»)", () => {
    const page = read("app/app/page.tsx");
    expect(page).not.toContain("'queued'");
    expect(page).not.toContain("'waiting'");
    expect(page).not.toContain("В очереди");
  });

  it("every «Вступить» button is locked while one manual join is in flight", () => {
    const page = read("app/app/page.tsx");
    const joinButtons = [...page.matchAll(/disabled=\{([^}]*)\}\s*onClick=\{\(\)=>\{?[^}]*joinGroup\(/g)];
    expect(joinButtons.length).toBe(2);
    for (const [, disabled] of joinButtons) expect(disabled).toContain("joinInFlight");
    expect(page).toContain("if(joinLock.current)");
  });

  it("removed panels are gone from the component tree", () => {
    for (const file of ["audience-panel", "invite-panel", "mailing-panel"]) {
      expect(() => read(`components/product/${file}.tsx`)).toThrow();
    }
  });
});

describe("marketing copy does not advertise removed features (REQ-10)", () => {
  const advertised = [
    SITE_DESCRIPTION,
    aboutLong.split("\n\n")[0]!,
    ...fitHas,
    ...tasks.map((t) => `${t.title} ${t.does}`),
    ...faqs.map((f) => f.a),
    ...contactTasks.map((t) => t.label),
  ].join("\n");

  it.each(["очередь вступлений", "Сбор аудитории", "инвайтинг и рассылка", "рассылка по сегменту"])(
    "no promise of «%s»",
    (phrase) => {
      expect(advertised.toLowerCase()).not.toContain(phrase.toLowerCase());
    },
  );

  it("contact form offers no audience/invite topic", () => {
    expect(contactTasks.map((t) => t.id)).not.toContain("audience");
  });
});
