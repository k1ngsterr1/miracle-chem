import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeDollarSign,
  ChevronRight,
  Check,
  CircleGauge,
  CopyPlus,
  Cylinder,
  Factory,
  FlaskConical,
  MoreHorizontal,
  PackageCheck,
  Play,
  Plus,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { apiFetch, apiMutation } from "../api.js";
import { CustomSelect } from "../components/CustomSelect.js";
import { DateTimePicker } from "../components/DateTimePicker.js";
import { useApi } from "../hooks/use-api.js";
import type { Batch, MetaData, Recipe } from "../types.js";
import { formatDate, formatMoney, formatNumber, unitLabel } from "../lib/format.js";
import {
  ErrorState,
  LoadingState,
  Modal,
  PageHeader,
  Panel,
  ProgressBar,
  StatusBadge,
} from "../components/ui.js";

const FILTERS = [
  { id: "ALL", label: "Все", tone: "all" },
  { id: "PLANNED", label: "План", tone: "planned" },
  { id: "IN_PROGRESS", label: "В работе", tone: "progress" },
  { id: "COMPLETED", label: "Завершены", tone: "completed" },
  { id: "TRANSFERRED", label: "Переданы", tone: "transferred" },
] as const;

type BatchFilter = (typeof FILTERS)[number]["id"];

