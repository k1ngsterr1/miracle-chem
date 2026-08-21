import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Boxes,
  CheckCircle2,
  Coins,
  Droplets,
  Filter,
  History,
  PackagePlus,
  Search,
  ShieldCheck,
} from "lucide-react";
import { apiMutation } from "../api.js";
import { CustomSelect } from "../components/CustomSelect.js";
import { DateTimePicker } from "../components/DateTimePicker.js";
import { useApi } from "../hooks/use-api.js";
import type {
  Material,
  MaterialMovement,
  MaterialPrice,
  Unit,
} from "../types.js";
import { formatDate, formatMoney, formatNumber, unitLabel } from "../lib/format.js";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  PageHeader,
  Panel,
  ProgressBar,
  StatusBadge,
} from "../components/ui.js";

const MATERIAL_LABELS: Record<string, string> = {
  CEMENT: "Цемент",
  WATER: "Вода",
  SAND: "Песок",
  AGGREGATE: "Щебень",
  CHEMICAL_ADDITIVE: "Химдобавка",
  REAGENT: "Реагент",
  OTHER: "Другое",
};

const MOVEMENT_LABELS: Record<string, string> = {
  RECEIPT: "Приход",
  RESERVATION: "Резерв",
  RESERVATION_RELEASE: "Снятие резерва",
  CONSUMPTION: "Расход",
  RETURN: "Возврат",
  LOSS: "Потеря",
  ADJUSTMENT: "Корректировка",
};

const MATERIAL_TYPE_OPTIONS = Object.entries(MATERIAL_LABELS).map(([value, label]) => ({ value, label }));
const UNIT_OPTIONS: Array<{ value: Unit; label: string }> = (Object.keys(unitLabel) as Unit[]).map((value) => ({
  value,
  label: `${unitLabel[value]} · ${value}`,
}));

interface WarehouseHistory {
  material: Material & { priceHistory: MaterialPrice[] };
  movements: MaterialMovement[];
}

