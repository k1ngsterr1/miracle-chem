import { createRequire } from "node:module";
import PDFDocument from "pdfkit";
import { AccountingDocumentStatus, AccountingDocumentType } from "../generated/prisma/index.js";

const require = createRequire(import.meta.url);
const regularFont = require.resolve("dejavu-fonts-ttf/ttf/DejaVuSans.ttf");
const boldFont = require.resolve("dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf");

const PAGE = { left: 42, right: 42, top: 42, bottom: 48 };

export interface PrintableAccountingDocument {
  number: string;
  type: AccountingDocumentType;
  status: AccountingDocumentStatus;
  documentAt: Date;
  dueAt: Date | null;
  counterparty: string;
  counterpartyTaxId: string | null;
  basis: string | null;
  subtotal: { toString(): string };
  vatRate: { toString(): string };
  vatAmount: { toString(): string };
  totalAmount: { toString(): string };
  currency: string;
  notes: string | null;
  details?: unknown;
  workspace: {
    name: string;
    timezone: string;
    companyProfile?: {
      legalName: string | null;
      taxId: string | null;
      address: string | null;
      phone: string | null;
      email: string | null;
      bankName: string | null;
      iban: string | null;
      bic: string | null;
      directorName: string | null;
      accountantName: string | null;
      signatoryName: string | null;
      signatoryPosition: string | null;
      documentFooter: string | null;
    } | null;
  };
  items: Array<{
    description: string;
    quantity: { toString(): string };
    unit: string;
    unitPrice: { toString(): string };
    amount: { toString(): string };
  }>;
}

export async function createAccountingDocumentPdf(document: PrintableAccountingDocument): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const pdf = new PDFDocument({
      size: "A4",
      margins: PAGE,
      bufferPages: true,
      info: {
        Title: `${documentTitle(document.type)} ${document.number}`,
        Author: "Miracle Chem",
        Subject: "Бухгалтерский документ",
        Creator: "Miracle Chem CRM",
      },
    });
    const chunks: Buffer[] = [];
    pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
    pdf.once("end", () => resolve(Buffer.concat(chunks)));
    pdf.once("error", reject);

    try {
      pdf.registerFont("Roboto", regularFont);
      pdf.registerFont("RobotoBold", boldFont);
      renderDocument(pdf, document);
      pdf.end();
    } catch (cause) {
      reject(cause);
    }
  });
}

export function accountingDocumentPdfName(document: Pick<PrintableAccountingDocument, "number" | "type">): string {
  const prefix = {
    [AccountingDocumentType.WAYBILL]: "waybill",
    [AccountingDocumentType.PAYMENT_INVOICE]: "payment-invoice",
    [AccountingDocumentType.COMPLETION_ACT]: "completion-act",
    [AccountingDocumentType.POWER_OF_ATTORNEY]: "power-of-attorney",
  }[document.type];
  const number = document.number.replaceAll(/[^a-zA-Z0-9_-]/gu, "-").replaceAll(/-+/gu, "-");
  return `${prefix}-${number || "document"}.pdf`;
}

function renderDocument(pdf: PDFKit.PDFDocument, document: PrintableAccountingDocument): void {
  drawDocumentHeader(pdf, document, false);
  if (document.type === AccountingDocumentType.POWER_OF_ATTORNEY) {
    drawPowerOfAttorneyBlock(pdf, document);
    drawItems(pdf, document, true);
  } else {
    drawPartiesBlock(pdf, document);
    drawItems(pdf, document, false);
    drawTotals(pdf, document);
    if (document.type === AccountingDocumentType.PAYMENT_INVOICE) drawBankDetails(pdf, document);
  }
  drawFooter(pdf, document);
  addPageNumbers(pdf);
}

