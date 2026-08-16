import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowRight,
  Check,
  FileText,
  MapPin,
  PackageCheck,
  Plus,
  Send,
  Truck,
} from "lucide-react";
import { apiFetch, apiMutation } from "../api.js";
import { useApi } from "../hooks/use-api.js";
import type { MetaData, Transfer } from "../types.js";
import { formatDate, formatNumber, unitLabel } from "../lib/format.js";
import {
  ErrorState,
  LoadingState,
  Modal,
  PageHeader,
  Panel,
  StatusBadge,
} from "../components/ui.js";

export function TransfersPage({ meta }: { meta: MetaData | null }) {
  const transfers = useApi<{ items: Transfer[] }>("/transfers");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const grouped = useMemo(() => {
    const items = transfers.data?.items ?? [];
    return {
      sent: items.filter((item) => item.status === "SENT").length,
      accepted: items.filter((item) => item.status === "ACCEPTED").length,
      draft: items.filter((item) => ["DRAFT", "PREPARED"].includes(item.status)).length,
      volume: items.reduce((sum, item) => sum + item.items.reduce((nested, row) => nested + Number(row.sentQuantity), 0), 0),
    };
  }, [transfers.data]);
  if (transfers.loading) return <LoadingState />;
  if (transfers.error !== null) return <ErrorState message={transfers.error} retry={transfers.reload} />;

  return (
    <>
      <PageHeader
        eyebrow="Лаборатория и реализация"
        title="Передачи на ЛРТ"
        description="Документы передачи готового продукта, частичная приёмка, возвраты и защищённый журнал движений."
        actions={<button className="button primary" onClick={() => setCreateOpen(true)}><Plus size={17} /> Новая передача</button>}
      />
      <div className="transfer-summary"><Panel><span className="blue"><Truck size={19} /></span><div><strong>{grouped.sent}</strong><small>в пути / на приёмке</small></div></Panel><Panel><span className="green"><PackageCheck size={19} /></span><div><strong>{grouped.accepted}</strong><small>принято документов</small></div></Panel><Panel><span className="amber"><FileText size={19} /></span><div><strong>{grouped.draft}</strong><small>требует отправки</small></div></Panel><Panel><span className="violet"><ArrowDownLeft size={19} /></span><div><strong>{formatNumber(grouped.volume)} м³</strong><small>отправлено всего</small></div></Panel></div>
      <Panel className="table-panel">
        <div className="table-toolbar"><div><h2>Журнал передач</h2><p>Каждая отправка защищена Idempotency-Key</p></div><div className="chart-legend"><span className="produced">Документы</span><span className="sent">Движения</span></div></div>
        <div className="transfer-cards">{(transfers.data?.items ?? []).map((transfer) => <article key={transfer.id} onClick={() => setSelectedId(transfer.id)}><div className="transfer-route"><span className="route-point source"><MapPin size={15} /></span><i /><span className="route-truck"><Truck size={17} /></span><i /><span className="route-point destination"><MapPin size={15} /></span></div><div className="transfer-card-head"><div><span>{transfer.number}</span><h3>{transfer.items[0]?.productLot.concreteGrade ?? "Продукт"}</h3></div><StatusBadge status={transfer.status} /></div><div className="transfer-points"><span><small>Отправитель</small><strong>{transfer.sender.name}</strong></span><ArrowRight size={17} /><span><small>Получатель</small><strong>{transfer.receiver?.name ?? transfer.receiverName ?? "ЛРТ"}</strong></span></div><div className="transfer-meta"><span><small>Дата</small><strong>{formatDate(transfer.transferAt, true)}</strong></span><span><small>Количество</small><strong>{formatNumber(transfer.items.reduce((sum, item) => sum + Number(item.requestedQuantity), 0))} {unitLabel[transfer.items[0]?.unit ?? "M3"]}</strong></span><span><small>Транспорт</small><strong>{transfer.transport ?? "Не указан"}</strong></span></div><button className="card-link">Открыть документ <ArrowRight size={15} /></button></article>)}</div>
      </Panel>
      {createOpen ? <CreateTransferModal meta={meta} onClose={() => setCreateOpen(false)} onCreated={async () => { setCreateOpen(false); await transfers.reload(); }} /> : null}
      {selectedId === null ? null : <TransferDetailModal id={selectedId} onClose={() => setSelectedId(null)} onChanged={transfers.reload} />}
    </>
  );
}

