import { useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  Check,
  CircleGauge,
  Factory,
  FlaskConical,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  ShieldCheck,
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
  ["ALL", "Все"],
  ["PLANNED", "План"],
  ["IN_PROGRESS", "В работе"],
  ["COMPLETED", "Завершены"],
  ["TRANSFERRED", "Переданы"],
] as const;

export function BatchesPage({ meta }: { meta: MetaData | null }) {
  const batches = useApi<{ items: Batch[] }>("/batches");
  const recipes = useApi<{ items: Recipe[] }>("/recipes");
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("ALL");
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const filtered = useMemo(() => {
    const normalized = query.toLocaleLowerCase("ru");
    return (batches.data?.items ?? []).filter((batch) => {
      const statusMatches = filter === "ALL"
        || (filter === "TRANSFERRED" && ["PARTIALLY_TRANSFERRED", "FULLY_TRANSFERRED"].includes(batch.status))
        || batch.status === filter;
      return statusMatches && [batch.number, batch.concreteGrade, batch.recipeVersion.recipe.name]
        .some((value) => value.toLocaleLowerCase("ru").includes(normalized));
    });
  }, [batches.data, filter, query]);

  if (batches.loading) return <LoadingState />;
  if (batches.error !== null) return <ErrorState message={batches.error} retry={batches.reload} />;

  return (
    <>
      <PageHeader
        eyebrow="Производственный контур"
        title="Замесы"
        description="Планируйте, резервируйте сырьё, фиксируйте факт и выпуск партии в одном журнале."
        actions={<button className="button primary" onClick={() => setCreateOpen(true)}><Plus size={17} /> Запланировать замес</button>}
      />

      <div className="summary-strip">
        <Summary value={String((batches.data?.items ?? []).filter((item) => item.status === "IN_PROGRESS").length)} label="в производстве" icon={<Factory />} />
        <Summary value={formatNumber((batches.data?.items ?? []).filter((item) => item.status === "COMPLETED").reduce((sum, item) => sum + Number(item.actualOutput ?? 0), 0))} label="м³ выпущено" icon={<FlaskConical />} />
        <Summary value={formatMoney((batches.data?.items ?? []).reduce((sum, item) => sum + Number(item.totalCost), 0))} label="стоимость выпуска" icon={<CircleGauge />} />
        <Summary value={String((batches.data?.items ?? []).filter((item) => item.status === "PLANNED").length)} label="в очереди" icon={<ShieldCheck />} />
      </div>

      <Panel className="table-panel">
        <div className="table-toolbar">
          <div className="segmented-control">
            {FILTERS.map(([id, label]) => <button type="button" key={id} className={filter === id ? "active" : ""} onClick={() => setFilter(id)}>{label}</button>)}
          </div>
          <div className="toolbar-actions"><label className="inline-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по замесам" /></label></div>
        </div>
        <div className="data-table-wrap">
          <table className="data-table batches-table">
            <thead><tr><th>Замес</th><th>Время</th><th>Рецептура</th><th>Линия / оператор</th><th>Объём</th><th>Выполнение</th><th>Статус</th><th /></tr></thead>
            <tbody>
              {filtered.map((batch) => {
                const progress = batch.status === "PLANNED" ? 5 : batch.status === "IN_PROGRESS" ? 62 : 100;
                return (
                  <tr key={batch.id} onClick={() => setSelectedId(batch.id)}>
                    <td><div className="primary-cell"><span className="batch-code-icon"><Factory size={16} /></span><span><strong>{batch.number}</strong><small>{batch.concreteGrade}</small></span></div></td>
                    <td><strong>{new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(batch.scheduledAt))}</strong><small>{formatDate(batch.scheduledAt)}</small></td>
                    <td><strong>{batch.recipeVersion.recipe.name}</strong><small>Версия {batch.recipeVersion.version}</small></td>
                    <td><strong>{batch.productionLine.name}</strong><small>{batch.operator.name}</small></td>
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
          onClose={() => setCreateOpen(false)}
          onCreated={async () => { setCreateOpen(false); await batches.reload(); }}
        />
      ) : null}
      {selectedId === null ? null : (
        <BatchDetailModal
          id={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={batches.reload}
        />
      )}
    </>
  );
}

function Summary({ value, label, icon }: { value: string; label: string; icon: React.ReactNode }) {
  return <div className="summary-item"><span>{icon}</span><div><strong>{value}</strong><small>{label}</small></div></div>;
}

function CreateBatchModal({
  meta,
  recipes,
  onClose,
  onCreated,
}: {
  meta: MetaData | null;
  recipes: Recipe[];
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const activeRecipes = recipes.filter((recipe) => recipe.status === "ACTIVE" && recipe.versions[0] !== undefined);
  const now = new Date(Date.now() + 5 * 60 * 1000);
  const [form, setForm] = useState({
    number: `ZM-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${String(Math.floor(Math.random() * 900) + 100)}`,
    scheduledAt: localDateTime(now),
    recipeVersionId: activeRecipes[0]?.versions[0]?.id ?? "",
    plannedVolume: "5",
    operatorId: meta?.users.find((user) => user.role === "OPERATOR")?.id ?? meta?.actor.id ?? "",
    productionLineId: meta?.productionLines[0]?.id ?? "",
    comments: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
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
    <Modal title="Новый производственный замес" onClose={onClose} wide>
      <form className="form-grid" onSubmit={(event) => void submit(event)}>
        <label><span>Номер замеса</span><input required value={form.number} onChange={(event) => setForm({ ...form, number: event.target.value })} /></label>
        <div className="form-field"><span>Дата и время</span><DateTimePicker ariaLabel="Дата и время замеса" value={form.scheduledAt} onChange={(scheduledAt) => setForm({ ...form, scheduledAt })} /></div>
        <div className="form-field span-2"><span>Рецептура</span><CustomSelect ariaLabel="Рецептура" value={form.recipeVersionId} onChange={(recipeVersionId) => setForm({ ...form, recipeVersionId })} options={activeRecipes.map((recipe) => ({ value: recipe.versions[0]?.id ?? "", label: recipe.name, description: `v${recipe.versions[0]?.version} · ${recipe.versions[0]?.concreteGrade}` })).filter((option) => option.value !== "")} /></div>
        <label><span>Плановый объём, м³</span><input required min="0.001" step="0.001" type="number" value={form.plannedVolume} onChange={(event) => setForm({ ...form, plannedVolume: event.target.value })} /></label>
        <div className="form-field"><span>Производственная линия</span><CustomSelect ariaLabel="Производственная линия" value={form.productionLineId} onChange={(productionLineId) => setForm({ ...form, productionLineId })} options={(meta?.productionLines ?? []).map((line) => ({ value: line.id, label: line.name, description: `${formatNumber(line.capacity)} ${unitLabel[line.capacityUnit]}/ч` }))} /></div>
        <div className="form-field span-2"><span>Оператор</span><CustomSelect ariaLabel="Оператор" value={form.operatorId} onChange={(operatorId) => setForm({ ...form, operatorId })} options={(meta?.users ?? []).filter((user) => ["OPERATOR", "ADMIN"].includes(user.role)).map((user) => ({ value: user.id, label: user.name, description: user.role === "ADMIN" ? "Администратор" : "Оператор" }))} /></div>
        <label className="span-2"><span>Комментарий</span><textarea rows={3} value={form.comments} onChange={(event) => setForm({ ...form, comments: event.target.value })} placeholder="Задание смены, особенности выпуска…" /></label>
        {error === null ? null : <div className="form-error span-2">{error}</div>}
        <div className="modal-actions span-2"><button type="button" className="button ghost" onClick={onClose}>Отмена</button><button className="button primary" disabled={saving}>{saving ? "Сохраняем…" : "Создать замес"}<ChevronRight size={16} /></button></div>
      </form>
    </Modal>
  );
}

function localDateTime(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function BatchDetailModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const [batch, setBatch] = useState<Batch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actuals, setActuals] = useState<Record<string, string>>({});
  const [completion, setCompletion] = useState({ actualOutput: "", goodOutput: "", rejectedOutput: "0", loss: "0", lot: "" });

  async function load(): Promise<void> {
    try {
      const value = await apiFetch<Batch>(`/batches/${id}`);
      setBatch(value);
      setActuals(Object.fromEntries((value.components ?? []).map((component) => [component.id, component.plannedQuantity])));
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
  const consumptionConfirmed = batch.materialMovements?.some((movement) => movement.type === "CONSUMPTION") ?? false;

  return (
    <Modal title={`${batch.number} · ${batch.concreteGrade}`} onClose={onClose} wide>
      <div className="detail-hero"><div><StatusBadge status={batch.status} /><h3>{batch.recipeVersion.recipe.name}</h3><p>Версия {batch.recipeVersion.version} · {batch.productionLine.name} · оператор {batch.operator.name}</p></div><div className="detail-volume"><strong>{formatNumber(batch.plannedVolume)} {unitLabel[batch.plannedVolumeUnit]}</strong><span>плановый объём</span></div></div>
      <div className="detail-facts"><span><small>План</small><strong>{formatDate(batch.scheduledAt, true)}</strong></span><span><small>Себестоимость</small><strong>{formatMoney(batch.totalCost, batch.currency)}</strong></span><span><small>Доступно</small><strong>{formatNumber(batch.availableOutput)} {unitLabel[batch.outputAccountingUnit]}</strong></span><span><small>Контроль</small><strong>{(batch.qualityChecks?.length ?? 0) > 0 ? "Пройден" : "Ожидает"}</strong></span></div>

      <div className="detail-section"><div className="section-title"><h3>Компоненты замеса</h3><span>{batch.components?.length ?? 0} позиций</span></div><div className="component-list">
        {batch.components?.map((component) => (
          <div className="component-row" key={component.id}>
            <span className="material-dot" /><div><strong>{component.materialNameSnapshot}</strong><small>Допуск ±{formatNumber(component.allowedDeviationPercent)}%</small></div><span><small>План</small><strong>{formatNumber(component.plannedQuantity)} {unitLabel[component.plannedUnit]}</strong></span><label><small>Факт</small><input disabled={consumptionConfirmed || batch.status !== "IN_PROGRESS"} type="number" step="0.001" value={actuals[component.id] ?? ""} onChange={(event) => setActuals({ ...actuals, [component.id]: event.target.value })} /></label><span className={component.withinTolerance ? "deviation-ok" : "deviation-bad"}>{consumptionConfirmed ? `${formatNumber(component.deviationPercent)}%` : "—"}</span>
          </div>
        ))}
      </div></div>

      {error === null ? null : <div className="form-error">{error}</div>}
      <div className="workflow-actions">
        {batch.status === "PLANNED" ? <button disabled={busy} className="button primary" onClick={() => void action(() => apiMutation(`/batches/${batch.id}/start`, {}, { idempotent: true }))}><Play size={16} /> Запустить и зарезервировать</button> : null}
        {batch.status === "IN_PROGRESS" && !consumptionConfirmed ? <button disabled={busy} className="button primary" onClick={() => void action(() => apiMutation(`/batches/${batch.id}/consumption`, { components: batch.components?.map((component) => ({ batchComponentId: component.id, actualQuantity: actuals[component.id] ?? component.plannedQuantity, actualUnit: component.actualUnit, lossQuantity: "0", lossUnit: component.actualUnit })) }, { idempotent: true }))}><Check size={16} /> Подтвердить расход</button> : null}
        {batch.status === "IN_PROGRESS" && consumptionConfirmed ? (
          <div className="completion-inline"><label>Партия<input value={completion.lot} onChange={(event) => setCompletion({ ...completion, lot: event.target.value })} /></label><label>Получено, м³<input type="number" step="0.001" value={completion.actualOutput} onChange={(event) => setCompletion({ ...completion, actualOutput: event.target.value, goodOutput: event.target.value })} /></label><label>Брак, м³<input type="number" step="0.001" value={completion.rejectedOutput} onChange={(event) => setCompletion({ ...completion, rejectedOutput: event.target.value, goodOutput: String(Math.max(0, Number(completion.actualOutput) - Number(event.target.value))) })} /></label><button disabled={busy} className="button primary" onClick={() => void action(() => apiMutation(`/batches/${batch.id}/complete`, { productLotNumber: completion.lot, actualVolume: completion.actualOutput, actualVolumeUnit: "M3", actualOutput: completion.actualOutput, goodOutput: completion.goodOutput, rejectedOutput: completion.rejectedOutput, technologicalLoss: completion.loss, outputUnit: "M3", densityKgPerM3: "2400" }, { idempotent: true }))}><ShieldCheck size={16} /> Завершить замес</button></div>
        ) : null}
        {["COMPLETED", "PARTIALLY_TRANSFERRED", "FULLY_TRANSFERRED"].includes(batch.status) ? <span className="locked-note"><ShieldCheck size={16} /> Расчётные данные зафиксированы и защищены от изменения</span> : null}
      </div>
    </Modal>
  );
}
