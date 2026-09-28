import { useMemo, useState } from "react";
import {
  Clock3,
  History,
  MapPin,
  MapPinned,
  Package,
  Plus,
  Route,
  TrainFront,
  Warehouse,
} from "lucide-react";
import { apiMutation } from "../api.js";
import { CustomSelect } from "../components/CustomSelect.js";
import { DateTimePicker } from "../components/DateTimePicker.js";
import { useApi } from "../hooks/use-api.js";
import type { Unit, Wagon, WagonStatus } from "../types.js";
import { formatDate, formatNumber, unitLabel } from "../lib/format.js";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  PageHeader,
  Panel,
  StatusBadge,
} from "../components/ui.js";

const STATUS_LABELS: Record<WagonStatus, string> = {
  EMPTY: "Порожний",
  LOADING: "Под погрузкой",
  LOADED: "Загружен",
  IN_TRANSIT: "В пути",
  AT_DESTINATION: "На станции назначения",
  UNLOADING: "Под выгрузкой",
  RETURNING: "Возвращается",
  MAINTENANCE: "Обслуживание",
};

const STATUS_OPTIONS = Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }));
const CARGO_UNIT_OPTIONS: Array<{ value: Unit; label: string }> = (["T", "KG", "M3"] as Unit[]).map((value) => ({ value, label: unitLabel[value] }));

export function WagonsPage() {
  const wagons = useApi<{ items: Wagon[] }>("/wagons");
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<Wagon | null>(null);
  const [moveWagon, setMoveWagon] = useState<Wagon | null>(null);
  const metrics = useMemo(() => {
    const items = wagons.data?.items ?? [];
    return {
      total: items.length,
      moving: items.filter((wagon) => ["IN_TRANSIT", "RETURNING"].includes(wagon.status)).length,
      loading: items.filter((wagon) => ["LOADING", "UNLOADING"].includes(wagon.status)).length,
      cargo: items.filter((wagon) => Number(wagon.cargoQuantity) > 0).length,
    };
  }, [wagons.data]);

  if (wagons.loading) return <LoadingState />;
  if (wagons.error !== null) return <ErrorState message={wagons.error} retry={wagons.reload} />;
  const items = wagons.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Дислокация вагонов"
        actions={<button className="button primary" onClick={() => setCreateOpen(true)}><Plus size={17} /> Добавить вагон</button>}
      />
      <div className="wagon-summary">
        <Panel><span><TrainFront size={19} /></span><div><strong>{metrics.total}</strong><small>вагонов на контроле</small></div></Panel>
        <Panel><span className="blue"><Route size={19} /></span><div><strong>{metrics.moving}</strong><small>сейчас в пути</small></div></Panel>
        <Panel><span className="amber"><Warehouse size={19} /></span><div><strong>{metrics.loading}</strong><small>погрузка / выгрузка</small></div></Panel>
        <Panel><span className="green"><Package size={19} /></span><div><strong>{metrics.cargo}</strong><small>вагонов с грузом</small></div></Panel>
      </div>

      {items.length === 0 ? <Panel><EmptyState title="Вагоны не добавлены" text="Добавьте первый вагон и зафиксируйте его текущее местоположение." /></Panel> : (
        <div className="wagon-grid">
          {items.map((wagon) => (
            <article key={wagon.id} className="wagon-card" onClick={() => setSelected(wagon)}>
              <div className="wagon-card-head"><div className="wagon-card-title"><span>{wagon.type}</span><h2><small>№</small>{wagon.number}</h2></div><StatusBadge status={wagon.status} /></div>
              <div className="wagon-location"><span className="wagon-location-icon"><MapPin size={18} /></span><div><small>Текущая дислокация</small><strong>{wagon.currentLocation}</strong></div></div>
              <div className="wagon-cargo">
                <div className="wagon-cargo-main"><span><Package size={18} /></span><div><small>Груз</small><strong>{wagon.cargoDescription ?? "Порожний"}</strong></div></div>
                <div><small>Количество</small><strong>{formatNumber(wagon.cargoQuantity)} {unitLabel[wagon.cargoUnit]}</strong></div>
                <div><small>Отгрузка</small><strong>{wagon.shipmentNumber ?? "Не назначена"}</strong></div>
              </div>
              <div className="wagon-card-foot"><span><Clock3 size={13} /><span>Обновлено</span><strong>{formatDate(wagon.lastReportedAt, true)}</strong></span><button className="button ghost small" onClick={(event) => { event.stopPropagation(); setMoveWagon(wagon); }}><MapPinned size={14} /> Обновить</button></div>
            </article>
          ))}
        </div>
      )}

      {createOpen ? <CreateWagonModal onClose={() => setCreateOpen(false)} onCreated={async () => { setCreateOpen(false); await wagons.reload(); }} /> : null}
      {moveWagon === null ? null : <WagonLocationModal wagon={moveWagon} onClose={() => setMoveWagon(null)} onCreated={async () => { setMoveWagon(null); await wagons.reload(); }} />}
      {selected === null ? null : <WagonDetail wagon={selected} onClose={() => setSelected(null)} onMove={() => { setSelected(null); setMoveWagon(selected); }} />}
    </>
  );
}