export function MaterialsPage() {
  const materials = useApi<{ items: Material[] }>("/materials");
  const [query, setQuery] = useState("");
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [selected, setSelected] = useState<Material | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [receiptMaterial, setReceiptMaterial] = useState<Material | null>(null);
  const [consumptionMaterial, setConsumptionMaterial] = useState<Material | null>(null);
  const filtered = useMemo(
    () => (materials.data?.items ?? []).filter((material) => {
      const matchesQuery = [material.name, material.code, MATERIAL_LABELS[material.type] ?? material.type]
        .some((value) => value.toLocaleLowerCase("ru").includes(query.toLocaleLowerCase("ru")));
      return matchesQuery && (!criticalOnly || material.isCritical);
    }),
    [criticalOnly, materials.data, query],
  );

  if (materials.loading) return <LoadingState />;
  if (materials.error !== null) return <ErrorState message={materials.error} retry={materials.reload} />;
  const all = materials.data?.items ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Складской контур"
        title="Склад"
        description="Остатки по партиям, приход и расход, резервы производства и полная история закупочных цен."
        actions={(
          <>
            <button className="button ghost" disabled={all.length === 0} onClick={() => setConsumptionMaterial(all[0] ?? null)}>
              <ChevronUp size={17} /> Расход
            </button>
            <button className="button ghost" disabled={all.length === 0} onClick={() => setReceiptMaterial(all[0] ?? null)}>
              <ChevronDown size={17} /> Приход
            </button>
            <button className="button primary" onClick={() => setCreateOpen(true)}>
              <PackagePlus size={17} /> Новая позиция
            </button>
          </>
        )}
      />

      <div className="stock-overview">
        <Panel className="stock-health">
          <div className="stock-health-icon"><ShieldCheck size={24} /></div>
          <div>
            <span className="eyebrow">Состояние склада</span>
            <strong>{all.filter((item) => item.isCritical).length === 0 ? "Все остатки в норме" : `${all.filter((item) => item.isCritical).length} критических позиций`}</strong>
            <p>{all.length} позиций · {all.reduce((sum, item) => sum + (item.lots?.length ?? 0), 0)} активных партий</p>
          </div>
        </Panel>
        <Panel className="stock-mini"><span><Coins size={18} /></span><div><small>Стоимость запасов</small><strong>{formatMoney(all.reduce((sum, item) => sum + Number(item.currentStock) * Number(item.costPerBaseUnit), 0))}</strong></div></Panel>
        <Panel className="stock-mini"><span className="amber"><AlertTriangle size={18} /></span><div><small>Зарезервировано</small><strong>{formatNumber(all.reduce((sum, item) => sum + Number(item.reservedStock), 0))}</strong></div></Panel>
      </div>

      <Panel className="table-panel">
        <div className="table-toolbar">
          <div><h2>Складской журнал</h2><p>Остатки приведены к базовой единице каждой позиции</p></div>
          <div className="toolbar-actions">
            <label className="inline-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Позиция или код" /></label>
            <button
              type="button"
              className={`icon-button ${criticalOnly ? "active" : ""}`}
              aria-label={criticalOnly ? "Показать все позиции" : "Показать только критические позиции"}
              aria-pressed={criticalOnly}
              onClick={() => setCriticalOnly((value) => !value)}
            >
              <Filter size={17} />
            </button>
          </div>
        </div>
        <div className="data-table-wrap">
          <table className="data-table materials-table">
            <thead><tr><th>Позиция</th><th>Тип</th><th>Общий остаток</th><th>Свободно</th><th>Резерв</th><th>Минимум</th><th>Уровень</th><th>Текущая цена</th></tr></thead>
            <tbody>
              {filtered.map((material) => {
                const level = Number(material.minimumStock) === 0 ? 100 : (Number(material.currentStock) / Number(material.minimumStock)) * 50;
                return (
                  <tr key={material.id} onClick={() => setSelected(material)}>
                    <td><div className="primary-cell"><span className={`material-type-icon type-${material.type.toLowerCase()}`}>{material.type === "WATER" ? <Droplets size={16} /> : <Boxes size={16} />}</span><span><strong>{material.name}</strong><small>{material.code}</small></span></div></td>
                    <td><span className="soft-tag">{MATERIAL_LABELS[material.type] ?? material.type}</span></td>
                    <td><strong>{formatNumber(material.currentStock)} {unitLabel[material.baseUnit]}</strong><small>{material.lots?.length ?? 0} активных партий</small></td>
                    <td><strong>{formatNumber(Number(material.currentStock) - Number(material.reservedStock))} {unitLabel[material.baseUnit]}</strong></td>
                    <td>{formatNumber(material.reservedStock)} {unitLabel[material.baseUnit]}</td>
                    <td>{formatNumber(material.minimumStock)} {unitLabel[material.baseUnit]}</td>
                    <td><div className="stock-level"><ProgressBar value={level} tone={material.isCritical ? "red" : level < 80 ? "amber" : "lime"} /><span>{material.isCritical ? "Критично" : "Норма"}</span></div></td>
                    <td>{formatMoney(material.costPerBaseUnit, material.currency)}<small>за {unitLabel[material.baseUnit]}</small></td>
                  </tr>
                );
              })}
              {filtered.length === 0 ? <tr className="table-empty-row"><td colSpan={8}>{criticalOnly ? "Критических позиций нет." : "По запросу ничего не найдено."}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Panel>

      {selected === null ? null : (
        <MaterialDetail
          material={selected}
          onClose={() => setSelected(null)}
          onReceipt={() => { setSelected(null); setReceiptMaterial(selected); }}
          onConsumption={() => { setSelected(null); setConsumptionMaterial(selected); }}
        />
      )}
      {createOpen ? <CreateMaterialModal onClose={() => setCreateOpen(false)} onCreated={async () => { setCreateOpen(false); await materials.reload(); }} /> : null}
      {receiptMaterial === null ? null : <ReceiptModal materials={all} initial={receiptMaterial} onClose={() => setReceiptMaterial(null)} onCreated={async () => { setReceiptMaterial(null); await materials.reload(); }} />}
      {consumptionMaterial === null ? null : <ConsumptionModal materials={all} initial={consumptionMaterial} onClose={() => setConsumptionMaterial(null)} onCreated={async () => { setConsumptionMaterial(null); await materials.reload(); }} />}
    </>
  );
}