function drawDocumentHeader(
  pdf: PDFKit.PDFDocument,
  document: PrintableAccountingDocument,
  continuation: boolean,
): void {
  const width = contentWidth(pdf);
  const company = companyProfile(document);
  pdf.fillColor("#1C241B").font("RobotoBold").fontSize(14).text(company.legalName, PAGE.left, PAGE.top, { characterSpacing: 0.55, width: width * 0.68, ellipsis: true });
  pdf.fillColor("#75806F").font("Roboto").fontSize(7.5).text("ПРОИЗВОДСТВО · ОТГРУЗКИ · ФИНАНСЫ", PAGE.left, PAGE.top + 20, { characterSpacing: 0.55 });
  pdf.moveTo(PAGE.left, PAGE.top + 35).lineTo(PAGE.left + width, PAGE.top + 35).lineWidth(1.2).strokeColor("#9EC83D").stroke();

  pdf.fillColor("#1C241B").font("RobotoBold").fontSize(20).text(continuation ? `${documentTitle(document.type)} - ПРОДОЛЖЕНИЕ` : documentTitle(document.type), PAGE.left, PAGE.top + 53, { width });
  pdf.fillColor("#6B7565").font("Roboto").fontSize(9).text(documentSubtitle(document), PAGE.left, PAGE.top + 80, { width });

  const metaTop = PAGE.top + 106;
  const boxGap = 8;
  const boxWidth = (width - boxGap * 2) / 3;
  drawMetaBox(pdf, PAGE.left, metaTop, boxWidth, "Номер", document.number);
  drawMetaBox(pdf, PAGE.left + boxWidth + boxGap, metaTop, boxWidth, "Дата", formatDate(document.documentAt, document.workspace.timezone));
  const thirdMeta = document.type === AccountingDocumentType.PAYMENT_INVOICE || document.type === AccountingDocumentType.POWER_OF_ATTORNEY
    ? (document.dueAt === null ? "Не указан" : formatDate(document.dueAt, document.workspace.timezone))
    : statusText(document.status);
  const thirdLabel = document.type === AccountingDocumentType.PAYMENT_INVOICE
    ? "Срок оплаты"
    : document.type === AccountingDocumentType.POWER_OF_ATTORNEY ? "Действует до" : "Статус";
  drawMetaBox(pdf, PAGE.left + (boxWidth + boxGap) * 2, metaTop, boxWidth, thirdLabel, thirdMeta);
  pdf.y = metaTop + 52;
}

function drawMetaBox(pdf: PDFKit.PDFDocument, x: number, y: number, width: number, label: string, value: string): void {
  pdf.roundedRect(x, y, width, 44, 4).fillAndStroke("#F3F6EF", "#D9DED2");
  pdf.fillColor("#7A8374").font("Roboto").fontSize(6.8).text(label.toUpperCase(), x + 8, y + 7, { width: width - 16, characterSpacing: 0.6 });
  pdf.fillColor("#1C241B").font("RobotoBold").fontSize(9.2).text(textValue(value), x + 8, y + 21, { width: width - 16, ellipsis: true });
}

function drawPartiesBlock(pdf: PDFKit.PDFDocument, document: PrintableAccountingDocument): void {
  const width = contentWidth(pdf);
  const top = pdf.y + 18;
  const basis = document.basis === null || document.basis.trim() === "" ? "Не указано" : document.basis;
  const taxId = document.counterpartyTaxId === null || document.counterpartyTaxId.trim() === "" ? "Не указан" : document.counterpartyTaxId;
  const company = companyProfile(document);
  const height = 110;
  pdf.roundedRect(PAGE.left, top, width, height, 5).fillAndStroke("#FFFFFF", "#D9DED2");
  const columnGap = 18;
  const columnWidth = (width - columnGap - 28) / 2;
  drawParty(pdf, PAGE.left + 14, top + 13, columnWidth, "Поставщик", company.legalName, [
    company.taxId === "" ? "" : `БИН / ИИН: ${company.taxId}`,
    company.address,
  ]);
  drawParty(pdf, PAGE.left + 14 + columnWidth + columnGap, top + 13, columnWidth, document.type === AccountingDocumentType.COMPLETION_ACT ? "Заказчик" : "Покупатель", document.counterparty, [
    `БИН / ИИН: ${taxId}`,
  ]);
  pdf.moveTo(PAGE.left + 14, top + 81).lineTo(PAGE.left + width - 14, top + 81).strokeColor("#E0E5DB").lineWidth(0.7).stroke();
  pdf.fillColor("#778070").font("Roboto").fontSize(7.2).text("ОСНОВАНИЕ", PAGE.left + 14, top + 91, { width: 78, characterSpacing: 0.45 });
  pdf.fillColor("#20271E").font("RobotoBold").fontSize(8.7).text(textValue(basis), PAGE.left + 95, top + 89, { width: width - 109, ellipsis: true });
  pdf.y = top + height;
}

