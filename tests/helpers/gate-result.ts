/** Narrows a `{ ok: true } | { ok: false; reason }` gate result; throws when the gate unexpectedly passed. */
export function blockReason<R extends string>(result: { ok: true } | { ok: false; reason: R }): R {
  if (result.ok) throw new Error("expected the gate to block, but it passed");
  return result.reason;
}