function WagonDetail({ wagon, onClose, onMove }: { wagon: Wagon; onClose: () => void; onMove: () => void }) {
  return (
    <Modal title={`Вагон ${wagon.number}`} onClose={onClose} wide>
      <div className="detail-hero"><div><StatusBadge status={wagon.status} /><h3>{wagon.currentLocation}</h3><p>{wagon.type} · вместимость {formatNumber(wagon.capacity)} {unitLabel[wagon.capacityUnit]}</p></div><div className="detail-volume"><strong>{formatNumber(wagon.cargoQuantity)} {unitLabel[wagon.cargoUnit]}</strong><span>{wagon.cargoDescription ?? "без груза"}</span></div></div>
      <div className="warehouse-detail-actions"><button className="button primary small" onClick={onMove}><MapPinned size={15} /> Новая отметка</button></div>
      <div className="section-title"><h3>История дислокации</h3><span><History size={14} /> {wagon.locationEvents.length}</span></div>
      <div className="wagon-timeline">
        {wagon.locationEvents.map((event) => (
          <div key={event.id}>
            <span className="timeline-mark" />
            <div><strong>{event.location}</strong><small>{STATUS_LABELS[event.status]} · отметил {event.actor.name}</small>{event.note === null ? null : <p>{event.note}</p>}</div>
            <span><strong>{formatNumber(event.cargoQuantity)} {unitLabel[event.cargoUnit]}</strong><small>{formatDate(event.occurredAt, true)}</small></span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function CreateWagonModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [form, setForm] = useState({ number: "", type: "", capacity: "", capacityUnit: "" as Unit | "", tareWeightT: "", status: "" as WagonStatus | "", location: "", cargoDescription: "", cargoQuantity: "", cargoUnit: "" as Unit | "", shipmentNumber: "", lastReportedAt: "", note: "" });
  const [error, setError] = useState<string | null>(null);
  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (form.number === "" || form.type === "" || form.capacity === "" || form.capacityUnit === "" || form.status === "" || form.location === "" || form.cargoQuantity === "" || form.cargoUnit === "" || form.lastReportedAt === "") { setError("Заполните обязательные поля вагона"); return; }
    try {
      await apiMutation("/wagons", { ...form, lastReportedAt: new Date(form.lastReportedAt).toISOString(), tareWeightT: form.tareWeightT || undefined, cargoDescription: form.cargoDescription || undefined, shipmentNumber: form.shipmentNumber || undefined, note: form.note || undefined });
      await onCreated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось добавить вагон"); }
  }
  return (
    <Modal title="Новый вагон" onClose={onClose} wide>
      <form className="form-grid" onSubmit={(event) => void submit(event)}>
        <label><span>Номер вагона</span><input required value={form.number} onChange={(event) => setForm({ ...form, number: event.target.value })} /></label>
        <label><span>Тип вагона</span><input required value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })} /></label>
        <label><span>Вместимость</span><input required type="number" min="0.001" step="0.001" value={form.capacity} onChange={(event) => setForm({ ...form, capacity: event.target.value })} /></label>
        <div className="form-field"><span>Единица вместимости</span><CustomSelect required ariaLabel="Единица вместимости" value={form.capacityUnit} onChange={(capacityUnit) => setForm({ ...form, capacityUnit: capacityUnit as Unit })} options={CARGO_UNIT_OPTIONS} /></div>
        <label><span>Тара, т</span><input type="number" min="0.001" step="0.001" value={form.tareWeightT} onChange={(event) => setForm({ ...form, tareWeightT: event.target.value })} /></label>
        <div className="form-field"><span>Статус</span><CustomSelect required ariaLabel="Статус вагона" value={form.status} onChange={(status) => setForm({ ...form, status: status as WagonStatus })} options={STATUS_OPTIONS} /></div>
        <label><span>Текущая дислокация</span><input required value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} /></label>
        <div className="form-field"><span>Дата и время отметки</span><DateTimePicker required ariaLabel="Дата и время первой отметки вагона" value={form.lastReportedAt} onChange={(lastReportedAt) => setForm({ ...form, lastReportedAt })} align="right" /></div>
        <label><span>Описание груза</span><input value={form.cargoDescription} onChange={(event) => setForm({ ...form, cargoDescription: event.target.value })} /></label>
        <label><span>Номер отгрузки</span><input value={form.shipmentNumber} onChange={(event) => setForm({ ...form, shipmentNumber: event.target.value })} /></label>
        <label><span>Количество груза</span><input required type="number" min="0" step="0.001" value={form.cargoQuantity} onChange={(event) => setForm({ ...form, cargoQuantity: event.target.value })} /></label>
        <div className="form-field"><span>Единица груза</span><CustomSelect required ariaLabel="Единица груза" value={form.cargoUnit} onChange={(cargoUnit) => setForm({ ...form, cargoUnit: cargoUnit as Unit })} options={CARGO_UNIT_OPTIONS} /></div>
        <label className="span-2"><span>Комментарий</span><textarea rows={3} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
        {error === null ? null : <div className="form-error span-2">{error}</div>}
        <div className="modal-actions span-2"><button type="button" className="button ghost" onClick={onClose}>Отмена</button><button className="button primary"><TrainFront size={16} /> Добавить вагон</button></div>
      </form>
    </Modal>
  );
}