function drawParty(pdf: PDFKit.PDFDocument, x: number, y: number, width: number, label: string, name: string, lines: string[]): void {
  pdf.fillColor("#778070").font("Roboto").fontSize(7.2).text(label.toUpperCase(), x, y, { width, characterSpacing: 0.5 });
  pdf.fillColor("#20271E").font("RobotoBold").fontSize(9.3).text(textValue(name), x, y + 14, { width, height: 23, ellipsis: true });
  pdf.fillColor("#667060").font("Roboto").fontSize(7.4).text(lines.filter(Boolean).map(textValue).join("\n"), x, y + 40, { width, height: 23, ellipsis: true });
}

function drawPowerOfAttorneyBlock(pdf: PDFKit.PDFDocument, document: PrintableAccountingDocument): void {
  const width = contentWidth(pdf);
  const top = pdf.y + 18;
  const company = companyProfile(document);
  const details = powerOfAttorneyDetails(document.details);
  const representative = [details.representativeName, details.representativePosition].filter(Boolean).join(", ");
  const identity = [details.identityDocument, details.identityIssuedBy, details.identityIssuedAt === "" ? "" : `от ${details.identityIssuedAt}`].filter(Boolean).join(", ");
  const text = `${company.legalName}${company.taxId === "" ? "" : `, БИН / ИИН ${company.taxId}`}, доверяет ${representative || "доверенному лицу"}${details.representativeIin === "" ? "" : `, ИИН ${details.representativeIin}`} получить товар у ${document.counterparty}. Документ, удостоверяющий личность: ${identity || "не указан"}. Основание: ${document.basis?.trim() || "не указано"}.`;
  const height = Math.max(112, pdf.font("Roboto").fontSize(9.2).heightOfString(text, { width: width - 28, lineGap: 2 }) + 48);
  pdf.roundedRect(PAGE.left, top, width, height, 5).fillAndStroke("#FFFFFF", "#D9DED2");
  pdf.fillColor("#778070").font("Roboto").fontSize(7.2).text("ДОВЕРЕННОЕ ЛИЦО", PAGE.left + 14, top + 13, { characterSpacing: 0.55 });
  pdf.fillColor("#20271E").font("RobotoBold").fontSize(10).text(representative || "Не указано", PAGE.left + 14, top + 27, { width: width - 28 });
  pdf.fillColor("#30392F").font("Roboto").fontSize(9.2).text(text, PAGE.left + 14, top + 49, { width: width - 28, lineGap: 2 });
  pdf.y = top + height;
}

function drawItems(pdf: PDFKit.PDFDocument, document: PrintableAccountingDocument, withoutPrices: boolean): void {
  const width = contentWidth(pdf);
  let top = pdf.y + 23;
  pdf.fillColor("#1C241B").font("RobotoBold").fontSize(11).text("Позиции документа", PAGE.left, top, { width });
  top += 21;

  const columns = withoutPrices ? [
    { label: "№", width: 30, align: "center" as const },
    { label: "Наименование товара", width: 343, align: "left" as const },
    { label: "Кол-во", width: 85, align: "right" as const },
    { label: "Ед.", width: 56, align: "center" as const },
  ] : [
    { label: "№", width: 24, align: "center" as const },
    { label: "Наименование", width: 205, align: "left" as const },
    { label: "Кол-во", width: 57, align: "right" as const },
    { label: "Ед.", width: 45, align: "center" as const },
    { label: "Цена", width: 84, align: "right" as const },
    { label: "Сумма", width: 96, align: "right" as const },
  ];

  drawTableHeader(pdf, top, columns);
  let y = top + 25;
  for (const [index, item] of document.items.entries()) {
    const values = [
      String(index + 1),
      textValue(item.description),
      formatNumber(item.quantity),
      unitLabel(item.unit),
      ...(withoutPrices ? [] : [formatMoney(item.unitPrice, document.currency), formatMoney(item.amount, document.currency)]),
    ];
    const height = Math.max(27, pdf.font("Roboto").fontSize(8.4).heightOfString(values[1] ?? "", { width: (columns[1]?.width ?? 205) - 12 }) + 12);
    if (y + height > pdf.page.height - PAGE.bottom - 135) {
      pdf.addPage();
      drawDocumentHeader(pdf, document, true);
      top = pdf.y + 22;
      drawTableHeader(pdf, top, columns);
      y = top + 25;
    }
    drawTableRow(pdf, y, height, columns, values);
    y += height;
  }
  pdf.y = y;
}

