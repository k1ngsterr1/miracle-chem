import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Boxes,
  CheckCircle2,
  CircleDollarSign,
  Coins,
  Droplets,
  Filter,
  History,
  PackageOpen,
  PackagePlus,
  Plus,
  Search,
  Scale,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { apiMutation } from "../api.js";
import { CustomSelect } from "../components/CustomSelect.js";
import { DateTimePicker } from "../components/DateTimePicker.js";
import { useApi } from "../hooks/use-api.js";
import { oneCDocumentStatus, sourceDecimal, sumSourceDecimals, useOneCSource, type OneCReceipt } from "../hooks/use-one-c-source.js";
import type {
  Material,
  MaterialListResponse,
  MaterialMovement,
  MaterialPrice,
  PurchaseBatch,
  Recipe,
  SupplierSummary,
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

interface DraftPurchaseItem {
  key: string;
  materialId: string;
  supplierName: string;
  quantity: string;
  unitCost: string;
  expiresAt: string;
  certificateNumber: string;
}

interface OneCSyncReview {
  id: string;
  entityType: string;
  externalId: string;
  payload: unknown;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
  resolutionNote: string | null;
}

interface AdjustmentDocument {
  id: string;
  number: string;
  status: "DRAFT" | "APPROVED" | "APPLIED" | "CANCELLED";
  targetType: string;
  targetId: string;
  reason: string;
  createdAt: string;
  createdBy: { name: string };
  approvedBy: { name: string } | null;
}

export function MaterialsPage({ actorRole }: { actorRole: string | undefined }) {
  const materials = useApi<MaterialListResponse>("/materials");
  const purchaseBatches = useApi<{ items: PurchaseBatch[]; suppliers: SupplierSummary[] }>("/materials/purchase-batches");
  const receipts = useOneCSource<OneCReceipt>("receipts", "receivedAt", ["ADMIN", "DIRECTOR"].includes(actorRole ?? ""));
  const canManageMaterials = ["ADMIN", "DIRECTOR", "TECHNOLOGIST", "STOREKEEPER"].includes(actorRole ?? "");
  const canMoveMaterials = ["ADMIN", "DIRECTOR", "TECHNOLOGIST", "OPERATOR", "STOREKEEPER"].includes(actorRole ?? "");
  const canViewRecipes = ["ADMIN", "DIRECTOR", "TECHNOLOGIST"].includes(actorRole ?? "");
  const recipes = useApi<{ items: Recipe[] }>(canViewRecipes ? "/recipes" : null);
  const oneCSyncReviews = useApi<{ items: OneCSyncReview[] }>("/integrations/1c/reviews");
  const [query, setQuery] = useState("");
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [selected, setSelected] = useState<Material | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [selectedPurchase, setSelectedPurchase] = useState<PurchaseBatch | null>(null);
  const [selectedReceipt, setSelectedReceipt] = useState<OneCReceipt[] | null>(null);
  const [purchaseQuery, setPurchaseQuery] = useState("");
  const [visiblePurchases, setVisiblePurchases] = useState(30);
  const [receiptMaterial, setReceiptMaterial] = useState<Material | null>(null);
  const [consumptionMaterial, setConsumptionMaterial] = useState<Material | null>(null);
  const [reviewAction, setReviewAction] = useState<OneCSyncReview | null>(null);
  const [adjustmentsOpen, setAdjustmentsOpen] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const filtered = useMemo(
    () => (materials.data?.items ?? []).filter((material) => {
      const matchesQuery = [material.name, material.code, MATERIAL_LABELS[material.type] ?? material.type]
        .some((value) => value.toLocaleLowerCase("ru").includes(query.toLocaleLowerCase("ru")));
      return matchesQuery && (!criticalOnly || material.isCritical);
    }),
    [criticalOnly, materials.data, query],
  );
  const purchaseRows = useMemo(() => {
    const imported = new Map<string, OneCReceipt[]>();
    for (const receipt of receipts.items) {
      const group = imported.get(receipt.documentId) ?? [];
      group.push(receipt);
      imported.set(receipt.documentId, group);
    }
    return [
      ...(purchaseBatches.data?.items ?? []).map((value) => ({ kind: "purchase" as const, value, date: value.receivedAt })),
      ...[...imported.entries()].map(([id, value]) => ({ kind: "receipt" as const, id, value, date: value[0]!.receivedAt })),
    ].filter((row) => {
      const needle = purchaseQuery.trim().toLocaleLowerCase("ru");
      if (!needle) return true;
      const fields = row.kind === "purchase"
        ? [row.value.number, ...row.value.items.flatMap((item) => [item.material.name, item.supplier?.name])]
        : [row.value[0]?.number, row.value[0]?.supplier, ...row.value.map((item) => item.material)];
      return fields.some((field) => field?.toLocaleLowerCase("ru").includes(needle));
    }).sort((a, b) => b.date.localeCompare(a.date));
  }, [purchaseBatches.data, purchaseQuery, receipts.items]);
  useEffect(() => setVisiblePurchases(30), [purchaseQuery]);

  if (materials.loading || purchaseBatches.loading || recipes.loading) return <LoadingState />;
  if (materials.error !== null) return <ErrorState message={materials.error} retry={materials.reload} />;
  if (purchaseBatches.error !== null) return <ErrorState message={purchaseBatches.error} retry={purchaseBatches.reload} />;
  if (recipes.error !== null) return <ErrorState message={recipes.error} retry={recipes.reload} />;
  const all = materials.data?.items ?? [];
  const writableMaterials = all.filter((material) => material.stockAuthority !== "1C");
  const gluconate = materials.data?.summary?.sodiumGluconate;
  const recipeItems = recipes.data?.items ?? [];
  const pendingReviews = (oneCSyncReviews.data?.items ?? []).filter((review) => review.status === "PENDING");
  const canManageOneC = canManageMaterials;
  const canViewAdjustments = ["ADMIN", "DIRECTOR", "TECHNOLOGIST"].includes(actorRole ?? "");
  const canApplyAdjustments = ["ADMIN", "TECHNOLOGIST"].includes(actorRole ?? "");

  async function approveReview(review: OneCSyncReview): Promise<void> {
    setReviewBusy(true);
    try {
      await apiMutation(`/integrations/1c/reviews/${review.id}/approve`, {}, { idempotent: true });
      await Promise.all([materials.reload(), oneCSyncReviews.reload()]);
    } finally {
      setReviewBusy(false);
    }
  }

  async function rejectReview(note: string): Promise<void> {
    if (reviewAction === null) return;
    setReviewBusy(true);
    try {
      await apiMutation(`/integrations/1c/reviews/${reviewAction.id}/reject`, { note }, { idempotent: true });
      setReviewAction(null);
      await oneCSyncReviews.reload();
    } finally {
      setReviewBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Склад"
        actions={(
          <>
            {canMoveMaterials ? <button className="button ghost" disabled={writableMaterials.length === 0} title={writableMaterials.length === 0 ? "Остатками управляет 1С" : undefined} onClick={() => setConsumptionMaterial(writableMaterials[0] ?? null)}>
              <ChevronUp size={17} /> Расход
            </button> : null}
            {canMoveMaterials ? <button className="button ghost" disabled={writableMaterials.length === 0} title={writableMaterials.length === 0 ? "Остатками управляет 1С" : undefined} onClick={() => setReceiptMaterial(writableMaterials[0] ?? null)}>
              <ChevronDown size={17} /> Приход
            </button> : null}
            {canManageMaterials ? <button className="button ghost" onClick={() => setCreateOpen(true)}>
              <PackagePlus size={17} /> Новая позиция
            </button> : null}
            {canViewAdjustments ? <button className="button ghost" onClick={() => setAdjustmentsOpen(true)}>
              <History size={17} /> Корректировки
            </button> : null}
            {canManageMaterials && canViewRecipes ? <button className="button primary" disabled={writableMaterials.length === 0} title={writableMaterials.length === 0 ? "Остатками управляет 1С" : undefined} onClick={() => setPurchaseOpen(true)}>
              <PackageOpen size={17} /> Новая партия
            </button> : null}
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
        <Panel className="stock-mini gluconate-total"><span><Scale size={18} /></span><div><small>Общая масса глюконата</small><strong>{formatNumber(gluconate?.totalMassKg ?? 0)} кг</strong><em>{formatCount(gluconate?.lotCount ?? 0, "партия", "партии", "партий")} · {formatCount(gluconate?.priceVariants ?? 0, "цена", "цены", "цен")}</em></div></Panel>
      </div>

      {oneCSyncReviews.error !== null ? (
        <Panel className="one-c-sync-panel"><ErrorState message={`Не удалось проверить записи: ${oneCSyncReviews.error}`} retry={oneCSyncReviews.reload} /></Panel>
      ) : !oneCSyncReviews.loading && pendingReviews.length > 0 ? (
        <Panel className="one-c-sync-panel">
          <div className="table-toolbar">
            <div><h2><AlertTriangle size={17} /> Записи на проверке</h2></div>
            <span className="soft-tag warning">{pendingReviews.length} на проверке</span>
          </div>
          <div className="one-c-review-list">
            {pendingReviews.slice(0, 5).map((review) => {
              const details = oneCPayloadDetails(review.payload);
              return <article key={review.id}>
                <span><AlertTriangle size={17} /></span>
                <div><strong>{details.name ?? review.externalId}</strong><small>{details.code === undefined ? review.entityType : `${review.entityType} · ${details.code}`}</small><p>{review.reason}</p></div>
                {canManageOneC ? <div className="one-c-review-actions"><button className="button ghost small" disabled={reviewBusy} onClick={() => setReviewAction(review)}>Отклонить</button><button className="button primary small" disabled={reviewBusy || review.entityType !== "MATERIAL"} onClick={() => void approveReview(review)}>Подтвердить</button></div> : null}
              </article>;
            })}
          </div>
        </Panel>
      ) : null}

      <Panel className="purchase-batch-panel">
        <div className="table-toolbar">
          <div><h2>Поступления и закупки</h2></div>
          <div className="toolbar-actions"><label className="inline-search"><Search size={16} /><input aria-label="Поиск по поступлениям" value={purchaseQuery} onChange={(event) => setPurchaseQuery(event.target.value)} placeholder="Номер, поставщик или материал" /></label><span className="soft-tag">{purchaseRows.length} записей</span></div>
        </div>
        {purchaseRows.length === 0 ? (
          <EmptyState title={receipts.loading ? "Загружаем записи…" : "Поступлений пока нет"} text="Новые закупки и поступления появятся здесь." />
        ) : (
          <div className="data-table-wrap"><table className="data-table purchase-journal-table">
            <thead><tr><th>Документ</th><th>Дата</th><th>Поставщик</th><th>Позиции</th><th>Сумма</th><th>Статус</th><th /></tr></thead>
            <tbody>{purchaseRows.slice(0, visiblePurchases).map((row) => row.kind === "purchase" ?
              <tr key={`purchase:${row.value.id}`} onClick={() => setSelectedPurchase(row.value)}>
                <td><strong>№{row.value.number}</strong><small>Закупочная партия</small></td>
                <td>{formatDate(row.value.receivedAt, true)}</td>
                <td>{[...new Set(row.value.items.map((item) => item.supplier?.name).filter(Boolean))].join(", ") || "—"}</td>
                <td>{row.value.items.length} поз.</td>
                <td><strong>{formatMoney(row.value.totalCost, row.value.currency)}</strong></td>
                <td><span className="soft-tag">На складе</span></td>
                <td><ChevronRight size={16} /></td>
              </tr> : <tr key={`receipt:${row.id}`} onClick={() => setSelectedReceipt(row.value)}>
                <td><strong>№{row.value[0]?.number}</strong><small>Поступление</small></td>
                <td>{formatDate(row.date, true)}</td>
                <td>{row.value[0]?.supplier || "—"}</td>
                <td>{row.value.length} поз.</td>
                <td><strong>{sourceDecimal(sumSourceDecimals(row.value.map((item) => item.amount)))} {row.value[0]?.currencyName}</strong></td>
                <td><span className="soft-tag">{oneCDocumentStatus(row.value[0]?.posted ?? false, row.value[0]?.deleted ?? false)}</span></td>
                <td><ChevronRight size={16} /></td>
              </tr>)}</tbody>
          </table></div>
        )}
        {purchaseRows.length > visiblePurchases ? <div className="journal-more"><button type="button" className="button ghost small" onClick={() => setVisiblePurchases((count) => count + 30)}>Показать ещё</button></div> : null}
      </Panel>
      {receipts.error ? <p className="inline-load-error" role="alert">Не удалось загрузить часть поступлений. <button type="button" onClick={() => void receipts.reload()}>Повторить</button></p> : null}

      <Panel className="table-panel">
        <div className="table-toolbar">
          <div><h2>Складской журнал</h2></div>
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
      {purchaseOpen ? <PurchaseBatchModal materials={writableMaterials} recipes={recipeItems} suppliers={purchaseBatches.data?.suppliers ?? []} onClose={() => setPurchaseOpen(false)} onCreated={async () => { setPurchaseOpen(false); await Promise.all([materials.reload(), purchaseBatches.reload()]); }} /> : null}
      {selectedPurchase === null ? null : <PurchaseBatchDetail batch={selectedPurchase} onClose={() => setSelectedPurchase(null)} />}
      {selectedReceipt ? <Modal title={`Поступление №${selectedReceipt[0]?.number ?? ""}`} onClose={() => setSelectedReceipt(null)}>
        <div className="imported-record-detail"><p>{formatDate(selectedReceipt[0]?.receivedAt ?? "", true)} · {selectedReceipt[0]?.supplier} · {selectedReceipt[0]?.warehouse}</p>
          <h3>Материалы</h3>{selectedReceipt.map((item) => <div key={`${item.documentId}:${item.lineNumber}`}><strong>{item.material}</strong><span>{sourceDecimal(item.quantity)} {item.unitName}</span><small>{sourceDecimal(item.amount)} {item.currencyName} · {sourceDecimal(item.unitPrice)} {item.currencyName} за {item.unitName}</small></div>)}
          <p className="imported-record-note">Запись доступна только для просмотра.</p></div>
      </Modal> : null}
      {receiptMaterial === null ? null : <ReceiptModal materials={writableMaterials} initial={receiptMaterial} onClose={() => setReceiptMaterial(null)} onCreated={async () => { setReceiptMaterial(null); await materials.reload(); }} />}
      {consumptionMaterial === null ? null : <ConsumptionModal materials={writableMaterials} initial={consumptionMaterial} onClose={() => setConsumptionMaterial(null)} onCreated={async () => { setConsumptionMaterial(null); await materials.reload(); }} />}
      {reviewAction === null ? null : <RejectOneCReviewModal review={reviewAction} busy={reviewBusy} onClose={() => setReviewAction(null)} onReject={rejectReview} />}
      {adjustmentsOpen ? <AdjustmentsModal materials={writableMaterials} canApply={canApplyAdjustments} onClose={() => setAdjustmentsOpen(false)} /> : null}
    </>
  );
}

function RejectOneCReviewModal({ review, busy, onClose, onReject }: { review: OneCSyncReview; busy: boolean; onClose: () => void; onReject: (note: string) => Promise<void> }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  return <Modal title="Отклонить запись" onClose={onClose}><form onSubmit={(event) => { event.preventDefault(); if (note.trim().length < 3) { setError("Укажите причину не короче трёх символов"); return; } void onReject(note.trim()).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Не удалось отклонить запись")); }}><div className="form-grid"><label className="span-2"><span>Причина <b>*</b></span><textarea required minLength={3} value={note} placeholder={`Почему «${oneCPayloadDetails(review.payload).name ?? review.externalId}» не нужно добавлять на склад`} onChange={(event) => setNote(event.target.value)} /></label></div>{error === null ? null : <p className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Назад</button><button className="button primary" disabled={busy}>{busy ? "Сохраняем…" : "Отклонить запись"}</button></div></form></Modal>;
}

function AdjustmentsModal({ materials, canApply, onClose }: { materials: Material[]; canApply: boolean; onClose: () => void }) {
  const adjustments = useApi<{ items: AdjustmentDocument[] }>("/adjustments?targetType=MATERIAL_LOT");
  const lots = useMemo(() => materials.flatMap((material) => (material.lots ?? []).map((lot) => ({ ...lot, materialName: material.name }))), [materials]);
  const [draft, setDraft] = useState({ materialLotId: "", quantityDelta: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedLot = lots.find((lot) => lot.id === draft.materialLotId) ?? null;

  async function create(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (selectedLot === null || !/^-?\d+(?:\.\d+)?$/u.test(draft.quantityDelta) || Number(draft.quantityDelta) === 0 || draft.reason.trim().length < 5) {
      setError("Выберите партию, укажите ненулевое изменение остатка и причину от 5 символов");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiMutation("/adjustments", {
        targetType: "MATERIAL_LOT",
        targetId: selectedLot.id,
        reason: draft.reason.trim(),
        changes: { quantityDelta: draft.quantityDelta, unit: selectedLot.unit },
      }, { idempotent: true });
      setDraft({ materialLotId: "", quantityDelta: "", reason: "" });
      await adjustments.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось создать корректировку");
    } finally {
      setBusy(false);
    }
  }

  async function progress(adjustment: AdjustmentDocument, action: "approve" | "apply"): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await apiMutation(`/adjustments/${adjustment.id}/${action}`, {}, { idempotent: true });
      await adjustments.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось обновить корректировку");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Корректировки остатков" onClose={onClose} wide>
      <div className="adjustment-notice"><ShieldCheck size={18} /><span><strong>Корректировка создаётся отдельно от исходных документов.</strong><small>После согласования она изменит остаток выбранной складской партии и оставит запись в журнале.</small></span></div>
      <form className="form-grid" onSubmit={(event) => void create(event)}>
        <div className="form-field span-2"><span>Складская партия</span><CustomSelect required ariaLabel="Партия для корректировки" value={draft.materialLotId} onChange={(materialLotId) => setDraft({ ...draft, materialLotId })} options={lots.map((lot) => ({ value: lot.id, label: `${lot.materialName} · ${lot.lotNumber}`, description: `Свободно ${formatNumber(Number(lot.availableQuantity) - Number(lot.reservedQuantity))} ${unitLabel[lot.unit]}` }))} /></div>
        <label><span>Изменение остатка, {selectedLot === null ? "ед." : unitLabel[selectedLot.unit]}</span><input required inputMode="decimal" placeholder="Например, -2.5 или 10" value={draft.quantityDelta} onChange={(event) => setDraft({ ...draft, quantityDelta: event.target.value })} /></label>
        <label><span>Причина</span><input required minLength={5} value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} placeholder="Недостача, пересчёт, излишек…" /></label>
        {error === null ? null : <div className="form-error span-2">{error}</div>}
        <div className="modal-actions span-2"><button type="button" className="button ghost" onClick={onClose}>Закрыть</button><button className="button primary" disabled={busy || lots.length === 0}>{busy ? "Сохраняем…" : "Создать корректировку"}</button></div>
      </form>
      <div className="adjustment-list">
        <div className="section-title"><h3>Журнал корректировок</h3><span>{adjustments.data?.items.length ?? 0}</span></div>
        {adjustments.loading ? <LoadingState /> : adjustments.error !== null ? <ErrorState message={adjustments.error} retry={adjustments.reload} /> : (adjustments.data?.items.length ?? 0) === 0 ? <EmptyState title="Корректировок пока нет" text="Созданные документы появятся здесь до и после применения." /> : adjustments.data?.items.map((adjustment) => {
          const lot = lots.find((item) => item.id === adjustment.targetId);
          return <article key={adjustment.id}>
            <div><strong>{adjustment.number}</strong><small>{lot === undefined ? "Складская партия" : `${lot.materialName} · ${lot.lotNumber}`} · {formatDate(adjustment.createdAt, true)}</small><p>{adjustment.reason}</p></div>
            <StatusBadge status={adjustment.status} />
            {canApply && adjustment.status === "DRAFT" ? <button className="button ghost small" disabled={busy} onClick={() => void progress(adjustment, "approve")}>Согласовать</button> : null}
            {canApply && adjustment.status === "APPROVED" ? <button className="button primary small" disabled={busy} onClick={() => void progress(adjustment, "apply")}>Применить</button> : null}
          </article>;
        })}
      </div>
    </Modal>
  );
}

function oneCPayloadDetails(payload: unknown): { name?: string; code?: string } {
  if (payload === null || typeof payload !== "object") return {};
  const value = payload as Record<string, unknown>;
  return {
    ...(typeof value.name === "string" ? { name: value.name } : {}),
    ...(typeof value.code === "string" ? { code: value.code } : {}),
  };
}

function formatCount(count: number, one: string, few: string, many: string): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return `${count} ${many}`;
  if (last === 1) return `${count} ${one}`;
  if (last >= 2 && last <= 4) return `${count} ${few}`;
  return `${count} ${many}`;
}

function PurchaseBatchModal({
  materials,
  recipes,
  suppliers,
  onClose,
  onCreated,
}: {
  materials: Material[];
  recipes: Recipe[];
  suppliers: SupplierSummary[];
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [form, setForm] = useState({ number: "", receivedAt: "", recipeVersionId: "", targetSalePrice: "", notes: "" });
  const [items, setItems] = useState<DraftPurchaseItem[]>([
    { key: crypto.randomUUID(), materialId: "", supplierName: "", quantity: "", unitCost: "", expiresAt: "", certificateNumber: "" },
  ]);
  const [error, setError] = useState<string | null>(null);
  const recipeOptions = recipes.flatMap((recipe) => recipe.versions.map((version) => ({
    value: version.id,
    label: `${recipe.name} · v${version.version}`,
    description: `${version.concreteGrade} · ${version.components.length} компонентов`,
  })));

  function addItem(): void {
    setItems([...items, { key: crypto.randomUUID(), materialId: "", supplierName: "", quantity: "", unitCost: "", expiresAt: "", certificateNumber: "" }]);
  }

  function updateItem(key: string, patch: Partial<DraftPurchaseItem>): void {
    setItems(items.map((item) => item.key === key ? { ...item, ...patch } : item));
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (form.number.trim() === "" || form.receivedAt === "" || form.recipeVersionId === "" || form.targetSalePrice === "") {
      setError("Укажите номер партии, дату, рецептуру и цену реализации");
      return;
    }
    if (items.length === 0 || items.some((item) => item.materialId === "" || item.supplierName.trim() === "" || item.quantity === "" || item.unitCost === "")) {
      setError("Для каждого реагента укажите наименование, количество, цену и поставщика");
      return;
    }
    try {
      await apiMutation("/materials/purchase-batches", {
        number: form.number,
        receivedAt: new Date(form.receivedAt).toISOString(),
        recipeVersionId: form.recipeVersionId,
        targetSalePrice: form.targetSalePrice,
        notes: form.notes || undefined,
        items: items.map((item) => {
          const material = materials.find((candidate) => candidate.id === item.materialId);
          return {
            materialId: item.materialId,
            supplierName: item.supplierName,
            quantity: item.quantity,
            unit: material?.baseUnit ?? "KG",
            unitCost: item.unitCost,
            expiresAt: item.expiresAt === "" ? undefined : new Date(item.expiresAt).toISOString(),
            certificateNumber: item.certificateNumber || undefined,
          };
        }),
      }, { idempotent: true });
      await onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось оприходовать закупочную партию");
    }
  }

  return (
    <Modal title="Новая закупочная партия" onClose={onClose} wide>
      <form onSubmit={(event) => void submit(event)}>
        <div className="form-grid purchase-batch-form-head">
          <label><span>Номер партии</span><input required value={form.number} onChange={(event) => setForm({ ...form, number: event.target.value })} placeholder="Например, 27" /></label>
          <div className="form-field"><span>Дата и время поступления</span><DateTimePicker required ariaLabel="Дата и время закупочной партии" value={form.receivedAt} onChange={(receivedAt) => setForm({ ...form, receivedAt })} align="right" /></div>
          <div className="form-field"><span>Рецептура для расчёта</span><CustomSelect ariaLabel="Рецептура для расчёта партии" value={form.recipeVersionId} onChange={(recipeVersionId) => setForm({ ...form, recipeVersionId })} options={recipeOptions} placeholder="Выберите текущую рецептуру" /></div>
          <label><span>Цена реализации за 1 м³, ₸</span><input required type="number" min="0" step="0.01" value={form.targetSalePrice} onChange={(event) => setForm({ ...form, targetSalePrice: event.target.value })} /></label>
        </div>
        <div className="section-title purchase-builder-title">
          <div><h3>Реагенты и материалы</h3><span>Каждая строка станет отдельной складской позицией внутри партии №{form.number || "—"}</span></div>
          <button type="button" className="button ghost small" disabled={items.length >= materials.length} onClick={addItem}><Plus size={15} /> Добавить реагент</button>
        </div>
        <div className="purchase-builder-list">
          {items.map((item, index) => {
            const material = materials.find((candidate) => candidate.id === item.materialId);
            return (
              <div key={item.key}>
                <span className="purchase-row-number">{index + 1}</span>
                <div className="form-field"><span>Наименование</span><CustomSelect required ariaLabel={`Реагент ${index + 1}`} value={item.materialId} onChange={(materialId) => updateItem(item.key, { materialId })} options={materials.filter((candidate) => candidate.id === item.materialId || !items.some((row) => row.materialId === candidate.id)).map((candidate) => ({ value: candidate.id, label: candidate.name, description: `${candidate.code} · на складе ${formatNumber(candidate.currentStock)} ${unitLabel[candidate.baseUnit]}` }))} placeholder="Выберите реагент" /></div>
                <label><span>Количество, {unitLabel[material?.baseUnit ?? "KG"]}</span><input required type="number" min="0.001" step="0.001" value={item.quantity} onChange={(event) => updateItem(item.key, { quantity: event.target.value })} /></label>
                <label><span>Цена за {unitLabel[material?.baseUnit ?? "KG"]}, ₸</span><input required type="number" min="0" step="0.01" value={item.unitCost} onChange={(event) => updateItem(item.key, { unitCost: event.target.value })} /></label>
                <label><span>Поставщик</span><input required value={item.supplierName} onChange={(event) => updateItem(item.key, { supplierName: event.target.value })} placeholder={suppliers[0]?.name ?? "Название поставщика"} /></label>
                <div className="form-field"><span>Срок годности</span><DateTimePicker mode="date" ariaLabel={`Срок годности реагента ${index + 1}`} value={item.expiresAt} onChange={(expiresAt) => updateItem(item.key, { expiresAt })} align="right" /></div>
                <button type="button" className="row-action danger" aria-label={`Удалить реагент ${index + 1}`} disabled={items.length === 1} onClick={() => setItems(items.filter((row) => row.key !== item.key))}><Trash2 size={16} /></button>
              </div>
            );
          })}
        </div>
        <label className="full-label"><span>Комментарий</span><textarea rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Документы, условия закупки, особенности партии…" /></label>
        {error === null ? null : <div className="form-error modal-inline-error">{error}</div>}
        <div className="modal-actions purchase-modal-actions"><button type="button" className="button ghost" onClick={onClose}>Отмена</button><button className="button primary"><PackageOpen size={16} /> Оприходовать партию</button></div>
      </form>
    </Modal>
  );
}

function PurchaseBatchDetail({ batch, onClose }: { batch: PurchaseBatch; onClose: () => void }) {
  const forecast = batch.forecast;
  return (
    <Modal title={`Закупочная партия №${batch.number}`} onClose={onClose} wide>
      <div className="purchase-detail-hero">
        <div><span className="soft-tag">Оприходована</span><h3>Партия №{batch.number}</h3><p>{formatDate(batch.receivedAt, true)} · {batch.items.length} складских позиций{forecast === null ? "" : ` · ${forecast.recipe.name}, v${forecast.recipe.version}`}</p></div>
        <div className="detail-volume"><strong>{formatMoney(batch.totalCost, batch.currency)}</strong><span>стоимость закупки</span></div>
      </div>
      <div className="purchase-forecast-kpis">
        <span><PackageOpen size={17} /><small>Остаток партии</small><strong>{formatMoney(batch.remainingCost, batch.currency)}</strong></span>
        <span><BarChart3 size={17} /><small>Можно произвести</small><strong>{forecast === null ? "—" : `${formatNumber(forecast.maximumOutput)} м³`}</strong></span>
        <span><Coins size={17} /><small>Себестоимость 1 м³</small><strong>{forecast === null ? "—" : formatMoney(forecast.costPerM3, batch.currency)}</strong></span>
        <span><CircleDollarSign size={17} /><small>Прогноз прибыли</small><strong className={Number(forecast?.projectedProfit ?? 0) < 0 ? "price-up" : "profit-value"}>{forecast?.projectedProfit === null || forecast === null ? "—" : formatMoney(forecast.projectedProfit, batch.currency)}</strong></span>
      </div>
      <div className="section-title"><h3>Состав закупки</h3><span>{batch.items.length} позиций</span></div>
      <div className="purchase-detail-table-wrap">
        <table className="data-table purchase-detail-table">
          <thead><tr><th>Наименование</th><th>Поставщик</th><th>Получено</th><th>Осталось</th><th>Цена</th><th>Сумма</th></tr></thead>
          <tbody>{batch.items.map((item) => <tr key={item.id}><td><strong>{item.material.name}</strong><small>{item.material.code} · {item.lotNumber}</small></td><td>{item.supplier?.name ?? "—"}</td><td>{formatNumber(item.initialQuantity)} {unitLabel[item.unit]}</td><td>{formatNumber(Number(item.availableQuantity) - Number(item.reservedQuantity))} {unitLabel[item.unit]}</td><td>{formatMoney(item.unitCost, batch.currency)}</td><td><strong>{formatMoney(item.lineCost, batch.currency)}</strong></td></tr>)}</tbody>
        </table>
      </div>
      {forecast === null ? (
        <div className="purchase-calculation-note"><AlertTriangle size={18} /><span><strong>Рецептура не выбрана</strong><small>Для расчёта выпуска и прибыли укажите рецептуру в закупочной партии.</small></span></div>
      ) : (
        <>
          <div className="purchase-finance-strip">
            <span><small>Из этой партии</small><strong>{formatNumber(forecast.outputFromBatch)} м³</strong></span>
            <span><small>Цена реализации</small><strong>{forecast.targetSalePrice === null ? "—" : formatMoney(forecast.targetSalePrice, batch.currency)}</strong></span>
            <span><small>Прогноз выручки</small><strong>{forecast.projectedRevenue === null ? "—" : formatMoney(forecast.projectedRevenue, batch.currency)}</strong></span>
            <span><small>Маржа на 1 м³</small><strong>{forecast.marginPerM3 === null ? "—" : formatMoney(forecast.marginPerM3, batch.currency)}</strong></span>
          </div>
          <div className="section-title"><h3>Расчёт по текущей рецептуре</h3><span>{forecast.recipe.concreteGrade} · на 1 м³</span></div>
          <div className="purchase-detail-table-wrap forecast-table-wrap">
            <table className="data-table purchase-detail-table forecast-table">
              <thead><tr><th>Компонент</th><th>Берём на 1 м³</th><th>Пришло в партии</th><th>Свободно на складе</th><th>Останется после 1 м³</th><th>Лимит выпуска</th></tr></thead>
              <tbody>{forecast.components.map((component) => <tr key={component.materialId}><td><strong>{component.name}</strong><small>{component.code} · {formatMoney(component.costPerM3, batch.currency)} / м³</small></td><td>{formatNumber(component.requirementPerM3)} {unitLabel[component.unit]}</td><td>{formatNumber(component.receivedInBatch)} {unitLabel[component.unit]}</td><td>{formatNumber(component.freeStock)} {unitLabel[component.unit]}</td><td>{formatNumber(component.remainingAfterOneM3)} {unitLabel[component.unit]}</td><td><strong>{component.maximumOutput === null ? "—" : `${formatNumber(component.maximumOutput)} м³`}</strong></td></tr>)}</tbody>
            </table>
          </div>
        </>
      )}
      {batch.notes === null ? null : <div className="technology-note"><strong>Комментарий к партии</strong><p>{batch.notes}</p></div>}
    </Modal>
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
        {material.stockAuthority === "1C" ? <span>Остатки обновляются из 1С. Складские операции оформляются там.</span> : <>
          <button className="button ghost small" onClick={onConsumption}><ChevronUp size={15} /> Оформить расход</button>
          <button className="button primary small" onClick={onReceipt}><ChevronDown size={15} /> Оформить приход</button>
        </>}
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
  const [form, setForm] = useState({ code: "", name: "", type: "", baseUnit: "" as Unit | "", densityKgPerM3: "", costPerBaseUnit: "", minimumStock: "" });
  const [error, setError] = useState<string | null>(null);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (form.type === "" || form.baseUnit === "" || form.costPerBaseUnit === "" || form.minimumStock === "") { setError("Заполните обязательные поля складской позиции"); return; }
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
        <div className="form-field"><span>Тип</span><CustomSelect required ariaLabel="Тип складской позиции" value={form.type} onChange={(type) => setForm({ ...form, type })} options={MATERIAL_TYPE_OPTIONS} /></div>
        <div className="form-field"><span>Единица учёта</span><CustomSelect required ariaLabel="Единица учёта" value={form.baseUnit} onChange={(baseUnit) => setForm({ ...form, baseUnit: baseUnit as Unit })} options={UNIT_OPTIONS} /></div>
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
  const [form, setForm] = useState({ materialId: "", lotNumber: "", supplierName: "", quantity: "", unit: "" as Unit | "", unitCost: "", receivedAt: "", expiresAt: "", certificateNumber: "" });
  const [error, setError] = useState<string | null>(null);
  const material = materials.find((item) => item.id === form.materialId) ?? initial;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (form.materialId === "" || form.lotNumber === "" || form.quantity === "" || form.unit === "" || form.unitCost === "" || form.receivedAt === "") { setError("Заполните обязательные поля прихода"); return; }
    try {
      await apiMutation("/materials/receipts", {
        ...form,
        receivedAt: new Date(form.receivedAt).toISOString(),
        expiresAt: form.expiresAt === "" ? undefined : new Date(form.expiresAt).toISOString(),
        supplierName: form.supplierName || undefined,
        certificateNumber: form.certificateNumber || undefined,
      }, { idempotent: true });
      await onCreated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось оформить приход"); }
  }
  return (
    <Modal title="Приход на склад" onClose={onClose} wide>
      <form className="form-grid" onSubmit={(event) => void submit(event)}>
        <div className="form-field span-2"><span>Складская позиция</span><CustomSelect required ariaLabel="Складская позиция для прихода" value={form.materialId} onChange={(materialId) => { const next = materials.find((item) => item.id === materialId); setForm({ ...form, materialId, unit: next?.baseUnit ?? form.unit }); }} options={materials.map((item) => ({ value: item.id, label: item.name, description: `${item.code} · остаток ${formatNumber(item.currentStock)} ${unitLabel[item.baseUnit]}` }))} /></div>
        <label><span>Номер партии</span><input required value={form.lotNumber} onChange={(event) => setForm({ ...form, lotNumber: event.target.value })} /></label>
        <label><span>Поставщик</span><input value={form.supplierName} onChange={(event) => setForm({ ...form, supplierName: event.target.value })} /></label>
        <div className="form-field"><span>Дата и время поступления</span><DateTimePicker required ariaLabel="Дата и время поступления" value={form.receivedAt} onChange={(receivedAt) => setForm({ ...form, receivedAt })} /></div>
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
  const [form, setForm] = useState({ materialId: "", quantity: "", unit: "" as Unit | "", consumedAt: "", reason: "", reference: "" });
  const [error, setError] = useState<string | null>(null);
  const material = materials.find((item) => item.id === form.materialId) ?? initial;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (form.materialId === "" || form.quantity === "" || form.unit === "" || form.consumedAt === "" || form.reason.trim().length < 3) { setError("Заполните обязательные поля расхода"); return; }
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
        <div className="form-field span-2"><span>Складская позиция</span><CustomSelect required ariaLabel="Складская позиция для расхода" value={form.materialId} onChange={(materialId) => { const next = materials.find((item) => item.id === materialId); setForm({ ...form, materialId, unit: next?.baseUnit ?? form.unit }); }} options={materials.map((item) => ({ value: item.id, label: item.name, description: `Свободно ${formatNumber(Number(item.currentStock) - Number(item.reservedStock))} ${unitLabel[item.baseUnit]}` }))} /></div>
        <label><span>Количество, {unitLabel[material.baseUnit]}</span><input type="number" min="0.001" step="0.001" required value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></label>
        <div className="form-field"><span>Дата и время расхода</span><DateTimePicker required ariaLabel="Дата и время расхода" value={form.consumedAt} onChange={(consumedAt) => setForm({ ...form, consumedAt })} align="right" /></div>
        <label><span>Основание</span><input required minLength={3} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></label>
        <label><span>Документ / заявка</span><input value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} placeholder="Необязательно" /></label>
        <div className="consumption-warning span-2"><ShieldCheck size={17} /><span>Расход спишется по FEFO-партиям. Зарезервированный под замесы объём останется защищён.</span></div>
        {error === null ? null : <div className="form-error span-2">{error}</div>}
        <div className="modal-actions span-2"><button type="button" className="button ghost" onClick={onClose}>Отмена</button><button className="button primary"><ChevronUp size={16} /> Провести расход</button></div>
      </form>
    </Modal>
  );
}
