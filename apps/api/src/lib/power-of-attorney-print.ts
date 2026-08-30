interface PowerOfAttorneyDocument {
  number: string;
  documentAt: Date;
  dueAt: Date | null;
  counterparty: string;
  counterpartyTaxId: string | null;
  basis: string | null;
  notes: string | null;
  details: unknown;
  workspace: { name: string; timezone: string };
  items: Array<{ description: string; quantity: unknown; unit: string }>;
}

interface PowerOfAttorneyDetails {
  representativeName: string;
  representativePosition: string;
  representativeIin: string;
  identityDocument: string;
  identityIssuedBy: string;
  identityIssuedAt: string;
}

export function createPowerOfAttorneyHtml(document: PowerOfAttorneyDocument): string {
  const details = parseDetails(document.details);
  const rows = document.items.map((item, index) => `
    <tr>
      <td class="number">${index + 1}</td>
      <td>${escapeHtml(item.description)}</td>
      <td>${escapeHtml(unitLabel(item.unit))}</td>
      <td class="quantity">${escapeHtml(formatQuantity(item.quantity))}</td>
    </tr>`).join("");
  const supplierTaxId = document.counterpartyTaxId === null || document.counterpartyTaxId === ""
    ? ""
    : `, БИН/ИИН ${escapeHtml(document.counterpartyTaxId)}`;
  const identityIssuedAt = details.identityIssuedAt === "" ? "—" : formatDate(new Date(details.identityIssuedAt), document.workspace.timezone);

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Доверенность ${escapeHtml(document.number)}</title>
  <style>
    :root { font-family: Arial, Helvetica, sans-serif; color: #171915; background: #eef0ea; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 36px 18px; }
    .print-actions { position: sticky; top: 16px; z-index: 2; display: flex; justify-content: flex-end; gap: 10px; width: 210mm; max-width: 100%; margin: 0 auto 16px; }
    button { min-height: 42px; padding: 0 18px; border: 1px solid #cfd4c8; border-radius: 10px; color: #29301f; background: #fff; font: 700 14px/1 Arial, sans-serif; cursor: pointer; }
    button.primary { border-color: #8cba31; background: #adf238; }
    .sheet { width: 210mm; min-height: 297mm; max-width: 100%; margin: 0 auto; padding: 18mm 17mm 16mm; background: #fff; box-shadow: 0 22px 70px rgba(31, 38, 24, .16); }
    .brand { display: flex; align-items: center; justify-content: space-between; padding-bottom: 11px; border-bottom: 2px solid #1e231b; }
    .brand strong { font-size: 16px; letter-spacing: .08em; }
    .brand span { color: #687063; font-size: 10px; text-transform: uppercase; letter-spacing: .12em; }
    h1 { margin: 27px 0 5px; text-align: center; font-size: 22px; letter-spacing: .08em; }
    .subtitle { margin: 0 0 24px; color: #596054; text-align: center; font-size: 12px; }
    .document-meta { display: grid; grid-template-columns: 1fr 1fr 1fr; margin-bottom: 24px; border: 1px solid #2d322a; }
    .document-meta div { padding: 9px 11px; border-right: 1px solid #2d322a; }
    .document-meta div:last-child { border-right: 0; }
    small { display: block; margin-bottom: 4px; color: #6f756b; font-size: 9px; text-transform: uppercase; letter-spacing: .08em; }
    strong { font-size: 12px; }
    .intro { margin: 0 0 18px; font-size: 12px; line-height: 1.75; }
    .line { display: inline; padding: 0 3px 2px; border-bottom: 1px solid #777d73; font-weight: 700; }
    .facts { display: grid; grid-template-columns: 1fr 1fr; margin-bottom: 20px; border: 1px solid #c8ccc3; }
    .facts div { min-height: 53px; padding: 9px 11px; border-right: 1px solid #c8ccc3; border-bottom: 1px solid #c8ccc3; }
    .facts div:nth-child(2n) { border-right: 0; }
    .facts div:nth-last-child(-n+2) { border-bottom: 0; }
    h2 { margin: 23px 0 9px; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 11px; }
    th, td { padding: 8px 9px; border: 1px solid #353a31; vertical-align: top; }
    th { background: #f1f4ec; font-size: 9px; text-align: left; text-transform: uppercase; letter-spacing: .05em; }
    .number { width: 42px; text-align: center; }
    .quantity { width: 105px; text-align: right; font-weight: 700; }
    .unit { width: 80px; }
    .basis, .note { margin: 18px 0 0; font-size: 11px; line-height: 1.6; }
    .note { padding: 10px 12px; color: #4d5547; background: #f4f6f1; border-left: 3px solid #9bc33e; }
    .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 26px 36px; margin-top: 44px; }
    .signature { min-height: 48px; }
    .signature-line { display: grid; grid-template-columns: 1fr auto; gap: 10px; margin-top: 23px; padding-top: 5px; border-top: 1px solid #222; font-size: 10px; }
    .stamp { display: flex; align-items: center; justify-content: center; width: 72px; height: 72px; margin-top: 24px; border: 1px dashed #9ba096; border-radius: 50%; color: #8a9085; font-size: 10px; }
    .footer { margin-top: 30px; padding-top: 10px; border-top: 1px solid #d7dad2; color: #858b81; font-size: 9px; text-align: right; }
    @page { size: A4; margin: 0; }
    @media print {
      :root, body { background: #fff; }
      body { padding: 0; }
      .print-actions { display: none; }
      .sheet { width: 210mm; min-height: 297mm; box-shadow: none; }
    }
  </style>
</head>
<body>
  <div class="print-actions">
    <button type="button" onclick="window.close()">Закрыть</button>
    <button type="button" class="primary" onclick="window.print()">Печать / сохранить PDF</button>
  </div>
  <main class="sheet">
    <header class="brand"><strong>MIRACLE CHEM</strong><span>Бухгалтерия · печатная форма</span></header>
    <h1>ДОВЕРЕННОСТЬ</h1>
    <p class="subtitle">на получение товарно-материальных ценностей</p>
    <section class="document-meta">
      <div><small>Номер</small><strong>${escapeHtml(document.number)}</strong></div>
      <div><small>Дата выдачи</small><strong>${formatDate(document.documentAt, document.workspace.timezone)}</strong></div>
      <div><small>Действительна до</small><strong>${document.dueAt === null ? "—" : formatDate(document.dueAt, document.workspace.timezone)}</strong></div>
    </section>
    <p class="intro"><span class="line">${escapeHtml(document.workspace.name)}</span> настоящей доверенностью уполномочивает указанное ниже лицо получить товарно-материальные ценности.</p>
    <section class="facts">
      <div><small>Доверенное лицо</small><strong>${escapeHtml(details.representativeName)}</strong></div>
      <div><small>Должность</small><strong>${escapeHtml(details.representativePosition || "—")}</strong></div>
      <div><small>ИИН</small><strong>${escapeHtml(details.representativeIin || "—")}</strong></div>
      <div><small>Удостоверение личности / паспорт</small><strong>${escapeHtml(details.identityDocument)}</strong></div>
      <div><small>Кем выдан</small><strong>${escapeHtml(details.identityIssuedBy)}</strong></div>
      <div><small>Дата выдачи документа</small><strong>${identityIssuedAt}</strong></div>
    </section>
    <p class="intro">Получить у <span class="line">${escapeHtml(document.counterparty)}${supplierTaxId}</span> следующие товарно-материальные ценности:</p>
    <h2>Перечень товаров</h2>
    <table>
      <thead><tr><th class="number">№</th><th>Наименование товара</th><th class="unit">Ед.</th><th class="quantity">Количество</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="basis"><b>Основание:</b> ${escapeHtml(document.basis || "—")}</p>
    ${document.notes === null || document.notes === "" ? "" : `<p class="note"><b>Примечание:</b> ${escapeHtml(document.notes)}</p>`}
    <section class="signatures">
      <div class="signature"><small>Подпись доверенного лица удостоверяю</small><div class="signature-line"><span>подпись</span><b>${escapeHtml(details.representativeName)}</b></div></div>
      <div class="signature"><small>Руководитель организации</small><div class="signature-line"><span>подпись</span><b>Ф.И.О.</b></div></div>
      <div class="signature"><small>Главный бухгалтер</small><div class="signature-line"><span>подпись</span><b>Ф.И.О.</b></div></div>
      <div class="stamp">М.П.</div>
    </section>
    <footer class="footer">Сформировано в CRM Miracle Chem</footer>
  </main>
</body>
</html>`;
}

function parseDetails(value: unknown): PowerOfAttorneyDetails {
  const source = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  return {
    representativeName: stringValue(source.representativeName),
    representativePosition: stringValue(source.representativePosition),
    representativeIin: stringValue(source.representativeIin),
    identityDocument: stringValue(source.identityDocument),
    identityIssuedBy: stringValue(source.identityIssuedBy),
    identityIssuedAt: stringValue(source.identityIssuedAt),
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function formatDate(value: Date, timezone: string): string {
  if (Number.isNaN(value.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "long", year: "numeric", timeZone: timezone }).format(value);
}

function formatQuantity(value: unknown): string {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 6 }).format(parsed)
    : String(value ?? "");
}

function unitLabel(unit: string): string {
  return ({ PCS: "шт.", KG: "кг", T: "т", L: "л", M3: "м³", SERVICE: "услуга" } as Record<string, string>)[unit] ?? unit;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