function drawTableHeader(
  pdf: PDFKit.PDFDocument,
  y: number,
  columns: Array<{ label: string; width: number; align: "left" | "right" | "center" }>,
): void {
  let x = PAGE.left;
  for (const column of columns) {
    pdf.rect(x, y, column.width, 25).fillAndStroke("#EDF2E8", "#D4DBCC");
    pdf.fillColor("#52604C").font("RobotoBold").fontSize(6.8).text(column.label, x + 5, y + 9, { width: column.width - 10, align: column.align });
    x += column.width;
  }
}

function drawTableRow(
  pdf: PDFKit.PDFDocument,
  y: number,
  height: number,
  columns: Array<{ label: string; width: number; align: "left" | "right" | "center" }>,
  values: string[],
): void {
  let x = PAGE.left;
  for (const [index, column] of columns.entries()) {
    const value = values[index] ?? "";
    pdf.rect(x, y, column.width, height).fillAndStroke("#FFFFFF", "#DDE2D6");
    pdf.fillColor("#263025").font(index === 1 ? "Roboto" : "RobotoBold").fontSize(8.4).text(value, x + 5, y + 6, { width: column.width - 10, align: column.align });
    x += column.width;
  }
}

function drawTotals(pdf: PDFKit.PDFDocument, document: PrintableAccountingDocument): void {
  const width = contentWidth(pdf);
  const totalWidth = 230;
  const height = 87;
  if (pdf.y + height + 128 > pdf.page.height - PAGE.bottom) {
    pdf.addPage();
    drawDocumentHeader(pdf, document, true);
  }
  const x = PAGE.left + width - totalWidth;
  const y = pdf.y + 24;
  pdf.roundedRect(x, y, totalWidth, height, 5).fillAndStroke("#F4F8EE", "#C9D5B7");
  drawTotalLine(pdf, x + 12, y + 12, "Без НДС", formatMoney(document.subtotal, document.currency));
  drawTotalLine(pdf, x + 12, y + 32, `НДС ${formatNumber(document.vatRate)}%`, formatMoney(document.vatAmount, document.currency));
  pdf.moveTo(x + 12, y + 56).lineTo(x + totalWidth - 12, y + 56).strokeColor("#B9C7AD").stroke();
  pdf.fillColor("#1D2B19").font("RobotoBold").fontSize(11).text(document.type === AccountingDocumentType.WAYBILL ? "Итого" : "К оплате", x + 12, y + 64, { width: 95 });
  pdf.fillColor("#1D2B19").font("RobotoBold").fontSize(11).text(formatMoney(document.totalAmount, document.currency), x + 110, y + 64, { width: totalWidth - 122, align: "right" });
  pdf.y = y + height;
}