export function BatchesPage({ meta, actorRole }: { meta: MetaData | null; actorRole: string | undefined }) {
  const batches = useApi<{ items: Batch[] }>("/batches");
  const recipes = useApi<{ items: Recipe[] }>("/recipes");
  const [filter, setFilter] = useState<BatchFilter>("ALL");
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [template, setTemplate] = useState<Batch | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const canManageBatches = ["ADMIN", "DIRECTOR", "TECHNOLOGIST", "OPERATOR"].includes(actorRole ?? "");
  const filtered = useMemo(() => {
    const normalized = query.toLocaleLowerCase("ru");
    return (batches.data?.items ?? []).filter((batch) => {
      const statusMatches = matchesBatchFilter(batch.status, filter);
      return statusMatches && [batch.number, batch.concreteGrade, batch.recipeVersion.recipe.name]
        .some((value) => value.toLocaleLowerCase("ru").includes(normalized));
    });
  }, [batches.data, filter, query]);

  if (batches.loading) return <LoadingState />;
  if (batches.error !== null) return <ErrorState message={batches.error} retry={batches.reload} />;
  const allBatches = batches.data?.items ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Производственный контур"
        title="Замесы"
        description="Планируйте, резервируйте сырьё, фиксируйте факт и выпуск партии в одном журнале."
        actions={canManageBatches ? <button className="button primary" onClick={() => { setTemplate(null); setCreateOpen(true); }}><Plus size={17} /> Запланировать замес</button> : undefined}
      />

      <div className="summary-strip">
        <Summary value={String((batches.data?.items ?? []).filter((item) => item.status === "IN_PROGRESS").length)} label="в производстве" icon={<Factory />} />
        <Summary value={formatNumber((batches.data?.items ?? []).filter((item) => item.status === "COMPLETED").reduce((sum, item) => sum + Number(item.actualOutput ?? 0), 0))} label="м³ выпущено" icon={<FlaskConical />} />
        <Summary value={formatMoney((batches.data?.items ?? []).reduce((sum, item) => sum + Number(item.totalCost), 0))} label="стоимость выпуска" icon={<CircleGauge />} />
        <Summary value={String((batches.data?.items ?? []).filter((item) => item.status === "PLANNED").length)} label="в очереди" icon={<ShieldCheck />} />
      </div>

      <Panel className="table-panel">
        <div className="table-toolbar batch-filter-toolbar">
          <div className="batch-filter-tabs" aria-label="Фильтр замесов по статусу">
            {FILTERS.map(({ id, label, tone }) => {
              const count = allBatches.filter((batch) => matchesBatchFilter(batch.status, id)).length;
              return <button type="button" key={id} className={`${tone}${filter === id ? " active" : ""}`} aria-pressed={filter === id} onClick={() => setFilter(id)}><i aria-hidden="true" /><span>{label}</span><em>{count}</em></button>;
            })}
          </div>
          <div className={`batch-filter-search${query === "" ? "" : " filled"}`} role="search">
            <Search size={16} />
            <input aria-label="Поиск по замесам" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Номер, марка или рецептура" />
            {query === "" ? null : <button type="button" aria-label="Очистить поиск" onClick={() => setQuery("")}><X size={14} /></button>}
          </div>
        </div>
        <div className="data-table-wrap">
          <table className="data-table batches-table">
            <thead><tr><th>Замес</th><th>Время</th><th>Рецептура</th><th>Линия / чан</th><th>Объём</th><th>Выполнение</th><th>Статус</th><th /></tr></thead>
            <tbody>
              {filtered.map((batch) => {
                const progress = batch.status === "PLANNED" ? 5 : batch.status === "IN_PROGRESS" ? 62 : 100;
                return (
                  <tr key={batch.id} onClick={() => setSelectedId(batch.id)}>
                    <td><div className="primary-cell"><span className="batch-code-icon"><Factory size={16} /></span><span><strong>{batch.number}</strong><small>{batch.concreteGrade}</small></span></div></td>
                    <td><strong>{new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(batch.scheduledAt))}</strong><small>{formatDate(batch.scheduledAt)}</small></td>
                    <td><strong>{batch.recipeVersion.recipe.name}</strong><small>Версия {batch.recipeVersion.version}</small></td>
                    <td><strong>{batch.productionLine.name}</strong><small>{batch.productionTank?.name ?? "Чан не указан"} · {batch.operator.name}</small></td>
                    <td><strong>{formatNumber(batch.plannedVolume)} {unitLabel[batch.plannedVolumeUnit]}</strong><small>план</small></td>
                    <td><div className="table-progress"><span>{progress}%</span><ProgressBar value={progress} /></div></td>
                    <td><StatusBadge status={batch.status} /></td>
                    <td><button type="button" className="row-action" aria-label={`Открыть замес ${batch.number}`} onClick={(event) => { event.stopPropagation(); setSelectedId(batch.id); }}><MoreHorizontal size={18} /></button></td>
                  </tr>
                );
              })}
              {filtered.length === 0 ? <tr className="table-empty-row"><td colSpan={8}>По выбранным фильтрам замесов нет.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className="table-footer"><span>Показано {filtered.length} из {batches.data?.items.length ?? 0}</span><span>Нажмите на строку, чтобы открыть карту замеса</span></div>
      </Panel>

      {createOpen ? (
        <CreateBatchModal
          meta={meta}
          recipes={recipes.data?.items ?? []}
          template={template}
          onClose={() => setCreateOpen(false)}
          onCreated={async () => { setCreateOpen(false); setTemplate(null); await batches.reload(); }}
        />
      ) : null}
      {selectedId === null ? null : (
        <BatchDetailModal
          id={selectedId}
          actorRole={actorRole}
          actorId={meta?.actor.id}
          onClose={() => setSelectedId(null)}
          onChanged={batches.reload}
          onDuplicate={(batch) => { setSelectedId(null); setTemplate(batch); setCreateOpen(true); }}
        />
      )}
    </>
  );
}

function matchesBatchFilter(status: Batch["status"], filter: BatchFilter): boolean {
  return filter === "ALL"
    || (filter === "TRANSFERRED" && ["PARTIALLY_TRANSFERRED", "FULLY_TRANSFERRED"].includes(status))
    || status === filter;
}

function Summary({ value, label, icon }: { value: string; label: string; icon: React.ReactNode }) {
  return <div className="summary-item"><span>{icon}</span><div><strong>{value}</strong><small>{label}</small></div></div>;
}