function CreateTransferModal({ meta, onClose, onCreated }: { meta: MetaData | null; onClose: () => void; onCreated: () => Promise<void> }) {
  const lot = meta?.productLots[0];
  const [form, setForm] = useState({ number: `LRT-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${String(Math.floor(Math.random() * 900) + 100)}`, transferAt: new Date().toISOString().slice(0, 16), productLotId: lot?.id ?? "", quantity: lot?.availableQuantity ?? "0", receiverName: "Лаборатория ЛРТ", transport: "Автобетоносмеситель", comments: "" });
  const [error, setError] = useState<string | null>(null);
  async function submit(event: React.FormEvent) { event.preventDefault(); try { const selectedLot = meta?.productLots.find((item) => item.id === form.productLotId); await apiMutation("/transfers", { number: form.number, transferAt: new Date(form.transferAt).toISOString(), senderId: meta?.actor.id, receiverName: form.receiverName, transport: form.transport, comments: form.comments || undefined, items: [{ productLotId: form.productLotId, quantity: form.quantity, unit: selectedLot?.unit ?? "M3" }] }); await onCreated(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Ошибка"); } }
  return <Modal title="Новый документ передачи" onClose={onClose} wide><form className="form-grid" onSubmit={(event) => void submit(event)}><label><span>Номер документа</span><input required value={form.number} onChange={(event) => setForm({ ...form, number: event.target.value })} /></label><label><span>Дата и время</span><input type="datetime-local" required value={form.transferAt} onChange={(event) => setForm({ ...form, transferAt: event.target.value })} /></label><label className="span-2"><span>Производственная партия</span><select required value={form.productLotId} onChange={(event) => { const selectedLot = meta?.productLots.find((item) => item.id === event.target.value); setForm({ ...form, productLotId: event.target.value, quantity: selectedLot?.availableQuantity ?? "0" }); }}>{meta?.productLots.map((item) => <option key={item.id} value={item.id}>{item.number} · {item.concreteGrade} · доступно {formatNumber(item.availableQuantity)} {unitLabel[item.unit]}</option>)}</select></label><label><span>Количество</span><input required type="number" min="0.001" step="0.001" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></label><label><span>Получатель</span><input required value={form.receiverName} onChange={(event) => setForm({ ...form, receiverName: event.target.value })} /></label><label className="span-2"><span>Транспорт / способ передачи</span><input value={form.transport} onChange={(event) => setForm({ ...form, transport: event.target.value })} /></label>{error === null ? null : <div className="form-error span-2">{error}</div>}<div className="modal-actions span-2"><button type="button" className="button ghost" onClick={onClose}>Отмена</button><button className="button primary"><FileText size={16} /> Создать документ</button></div></form></Modal>;
}

function TransferDetailModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function load() { try { setTransfer(await apiFetch<Transfer>(`/transfers/${id}`)); } catch (cause) { setError(cause instanceof Error ? cause.message : "Ошибка"); } }
  useEffect(() => { void load(); }, [id]);
  async function action(path: string, body: unknown = {}, idempotent = false) { setBusy(true); setError(null); try { await apiMutation(path, body, { idempotent }); await load(); await onChanged(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Операция не выполнена"); } finally { setBusy(false); } }
  if (transfer === null) return <Modal title="Документ передачи" onClose={onClose} wide><LoadingState /></Modal>;
  return <Modal title={transfer.number} onClose={onClose} wide><div className="detail-hero"><div><StatusBadge status={transfer.status} /><h3>Передача готового продукта</h3><p>{transfer.sender.name} → {transfer.receiver?.name ?? transfer.receiverName ?? "ЛРТ"}</p></div><div className="detail-volume"><strong>{formatNumber(transfer.items.reduce((sum, item) => sum + Number(item.requestedQuantity), 0))} {unitLabel[transfer.items[0]?.unit ?? "M3"]}</strong><span>по документу</span></div></div><div className="transfer-document"><div><small>Дата передачи</small><strong>{formatDate(transfer.transferAt, true)}</strong></div><div><small>Транспорт</small><strong>{transfer.transport ?? "—"}</strong></div><div><small>Отправлено</small><strong>{formatNumber(transfer.items.reduce((sum, item) => sum + Number(item.sentQuantity), 0))}</strong></div><div><small>Принято</small><strong>{formatNumber(transfer.items.reduce((sum, item) => sum + Number(item.acceptedQuantity), 0))}</strong></div></div><div className="section-title"><h3>Позиции</h3><span>{transfer.items.length}</span></div><div className="transfer-items">{transfer.items.map((item) => <div key={item.id}><span><PackageCheck size={17} /></span><div><strong>{item.productLot.number}</strong><small>Замес {item.batch.number} · {item.productLot.concreteGrade}</small></div><span><small>Заявлено</small><strong>{formatNumber(item.requestedQuantity)} {unitLabel[item.unit]}</strong></span><span><small>Принято</small><strong>{formatNumber(item.acceptedQuantity)} {unitLabel[item.unit]}</strong></span></div>)}</div>{error === null ? null : <div className="form-error">{error}</div>}<div className="workflow-actions">{transfer.status === "DRAFT" ? <button disabled={busy} className="button ghost" onClick={() => void action(`/transfers/${transfer.id}/prepare`)}><Check size={16} /> Подготовить</button> : null}{["DRAFT", "PREPARED"].includes(transfer.status) ? <button disabled={busy} className="button primary" onClick={() => void action(`/transfers/${transfer.id}/send`, {}, true)}><Send size={16} /> Подтвердить отправку</button> : null}{transfer.status === "SENT" ? <button disabled={busy} className="button primary" onClick={() => void action(`/transfers/${transfer.id}/accept`, { items: transfer.items.map((item) => ({ transferItemId: item.id, acceptedQuantity: item.sentQuantity, rejectedQuantity: "0", unit: item.unit })) }, true)}><PackageCheck size={16} /> Принять полностью</button> : null}</div></Modal>;
}

