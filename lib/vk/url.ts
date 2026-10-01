/**
 * VK community links (spec vk-lead-source REQ-4): `vk.com/<screen_name>`, `club<id>`,
 * `public<id>`, `event<id>`, with or without scheme, `m.`/`www.` prefixes or the `vk.ru` mirror.
 * A screen name still needs utils.resolveScreenName; numeric forms are final.
 */

export type VkGroupRef = {kind: 'id'; groupId: number} | {kind: 'screen_name'; screenName: string};

const HOSTS = new Set(['vk.com', 'm.vk.com', 'www.vk.com', 'vk.ru', 'm.vk.ru', 'www.vk.ru']);
const NUMERIC_RE = /^(?:club|public|event)(\d{1,12})$/;
// VK screen names: latin letters, digits, '_' and '.', 2..64 chars.
const SCREEN_NAME_RE = /^[a-z0-9_.]{2,64}$/;
// Site sections and user pages that are never communities.
const RESERVED = new Set(['feed', 'im', 'search', 'groups', 'friends', 'audio', 'video', 'apps', 'settings', 'wall', 'away.php', 'login']);

function pathOf(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!HOSTS.has(url.hostname.toLowerCase())) return null;
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
  const segments = url.pathname.split('/').filter(Boolean);
  return segments.length === 1 ? segments[0].toLowerCase() : null;
}

/** Parses a community link, or null when it is not one (user page, other site, deep path). */
export function parseVkGroupUrl(input: string): VkGroupRef | null {
  const name = pathOf(input);
  if (!name) return null;
  const numeric = NUMERIC_RE.exec(name);
  if (numeric) {
    const groupId = Number(numeric[1]);
    return groupId > 0 ? {kind: 'id', groupId} : null;
  }
  if (/^id\d+$/.test(name) || RESERVED.has(name) || !SCREEN_NAME_RE.test(name)) return null;
  return {kind: 'screen_name', screenName: name};
}

/** The one canonical form used for duplicate checks and links: by numeric id. */
export function canonicalVkGroupUrl(groupId: number): string {
  if (!Number.isInteger(groupId) || groupId <= 0) throw new RangeError('VK group id must be a positive integer');
  return `https://vk.com/club${groupId}`;
}
