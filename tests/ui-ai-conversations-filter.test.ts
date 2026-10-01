import { describe, expect, it } from "vitest";
import { isAwaitingApproval, isInConversations } from "@/components/product/ai/model";

// REQ-20: auto drafts wait in the AI page queue; «Переписки» shows open conversations and manual drafts only.
describe("REQ-20 «Переписки» vs approval queue", () => {
  it("keeps a lead with only an auto draft out of «Переписки» and in the queue", () => {
    const lead = { draft: "Здравствуйте!", draftKind: "group_reply" };
    expect(isInConversations(lead)).toBe(false);
    expect(isAwaitingApproval(lead)).toBe(true);
  });

  it("shows a manual draft (no draftKind) in «Переписки», not in the queue", () => {
    const lead = { draft: "Ручной ответ" };
    expect(isInConversations(lead)).toBe(true);
    expect(isAwaitingApproval(lead)).toBe(false);
  });

  it("shows an open conversation even while an auto draft waits", () => {
    expect(isInConversations({ conversationOpen: true, draft: "Ещё", draftKind: "dm_continue" })).toBe(true);
  });

  it("hides leads excluded from training and leads without a draft or conversation", () => {
    expect(isInConversations({ excludeFromTraining: true, conversationOpen: true })).toBe(false);
    expect(isInConversations({ draft: "   " })).toBe(false);
    expect(isAwaitingApproval({ draft: " ", draftKind: "dm_first" })).toBe(false);
  });
});
