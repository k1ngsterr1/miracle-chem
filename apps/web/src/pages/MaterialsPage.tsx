import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  Boxes,
  CheckCircle2,
  Droplets,
  Filter,
  PackagePlus,
  Search,
  ShieldCheck,
} from "lucide-react";
import { apiMutation } from "../api.js";
import { useApi } from "../hooks/use-api.js";
import type { Material, Unit } from "../types.js";
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

const MATERIAL_LABELS: Record<string, string> = {
  CEMENT: "Цемент",
  WATER: "Вода",
  SAND: "Песок",
  AGGREGATE: "Щебень",
  CHEMICAL_ADDITIVE: "Химдобавка",
  REAGENT: "Реагент",
  OTHER: "Другое",
};

export function MaterialsPage() {
  const materials = useApi<{ items: Material[] }>("/materials");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Material | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [receiptMaterial, setReceiptMaterial] = useState<Material | null>(null);
  const filtered = useMemo(
    () => (materials.data?.items ?? []).filter((material) =>
      [material.name, material.code, MATERIAL_LABELS[material.type] ?? material.type]
        .some((value) => value.toLocaleLowerCase("ru").includes(query.toLocaleLowerCase("ru"))),
    ),
    [materials.data, query],
  );

  if (materials.loading) return <LoadingState />;
  if (materials.error !== null) return <ErrorState message={materials.error} retry={materials.reload} />;
  const all = materials.data?.items ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Склад сырья"
        title="Материалы и реагенты"
        description="Партии, сертификаты, свободный остаток и резерв под производственные замесы."
        actions={<><button className="button ghost" onClick={() => setReceiptMaterial(all[0] ?? null)}><ArrowDownToLine size={17} /> Приход</button><button className="button primary" onClick={() => setCreateOpen(true)}><PackagePlus size={17} /> Новый материал</button></>}
      />

      <div className="stock-overview">
        <Panel className="stock-health"><div className="stock-health-icon"><ShieldCheck size={24} /></div><div><span className="eyebrow">Состояние склада</span><strong>{all.filter((item) => item.isCritical).length === 0 ? "Все остатки в норме" : `${all.filter((item) => item.isCritical).length} критических позиций`}</strong><p>{all.length} материалов · {all.reduce((sum, item) => sum + (item.lots?.length ?? 0), 0)} активных партий</p></div></Panel>
        <Panel className="stock-mini"><span><Boxes size={18} /></span><div><small>Стоимость запасов</small><strong>{formatMoney(all.reduce((sum, item) => sum + Number(item.currentStock) * Number(item.costPerBaseUnit), 0))}</strong></div></Panel>
        <Panel className="stock-mini"><span className="amber"><AlertTriangle size={18} /></span><div><small>Зарезервировано</small><strong>{formatNumber(all.reduce((sum, item) => sum + Number(item.reservedStock), 0))}</strong></div></Panel>
      </div>

      <Panel className="table-panel">
        <div className="table-toolbar"><div><h2>Складской справочник</h2><p>Остатки приведены к базовой единице материала</p></div><div className="toolbar-actions"><label className="inline-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Материал или код" /></label><button className="icon-button"><Filter size={17} /></button></div></div>
        <div className="data-table-wrap"><table className="data-table materials-table"><thead><tr><th>Материал</th><th>Тип</th><th>Общий остаток</th><th>Свободно</th><th>Резерв</th><th>Минимум</th><th>Уровень</th><th>Цена</th></tr></thead><tbody>
          {filtered.map((material) => {
            const level = Number(material.minimumStock) === 0 ? 100 : (Number(material.currentStock) / Number(material.minimumStock)) * 50;
            return <tr key={material.id} onClick={() => setSelected(material)}><td><div className="primary-cell"><span className={`material-type-icon type-${material.type.toLowerCase()}`}>{material.type === "WATER" ? <Droplets size={16} /> : <Boxes size={16} />}</span><span><strong>{material.name}</strong><small>{material.code}</small></span></div></td><td><span className="soft-tag">{MATERIAL_LABELS[material.type] ?? material.type}</span></td><td><strong>{formatNumber(material.currentStock)} {unitLabel[material.baseUnit]}</strong><small>{material.lots?.length ?? 0} активных партий</small></td><td><strong>{formatNumber(Number(material.currentStock) - Number(material.reservedStock))} {unitLabel[material.baseUnit]}</strong></td><td>{formatNumber(material.reservedStock)} {unitLabel[material.baseUnit]}</td><td>{formatNumber(material.minimumStock)} {unitLabel[material.baseUnit]}</td><td><div className="stock-level"><ProgressBar value={level} tone={material.isCritical ? "red" : level < 80 ? "amber" : "lime"} /><span>{material.isCritical ? "Критично" : "Норма"}</span></div></td><td>{formatMoney(material.costPerBaseUnit)}<small>за {unitLabel[material.baseUnit]}</small></td></tr>;
          })}
        </tbody></table></div>
      </Panel>

      {selected === null ? null : <MaterialDetail material={selected} onClose={() => setSelected(null)} onReceipt={() => { setSelected(null); setReceiptMaterial(selected); }} />}
      {createOpen ? <CreateMaterialModal onClose={() => setCreateOpen(false)} onCreated={async () => { setCreateOpen(false); await materials.reload(); }} /> : null}
      {receiptMaterial === null ? null : <ReceiptModal material={receiptMaterial} onClose={() => setReceiptMaterial(null)} onCreated={async () => { setReceiptMaterial(null); await materials.reload(); }} />}
    </>
  );
}

