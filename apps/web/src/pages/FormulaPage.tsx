import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Braces,
  Calculator,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  FlaskConical,
  Play,
  ShieldCheck,
  Sigma,
} from "lucide-react";
import { apiMutation } from "../api.js";
import { CustomSelect } from "../components/CustomSelect.js";
import { DateTimePicker } from "../components/DateTimePicker.js";
import { useApi } from "../hooks/use-api.js";
import type { Recipe, RecipeCalculation } from "../types.js";
import { formatMoney, formatNumber, unitLabel } from "../lib/format.js";
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
  const recipes = useApi<{ items: Recipe[] }>("/recipes");
  const [selectedId, setSelectedId] = useState<string>("");
  const selected = useMemo(
    () => formulas.data?.items.find((formula) => formula.id === selectedId) ?? formulas.data?.items[0] ?? null,
    [formulas.data, selectedId],
  );
  const version = selected?.versions[0];
  const [customExpression, setCustomExpression] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Evaluation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [calculationRecipeId, setCalculationRecipeId] = useState("");
  const [calculationVolume, setCalculationVolume] = useState("");
  const [calculatedFor, setCalculatedFor] = useState("");
  const [recipeResult, setRecipeResult] = useState<RecipeCalculation | null>(null);
  const [calculatorBusy, setCalculatorBusy] = useState(false);
  const [calculatorError, setCalculatorError] = useState<string | null>(null);
  if (formulas.loading || recipes.loading) return <LoadingState />;
  if (formulas.error !== null) return <ErrorState message={formulas.error} retry={formulas.reload} />;
  if (recipes.error !== null) return <ErrorState message={recipes.error} retry={recipes.reload} />;
  const expression = customExpression || version?.expression || "normPerM3 * plannedVolumeM3";
  const variableNames = extractVariables(expression);
  const recipeOptions = (recipes.data?.items ?? []).flatMap((recipe) => recipe.versions.map((recipeVersion) => ({
    value: recipeVersion.id,
    label: recipe.name,
    description: `v${recipeVersion.version} · ${recipeVersion.concreteGrade}`,
  })));
  const activeCalculationRecipeId = calculationRecipeId;

  async function evaluate(): Promise<void> {
    if (variableNames.some((name) => (values[name] ?? "") === "")) {
      setError("Заполните все входные значения формулы");
      return;
    }
    setBusy(true); setError(null);
    try {
      const evaluation = await apiMutation<Evaluation>("/formulas/evaluate", {
        expression,
        precision: version?.precision ?? 3,
        roundingMode: version?.roundingMode ?? "HALF_UP",
        formulaVersionId: customExpression === "" ? version?.id : undefined,
        variables: Object.fromEntries(variableNames.map((name) => [name, { value: values[name] ?? "" }])),
      });
      setResult(evaluation);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Формула не выполнена"); }
    finally { setBusy(false); }
  }

  async function calculateRecipe(): Promise<void> {
    if (activeCalculationRecipeId === "" || calculationVolume === "" || calculatedFor === "") {
      setCalculatorError("Выберите рецептуру, укажите объём и дату расчёта");
      return;
    }
    setCalculatorBusy(true);
    setCalculatorError(null);
    try {
      setRecipeResult(await apiMutation<RecipeCalculation>("/calculator/recipe", {
        recipeVersionId: activeCalculationRecipeId,
        plannedVolume: calculationVolume,
        plannedVolumeUnit: "M3",
        calculatedFor: new Date(calculatedFor).toISOString(),
      }));
    } catch (cause) {
      setCalculatorError(cause instanceof Error ? cause.message : "Расчёт не выполнен");
    } finally {
      setCalculatorBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Расчётное ядро"
        title="Калькулятор производства"
        description="Рассчитывайте состав, себестоимость и дефицит склада, а также проверяйте инженерные формулы с полной расшифровкой."
      />
      <Panel className="recipe-calculator-panel">
        <div className="calculator-heading"><span><Calculator size={21} /></span><div><span className="eyebrow">Производственный расчёт</span><h2>Расчёт замеса по рецептуре</h2><p>Все количества и цены пересчитываются на сервере в Decimal.</p></div></div>
        <div className="calculator-controls">
          <div className="form-field"><span>Рецептура</span><CustomSelect ariaLabel="Рецептура для расчёта" value={activeCalculationRecipeId} onChange={(value) => { setCalculationRecipeId(value); setRecipeResult(null); }} options={recipeOptions} /></div>
          <label><span>Объём, м³</span><input type="number" min="0.001" step="0.001" value={calculationVolume} onChange={(event) => setCalculationVolume(event.target.value)} /></label>
          <div className="form-field"><span>Дата расчёта</span><DateTimePicker ariaLabel="Дата производственного расчёта" value={calculatedFor} onChange={setCalculatedFor} align="right" /></div>
          <button className="button primary" disabled={calculatorBusy} onClick={() => void calculateRecipe()}><Calculator size={16} /> {calculatorBusy ? "Считаем…" : "Рассчитать состав"}</button>
        </div>
        {calculatorError === null ? null : <div className="form-error calculator-error">{calculatorError}</div>}
        {recipeResult === null ? <div className="calculator-empty"><FlaskConical size={27} /><span>Выберите рецептуру и объём — получите план расхода, стоимость и проверку остатков.</span></div> : (
          <div className="calculator-result">
            <div className="calculator-kpis">
              <span><small>Плановый выпуск</small><strong>{formatNumber(recipeResult.plannedOutput)} {unitLabel[recipeResult.plannedOutputUnit]}</strong></span>
              <span><small>Стоимость замеса</small><strong>{formatMoney(recipeResult.totalCost, recipeResult.currency)}</strong></span>
              <span><small>Себестоимость 1 м³</small><strong>{formatMoney(recipeResult.costPerM3, recipeResult.currency)}</strong></span>
              <span className={recipeResult.sufficient ? "sufficient" : "shortage"}><small>Готовность склада</small><strong>{recipeResult.sufficient ? "Материалов достаточно" : "Есть дефицит"}</strong></span>
            </div>
            <div className="calculator-table-wrap"><table className="data-table calculator-table"><thead><tr><th>Компонент</th><th>Норма</th><th>Требуется</th><th>Свободно</th><th>Цена</th><th>Стоимость</th><th>Проверка</th></tr></thead><tbody>{recipeResult.components.map((component) => <tr key={component.materialId}><td><strong>{component.name}</strong><small>{component.code}</small></td><td>{formatNumber(component.normPerM3)} {unitLabel[component.recipeUnit]}</td><td><strong>{formatNumber(component.quantity)} {unitLabel[component.unit]}</strong></td><td>{formatNumber(component.freeStock)} {unitLabel[component.unit]}</td><td>{formatMoney(component.unitCost, recipeResult.currency)}</td><td>{formatMoney(component.componentCost, recipeResult.currency)}</td><td>{component.sufficient ? <span className="calculation-ok"><CheckCircle2 size={14} /> Достаточно</span> : <span className="calculation-shortage"><AlertTriangle size={14} /> −{formatNumber(component.shortage)}</span>}</td></tr>)}</tbody></table></div>
          </div>
        )}
      </Panel>

      <div className="formula-section-heading"><span className="eyebrow">Инженерный режим</span><h2>Редактор формул</h2></div>
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
          <div className="variable-grid">{variableNames.map((name) => <label key={name}><span>{humanize(name)}</span><div><input type="number" step="0.001" value={values[name] ?? ""} onChange={(event) => setValues({ ...values, [name]: event.target.value })} /><em>{guessUnit(name)}</em></div><small>{name}</small></label>)}</div>
          {error === null ? null : <div className="form-error">{error}</div>}
          <button className="button primary evaluate-button" disabled={busy} onClick={() => void evaluate()}><Play size={17} /> {busy ? "Вычисляем…" : "Выполнить расчёт"}</button>
        </Panel>

        <Panel className="formula-result">
          <PanelHeader title="Результат" description="Итоговое значение и пошаговая расшифровка" />
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
