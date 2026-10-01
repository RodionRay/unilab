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
// Every POST /api/workspace body with its answer status; read by e2e-ai.mjs via GET /__mock/log, cleared by DELETE.
let postLog = [];
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
  const workspace = state.workspace ? { ...up.body.workspace, ...state.workspace } : up.body.workspace;
  send(res, 200, { ...up.body, workspace, records, telegramConnected: state.telegramConnected, ai: state.ai });
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
    return [200, { ok: true, id: record.id, project: record.data }];
  },
  project_update(b) {
    const r = find(b.id, 'project');
    if (!r) return [404, { error: 'Проект не найден' }];
    r.data = { ...r.data, ...(b.patch || {}), updatedAt: nowIso() };
    return [200, { ok: true, id: r.id, project: r.data }];
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
    return [200, { ok: true, id: b.id, moved: moved.groups + moved.leads, moveToProjectId: b.moveToProjectId || projects()[0]?.id }];
  },
  set_group_project(b) {
    if (b.projectId && !find(b.projectId, 'project')) return [404, { error: 'Проект не найден' }];
    let updated = 0;
    for (const id of b.groupIds || []) { const g = find(id, 'group'); if (g) { g.data = { ...g.data, projectId: b.projectId || '' }; updated += 1; } }
    return [200, { ok: true, projectId: b.projectId, updated }];
  },
  funnel(b) {
    if (SCENARIO === 'error') return [500, { error: 'Не удалось посчитать воронку. Повторите попытку.' }];
    const projectId = b.projectId || projects()[0]?.id;
    if (projectId && !find(projectId, 'project')) return [404, { error: 'Проект не найден' }];
    const body = funnelFor(SCENARIO, projectId, Number(b.days) === 1 ? 1 : 7);
    return [200, body];
  },
  lead_feedback(b) {
    const lead = find(b.id, 'lead');
    if (!lead) return [404, { error: 'Лид не найден' }];
    const project = find(lead.data.projectId, 'project') || projects()[0];
    const key = b.verdict === 'good' ? 'goodExamples' : 'badExamples';
    const list = [...(project.data[key] || []), String(lead.data.message || '').slice(0, 300)].slice(-10);
    project.data = { ...project.data, [key]: list, updatedAt: nowIso() };
    patchLead(b.id, { feedback: b.verdict, ...(b.verdict === 'bad' && !lead.data.viewed ? { viewed: true, viewedAt: nowIso() } : {}) });
    return [200, { ok: true, lead: lead.data, projectId: project.id, project: project.data }];
  },
  draft(b) {
    if (!state.ai.hasEnvKey) return [409, { error: 'DeepSeek не настроен: добавьте AI_API_KEY в .env и перезапустите сервер' }];
    const kind = ['group_reply', 'dm_first', 'dm_continue'].includes(b.kind) ? b.kind : null;
    const draft = { group_reply: DRAFTS.reply, dm_first: DRAFTS.dm, dm_continue: DRAFTS.followup }[kind] || DRAFTS.reply;
    const lead = find(b.id, 'lead');
    if (!lead) return [404, { error: 'Лид не найден' }];
    const { draftKind: _old, ...rest } = lead.data;
    lead.data = kind ? { ...rest, draft, draftKind: kind } : { ...rest, draft };
    return [200, { ok: true, draft, kind, model: 'deepseek-chat' }];
  },
  dismiss_draft(b) {
    const lead = find(b.id, 'lead');
    if (!lead) return [404, { error: 'Лид не найден' }];
    const { draftKind: _old, ...rest } = lead.data;
    lead.data = { ...rest, draft: '' };
    return [200, { ok: true, lead: lead.data }];
  },
  send_lead_message(b) {
    const r = find(b.id, 'lead');
    if (!r) return [404, { error: 'Лид не найден' }];
    const reply = { text: String(b.text || r.data.draft || ''), mode: b.mode || 'dm', at: nowIso(), ok: true, error: '', messageId: String(Date.now() % 100000), link: '', chatId: '', from: 'us', status: 'sent', accountId: r.data.accountId || '' };
    const { draftKind: _old, ...rest } = r.data;
    r.data = { ...rest, replies: [...(r.data.replies || []), reply], conversationOpen: true, conversationAt: nowIso(), draft: '' };
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
    return [200, { ok: true, id: p.id, project: p.data }];
  },
  rescan_groups() { return [200, { ok: true, scanned: state.records.filter((r) => r.kind === 'group').length, added: 0, matched: 0 }]; },
  poll_dm_replies() { return [200, { ok: true, opened: 0, skipped: true, reason: 'mock' }]; },
  heal_group_join_state() { return [200, { ok: true, fixed: 0 }]; },
};

// staff-redacted mirrors lib/security/workspace-authz.ts for STAFF_WORKSPACE (ai + groups, no leads/chats).
const LEAD_ACTIONS = new Set(['draft', 'mark_lead_viewed', 'send_lead_message', 'lead_feedback', 'dismiss_draft', 'poll_dm_replies']);
function staffDenial(b) {
  if (SCENARIO !== 'staff-redacted') return '';
  if (LEAD_ACTIONS.has(b.action) || ((b.action === 'save' || b.action === 'delete') && b.kind === 'lead')) return 'Нет доступа к этому разделу. Обратитесь к владельцу кабинета.';
  const patch = b.patch || {};
  if (b.action === 'project_update' && ('goodExamples' in patch || 'badExamples' in patch)) return 'Примеры лидов меняют только сотрудники с доступом к лидам';
  return '';
}
function redactLeadText(body) {
  const next = { ...body };
  for (const key of ['funnel', 'dm']) if (next[key]) next[key] = { ...next[key], samples: {} };
  if (next.project) next.project = { ...next.project, goodExamples: [], badExamples: [] };
  return next;
}

async function handlePost(req, res) {
  const chunks = []; for await (const c of req) chunks.push(c);
  let b; try { b = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return send(res, 400, { error: 'Некорректный запрос' }); }
  const fn = ACTIONS[b.action];
  if (!fn) { postLog.push({ at: nowIso(), status: 200, body: b }); return send(res, 200, { ok: true, mocked: true }); }
  const denied = staffDenial(b);
  if (denied) { postLog.push({ at: nowIso(), status: 403, body: b }); console.log(`[mock] POST ${b.action} -> 403 (${denied})`); return send(res, 403, { error: denied }); }
  const [status, raw] = fn(b);
  postLog.push({ at: nowIso(), status, body: b });
  const body = SCENARIO === 'staff-redacted' ? redactLeadText(raw) : raw;
  console.log(`[mock] POST ${b.action} -> ${status}`);
  send(res, status, body);
}

http.createServer(async (req, res) => {
  const pathname = (req.url || '/').split('?')[0];
  if (pathname === '/__mock/log') {
    if (req.method === 'DELETE') { postLog = []; return send(res, 200, { ok: true }); }
    return send(res, 200, { scenario: SCENARIO, posts: postLog });
  }
  if (pathname !== '/api/workspace') return forward(req, res);
  if (LATENCY) await new Promise((r) => setTimeout(r, LATENCY));
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  return forward(req, res);
}).listen(PORT, '127.0.0.1', () => console.log(`mock-proxy :${PORT} -> ${TARGET.origin} scenario=${SCENARIO}${LATENCY ? ` latency=${LATENCY}ms` : ''}`));