function MaterialDetail({
  material,
  onClose,
  onReceipt,
  onConsumption,
}: {
  material: Material;
  onClose: () => void;
  onReceipt: () => void;
  onConsumption: () => void;
}) {
  const history = useApi<WarehouseHistory>(`/materials/${material.id}/history`);
  const detail = history.data?.material ?? material;
  return (
    <Modal title={material.name} onClose={onClose} wide>
      <div className="detail-hero">
        <div><span className="soft-tag">{MATERIAL_LABELS[material.type] ?? material.type}</span><h3>{material.code}</h3><p>Плотность {material.densityKgPerM3 === null ? "не задана" : `${formatNumber(material.densityKgPerM3)} кг/м³`} · учёт в {unitLabel[material.baseUnit]}</p></div>
        <div className="detail-volume"><strong>{formatNumber(detail.currentStock)} {unitLabel[detail.baseUnit]}</strong><span>на складе</span></div>
      </div>
      <div className="warehouse-detail-actions">
        <button className="button ghost small" onClick={onConsumption}><ChevronUp size={15} /> Оформить расход</button>
        <button className="button primary small" onClick={onReceipt}><ChevronDown size={15} /> Оформить приход</button>
      </div>
      {history.loading ? <LoadingState /> : history.error !== null ? <ErrorState message={history.error} retry={history.reload} /> : (
        <div className="warehouse-history-grid">
          <section>
            <div className="section-title"><h3>Партии</h3><span>{detail.lots?.length ?? 0}</span></div>
            <div className="lots-list compact-list">
              {(detail.lots ?? []).map((lot) => (
                <div className="lot-row" key={lot.id}>
                  <span className="lot-status"><CheckCircle2 size={16} /></span>
                  <div><strong>{lot.lotNumber}</strong><small>{lot.supplier?.name ?? "Без поставщика"} · {formatDate(lot.receivedAt)}</small></div>
                  <span><small>Остаток</small><strong>{formatNumber(Number(lot.availableQuantity) - Number(lot.reservedQuantity))} {unitLabel[lot.unit]}</strong></span>
                  <span><small>Цена</small><strong>{formatMoney(lot.unitCost, lot.currency)}</strong></span>
                </div>
              ))}
            </div>
          </section>
          <section>
            <div className="section-title"><h3>История цен</h3><span><History size={14} /> {detail.priceHistory?.length ?? 0}</span></div>
            <div className="price-history-list">
              {(detail.priceHistory ?? []).map((price, index) => {
                const previous = detail.priceHistory?.[index + 1];
                const delta = previous === undefined ? null : Number(price.pricePerBaseUnit) - Number(previous.pricePerBaseUnit);
                return (
                  <div key={price.id}>
                    <span><strong>{formatMoney(price.pricePerBaseUnit, price.currency)}</strong><small>{price.note ?? price.source}</small></span>
                    <span><strong className={delta !== null && delta > 0 ? "price-up" : ""}>{delta === null ? "—" : `${delta > 0 ? "+" : ""}${formatNumber(delta)}`}</strong><small>{formatDate(price.effectiveAt, true)}</small></span>
                  </div>
                );
              })}
              {(detail.priceHistory?.length ?? 0) === 0 ? <EmptyState title="История пока пуста" text="Новая цена появится после прихода." /> : null}
            </div>
          </section>
          <section className="warehouse-movements">
            <div className="section-title"><h3>Движения</h3><span>{history.data?.movements.length ?? 0}</span></div>
            <div className="movement-list">
              {(history.data?.movements ?? []).slice(0, 30).map((movement) => (
                <div key={movement.id}>
                  <span className={`movement-mark ${movement.type.toLowerCase()}`} />
                  <span><strong>{MOVEMENT_LABELS[movement.type] ?? movement.type}</strong><small>Партия {movement.materialLot.lotNumber}{movement.batch === null ? "" : ` · замес ${movement.batch.number}`}</small></span>
                  <span><strong>{movement.type === "RECEIPT" || movement.type === "RETURN" ? "+" : movement.type === "RESERVATION" ? "" : "−"}{formatNumber(movement.baseQuantity)} {unitLabel[movement.baseUnit]}</strong><small>{formatDate(movement.occurredAt, true)}</small></span>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </Modal>
  );
}

function CreateMaterialModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [form, setForm] = useState({ code: "", name: "", type: "CEMENT", baseUnit: "KG" as Unit, densityKgPerM3: "", costPerBaseUnit: "0", minimumStock: "0" });
  const [error, setError] = useState<string | null>(null);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      await apiMutation("/materials", { ...form, densityKgPerM3: form.densityKgPerM3 || undefined });
      await onCreated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось создать позицию"); }
  }
  return (
    <Modal title="Новая складская позиция" onClose={onClose}>
      <form className="form-grid" onSubmit={(event) => void submit(event)}>
        <label><span>Код</span><input required value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} /></label>
        <label><span>Название</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <div className="form-field"><span>Тип</span><CustomSelect ariaLabel="Тип складской позиции" value={form.type} onChange={(type) => setForm({ ...form, type })} options={MATERIAL_TYPE_OPTIONS} /></div>
        <div className="form-field"><span>Единица учёта</span><CustomSelect ariaLabel="Единица учёта" value={form.baseUnit} onChange={(baseUnit) => setForm({ ...form, baseUnit: baseUnit as Unit })} options={UNIT_OPTIONS} /></div>
        <label><span>Начальная цена</span><input type="number" min="0" step="0.01" required value={form.costPerBaseUnit} onChange={(event) => setForm({ ...form, costPerBaseUnit: event.target.value })} /></label>
        <label><span>Минимальный остаток</span><input type="number" min="0" step="0.001" required value={form.minimumStock} onChange={(event) => setForm({ ...form, minimumStock: event.target.value })} /></label>
        <label className="span-2"><span>Плотность, кг/м³</span><input type="number" min="0" step="0.001" value={form.densityKgPerM3} onChange={(event) => setForm({ ...form, densityKgPerM3: event.target.value })} placeholder="Для пересчёта массы и объёма" /></label>
        {error === null ? null : <div className="form-error span-2">{error}</div>}
        <div className="modal-actions span-2"><button type="button" className="button ghost" onClick={onClose}>Отмена</button><button className="button primary">Создать позицию</button></div>
      </form>
    </Modal>
  );
}

function ReceiptModal({ materials, initial, onClose, onCreated }: { materials: Material[]; initial: Material; onClose: () => void; onCreated: () => Promise<void> }) {
  const defaultExpiry = new Date();
  defaultExpiry.setFullYear(defaultExpiry.getFullYear() + 1);
  const [form, setForm] = useState({ materialId: initial.id, lotNumber: `${initial.code}-${Date.now().toString().slice(-5)}`, supplierName: "", quantity: "1000", unit: initial.baseUnit, unitCost: initial.costPerBaseUnit, receivedAt: localDateTime(), expiresAt: localDate(defaultExpiry), certificateNumber: "" });
  const [error, setError] = useState<string | null>(null);
  const material = materials.find((item) => item.id === form.materialId) ?? initial;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      await apiMutation("/materials/receipts", {
        ...form,
        receivedAt: new Date(form.receivedAt).toISOString(),
        expiresAt: new Date(form.expiresAt).toISOString(),
        supplierName: form.supplierName || undefined,
        certificateNumber: form.certificateNumber || undefined,
      }, { idempotent: true });
      await onCreated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось оформить приход"); }
  }
  return (
    <Modal title="Приход на склад" onClose={onClose} wide>
      <form className="form-grid" onSubmit={(event) => void submit(event)}>
        <div className="form-field span-2"><span>Складская позиция</span><CustomSelect ariaLabel="Складская позиция для прихода" value={form.materialId} onChange={(materialId) => { const next = materials.find((item) => item.id === materialId); setForm({ ...form, materialId, unit: next?.baseUnit ?? form.unit, unitCost: next?.costPerBaseUnit ?? form.unitCost, lotNumber: `${next?.code ?? "LOT"}-${Date.now().toString().slice(-5)}` }); }} options={materials.map((item) => ({ value: item.id, label: item.name, description: `${item.code} · остаток ${formatNumber(item.currentStock)} ${unitLabel[item.baseUnit]}` }))} /></div>
        <label><span>Номер партии</span><input required value={form.lotNumber} onChange={(event) => setForm({ ...form, lotNumber: event.target.value })} /></label>
        <label><span>Поставщик</span><input value={form.supplierName} onChange={(event) => setForm({ ...form, supplierName: event.target.value })} /></label>
        <div className="form-field"><span>Дата и время поступления</span><DateTimePicker ariaLabel="Дата и время поступления" value={form.receivedAt} onChange={(receivedAt) => setForm({ ...form, receivedAt })} /></div>
        <div className="form-field"><span>Срок годности</span><DateTimePicker mode="date" ariaLabel="Срок годности партии" value={form.expiresAt} onChange={(expiresAt) => setForm({ ...form, expiresAt })} align="right" /></div>
        <label><span>Количество, {unitLabel[material.baseUnit]}</span><input type="number" min="0.001" step="0.001" required value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></label>
        <label><span>Цена единицы</span><input type="number" min="0" step="0.01" required value={form.unitCost} onChange={(event) => setForm({ ...form, unitCost: event.target.value })} /></label>
        <label className="span-2"><span>Сертификат</span><input value={form.certificateNumber} onChange={(event) => setForm({ ...form, certificateNumber: event.target.value })} /></label>
        {error === null ? null : <div className="form-error span-2">{error}</div>}
        <div className="modal-actions span-2"><button type="button" className="button ghost" onClick={onClose}>Отмена</button><button className="button primary"><ChevronDown size={16} /> Оприходовать</button></div>
      </form>
    </Modal>
  );
}

function ConsumptionModal({ materials, initial, onClose, onCreated }: { materials: Material[]; initial: Material; onClose: () => void; onCreated: () => Promise<void> }) {
  const [form, setForm] = useState({ materialId: initial.id, quantity: "1", unit: initial.baseUnit, consumedAt: localDateTime(), reason: "Производственные нужды", reference: "" });
  const [error, setError] = useState<string | null>(null);
  const material = materials.find((item) => item.id === form.materialId) ?? initial;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      await apiMutation("/materials/consumptions", {
        ...form,
        consumedAt: new Date(form.consumedAt).toISOString(),
        reference: form.reference || undefined,
      }, { idempotent: true });
      await onCreated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось оформить расход"); }
  }
  return (
    <Modal title="Расход со склада" onClose={onClose} wide>
      <form className="form-grid" onSubmit={(event) => void submit(event)}>
        <div className="form-field span-2"><span>Складская позиция</span><CustomSelect ariaLabel="Складская позиция для расхода" value={form.materialId} onChange={(materialId) => { const next = materials.find((item) => item.id === materialId); setForm({ ...form, materialId, unit: next?.baseUnit ?? form.unit }); }} options={materials.map((item) => ({ value: item.id, label: item.name, description: `Свободно ${formatNumber(Number(item.currentStock) - Number(item.reservedStock))} ${unitLabel[item.baseUnit]}` }))} /></div>
        <label><span>Количество, {unitLabel[material.baseUnit]}</span><input type="number" min="0.001" step="0.001" required value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></label>
        <div className="form-field"><span>Дата и время расхода</span><DateTimePicker ariaLabel="Дата и время расхода" value={form.consumedAt} onChange={(consumedAt) => setForm({ ...form, consumedAt })} align="right" /></div>
        <label><span>Основание</span><input required minLength={3} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></label>
        <label><span>Документ / заявка</span><input value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} placeholder="Необязательно" /></label>
        <div className="consumption-warning span-2"><ShieldCheck size={17} /><span>Расход спишется по FEFO-партиям. Зарезервированный под замесы объём останется защищён.</span></div>
        {error === null ? null : <div className="form-error span-2">{error}</div>}
        <div className="modal-actions span-2"><button type="button" className="button ghost" onClick={onClose}>Отмена</button><button className="button primary"><ChevronUp size={16} /> Провести расход</button></div>
      </form>
    </Modal>
  );
}

function localDateTime(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function localDate(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}
