#!/usr/bin/env node
// Reverse proxy for UI screenshots: forwards everything to the real server except /api/workspace,
// which is answered from fixtures.mjs with in-memory state (edits persist until restart).
// Usage: node mock-proxy.mjs --port 8011 --target http://127.0.0.1:8001 --scenario full [--latency 400]
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { initialState, funnelFor, SCENARIOS } from './fixtures.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []));
const PORT = Number(args.port || 8011);
const TARGET = new URL(args.target || 'http://127.0.0.1:8001');
const SCENARIO = args.scenario || 'full';
const LATENCY = Number(args.latency || 0);
if (!SCENARIOS.includes(SCENARIO)) { console.error(`scenario must be one of ${SCENARIOS.join(', ')}`); process.exit(64); }

const state = initialState(SCENARIO);
const nowIso = () => new Date().toISOString();
const find = (id, kind) => state.records.find((r) => r.id === id && (!kind || r.kind === kind));
const projects = () => state.records.filter((r) => r.kind === 'project');

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function forward(req, res, bodyBuf) {
  const headers = { ...req.headers, host: TARGET.host };
  if (headers.origin) headers.origin = TARGET.origin;
  const up = http.request({ hostname: TARGET.hostname, port: TARGET.port, path: req.url, method: req.method, headers }, (upRes) => {
    const out = { ...upRes.headers };
    if (out.location) out.location = out.location.replace(TARGET.origin, `http://${req.headers.host}`);
    res.writeHead(upRes.statusCode || 502, out);
    upRes.pipe(res);
  });
  up.on('error', (e) => send(res, 502, { error: `mock-proxy: upstream ${TARGET.origin} недоступен (${e.code})` }));
  if (bodyBuf) up.end(bodyBuf); else req.pipe(up);
}

// Auth stays real: ask the server for the session envelope (workspace, me), replace data fields.
function upstreamGet(req) {
  return new Promise((resolve) => {
    const up = http.request({ hostname: TARGET.hostname, port: TARGET.port, path: '/api/workspace', method: 'GET', headers: { cookie: req.headers.cookie || '', host: TARGET.host } }, (r) => {
      let buf = ''; r.on('data', (c) => { buf += c; }); r.on('end', () => { try { resolve({ status: r.statusCode, body: JSON.parse(buf) }); } catch { resolve({ status: 502, body: { error: 'mock-proxy: bad upstream JSON' } }); } });
    });
    up.on('error', () => resolve({ status: 502, body: { error: 'mock-proxy: upstream down' } }));
    up.end();
  });
}

async function handleGet(req, res) {
  const up = await upstreamGet(req);
  if (up.status !== 200) return send(res, up.status, up.body);
  if (SCENARIO === 'error') return send(res, 500, { error: 'Не удалось загрузить данные. Повторите попытку.' });
  const records = [...state.records].sort((a, b) => b.created.localeCompare(a.created));
  send(res, 200, { ...up.body, records, telegramConnected: state.telegramConnected, ai: state.ai });
}

function patchLead(id, patch) {
  const r = find(id, 'lead');
  if (!r) return null;
  r.data = { ...r.data, ...patch };
  return r;
}

const DRAFTS = {
  reply: 'Добрый день. Видел ваш вопрос в чате: мы как раз этим занимаемся, можем посчитать стоимость под ваш объём. Удобно, если пришлю расчёт сюда?',
  dm: 'Здравствуйте. Пишу по вашему сообщению в чате селлеров: подскажу по условиям и срокам, если расскажете про объём и категорию товара.',
  followup: 'Напомню о себе: расчёт под ваш объём ещё актуален, могу прислать его сегодня.',
};