function drawBankDetails(pdf: PDFKit.PDFDocument, document: PrintableAccountingDocument): void {
  const company = companyProfile(document);
  const values = [
    company.bankName === "" ? "" : `Банк: ${company.bankName}`,
    company.iban === "" ? "" : `ИИК: ${company.iban}`,
    company.bic === "" ? "" : `БИК: ${company.bic}`,
  ].filter(Boolean);
  if (values.length === 0) return;
  const width = contentWidth(pdf);
  const top = pdf.y + 18;
  if (top + 45 > pdf.page.height - PAGE.bottom - 88) {
    pdf.addPage();
    drawDocumentHeader(pdf, document, true);
  }
  const y = pdf.y + 18;
  pdf.roundedRect(PAGE.left, y, width, 39, 4).fillAndStroke("#F8FAF5", "#D9DED2");
  pdf.fillColor("#778070").font("Roboto").fontSize(6.8).text("БАНКОВСКИЕ РЕКВИЗИТЫ ПОСТАВЩИКА", PAGE.left + 10, y + 8, { characterSpacing: 0.4 });
  pdf.fillColor("#263025").font("RobotoBold").fontSize(8.4).text(values.join("   ·   "), PAGE.left + 10, y + 20, { width: width - 20, ellipsis: true });
  pdf.y = y + 39;
}

function drawTotalLine(pdf: PDFKit.PDFDocument, x: number, y: number, label: string, value: string): void {
  pdf.fillColor("#687360").font("Roboto").fontSize(8.3).text(label, x, y, { width: 100 });
  pdf.fillColor("#202A1E").font("RobotoBold").fontSize(8.8).text(value, x + 100, y, { width: 106, align: "right" });
}

function drawFooter(pdf: PDFKit.PDFDocument, document: PrintableAccountingDocument): void {
  const width = contentWidth(pdf);
  const top = pdf.y + 31;
  const company = companyProfile(document);
  const footerText = [document.notes?.trim() ?? "", company.documentFooter].filter(Boolean).join("\n");
  if (footerText !== "") {
    pdf.fillColor("#6D7767").font("Roboto").fontSize(7.2).text("Примечание", PAGE.left, top, { width });
    pdf.fillColor("#313B2F").font("Roboto").fontSize(8.8).text(textValue(footerText), PAGE.left, top + 11, { width });
  }
  const signaturesTop = Math.max(pdf.y + 49, top + (footerText === "" ? 0 : 38));
  if (signaturesTop + 56 > pdf.page.height - PAGE.bottom) {
    pdf.addPage();
    drawDocumentHeader(pdf, document, true);
  }
  const y = pdf.y > signaturesTop ? pdf.y + 28 : signaturesTop;
  const signWidth = (width - 26) / 2;
  const leftLabel = document.type === AccountingDocumentType.POWER_OF_ATTORNEY ? "Руководитель" : document.type === AccountingDocumentType.WAYBILL ? "Отпустил" : "Исполнитель";
  const rightLabel = document.type === AccountingDocumentType.POWER_OF_ATTORNEY ? "Доверенное лицо" : document.type === AccountingDocumentType.WAYBILL ? "Получил" : "Покупатель";
  const leftSignature = [company.signatoryPosition, company.signatoryName || company.directorName].filter(Boolean).join(" · ");
  drawSignature(pdf, PAGE.left, y, signWidth, leftLabel, leftSignature);
  drawSignature(pdf, PAGE.left + signWidth + 26, y, signWidth, rightLabel);
}

function drawSignature(pdf: PDFKit.PDFDocument, x: number, y: number, width: number, label: string, name = ""): void {
  pdf.fillColor("#6C7565").font("Roboto").fontSize(7.5).text(label, x, y, { width });
  if (name !== "") pdf.fillColor("#596253").font("Roboto").fontSize(7.3).text(textValue(name), x, y + 12, { width, align: "right", ellipsis: true });
  pdf.moveTo(x, y + 30).lineTo(x + width, y + 30).strokeColor("#98A092").lineWidth(0.7).stroke();
  pdf.fillColor("#929A8D").font("Roboto").fontSize(6.6).text("подпись / расшифровка", x, y + 34, { width, align: "center" });
}

function addPageNumbers(pdf: PDFKit.PDFDocument): void {
  const range = pdf.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    pdf.switchToPage(index);
    const bottomMargin = pdf.page.margins.bottom;
    pdf.page.margins.bottom = 0;
    pdf.fillColor("#929A8D").font("Roboto").fontSize(6.8).text(`Сформировано в Miracle Chem CRM · ${index + 1} / ${range.count}`, PAGE.left, pdf.page.height - 29, { width: contentWidth(pdf), align: "right", lineBreak: false });
    pdf.page.margins.bottom = bottomMargin;
  }
}

