# Скрыть «был в сети» у аккаунта (quick)

status: implemented (branch `task/account-hide-last-seen-2026-10-01`)

## Поведение
- Форма аккаунта: чекбокс «Скрывать, когда был в сети» + строка состояния (`lib/account-privacy.ts::lastSeenStatus`):
  «Скрыто / Видно в Telegram», «Не применено: <причина>. «Сохранить» повторит попытку», «Применится после «Сохранить»»,
  «Применится, когда у аккаунта будет сессия».
- «Сохранить» → `save` (кабинет), затем при необходимости (`lib/account-privacy.ts::lastSeenNeedsApply`)
  `apply_account_last_seen`. Новый аккаунт — после фоновой `check_account`, не параллельно (одна сессия).
  Никогда не применяли и флаг выключен — Telegram не трогаем.

## Контракт
- `POST /api/workspace {action:'apply_account_last_seen', id:uuid, hide:boolean}` (`app/api/workspace/route.ts`),
  право `accounts` (`lib/security/workspace-authz.ts::ACTION_RULES`). 400 на не-boolean `hide`, 404 на чужой/нет id.
  Ответ `{ok:true, hidden, applied, at, error}`; `ok` = запрос обработан, `applied` = Telegram подтвердил.
- Запись `account.data`: `hideLastSeen` (желаемое, пишет форма) и `lastSeenPrivacy {hidden, applied, at, error}`
  (пишет только этот action; `save` клиентское значение отбрасывает и сохраняет серверное, а при новой или
  удалённой сессии сбрасывает — к другому входу Telegram прежнее «применено» не относится). Поля обновляются
  точечно `json_set`, чтобы не затереть параллельные изменения тиков.
- Аренда `lastSeenPrivacyLease` (CAS, 60 с > таймаута воркера 45 с): второй вызов во время применения → 429
  «уже применяется», воркер не зовётся (не два входа одной сессией). Снимается вместе с записью итога.
  Занятый воркер (429) → «Воркер занят — повторите позже».
- Гонки с другими писателями записи: клиентский `save` сливается со строкой «как сейчас» под CAS
  (`lib/record-cas.ts::updateRecordData` + `lib/processes/scan-flow.ts::keepServerOwnedFields`, `account`:
  `lastSeenPrivacy`, `lastSeenPrivacyLease`); `check_account` и её исходы пишут только свои поля поверх строки «как сейчас»
  (`app/api/workspace/route.ts::putAccountPatch`), поэтому итог применения, записанный во время проверки или
  между чтением и записью `save`, не теряется. Если другие писатели перебили все попытки CAS —
  `lib/record-cas.ts::RecordConflictError`, ответ 409 «не сохранено, повторите» (проверка не уходит в ротацию прокси).
- Известное ограничение (следующая задача): остальные писатели аккаунта всё ещё переписывают `data` целиком из
  прочитанной ранее копии и могут затереть итог применения, если завершатся во время него — в
  `app/api/workspace/route.ts`: `rotateGroupOffDeadAccount`, actions `apply_account_profiles`,
  `upload_account_photos`, `join_group`, `scan_group`, `send_lead_message`, `tick_audience`, `tick_invite`,
  `tick_mailing`. UI тогда покажет «Применится после «Сохранить»», повтор безопасен.
- Воркер: `/set-last-seen-privacy` → `set_last_seen_privacy` (`telegram-worker/src/worker-app.mjs::ROUTES`,
  `telegram-worker/src/check_account.py::set_last_seen_privacy`): `account.SetPrivacyRequest(InputPrivacyKeyStatusTimestamp,
  [DisallowAll | AllowAll])`. Идемпотентно (правило задаётся целиком). FloodWait → текст с секундами;
  заморозка → `status:'frozen'` (route помечает аккаунт frozen). Сбой воркера → общее сообщение, деталь в серверный лог.

## Взаимность Telegram и влияние на функции
- Скрыв своё время, аккаунт без Premium видит у других только «недавно / на неделе / в месяц», не «онлайн» и не точное время.
- Затронут только сбор аудитории этим аккаунтом (`check_account.py::_user_status_bucket`): фильтр «Онлайн» почти
  пустеет, точные «был в …» уходят в приблизительные корзины. Вступления, скан, инвайт, рассылка, ЛС статус не читают.

## Тесты
`tests/account-last-seen-route.test.ts`, `tests/account-server-fields-race.test.ts` (гонки save/check_account), `tests/account-privacy.test.ts`,
`telegram-worker/tests/test_last_seen_privacy.py` (telethon-заглушка клиента).