const ACTIONS = {
  save(b) {
    const id = b.id || randomUUID();
    const r = find(id);
    if (r) r.data = { ...r.data, ...b.data };
    else state.records.push({ id, kind: b.kind, data: b.data || {}, created: nowIso(), hasSecret: !!b.secret });
    return [200, { ok: true, id }];
  },
  delete(b) {
    const before = state.records.length;
    state.records = state.records.filter((r) => !(r.id === b.id && r.kind === b.kind));
    return before === state.records.length ? [404, { error: 'Запись не найдена' }] : [200, { ok: true }];
  },
  project_create(b) {
    const record = { id: randomUUID(), kind: 'project', data: { ...(b.data || {}), updatedAt: nowIso() }, created: nowIso(), hasSecret: false };
    state.records.push(record);
    return [200, { ok: true, id: record.id, record }];
  },
  project_update(b) {
    const r = find(b.id, 'project');
    if (!r) return [404, { error: 'Проект не найден' }];
    r.data = { ...r.data, ...(b.patch || {}), updatedAt: nowIso() };
    return [200, { ok: true, id: r.id, record: r }];
  },
  project_delete(b) {
    if (!find(b.id, 'project')) return [404, { error: 'Проект не найден' }];
    if (b.moveToProjectId && !find(b.moveToProjectId, 'project')) return [400, { error: 'Проект для переноса не найден' }];
    const moved = { groups: 0, leads: 0 };
    for (const r of state.records) {
      if ((r.kind === 'group' || r.kind === 'lead') && r.data.projectId === b.id) {
        r.data = { ...r.data, projectId: b.moveToProjectId || '' };
        moved[r.kind === 'group' ? 'groups' : 'leads'] += 1;
      }
    }
    state.records = state.records.filter((r) => r.id !== b.id);
    return [200, { ok: true, moved }];
  },
  set_group_project(b) {
    if (b.projectId && !find(b.projectId, 'project')) return [404, { error: 'Проект не найден' }];
    let updated = 0;
    for (const id of b.groupIds || []) { const g = find(id, 'group'); if (g) { g.data = { ...g.data, projectId: b.projectId || '' }; updated += 1; } }
    return [200, { ok: true, updated }];
  },
  funnel(b) {
    if (SCENARIO === 'error') return [500, { error: 'Не удалось посчитать воронку. Повторите попытку.' }];
    const projectId = b.projectId || projects()[0]?.id;
    if (projectId && !find(projectId, 'project')) return [404, { error: 'Проект не найден' }];
    return [200, funnelFor(SCENARIO, projectId, Number(b.days) === 1 ? 1 : 7)];
  },
  lead_feedback(b) {
    const r = patchLead(b.id, { feedback: b.verdict, feedbackAt: nowIso() });
    return r ? [200, { ok: true, lead: r.data }] : [404, { error: 'Лид не найден' }];
  },
  draft(b) {
    if (!state.ai.hasEnvKey) return [409, { error: 'DeepSeek не настроен: добавьте AI_API_KEY в .env и перезапустите сервер' }];
    const draft = DRAFTS[b.kind] || DRAFTS.reply;
    const r = patchLead(b.id, { draft, draftKind: b.kind || '' });
    return r ? [200, { ok: true, draft, model: 'deepseek-chat' }] : [404, { error: 'Лид не найден' }];
  },
  dismiss_draft(b) {
    const r = patchLead(b.id, { draft: '', draftKind: '' });
    return r ? [200, { ok: true, lead: r.data }] : [404, { error: 'Лид не найден' }];
  },
  send_lead_message(b) {
    const r = find(b.id, 'lead');
    if (!r) return [404, { error: 'Лид не найден' }];
    const reply = { text: String(b.text || r.data.draft || ''), mode: b.mode || 'dm', at: nowIso(), ok: true, error: '', messageId: String(Date.now() % 100000), link: '', chatId: '', from: 'us', status: 'sent', accountId: r.data.accountId || '' };
    patchLead(b.id, { replies: [...(r.data.replies || []), reply], conversationOpen: true, conversationAt: nowIso(), draft: '', draftKind: '' });
    return [200, { ok: true, lead: r.data, mode: reply.mode, link: '', messageId: reply.messageId, accountId: reply.accountId }];
  },
  mark_lead_viewed(b) {
    const r = patchLead(b.id, { viewed: true, viewedAt: nowIso() });
    return r ? [200, { ok: true, lead: r.data }] : [404, { error: 'Лид не найден' }];
  },
  rebuild_product(b) {
    const p = find(b.projectId, 'project') || projects()[0];
    if (!p) return [404, { error: 'Проект не найден' }];
    if (!state.ai.hasEnvKey) return [409, { error: 'DeepSeek не настроен: добавьте AI_API_KEY в .env и перезапустите сервер' }];
    p.data = { ...p.data, updatedAt: nowIso() };
    return [200, { ok: true, id: p.id, data: p.data }];
  },
  rescan_groups() { return [200, { ok: true, scanned: state.records.filter((r) => r.kind === 'group').length, added: 0, matched: 0 }]; },
  poll_dm_replies() { return [200, { ok: true, opened: 0, skipped: true, reason: 'mock' }]; },
  heal_group_join_state() { return [200, { ok: true, fixed: 0 }]; },
};

async function handlePost(req, res) {
  const chunks = []; for await (const c of req) chunks.push(c);
  let b; try { b = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return send(res, 400, { error: 'Некорректный запрос' }); }
  const fn = ACTIONS[b.action];
  if (!fn) return send(res, 200, { ok: true, mocked: true });
  const [status, body] = fn(b);
  console.log(`[mock] POST ${b.action} -> ${status}`);
  send(res, status, body);
}

http.createServer(async (req, res) => {
  const pathname = (req.url || '/').split('?')[0];
  if (pathname !== '/api/workspace') return forward(req, res);
  if (LATENCY) await new Promise((r) => setTimeout(r, LATENCY));
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  return forward(req, res);
}).listen(PORT, '127.0.0.1', () => console.log(`mock-proxy :${PORT} -> ${TARGET.origin} scenario=${SCENARIO}${LATENCY ? ` latency=${LATENCY}ms` : ''}`));