function MaterialDetail({ material, onClose, onReceipt }: { material: Material; onClose: () => void; onReceipt: () => void }) {
  return <Modal title={material.name} onClose={onClose} wide><div className="detail-hero"><div><span className="soft-tag">{MATERIAL_LABELS[material.type] ?? material.type}</span><h3>{material.code}</h3><p>Плотность {material.densityKgPerM3 === null ? "не задана" : `${formatNumber(material.densityKgPerM3)} кг/м³`} · учёт в {unitLabel[material.baseUnit]}</p></div><div className="detail-volume"><strong>{formatNumber(material.currentStock)} {unitLabel[material.baseUnit]}</strong><span>на складе</span></div></div><div className="lots-list"><div className="section-title"><h3>Активные партии</h3><button className="button ghost small" onClick={onReceipt}><ArrowDownToLine size={15} /> Приход</button></div>{material.lots?.map((lot) => <div className="lot-row" key={lot.id}><span className="lot-status"><CheckCircle2 size={16} /></span><div><strong>{lot.lotNumber}</strong><small>Поступила {formatDate(lot.receivedAt)} · сертификат {lot.certificateNumber ?? "—"}</small></div><span><small>Годен до</small><strong>{lot.expiresAt === null ? "Без срока" : formatDate(lot.expiresAt)}</strong></span><span><small>Свободно</small><strong>{formatNumber(Number(lot.availableQuantity) - Number(lot.reservedQuantity))} {unitLabel[lot.unit]}</strong></span><StatusBadge status="AVAILABLE" /></div>)}</div></Modal>;
}

function CreateMaterialModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [form, setForm] = useState({ code: "", name: "", type: "CEMENT", baseUnit: "KG" as Unit, densityKgPerM3: "", costPerBaseUnit: "0", minimumStock: "0" });
  const [error, setError] = useState<string | null>(null);
  async function submit(event: React.FormEvent) { event.preventDefault(); try { await apiMutation("/materials", { ...form, densityKgPerM3: form.densityKgPerM3 || undefined }); await onCreated(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Ошибка"); } }
  return <Modal title="Новый материал" onClose={onClose}><form className="form-grid" onSubmit={(event) => void submit(event)}><label><span>Код</span><input required value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} /></label><label><span>Название</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label><span>Тип</span><select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>{Object.entries(MATERIAL_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label><span>Базовая единица</span><select value={form.baseUnit} onChange={(event) => setForm({ ...form, baseUnit: event.target.value as Unit })}>{Object.entries(unitLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label><span>Плотность, кг/м³</span><input type="number" min="0" value={form.densityKgPerM3} onChange={(event) => setForm({ ...form, densityKgPerM3: event.target.value })} /></label><label><span>Стоимость единицы</span><input type="number" min="0" step="0.01" value={form.costPerBaseUnit} onChange={(event) => setForm({ ...form, costPerBaseUnit: event.target.value })} /></label><label className="span-2"><span>Минимальный остаток</span><input type="number" min="0" value={form.minimumStock} onChange={(event) => setForm({ ...form, minimumStock: event.target.value })} /></label>{error === null ? null : <div className="form-error span-2">{error}</div>}<div className="modal-actions span-2"><button type="button" className="button ghost" onClick={onClose}>Отмена</button><button className="button primary">Создать</button></div></form></Modal>;
}

function ReceiptModal({ material, onClose, onCreated }: { material: Material; onClose: () => void; onCreated: () => Promise<void> }) {
  const [form, setForm] = useState({ lotNumber: `${material.code}-${Date.now().toString().slice(-5)}`, supplierName: "", quantity: "1000", unit: material.baseUnit, unitCost: material.costPerBaseUnit, receivedAt: new Date().toISOString().slice(0, 10), certificateNumber: "" });
  const [error, setError] = useState<string | null>(null);
  async function submit(event: React.FormEvent) { event.preventDefault(); try { await apiMutation("/materials/receipts", { ...form, materialId: material.id, receivedAt: new Date(form.receivedAt).toISOString(), supplierName: form.supplierName || undefined, certificateNumber: form.certificateNumber || undefined }, { idempotent: true }); await onCreated(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Ошибка"); } }
  return <Modal title={`Приход · ${material.name}`} onClose={onClose}><form className="form-grid" onSubmit={(event) => void submit(event)}><label><span>Номер партии</span><input required value={form.lotNumber} onChange={(event) => setForm({ ...form, lotNumber: event.target.value })} /></label><label><span>Дата поступления</span><input type="date" required value={form.receivedAt} onChange={(event) => setForm({ ...form, receivedAt: event.target.value })} /></label><label><span>Количество, {unitLabel[material.baseUnit]}</span><input type="number" min="0.001" step="0.001" required value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></label><label><span>Цена единицы</span><input type="number" min="0" step="0.01" required value={form.unitCost} onChange={(event) => setForm({ ...form, unitCost: event.target.value })} /></label><label><span>Поставщик</span><input value={form.supplierName} onChange={(event) => setForm({ ...form, supplierName: event.target.value })} /></label><label><span>Сертификат</span><input value={form.certificateNumber} onChange={(event) => setForm({ ...form, certificateNumber: event.target.value })} /></label>{error === null ? null : <div className="form-error span-2">{error}</div>}<div className="modal-actions span-2"><button type="button" className="button ghost" onClick={onClose}>Отмена</button><button className="button primary">Оприходовать</button></div></form></Modal>;
}