function WagonLocationModal({ wagon, onClose, onCreated }: { wagon: Wagon; onClose: () => void; onCreated: () => Promise<void> }) {
  const [form, setForm] = useState({ status: "" as WagonStatus | "", location: "", cargoDescription: "", cargoQuantity: "", cargoUnit: "" as Unit | "", shipmentNumber: "", occurredAt: "", note: "" });
  const [error, setError] = useState<string | null>(null);
  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (form.status === "" || form.location === "" || form.cargoQuantity === "" || form.cargoUnit === "" || form.occurredAt === "") { setError("Заполните обязательные поля отметки"); return; }
    try {
      await apiMutation(`/wagons/${wagon.id}/location`, { ...form, occurredAt: new Date(form.occurredAt).toISOString(), cargoDescription: form.cargoDescription || undefined, shipmentNumber: form.shipmentNumber || undefined, note: form.note || undefined });
      await onCreated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось обновить дислокацию"); }
  }
  return (
    <Modal title={`Новая отметка · ${wagon.number}`} onClose={onClose} wide>
      <form className="form-grid" onSubmit={(event) => void submit(event)}>
        <div className="form-field"><span>Статус</span><CustomSelect required ariaLabel="Новый статус вагона" value={form.status} onChange={(status) => setForm({ ...form, status: status as WagonStatus })} options={STATUS_OPTIONS} /></div>
        <div className="form-field"><span>Дата и время</span><DateTimePicker required ariaLabel="Дата и время дислокации" value={form.occurredAt} onChange={(occurredAt) => setForm({ ...form, occurredAt })} align="right" /></div>
        <label className="span-2"><span>Местоположение</span><input required value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} /></label>
        <label><span>Груз</span><input value={form.cargoDescription} onChange={(event) => setForm({ ...form, cargoDescription: event.target.value })} /></label>
        <label><span>Номер отгрузки</span><input value={form.shipmentNumber} onChange={(event) => setForm({ ...form, shipmentNumber: event.target.value })} /></label>
        <label><span>Количество</span><input required type="number" min="0" step="0.001" value={form.cargoQuantity} onChange={(event) => setForm({ ...form, cargoQuantity: event.target.value })} /></label>
        <div className="form-field"><span>Единица груза</span><CustomSelect required ariaLabel="Единица груза при отметке" value={form.cargoUnit} onChange={(cargoUnit) => setForm({ ...form, cargoUnit: cargoUnit as Unit })} options={CARGO_UNIT_OPTIONS} /></div>
        <label className="span-2"><span>Комментарий диспетчера</span><textarea rows={3} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
        {error === null ? null : <div className="form-error span-2">{error}</div>}
        <div className="modal-actions span-2"><button type="button" className="button ghost" onClick={onClose}>Отмена</button><button className="button primary"><MapPinned size={16} /> Зафиксировать</button></div>
      </form>
    </Modal>
  );
}
