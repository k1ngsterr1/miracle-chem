# BetonFlow

Отдельная CRM для планирования, учёта и полной прослеживаемости производства бетона: от партии сырья и версии рецептуры до замеса, готовой продукции и передачи на ЛРТ.

## Архитектура

- `apps/web` — React CRM-интерфейс и аналитика.
- `apps/api` — Fastify API, транзакционные производственные операции и экспорт.
- `packages/domain` — Decimal-расчёты, единицы измерения и безопасный движок формул.
- PostgreSQL + Prisma — основное хранилище; количество и деньги не используют `float`.

## Локальный запуск

```bash
cp .env.example .env
docker compose up -d postgres
npm install
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Web: `http://localhost:5173` · API: `http://localhost:4100/api` · health: `http://localhost:4100/health`.

## Проверка

```bash
npm run typecheck
npm test
npm run build
npm audit --audit-level=low
```

Тесты включают unit-проверки формул/единиц и интеграционные сценарии PostgreSQL: идемпотентный приход, rollback резервов при дефиците, отправку и возврат ЛРТ, движения продукта, корректировки, вложения и XLSX.

## Production-контур

`compose.production.yaml` собирает отдельные API и web-образы, выполняет `prisma migrate deploy`, включает healthcheck, security headers и rate limit. Перед запуском задайте как минимум `POSTGRES_USER`, `POSTGRES_PASSWORD`, `INTERNAL_API_KEY` (32+ случайных символа) и внешний `WEB_ORIGIN`:

```bash
docker compose -f compose.production.yaml up -d --build
```

Production API работает в режиме `trusted-gateway`: аутентифицирующий reverse proxy обязан добавлять `X-Workspace-Id`, `X-Actor-Id` и серверный `X-Internal-Api-Key`. Ключ нельзя помещать во frontend. Для локального seed-демо используется `AUTH_MODE=demo`.

Вложения регистрируются как metadata + `storageKey`/URL; бинарные файлы должен принимать объектный storage или корпоративный файловый шлюз. Это не позволяет API хранить произвольные файлы на локальном диске контейнера.

## Гарантии домена

- формулы разбираются парсером и исполняются по AST, без `eval`;
- единицы всегда приводятся к совместимому базовому измерению;
- завершённый замес хранит immutable snapshot рецептуры, формул, цен и фактических значений;
- резервы, списания, выпуск партии и передача на ЛРТ выполняются транзакционно;
- складские движения и передачи защищены `idempotencyKey`;
- корректировки оформляются отдельными документами и попадают в audit log.

## Основные API-контуры

- `/api/materials`, `/api/materials/receipts` — материалы, партии и приходы;
- `/api/recipes`, `/api/formulas` — версии рецептур и безопасные backend-формулы;
- `/api/batches` — план, резервирование, факт, завершение и отмена;
- `/api/product-lots` — партии продукта, списания, брак и другие отгрузки;
- `/api/transfers` — документы ЛРТ, отправка, приёмка, возврат и отмена;
- `/api/adjustments` — отдельное согласование и применение корректировок;
- `/api/attachments` — привязка сертификатов и документов;
- `/api/reports` — выпуск, расход, баланс, эффективность рецептур, ЛРТ, CSV/XLSX и trace партии.

Подробности: [docs/architecture.md](docs/architecture.md).
