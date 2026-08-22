import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Check,
  FileText,
  MapPin,
  PackageCheck,
  Plus,
  Send,
  Truck,
} from "lucide-react";
import { apiFetch, apiMutation } from "../api.js";
import { CustomSelect } from "../components/CustomSelect.js";
import { DateTimePicker } from "../components/DateTimePicker.js";
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

const DELIVERY_METHOD_OPTIONS = [
  { value: "Автобетоносмеситель", label: "Автобетоносмеситель", description: "Доставка готовой смеси миксером" },
  { value: "Железнодорожный вагон", label: "Железнодорожный вагон", description: "Отгрузка по железной дороге" },
  { value: "Самосвал", label: "Самосвал", description: "Навальный или инертный груз" },
  { value: "Самовывоз", label: "Самовывоз", description: "Транспорт предоставляет получатель" },
  { value: "Контейнер", label: "Контейнер", description: "Контейнерная перевозка" },
];

const EXTERNAL_RECEIVERS = [
  { value: "name:Лаборатория ЛРТ", label: "Лаборатория ЛРТ", description: "Контроль и приёмка партии" },
  { value: "name:Склад готовой продукции", label: "Склад готовой продукции", description: "Внутреннее перемещение" },
  { value: "name:Строительная площадка", label: "Строительная площадка", description: "Доставка заказчику" },
  { value: "name:Контрагент по договору", label: "Контрагент по договору", description: "Внешний получатель" },
];

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
        eyebrow="Логистика готового продукта"
        title="Отгрузки"
        description="Документы отгрузки готового продукта на ЛРТ и другим получателям, приёмка, возвраты и защищённый журнал движений."
        actions={<button className="button primary" onClick={() => setCreateOpen(true)}><Plus size={17} /> Новая отгрузка</button>}
      />
      <div className="transfer-summary"><Panel><span className="blue"><Truck size={19} /></span><div><strong>{grouped.sent}</strong><small>в пути / на приёмке</small></div></Panel><Panel><span className="green"><PackageCheck size={19} /></span><div><strong>{grouped.accepted}</strong><small>принято документов</small></div></Panel><Panel><span className="amber"><FileText size={19} /></span><div><strong>{grouped.draft}</strong><small>требует отправки</small></div></Panel><Panel><span className="violet"><ChevronDown size={19} /></span><div><strong>{formatNumber(grouped.volume)} м³</strong><small>отправлено всего</small></div></Panel></div>
      <Panel className="table-panel">
        <div className="table-toolbar"><div><h2>Журнал отгрузок</h2><p>Каждая отправка защищена Idempotency-Key</p></div><div className="chart-legend"><span className="produced">Документы</span><span className="sent">Движения</span></div></div>
        <div className="transfer-cards">{(transfers.data?.items ?? []).map((transfer) => <article key={transfer.id} onClick={() => setSelectedId(transfer.id)}><div className="transfer-route"><span className="route-point source"><MapPin size={15} /></span><i /><span className="route-truck"><Truck size={17} /></span><i /><span className="route-point destination"><MapPin size={15} /></span></div><div className="transfer-card-head"><div><span>{transfer.number}</span><h3>{transfer.items[0]?.productLot.concreteGrade ?? "Продукт"}</h3></div><StatusBadge status={transfer.status} /></div><div className="transfer-points"><span><small>Отправитель</small><strong>{transfer.sender.name}</strong></span><ChevronRight size={17} /><span><small>Получатель</small><strong>{transfer.receiver?.name ?? transfer.receiverName ?? "ЛРТ"}</strong></span></div><div className="transfer-meta"><span><small>Дата</small><strong>{formatDate(transfer.transferAt, true)}</strong></span><span><small>Количество</small><strong>{formatNumber(transfer.items.reduce((sum, item) => sum + Number(item.requestedQuantity), 0))} {unitLabel[transfer.items[0]?.unit ?? "M3"]}</strong></span><span><small>Транспорт</small><strong>{transfer.transport ?? "Не указан"}</strong></span></div><button type="button" className="card-link" onClick={(event) => { event.stopPropagation(); setSelectedId(transfer.id); }}>Открыть документ <ChevronRight size={15} /></button></article>)}</div>
      </Panel>
      {createOpen ? <CreateTransferModal meta={meta} onClose={() => setCreateOpen(false)} onCreated={async () => { setCreateOpen(false); await transfers.reload(); }} /> : null}
      {selectedId === null ? null : <TransferDetailModal id={selectedId} onClose={() => setSelectedId(null)} onChanged={transfers.reload} />}
    </>
  );
}

