# Mock workspace harness (AI page redesign, lead core v2)
Real server for auth and assets; `/api/workspace` GET/POST answered from `fixtures.mjs` (in-memory, reset on restart).
`H=<worktree>/artifacts/ui-qa/lead-core-v2/harness`; logs, pids and the generated admin password live in `$H/.run/` (gitignored).

1. Server (builds if `dist` is stale, writes `.env` + `dist/server/.dev.vars`, applies `drizzle/*.sql` once, port 8001):
   `$H/serve.sh` · force rebuild `$H/serve.sh --rebuild` · stop server + proxy `$H/serve.sh --stop`
2. Proxy, one scenario at a time (`full`, `no-project`, `no-groups`, `no-scans`, `ai-key-missing`, `error`, `staff-redacted`):
   `nohup node $H/mock-proxy.mjs --port 8011 --target http://127.0.0.1:8001 --scenario full [--latency 600] > $H/.run/proxy.log 2>&1 & echo $! > $H/.run/proxy.pid`
   Switch scenario: `kill $(cat $H/.run/proxy.pid)` and start again (state resets).
3. Login (once per server `.env`; writes `$H/storage.json`): `node $H/login.mjs`
   Playwright comes from `$PW_PROJECT`, the worktree, `~/.claude/tools`, then `~/Projects/crm-spa` (the only one that has it today).
4. Screens (AI view = `/app?view=ai`, leads = `/app?view=leads`):
   `node ~/.claude/tools/ui-qa.mjs --url http://127.0.0.1:8011 --routes '/app?view=ai' --storage $H/storage.json --out <dir> --project ~/Projects/crm-spa`
   (`--project <worktree>` fails: the worktree has no `@playwright/test`.)

GET envelope = real one: `{records:[{id,kind,data,created,hasSecret}], telegramConnected, ai:{provider,hasEnvKey}, workspace, me}`;
`workspace`/`me` come from the real server, `records` sorted by `created` desc. AI key readiness in the UI is
`settings.hasSecret || ai.hasEnvKey` (both false only in `ai-key-missing`). Records of kind `project` are new.
POST mocks: save, delete, project_create/update/delete, set_group_project, funnel, lead_feedback, draft, dismiss_draft,
send_lead_message, mark_lead_viewed, rebuild_product, rescan_groups, poll_dm_replies, heal_group_join_state;
any other action → `{ok:true, mocked:true}`. Scenario `error`: GET 500, funnel 500. Fixture ids: `fixtures.mjs::IDS`.
Answers follow `docs/leads-pipeline.md` (Actions): `funnel` → `{ok,funnel,dm}` (`dm.projectId:'dm'`), `project_create|update` → `{ok,id,project}`,
`lead_feedback` → `{ok,lead,projectId,project}`, `draft` → `{ok,draft,kind,model}`, `dismiss_draft` → `{ok,lead}`; auto drafts carry
`draftKind` `group_reply|dm_first|dm_continue`, manual drafts none. Scenario `staff-redacted`: GET `workspace` = `fixtures.mjs::STAFF_WORKSPACE`
(manager, ai + groups, no leads/chats), records filtered like `visibleRecordsFor`, funnel `samples:{}`, examples `[]`; lead actions and a
`project_update` patch with examples → 403 (logged as `-> 403` in `$H/.run/proxy.log`, the redaction check greps for it).
