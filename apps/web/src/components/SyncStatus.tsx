import { useEffect, useState } from "react";
import { RefreshCw, AlertTriangle, Clock3 } from "lucide-react";
import { useApi } from "../hooks/use-api.js";
import { formatDate } from "../lib/format.js";
import { Modal } from "./ui.js";

interface SyncState {
  configured: boolean;
  state: "CURRENT" | "PARTIAL" | "STALE" | "ERROR" | "WAITING";
  snapshotAt: string | null;
  receivedAt: string | null;
  accountingExceptionCount?: number;
  unitScaleUnverifiedMaterialCount?: number;
  error: { code: string; message: string } | null;
}

export function SyncStatus() {
  const status = useApi<SyncState>("/integrations/1c/status");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void status.reload();
    }, 60_000);
    const refresh = () => { if (document.visibilityState === "visible") void status.reload(); };
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [status.reload]);
  if (!status.error && !status.data?.configured) return null;
  const warning = status.error !== null || status.data?.state !== "CURRENT";
  const label = status.error ? "Обмен недоступен" : status.data?.state === "ERROR" ? "Ошибка обмена"
    : status.data?.state === "STALE" ? "Данные устарели" : status.data?.state === "PARTIAL" ? "Нужна сверка остатков"
      : status.data?.state === "WAITING" ? "Ожидается обмен" : "Данные обновлены";
  return <>
    <button type="button" className={`sync-status${warning ? " warning" : ""}`} onClick={() => setOpen(true)}
      title={status.data?.snapshotAt ? `${label}: ${formatDate(status.data.snapshotAt, true)}` : label}>
      {warning ? <AlertTriangle size={15} /> : <Clock3 size={15} />}<span>{label}</span>
    </button>
    {open ? <Modal title="Актуальность данных" onClose={() => setOpen(false)}>
      <div className="sync-status-detail">
        <p>Последние применённые данные: <strong>{status.data?.snapshotAt ? formatDate(status.data.snapshotAt, true) : "ещё не получены"}</strong></p>
        <p>Остатки и задолженность показаны на момент обмена. Календарь фильтрует документы, а не восстанавливает исторические остатки.</p>
        {status.data?.accountingExceptionCount ? <p role="alert">
          Данные 1С приняты. Для {status.data.accountingExceptionCount} бухгалтерских остатков нельзя надёжно рассчитать цену за единицу;
          исходные количество и сумма сохранены без изменений.
        </p> : null}
        {status.data?.unitScaleUnverifiedMaterialCount ? <p role="alert">
          Для {status.data.unitScaleUnverifiedMaterialCount} материалов перевод тонн в килограммы требует проверки;
          исходные данные 1С сохранены, остаток склада CRM пока не обновлён.
        </p> : null}
        {status.error || status.data?.error ? <p className="form-error" role="alert">{status.error ?? status.data?.error?.message}</p> : null}
        {status.data?.state === "STALE" ? <p role="alert">Более 45 минут нет свежих данных. Проверьте Windows-агент и соединение.</p> : null}
        <button type="button" className="button ghost" disabled={status.loading} onClick={() => void status.reload()}><RefreshCw size={15} /> Проверить</button>
      </div>
    </Modal> : null}
  </>;
}