function CreateBatchModal({
  meta,
  recipes,
  template,
  onClose,
  onCreated,
}: {
  meta: MetaData | null;
  recipes: Recipe[];
  template: Batch | null;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const activeRecipes = recipes.filter((recipe) => recipe.status === "ACTIVE" && recipe.versions[0] !== undefined);
  const [form, setForm] = useState(() => batchDraftFromTemplate(template));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const productionLines = meta?.productionLines ?? [];
  const productionTanks = meta?.productionTanks ?? [];

  useEffect(() => {
    setForm((current) => {
      const productionLineId = current.productionLineId || (productionLines.length === 1 ? productionLines[0]?.id ?? "" : "");
      const tanksForLine = productionTanks.filter((tank) => tank.productionLineId === productionLineId);
      const productionTankId = tanksForLine.some((tank) => tank.id === current.productionTankId)
        ? current.productionTankId
        : tanksForLine.length === 1 ? tanksForLine[0]?.id ?? "" : "";
      return productionLineId === current.productionLineId && productionTankId === current.productionTankId
        ? current
        : { ...current, productionLineId, productionTankId };
    });
  }, [productionLines, productionTanks]);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (Object.entries(form).some(([key, value]) => key !== "comments" && value === "")) {
      setError("Заполните обязательные поля замеса");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiMutation("/batches", {
        ...form,
        scheduledAt: new Date(form.scheduledAt).toISOString(),
        plannedVolumeUnit: "M3",
      });
      await onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось создать замес");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={template === null ? "Новый производственный замес" : `Повторить замес ${template.number}`} onClose={onClose} wide>
      <form className="form-grid batch-create-form" onSubmit={(event) => void submit(event)}>
        <label><span>Номер замеса</span><input required value={form.number} onChange={(event) => setForm({ ...form, number: event.target.value })} /></label>
        <div className="form-field"><span>Дата и время</span><DateTimePicker required ariaLabel="Дата и время замеса" value={form.scheduledAt} onChange={(scheduledAt) => setForm({ ...form, scheduledAt })} /></div>
        <div className="form-field span-2"><span>Рецептура</span><CustomSelect required ariaLabel="Рецептура" value={form.recipeVersionId} onChange={(recipeVersionId) => setForm({ ...form, recipeVersionId })} options={activeRecipes.map((recipe) => ({ value: recipe.versions[0]?.id ?? "", label: recipe.name, description: `v${recipe.versions[0]?.version} · ${recipe.versions[0]?.concreteGrade}` })).filter((option) => option.value !== "")} /></div>
        <label><span>Плановый объём, м³</span><input required min="0.001" step="0.001" type="number" value={form.plannedVolume} onChange={(event) => setForm({ ...form, plannedVolume: event.target.value })} /></label>
        {productionLines.length === 1 && productionTanks.length === 1 ? <div className="equipment-assignment span-2">
          <span><Factory size={17} /><small>Производственная линия</small><strong>{productionLines[0]?.name}</strong></span>
          <span><Cylinder size={17} /><small>Производственный чан</small><strong>{productionTanks[0]?.name}</strong></span>
        </div> : <>
          <div className="form-field"><span>Производственная линия</span><CustomSelect required ariaLabel="Производственная линия" value={form.productionLineId} onChange={(productionLineId) => setForm({ ...form, productionLineId, productionTankId: "" })} options={productionLines.map((line) => ({ value: line.id, label: line.name, description: Number(line.capacity) > 0 ? `${formatNumber(line.capacity)} ${unitLabel[line.capacityUnit]}/ч` : "Мощность не задана" }))} /></div>
          <div className="form-field"><span>Производственный чан</span><CustomSelect required ariaLabel="Производственный чан" value={form.productionTankId} onChange={(productionTankId) => setForm({ ...form, productionTankId })} options={productionTanks.filter((tank) => tank.productionLineId === form.productionLineId).map((tank) => ({ value: tank.id, label: tank.name, description: tank.capacity === null ? "Объём не задан" : `${formatNumber(tank.capacity)} ${unitLabel[tank.capacityUnit]}` }))} /></div>
        </>}
        <div className="form-field span-2"><span>Оператор</span><CustomSelect required ariaLabel="Оператор" value={form.operatorId} onChange={(operatorId) => setForm({ ...form, operatorId })} options={(meta?.users ?? []).filter((user) => ["OPERATOR", "ADMIN"].includes(user.role)).map((user) => ({ value: user.id, label: user.name, description: user.role === "ADMIN" ? "Администратор" : "Оператор" }))} /></div>
        <label className="span-2"><span>Комментарий</span><textarea rows={3} value={form.comments} onChange={(event) => setForm({ ...form, comments: event.target.value })} placeholder="Задание смены, особенности выпуска…" /></label>
        {error === null ? null : <div className="form-error span-2">{error}</div>}
        <div className="modal-actions span-2"><button type="button" className="button ghost" onClick={onClose}>Отмена</button><button className="button primary" disabled={saving}>{saving ? "Сохраняем…" : "Создать замес"}<ChevronRight size={16} /></button></div>
      </form>
    </Modal>
  );
}

function BatchDetailModal({
  id,
  actorRole,
  actorId,
  onClose,
  onChanged,
  onDuplicate,
}: {
  id: string;
  actorRole: string | undefined;
  actorId: string | undefined;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onDuplicate: (batch: Batch) => void;
}) {
  const [batch, setBatch] = useState<Batch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actuals, setActuals] = useState<Record<string, string>>({});
  const [completion, setCompletion] = useState({ actualOutput: "", goodOutput: "", rejectedOutput: "0", loss: "0", lot: "" });
  const [qualityDraft, setQualityDraft] = useState({ status: "PASSED", comments: "" });
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  async function load(): Promise<void> {
    try {
      const value = await apiFetch<Batch>(`/batches/${id}`);
      setBatch(value);
      const confirmed = value.economics?.consumptionConfirmed
        ?? value.materialMovements?.some((movement) => movement.type === "CONSUMPTION")
        ?? false;
      setActuals(Object.fromEntries((value.components ?? []).map((component) => [
        component.id,
        confirmed ? component.actualQuantity : component.plannedQuantity,
      ])));
      setCompletion({
        actualOutput: value.plannedOutput,
        goodOutput: value.plannedOutput,
        rejectedOutput: "0",
        loss: "0",
        lot: `LOT-${value.number}`,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось открыть замес");
    }
  }

  useEffect(() => { void load(); }, [id]);

  async function action(fn: () => Promise<unknown>): Promise<void> {
    setBusy(true); setError(null);
    try { await fn(); await load(); await onChanged(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Операция не выполнена"); } finally { setBusy(false); }
  }

  if (batch === null) return <Modal title="Карта замеса" onClose={onClose} wide>{error === null ? <LoadingState /> : <ErrorState message={error} retry={load} />}</Modal>;
  const consumptionConfirmed = batch.economics?.consumptionConfirmed
    ?? batch.materialMovements?.some((movement) => movement.type === "CONSUMPTION")
    ?? false;
  const economics = batch.economics;
  const stockWarnings = batch.stockReadiness?.warnings ?? [];
  const canManageBatches = ["ADMIN", "DIRECTOR", "TECHNOLOGIST", "OPERATOR"].includes(actorRole ?? "");
  const canManageQuality = ["ADMIN", "DIRECTOR", "TECHNOLOGIST", "QUALITY_MANAGER"].includes(actorRole ?? "");
  const canCancel = canManageBatches && ["PLANNED", "PREPARATION", "IN_PROGRESS"].includes(batch.status) && !consumptionConfirmed;

  return (
    <Modal title={`${batch.number} · ${batch.concreteGrade}`} onClose={onClose} wide>
      <div className="detail-hero"><div><StatusBadge status={batch.status} /><h3>{batch.recipeVersion.recipe.name}</h3><p>Версия {batch.recipeVersion.version} · {batch.productionLine.name} · {batch.productionTank?.name ?? "чан не указан"} · оператор {batch.operator.name}</p></div><div className="detail-volume"><strong>{formatNumber(batch.plannedVolume)} {unitLabel[batch.plannedVolumeUnit]}</strong><span>плановый объём</span></div></div>
      <div className="detail-facts"><span><small>План</small><strong>{formatDate(batch.scheduledAt, true)}</strong></span><span><small>Стоимость реагентов</small><strong>{formatMoney(economics?.actualMaterialCost ?? batch.totalCost, batch.currency)}</strong></span><span><small>Доступно</small><strong>{formatNumber(batch.availableOutput)} {unitLabel[batch.outputAccountingUnit]}</strong></span><span><small>Контроль</small><strong>{(batch.qualityChecks?.length ?? 0) > 0 ? "Пройден" : "Ожидает"}</strong></span></div>

      {stockWarnings.length > 0 ? (
        <div className={`batch-stock-warning ${batch.stockReadiness?.status === "SHORTAGE" ? "critical" : "low"}`}>
          <span><AlertTriangle size={18} /></span>
          <div className="batch-stock-warning-copy">
            <strong>{batch.stockReadiness?.status === "SHORTAGE" ? "Недостаточно реагентов для запуска" : "После замеса остаток будет низким"}</strong>
            <p>{batch.stockReadiness?.status === "SHORTAGE" ? "Пополните склад или скорректируйте объём партии." : "Проверьте минимальные остатки и запланируйте закупку."}</p>
          </div>
          <div className="batch-stock-warning-items">
            {stockWarnings.map((warning) => (
              <span key={warning.batchComponentId}>
                <b>{warning.materialName}</b>
                <small>{batchStockWarningText(warning)}</small>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {consumptionConfirmed && economics !== null && economics !== undefined ? (
        <div className="batch-economics-section">
          <div className="section-title batch-economics-title">
            <div><h3>Фактическая экономика партии</h3><p>Списание по складским партиям и прибыль по выставленным счетам отгрузки.</p></div>
            <span><PackageCheck size={14} /> По фактическим лотам</span>
          </div>
          <div className="batch-economics-grid">
            <EconomicsMetric label="Списано по факту" value={formatActualQuantities(economics.actualQuantities)} note={`${economics.components.length} реагентов в партии`} />
            <EconomicsMetric label="Стоимость реагентов" value={formatMoney(economics.actualMaterialCost, economics.currency)} note={`${formatMoney(economics.actualUnitCost, economics.currency)} / ${unitLabel[economics.outputUnit]}`} />
            <EconomicsMetric label="Отгружено" value={`${formatNumber(economics.shippedQuantity)} ${unitLabel[economics.outputUnit]}`} note={`В счетах: ${formatNumber(economics.invoicedQuantity)} ${unitLabel[economics.outputUnit]}`} />
            <EconomicsMetric label="Выручка без НДС" value={formatMoney(economics.invoicedRevenue, economics.currency)} note={`Оплачено без НДС: ${formatMoney(economics.paidRevenue, economics.currency)}`} />
            <EconomicsMetric label="Реагенты в отгрузке" value={formatMoney(economics.soldCost, economics.currency)} note="Себестоимость выставленного объёма" />
            <EconomicsMetric
              accent={economics.grossProfit !== null}
              label="Валовая прибыль"
              value={economics.grossProfit === null ? "—" : formatMoney(economics.grossProfit, economics.currency)}
              note={economics.marginPercent === null ? economicsStatusText(economics.calculationStatus) : `Маржа ${formatNumber(economics.marginPercent)}%`}
              icon={<BadgeDollarSign size={16} />}
            />
          </div>
          <p className="batch-economics-note">Прибыль рассчитана как выручка без НДС по выставленным счетам минус фактическая стоимость реагентов в отгруженном объёме. Операционные расходы в эту сумму не входят.</p>
        </div>
      ) : null}

      <div className="detail-section"><div className="section-title"><div><h3>Расход реагентов на партию</h3><p className="section-subtitle">План, подтверждённый факт и стоимость конкретных складских лотов.</p></div><span>{batch.components?.length ?? 0} позиций</span></div><div className="component-list">
        {batch.components?.map((component) => {
          const componentEconomics = economics?.components.find((item) => item.batchComponentId === component.id);
          return (
            <article className="component-item" key={component.id}>
              <div className="component-row">
                <span className="material-dot" />
                <div className="component-name"><strong>{component.materialNameSnapshot}</strong><small>Допуск ±{formatNumber(component.allowedDeviationPercent)}%</small></div>
                <div className="component-metrics">
                  <span><small>План</small><strong>{formatNumber(component.plannedQuantity)} {unitLabel[component.plannedUnit]}</strong></span>
                  {consumptionConfirmed || batch.status !== "IN_PROGRESS" || !canManageBatches
                    ? <span><small>Потрачено по факту</small><strong>{formatNumber(component.actualQuantity)} {unitLabel[component.actualUnit]}</strong></span>
                    : <label><small>Факт</small><input type="number" min="0" step="0.001" value={actuals[component.id] ?? ""} onChange={(event) => setActuals({ ...actuals, [component.id]: event.target.value })} /></label>}
                  <span><small>Отклонение</small><strong className={component.withinTolerance ? "deviation-ok" : "deviation-bad"}>{consumptionConfirmed ? `${formatNumber(component.deviationPercent)}%` : "—"}</strong></span>
                  <span><small>Фактическая стоимость</small><strong>{consumptionConfirmed ? formatMoney(componentEconomics?.actualCost ?? component.componentCost, componentEconomics?.currency ?? batch.currency) : "—"}</strong></span>
                </div>
              </div>
              {consumptionConfirmed && (componentEconomics?.lots.length ?? 0) > 0 ? (
                <div className="component-lot-lines">
                  {componentEconomics?.lots.map((lot) => (
                    <span key={lot.allocationId}>
                      <small>Лот {lot.lotNumber}{lot.supplier === null ? "" : ` · ${lot.supplier.name}`}</small>
                      <strong>{formatNumber(lot.quantity)} {unitLabel[lot.unit]} × {formatMoney(lot.unitCost, componentEconomics.currency)} = {formatMoney(lot.cost, componentEconomics.currency)}</strong>
                    </span>
                  ))}
                </div>
              ) : null}
            </article>
          );
        })}
      </div></div>

      {error === null ? null : <div className="form-error">{error}</div>}
      <div className="workflow-actions">
        {canManageBatches ? <button className="button ghost" onClick={() => onDuplicate(batch)}><CopyPlus size={16} /> Создать на основе</button> : null}
        {canManageBatches && batch.status === "PLANNED" ? <button disabled={busy} className="button primary" onClick={() => void action(() => apiMutation(`/batches/${batch.id}/start`, {}, { idempotent: true }))}><Play size={16} /> Запустить и зарезервировать</button> : null}
        {canManageBatches && batch.status === "IN_PROGRESS" && !consumptionConfirmed ? <button disabled={busy} className="button primary" onClick={() => void action(() => apiMutation(`/batches/${batch.id}/consumption`, { components: batch.components?.map((component) => ({ batchComponentId: component.id, actualQuantity: actuals[component.id] ?? component.plannedQuantity, actualUnit: component.actualUnit, lossQuantity: "0", lossUnit: component.actualUnit })) }, { idempotent: true }))}><Check size={16} /> Подтвердить расход</button> : null}
        {canManageBatches && batch.status === "IN_PROGRESS" && consumptionConfirmed ? (
          <div className="completion-inline"><label><span>Партия</span><input required value={completion.lot} onChange={(event) => setCompletion({ ...completion, lot: event.target.value })} /></label><label><span>Получено, м³</span><input required type="number" step="0.001" value={completion.actualOutput} onChange={(event) => setCompletion({ ...completion, actualOutput: event.target.value, goodOutput: event.target.value })} /></label><label><span>Брак, м³</span><input required type="number" step="0.001" value={completion.rejectedOutput} onChange={(event) => setCompletion({ ...completion, rejectedOutput: event.target.value, goodOutput: String(Math.max(0, Number(completion.actualOutput) - Number(event.target.value))) })} /></label><button disabled={busy} className="button primary" onClick={() => void action(() => apiMutation(`/batches/${batch.id}/complete`, { productLotNumber: completion.lot, actualVolume: completion.actualOutput, actualVolumeUnit: "M3", actualOutput: completion.actualOutput, goodOutput: completion.goodOutput, rejectedOutput: completion.rejectedOutput, technologicalLoss: completion.loss, outputUnit: "M3", densityKgPerM3: "2400" }, { idempotent: true }))}><ShieldCheck size={16} /> Завершить замес</button></div>
        ) : null}
        {canCancel ? (cancelling ? <div className="workflow-inline-form"><label><span>Причина отмены</span><input autoFocus minLength={3} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Например, изменился производственный план" /></label><button type="button" className="button ghost" onClick={() => { setCancelling(false); setCancelReason(""); }}>Назад</button><button type="button" className="button danger" disabled={busy || cancelReason.trim().length < 3} onClick={() => void action(async () => { await apiMutation(`/batches/${batch.id}/cancel`, { reason: cancelReason.trim() }, { idempotent: true }); setCancelling(false); setCancelReason(""); })}><X size={16} /> Отменить замес</button></div> : <button type="button" className="button ghost danger" disabled={busy} onClick={() => setCancelling(true)}><X size={16} /> Отменить замес</button>) : null}
        {canManageQuality ? <div className="workflow-inline-form quality-check-form"><div className="form-field"><span>Результат контроля</span><CustomSelect required ariaLabel="Результат контроля качества" value={qualityDraft.status} options={[{ value: "PASSED", label: "Пройден" }, { value: "CONDITIONAL", label: "Условно пройден" }, { value: "FAILED", label: "Не пройден" }, { value: "PENDING", label: "Ожидает решения" }]} onChange={(status) => setQualityDraft({ ...qualityDraft, status })} /></div><label><span>Комментарий</span><input value={qualityDraft.comments} onChange={(event) => setQualityDraft({ ...qualityDraft, comments: event.target.value })} placeholder="Замеры и замечания" /></label><button type="button" className="button ghost" disabled={busy || actorId === undefined} onClick={() => void action(async () => { if (actorId === undefined) return; await apiMutation(`/batches/${batch.id}/quality-checks`, { performedById: actorId, status: qualityDraft.status, comments: qualityDraft.comments.trim() || undefined }, { idempotent: true }); setQualityDraft({ status: "PASSED", comments: "" }); })}><ShieldCheck size={16} /> Записать контроль</button></div> : null}
        {["COMPLETED", "PARTIALLY_TRANSFERRED", "FULLY_TRANSFERRED"].includes(batch.status) ? <span className="locked-note"><ShieldCheck size={16} /> Расчётные данные зафиксированы и защищены от изменения</span> : null}
      </div>
    </Modal>
  );
}

function batchDraftFromTemplate(template: Batch | null) {
  return {
    number: "",
    scheduledAt: "",
    recipeVersionId: template?.recipeVersionId ?? "",
    plannedVolume: template?.plannedVolume ?? "",
    operatorId: template?.operator.id ?? "",
    productionLineId: template?.productionLine.id ?? "",
    productionTankId: template?.productionTank?.id ?? "",
    comments: template?.comments ?? "",
  };
}

function EconomicsMetric({
  label,
  value,
  note,
  accent = false,
  icon,
}: {
  label: string;
  value: string;
  note: string;
  accent?: boolean;
  icon?: React.ReactNode;
}) {
  return <div className={`batch-economics-metric${accent ? " accent" : ""}`}><span>{label}{icon}</span><strong>{value}</strong><small>{note}</small></div>;
}

function economicsStatusText(status: NonNullable<Batch["economics"]>["calculationStatus"]): string {
  return {
    NO_CONSUMPTION: "Сначала подтвердите расход реагентов",
    NOT_COMPLETED: "Сначала завершите выпуск партии",
    NO_SHIPMENT: "Партия ещё не отгружена",
    NO_INVOICE: "Нет выставленного счёта по отгрузке",
    CURRENCY_MISMATCH: "Валюта счёта отличается от валюты партии",
    CALCULATED: "Рассчитано по факту",
  }[status];
}

function formatActualQuantities(quantities: NonNullable<Batch["economics"]>["actualQuantities"]): string {
  return quantities.length === 0
    ? "0"
    : quantities.map((quantity) => `${formatNumber(quantity.value)} ${unitLabel[quantity.unit]}`).join(" · ");
}

function batchStockWarningText(warning: NonNullable<Batch["stockReadiness"]>["warnings"][number]): string {
  if (["OUT_OF_STOCK", "SHORTAGE"].includes(warning.level)) {
    return `Свободно ${formatNumber(warning.freeStock)} ${unitLabel[warning.unit]}, нужно ${formatNumber(warning.requiredQuantity)} · дефицит ${formatNumber(warning.shortfall)}`;
  }
  return `Свободно ${formatNumber(warning.freeStock)} ${unitLabel[warning.unit]}, после замеса ${formatNumber(warning.projectedStock)}`;
}
