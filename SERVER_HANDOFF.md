# Uniseller — перенос проекта на сервер и продолжение в Cursor

Дата: 15 сентября 2026. Это исходники текущего проекта, а не готовый автономный production-сервис.

## Состав

Полный актуальный исходный код, lockfile зависимостей, SQL-миграции, компоненты интерфейса, фон Air и анимации. Включены последние незакоммиченные исправления. Синтаксическая ошибка SQL в GET /api/workspace исправлена; TypeScript и production-сборка проверены на исходном Mac.

Не включены: node_modules, результаты сборки, .git, .env, приватные ключи, локальная .wrangler/state, пользовательские записи и данные опубликованной D1. Telegram tdata, двухфакторный пароль и исходный файл прокси из Downloads не включены. Это исходный проект, не резервная копия пользовательских данных.

## Что работает

- Русская админка, оформление Air, анимации с prefers-reduced-motion.
- Карточки аккаунтов, прокси, групп; ручные лиды и статусы.
- Импорт списка прокси; HTTP / SOCKS5; связи аккаунт–прокси и группа–аккаунт.
- Серверная валидация, owner-фильтрация, AES-GCM для секретов.
- Подготовка AI-черновиков через OpenAI Responses API (нужен свой ключ).
- Очистка сохранённого секрета, лимит один AI-запрос в минуту на владельца, защита от затирания изменённого сообщения при генерации.

Успешный живой ответ OpenAI после последних исправлений не подтверждён. На сервере проект ещё не проверен.

## Что НЕ реализовано

Авторизация Telegram/код/2FA/импорт tdata, проверка прокси, вступление в группы и заявки, чтение сообщений и комментариев, автоматический отбор лидов, отправка в Telegram, постоянная очередь задач и журнал событий.

## Важная архитектура

UI: React + Vinext/Vite + компоненты Radix/shadcn. База: Cloudflare D1, запросы через cloudflare:workers в lib/server-store.ts. Авторизация: app/chatgpt-auth.ts доверяет заголовкам доверенного Sites gateway. Локальная имитация входа в build/sites-vite-plugin.ts предназначена исключительно для разработки на loopback.

Обычный VPS не предоставляет Sites gateway и D1. Не открывайте текущий dev-сервер в интернет и не имитируйте production-вход добавлением oai-authenticated-user-* заголовков. Для дальнейшей разработки используйте SSH-туннель. Для автономного production замените auth и адаптер БД; перенос файлов сам по себе этого не делает.

.openai/hosting.json содержит идентификатор прежнего Sites-проекта, но не секрет. Оставлен для полноты исходников. Не запускайте публикацию в прежний Sites из нового рабочего процесса случайно.

## Загрузка

Подставьте свой SSH-адрес и порт вместо USER, HOST и 22. Команды выполняются на вашем компьютере.

```sh
scp -P 22 uniseller-project.zip USER@HOST:~/uniseller-project.zip
ssh -p 22 USER@HOST
```

На сервере, в НОВОЙ пустой папке:

```sh
mkdir -p ~/projects/uniseller
unzip ~/uniseller-project.zip -d ~/projects/uniseller
cd ~/projects/uniseller/uniseller-project
git init
git add .
git commit -m 'Import Uniseller source snapshot'
```

## Разработка на сервере

Нужны Git, unzip и Node.js 22.13 или новее (ветка 22), npm и среда Linux, поддерживаемая Node/Cloudflare workerd. Устанавливайте зависимости на сервере заново — macOS node_modules переносить нельзя.

```sh
npm run install:ci
npx tsc --noEmit
npm run build
```

Для НОВОЙ пустой локальной базы примените первоначальную миграцию ОДИН раз:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --persist-to .wrangler/state --config dist/server/wrangler.json --file drizzle/0000_even_hydra.sql
```

Создайте новый ключ шифрования для новой тестовой базы; команда не перезаписывает существующий .env:

```sh
node --input-type=module -e "import {writeFileSync} from 'node:fs'; import {randomBytes} from 'node:crypto'; writeFileSync('.env', 'ENCRYPTION_KEY='+randomBytes(32).toString('hex')+'\n', {flag:'wx',mode:0o600});"
```

Если переносите существующие зашифрованные записи, нужен ИСХОДНЫЙ ключ ENCRYPTION_KEY; новым ключом старые значения не расшифровать. В AAD используется owner, поэтому простая замена owner при импорте тоже нарушит расшифровку. Данные нужно переносить отдельно контролируемой процедурой.

Запустите только на loopback:

```sh
npm run dev -- --host 127.0.0.1 --port 5173
```

На вашем компьютере откройте SSH-туннель:

```sh
ssh -p 22 -N -L 5173:127.0.0.1:5173 USER@HOST
```

В браузере: http://localhost:5173 . Тестовый вход: http://localhost:5173/signin-with-chatgpt?return_to=%2F . Это локальная dev-авторизация, не настоящий вход в ChatGPT. Не заменяйте bind на 0.0.0.0 ради удобства. Локальная эмуляция D1 сохраняет данные в .wrangler/state на сервере.

## Cursor

Подключитесь к серверу через расширение Remote SSH в Cursor и откройте папку ~/projects/uniseller/uniseller-project. Код редактируется на сервере; зависимости и dev-команды выполняйте в удалённом терминале. Предпросмотр доступен через SSH-туннель выше.

Документация: https://prod.cursor.com/help/troubleshooting/network

## Задача для первого запуска Cursor Agent

Прочитай SERVER_HANDOFF.md, README.md, app/api/workspace/route.ts, lib/server-store.ts и app/chatgpt-auth.ts. Сохрани оформление Air и текущие CRUD-функции. Подготовь автономный запуск на VPS: замени зависимость от Sites gateway собственной серверной авторизацией, замени Cloudflare D1 адаптером SQLite/PostgreSQL, добавь миграции, healthcheck и deployment-конфигурацию. Сначала подтверди архитектуру и проверь текущие тесты. Не открывай dev-авторизацию в интернет. Затем реализуй отдельный Telegram worker: авторизация, защищённые сессии, назначенные прокси, вступление/заявки, чтение сообщений с дедупликацией, AI-отбор и черновики. Отправка только после подтверждения оператора; учитывать FloodWait. Не подменяй реальные подключения фальшивыми статусами. Не выводи ключи и сессии в логи. Начни пилот с одного аккаунта и одной группы.

## Для рабочего запуска после адаптации

Понадобятся сервер, домен/HTTPS для публичного доступа, Telegram api_id/api_hash, аккаунт с доступом к коду/2FA, рабочий прокси и OpenAI API-ключ. Секреты передавать через защищённые настройки/файлы, не через чат или Git.

Telegram credentials: https://core.telegram.org/api/obtaining_api_id