function documentTitle(type: AccountingDocumentType): string {
  return ({
    WAYBILL: "НАКЛАДНАЯ",
    PAYMENT_INVOICE: "СЧЕТ НА ОПЛАТУ",
    COMPLETION_ACT: "АКТ ВЫПОЛНЕННЫХ РАБОТ",
    POWER_OF_ATTORNEY: "ДОВЕРЕННОСТЬ НА ПОЛУЧЕНИЕ ТОВАРА",
  } satisfies Record<AccountingDocumentType, string>)[type];
}

function documentSubtitle(document: PrintableAccountingDocument): string {
  return ({
    WAYBILL: "Товарная накладная на отгрузку продукции",
    PAYMENT_INVOICE: "Счет на оплату товаров и услуг",
    COMPLETION_ACT: "Подтверждение выполненных работ и услуг",
    POWER_OF_ATTORNEY: "Право на получение товара у поставщика",
  } satisfies Record<AccountingDocumentType, string>)[document.type];
}

function statusText(status: AccountingDocumentStatus): string {
  return ({
    DRAFT: "Черновик",
    PENDING_DIRECTOR_APPROVAL: "На согласовании у руководителя",
    PENDING_ACCOUNTANT_APPROVAL: "На проверке у бухгалтера",
    ISSUED: "Выставлен",
    PAID: "Оплачен",
    CANCELLED: "Отменен",
  } satisfies Record<AccountingDocumentStatus, string>)[status];
}

function formatDate(value: Date, timezone: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: timezone }).format(value);
}

function formatNumber(value: { toString(): string }): string {
  const amount = Number(value.toString());
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(Number.isFinite(amount) ? amount : 0);
}

function formatMoney(value: { toString(): string }, currency: string): string {
  const amount = Number(value.toString());
  return `${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number.isFinite(amount) ? amount : 0)} ${currency}`;
}

function unitLabel(unit: string): string {
  return ({ PCS: "шт.", KG: "кг", T: "т", L: "л", M3: "м³", SERVICE: "услуга" } as Record<string, string>)[unit] ?? unit;
}

function textValue(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]/gu, " ").replace(/\s+/gu, " ").trim() || "-";
}

function contentWidth(pdf: PDFKit.PDFDocument): number {
  return pdf.page.width - PAGE.left - PAGE.right;
}

function companyProfile(document: PrintableAccountingDocument): {
  legalName: string;
  taxId: string;
  address: string;
  bankName: string;
  iban: string;
  bic: string;
  directorName: string;
  signatoryName: string;
  signatoryPosition: string;
  documentFooter: string;
} {
  const profile = document.workspace.companyProfile;
  return {
    legalName: textValue(profile?.legalName ?? document.workspace.name),
    taxId: profile?.taxId?.trim() ?? "",
    address: profile?.address?.trim() ?? "",
    bankName: profile?.bankName?.trim() ?? "",
    iban: profile?.iban?.trim() ?? "",
    bic: profile?.bic?.trim() ?? "",
    directorName: profile?.directorName?.trim() ?? "",
    signatoryName: profile?.signatoryName?.trim() ?? "",
    signatoryPosition: profile?.signatoryPosition?.trim() ?? "",
    documentFooter: profile?.documentFooter?.trim() ?? "",
  };
}

function powerOfAttorneyDetails(value: unknown): Record<"representativeName" | "representativePosition" | "representativeIin" | "identityDocument" | "identityIssuedBy" | "identityIssuedAt", string> {
  const details = value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    representativeName: stringDetail(details.representativeName),
    representativePosition: stringDetail(details.representativePosition),
    representativeIin: stringDetail(details.representativeIin),
    identityDocument: stringDetail(details.identityDocument),
    identityIssuedBy: stringDetail(details.identityIssuedBy),
    identityIssuedAt: stringDetail(details.identityIssuedAt),
  };
}

function stringDetail(value: unknown): string {
  return typeof value === "string" ? textValue(value) : "";
}