function CreateTransferModal({ meta, onClose, onCreated }: { meta: MetaData | null; onClose: () => void; onCreated: () => Promise<void> }) {
  const [form, setForm] = useState({ number: "", transferAt: "", productLotId: "", quantity: "", receiver: "", transport: "", comments: "" });
  const [error, setError] = useState<string | null>(null);
  const receiverOptions = [
    ...(meta?.users ?? []).filter((user) => user.role === "LRT_RECEIVER").map((user) => ({ value: `user:${user.id}`, label: user.name, description: "Ответственный получатель" })),
    ...EXTERNAL_RECEIVERS,
  ];
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (form.number === "" || form.transferAt === "" || form.productLotId === "" || form.quantity === "" || form.receiver === "" || form.transport === "") { setError("Заполните обязательные поля отгрузки"); return; }
    try {
      const selectedLot = meta?.productLots.find((item) => item.id === form.productLotId);
      const internalReceiverId = form.receiver.startsWith("user:") ? form.receiver.slice(5) : undefined;
      const receiverName = form.receiver.startsWith("name:") ? form.receiver.slice(5) : undefined;
      await apiMutation("/transfers", {
        number: form.number,
        transferAt: new Date(form.transferAt).toISOString(),
        senderId: meta?.actor.id,
        receiverId: internalReceiverId,
        receiverName,
        transport: form.transport,
        comments: form.comments || undefined,
        items: [{ productLotId: form.productLotId, quantity: form.quantity, unit: selectedLot?.unit ?? "M3" }],
      });
      await onCreated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось создать отгрузку"); }
  }
  return <Modal title="Новая отгрузка" onClose={onClose} wide><form className="form-grid" onSubmit={(event) => void submit(event)}><label><span>Номер документа</span><input required value={form.number} onChange={(event) => setForm({ ...form, number: event.target.value })} /></label><div className="form-field"><span>Дата и время</span><DateTimePicker ariaLabel="Дата и время отгрузки" value={form.transferAt} onChange={(transferAt) => setForm({ ...form, transferAt })} /></div><div className="form-field span-2"><span>Производственная партия</span><CustomSelect ariaLabel="Производственная партия" value={form.productLotId} onChange={(productLotId) => setForm({ ...form, productLotId, quantity: "" })} options={(meta?.productLots ?? []).map((item) => ({ value: item.id, label: `${item.number} · ${item.concreteGrade}`, description: `Доступно ${formatNumber(item.availableQuantity)} ${unitLabel[item.unit]}` }))} /></div><label><span>Количество</span><input required type="number" min="0.001" step="0.001" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></label><div className="form-field"><span>Получатель</span><CustomSelect ariaLabel="Получатель отгрузки" value={form.receiver} onChange={(receiver) => setForm({ ...form, receiver })} options={receiverOptions} /></div><div className="form-field span-2"><span>Способ отгрузки</span><CustomSelect ariaLabel="Способ отгрузки" value={form.transport} onChange={(transport) => setForm({ ...form, transport })} options={DELIVERY_METHOD_OPTIONS} /></div><label className="span-2"><span>Комментарий</span><textarea rows={3} value={form.comments} onChange={(event) => setForm({ ...form, comments: event.target.value })} /></label>{error === null ? null : <div className="form-error span-2">{error}</div>}<div className="modal-actions span-2"><button type="button" className="button ghost" onClick={onClose}>Отмена</button><button className="button primary"><FileText size={16} /> Создать отгрузку</button></div></form></Modal>;
}

function TransferDetailModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function load() { try { setTransfer(await apiFetch<Transfer>(`/transfers/${id}`)); } catch (cause) { setError(cause instanceof Error ? cause.message : "Ошибка"); } }
  useEffect(() => { void load(); }, [id]);
  async function action(path: string, body: unknown = {}, idempotent = false) { setBusy(true); setError(null); try { await apiMutation(path, body, { idempotent }); await load(); await onChanged(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Операция не выполнена"); } finally { setBusy(false); } }
  if (transfer === null) return <Modal title="Документ отгрузки" onClose={onClose} wide><LoadingState /></Modal>;
  return <Modal title={transfer.number} onClose={onClose} wide><div className="detail-hero"><div><StatusBadge status={transfer.status} /><h3>Отгрузка готового продукта</h3><p className="transfer-direction"><span>{transfer.sender.name}</span><ChevronRight size={13} /><span>{transfer.receiver?.name ?? transfer.receiverName ?? "ЛРТ"}</span></p></div><div className="detail-volume"><strong>{formatNumber(transfer.items.reduce((sum, item) => sum + Number(item.requestedQuantity), 0))} {unitLabel[transfer.items[0]?.unit ?? "M3"]}</strong><span>по документу</span></div></div><div className="transfer-document"><div><small>Дата отгрузки</small><strong>{formatDate(transfer.transferAt, true)}</strong></div><div><small>Транспорт</small><strong>{transfer.transport ?? "—"}</strong></div><div><small>Отправлено</small><strong>{formatNumber(transfer.items.reduce((sum, item) => sum + Number(item.sentQuantity), 0))}</strong></div><div><small>Принято</small><strong>{formatNumber(transfer.items.reduce((sum, item) => sum + Number(item.acceptedQuantity), 0))}</strong></div></div><div className="section-title"><h3>Позиции</h3><span>{transfer.items.length}</span></div><div className="transfer-items">{transfer.items.map((item) => <div key={item.id}><span><PackageCheck size={17} /></span><div><strong>{item.productLot.number}</strong><small>Замес {item.batch.number} · {item.productLot.concreteGrade}</small></div><span><small>Заявлено</small><strong>{formatNumber(item.requestedQuantity)} {unitLabel[item.unit]}</strong></span><span><small>Принято</small><strong>{formatNumber(item.acceptedQuantity)} {unitLabel[item.unit]}</strong></span></div>)}</div>{error === null ? null : <div className="form-error">{error}</div>}<div className="workflow-actions">{transfer.status === "DRAFT" ? <button disabled={busy} className="button ghost" onClick={() => void action(`/transfers/${transfer.id}/prepare`)}><Check size={16} /> Подготовить</button> : null}{["DRAFT", "PREPARED"].includes(transfer.status) ? <button disabled={busy} className="button primary" onClick={() => void action(`/transfers/${transfer.id}/send`, {}, true)}><Send size={16} /> Подтвердить отправку</button> : null}{transfer.status === "SENT" ? <button disabled={busy} className="button primary" onClick={() => void action(`/transfers/${transfer.id}/accept`, { items: transfer.items.map((item) => ({ transferItemId: item.id, acceptedQuantity: item.sentQuantity, rejectedQuantity: "0", unit: item.unit })) }, true)}><PackageCheck size={16} /> Принять полностью</button> : null}</div></Modal>;
}
