import { useMemo, useState } from "react";
import {
  Braces,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  FlaskConical,
  Play,
  ShieldCheck,
  Sigma,
} from "lucide-react";
import { apiMutation } from "../api.js";
import { useApi } from "../hooks/use-api.js";
import { formatNumber } from "../lib/format.js";
import { ErrorState, LoadingState, PageHeader, Panel, PanelHeader } from "../components/ui.js";

interface StoredFormula {
  id: string;
  code: string;
  name: string;
  description: string;
  versions: Array<{
    id: string;
    version: number;
    expression: string;
    variables: string[];
    precision: number;
    roundingMode: "HALF_UP" | "UP" | "DOWN";
  }>;
}

interface Evaluation {
  value: string;
  unit: string | null;
  usedVariables: string[];
  trace: Array<{
    index: number;
    operation: string;
    expression: string;
    inputs: Array<{ value: string; unit: string | null }>;
    result: { value: string; unit: string | null } | boolean | string;
    explanation: string;
  }>;
}

export function FormulaPage() {
  const formulas = useApi<{ items: StoredFormula[] }>("/formulas");
  const [selectedId, setSelectedId] = useState<string>("");
  const selected = useMemo(
    () => formulas.data?.items.find((formula) => formula.id === selectedId) ?? formulas.data?.items[0] ?? null,
    [formulas.data, selectedId],
  );
  const version = selected?.versions[0];
  const [customExpression, setCustomExpression] = useState("");
  const [values, setValues] = useState<Record<string, string>>({
    normPerM3: "390",
    plannedVolumeM3: "5",
    waterMass: "875",
    cementMass: "1950",
    actual: "1980",
    planned: "1950",
    recipeWater: "875",
    aggregateWater: "210",
    batchCost: "257774.16",
    actualOutput: "5",
  });
  const [result, setResult] = useState<Evaluation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (formulas.loading) return <LoadingState />;
  if (formulas.error !== null) return <ErrorState message={formulas.error} retry={formulas.reload} />;
  const expression = customExpression || version?.expression || "normPerM3 * plannedVolumeM3";
  const variableNames = extractVariables(expression);

  async function evaluate(): Promise<void> {
    setBusy(true); setError(null);
    try {
      const evaluation = await apiMutation<Evaluation>("/formulas/evaluate", {
        expression,
        precision: version?.precision ?? 3,
        roundingMode: version?.roundingMode ?? "HALF_UP",
        variables: Object.fromEntries(variableNames.map((name) => [name, { value: values[name] ?? "0" }])),
      });
      setResult(evaluation);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Формула не выполнена"); }
    finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader
        eyebrow="Расчётное ядро"
        title="Формулы производства"
        description="Безопасный AST-движок на Decimal: без eval, с проверкой единиц и полной расшифровкой каждого шага."
        actions={<span className="engine-badge"><ShieldCheck size={16} /> Backend verified</span>}
      />
      <div className="formula-layout">
        <Panel className="formula-library">
          <PanelHeader title="Библиотека" description={`${formulas.data?.items.length ?? 0} активных формул`} />
          <div className="formula-list">{formulas.data?.items.map((formula) => <button key={formula.id} className={selected?.id === formula.id ? "active" : ""} onClick={() => { setSelectedId(formula.id); setCustomExpression(""); setResult(null); }}><span><Sigma size={17} /></span><div><strong>{formula.name}</strong><small>{formula.code} · v{formula.versions[0]?.version}</small></div><ChevronDown size={15} /></button>)}</div>
          <div className="engine-guard"><ShieldCheck size={19} /><div><strong>Защищённое исполнение</strong><p>Лимит 4 096 символов, 512 токенов и 256 AST-узлов.</p></div></div>
        </Panel>

        <Panel className="formula-editor">
          <div className="formula-editor-head"><div><span className="eyebrow">Редактор выражения</span><h2>{selected?.name ?? "Пользовательская формула"}</h2></div><span className="version-chip">v{version?.version ?? 1}</span></div>
          <label className="code-editor"><span><Braces size={16} /> expression</span><textarea spellCheck={false} value={expression} onChange={(event) => setCustomExpression(event.target.value)} /><small>Доступно: + − × ÷, %, скобки, сравнения, ? :, min, max, round, abs, if, convert.</small></label>
          <div className="variable-heading"><h3>Входные переменные</h3><span>{variableNames.length} значений</span></div>
          <div className="variable-grid">{variableNames.map((name) => <label key={name}><span>{humanize(name)}</span><div><input type="number" step="0.001" value={values[name] ?? "0"} onChange={(event) => setValues({ ...values, [name]: event.target.value })} /><em>{guessUnit(name)}</em></div><small>{name}</small></label>)}</div>
          {error === null ? null : <div className="form-error">{error}</div>}
          <button className="button primary evaluate-button" disabled={busy} onClick={() => void evaluate()}><Play size={17} /> {busy ? "Вычисляем…" : "Выполнить на backend"}</button>
        </Panel>

        <Panel className="formula-result">
          <PanelHeader title="Результат" description="Окончательный backend-расчёт" />
          {result === null ? <div className="formula-placeholder"><FlaskConical size={34} /><strong>Готово к расчёту</strong><p>Введите исходные значения и запустите формулу.</p></div> : <><div className="result-value"><span><CheckCircle2 size={18} /> Расчёт выполнен</span><strong>{formatNumber(result.value)} {result.unit ?? ""}</strong><small>Точность: {version?.precision ?? 3} знака · HALF_UP</small></div><div className="trace-title"><h3>Расшифровка</h3><span>{result.trace.length} шагов</span></div><div className="trace-list">{result.trace.map((step) => <div key={step.index}><span>{step.index}</span><div><strong>{step.explanation}</strong><code>{step.expression}</code><small>Результат: {formatResult(step.result)}</small></div></div>)}</div></>}
          <div className="formula-help"><CircleHelp size={17} /><span>Входные значения, результат и trace сохраняются в журнале для производственных расчётов.</span></div>
        </Panel>
      </div>
    </>
  );
}

function extractVariables(expression: string): string[] {
  const functions = new Set(["min", "max", "round", "abs", "if", "convert", "kg", "g", "t", "l", "ml", "m3"]);
  return [...new Set(expression.match(/[A-Za-z_][A-Za-z0-9_.]*/gu) ?? [])].filter((name) => !functions.has(name.toLowerCase()));
}

function humanize(value: string): string {
  const labels: Record<string, string> = { normPerM3: "Норма на 1 м³", plannedVolumeM3: "Плановый объём", waterMass: "Масса воды", cementMass: "Масса цемента", actual: "Фактический расход", planned: "Плановый расход", recipeWater: "Вода по рецептуре", aggregateWater: "Вода в заполнителях", batchCost: "Стоимость замеса", actualOutput: "Фактический выход" };
  return labels[value] ?? value;
}

function guessUnit(name: string): string {
  if (/volume|output/iu.test(name)) return "м³";
  if (/cost/iu.test(name)) return "₸";
  if (/water|cement|mass|norm|actual|planned/iu.test(name)) return "кг";
  return "";
}

function formatResult(value: Evaluation["trace"][number]["result"]): string {
  if (typeof value !== "object") return String(value);
  return `${formatNumber(value.value)}${value.unit === null ? "" : ` ${value.unit}`}`;
}

