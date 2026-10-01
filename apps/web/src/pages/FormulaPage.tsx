import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Braces,
  Calculator,
  CheckCircle2,
  ChevronDown,
  FlaskConical,
  Percent,
  Play,
  Plus,
  Sigma,
  Trash2,
} from "lucide-react";
import { apiMutation } from "../api.js";
import { CustomSelect } from "../components/CustomSelect.js";
import { DateTimePicker } from "../components/DateTimePicker.js";
import { useApi } from "../hooks/use-api.js";
import { useDateFilter } from "../hooks/use-date-filter.js";
import type {
  AdditiveFormulaCalculation,
  Material,
  MaterialListResponse,
  Recipe,
  RecipeCalculation,
} from "../types.js";
import type { HistoricalFormula } from "../types/historical.js";
import { formatMoney, formatNumber, unitLabel } from "../lib/format.js";
import { ErrorState, LoadingState, Modal, PageHeader, Panel, PanelHeader } from "../components/ui.js";

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
    dosagePercent: string | null;
    components: Array<{
      id: string;
      materialId: string;
      percentage: string;
      material: Material;
    }>;
  }>;
}

interface DraftAdditiveComponent {
  key: string;
  materialId: string;
  percentage: string;
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
  const { selectedDate } = useDateFilter();
  const formulas = useApi<{ items: StoredFormula[] }>("/formulas");
  const workbookFormulas = useApi<{ items: HistoricalFormula[] }>("/historical-workbooks/formulas");
  const recipes = useApi<{ items: Recipe[] }>("/recipes");
  const materials = useApi<MaterialListResponse>("/materials");
  const [selectedId, setSelectedId] = useState<string>("");
  const [selectedWorkbookFormula, setSelectedWorkbookFormula] = useState<HistoricalFormula | null>(null);
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
  const [createAdditiveOpen, setCreateAdditiveOpen] = useState(false);
  const [additiveFormulaVersionId, setAdditiveFormulaVersionId] = useState("");
  const [binderMass, setBinderMass] = useState("");
  const [additiveResult, setAdditiveResult] = useState<AdditiveFormulaCalculation | null>(null);
  const [additiveBusy, setAdditiveBusy] = useState(false);
  const [additiveError, setAdditiveError] = useState<string | null>(null);
  useEffect(() => {
    setCalculatedFor((current) => current === "" ? `${selectedDate}T08:00` : current);
  }, [selectedDate]);
  if (formulas.loading || recipes.loading || materials.loading) return <LoadingState />;
  if (formulas.error !== null) return <ErrorState message={formulas.error} retry={formulas.reload} />;
  if (recipes.error !== null) return <ErrorState message={recipes.error} retry={recipes.reload} />;
  if (materials.error !== null) return <ErrorState message={materials.error} retry={materials.reload} />;
  const expression = customExpression || version?.expression || "normPerM3 * plannedVolumeM3";
  const variableNames = extractVariables(expression);
  const warehouse = materials.data?.items ?? [];
  const massMaterials = warehouse.filter((material) => ["G", "KG", "T"].includes(material.baseUnit));
  const additiveFormulaOptions = (formulas.data?.items ?? []).flatMap((formula) => formula.versions
    .filter((formulaVersion) => formulaVersion.dosagePercent !== null && formulaVersion.components.length > 0)
    .map((formulaVersion) => ({
      value: formulaVersion.id,
      label: formula.name,
      description: `v${formulaVersion.version} · дозировка ${formatNumber(formulaVersion.dosagePercent ?? "0")}%`,
    })));
  const recipeOptions = (recipes.data?.items ?? []).flatMap((recipe) => recipe.versions.map((recipeVersion) => ({
    value: recipeVersion.id,
    label: recipe.name,
    description: `v${recipeVersion.version} · ${recipeVersion.concreteGrade}`,
  })));
  const activeCalculationRecipeId = calculationRecipeId;

  function valueForVariable(name: string): string {
    if (values[name] !== undefined) return values[name] ?? "";
    if (name === "dosagePercent") return version?.dosagePercent ?? "";
    return "";
  }

  async function evaluate(): Promise<void> {
    if (variableNames.some((name) => valueForVariable(name) === "")) {
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
        variables: Object.fromEntries(variableNames.map((name) => [name, { value: valueForVariable(name) }])),
      });
      setResult(evaluation);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Формула не выполнена"); }
    finally { setBusy(false); }
  }

  async function calculateAdditive(): Promise<void> {
    if (additiveFormulaVersionId === "" || binderMass === "") {
      setAdditiveError("Выберите формулу добавки и укажите массу вяжущего");
      return;
    }
    setAdditiveBusy(true);
    setAdditiveError(null);
    try {
      setAdditiveResult(await apiMutation<AdditiveFormulaCalculation>("/calculator/additive", {
        formulaVersionId: additiveFormulaVersionId,
        binderMass,
        binderMassUnit: "KG",
      }));
    } catch (cause) {
      setAdditiveError(cause instanceof Error ? cause.message : "Расчёт добавки не выполнен");
    } finally {
      setAdditiveBusy(false);
    }
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
        title="Калькулятор производства"
        actions={<button className="button primary" disabled={massMaterials.length === 0} onClick={() => setCreateAdditiveOpen(true)}><Plus size={17} /> Новая формула добавки</button>}
      />
      {(workbookFormulas.data?.items.length ?? 0) > 0 ? <Panel className="table-panel">
        <div className="table-toolbar"><div><h2>Составы добавок</h2></div><span className="soft-tag">{workbookFormulas.data?.items.length} записей</span></div>
        <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Формула</th><th>Клиент</th><th>Компоненты</th><th>Итог в файле</th><th>На единицу</th></tr></thead><tbody>
          {workbookFormulas.data?.items.map((row) => <tr key={row.id} onClick={() => setSelectedWorkbookFormula(row)}>
            <td><strong>№{row.number}</strong><small>{row.fileName}</small></td>
            <td>{row.customer ?? "Не указан"}</td><td>{row.components.map((part) => part.name).join(", ")}</td>
            <td>{formatNumber(row.total)}</td><td>{row.costPerUnit === null ? "—" : formatNumber(row.costPerUnit)}</td>
          </tr>)}
        </tbody></table></div>
      </Panel> : null}
      {workbookFormulas.error ? <p className="inline-load-error" role="alert">Не удалось загрузить формулы из Excel. <button type="button" onClick={() => void workbookFormulas.reload()}>Повторить</button></p> : null}
      <Panel className="additive-calculator-panel">
        <div className="calculator-heading"><span><Percent size={21} /></span><div><h2>Расчёт добавки по проценту</h2></div></div>
        <div className="additive-calculator-controls">
          <div className="form-field"><span>Формула добавки</span><CustomSelect required ariaLabel="Формула добавки" value={additiveFormulaVersionId} onChange={(value) => { setAdditiveFormulaVersionId(value); setAdditiveResult(null); }} options={additiveFormulaOptions} placeholder="Выберите формулу" /></div>
          <label><span>Масса вяжущего, кг</span><input required type="number" min="0.001" step="0.001" value={binderMass} onChange={(event) => { setBinderMass(event.target.value); setAdditiveResult(null); }} /></label>
          <button className="button primary" disabled={additiveBusy || additiveFormulaOptions.length === 0} onClick={() => void calculateAdditive()}><Calculator size={16} /> {additiveBusy ? "Считаем…" : "Рассчитать добавку"}</button>
        </div>
        {additiveError === null ? null : <div className="form-error calculator-error">{additiveError}</div>}
        {additiveResult === null ? (
          <div className="additive-formula-empty">
            <FlaskConical size={25} />
            <span>{additiveFormulaOptions.length === 0 ? "Создайте первую формулу добавки: укажите рабочую дозировку и состав на 100%." : "Выберите формулу и массу вяжущего — система рассчитает расход каждого реагента."}</span>
          </div>
        ) : (
          <div className="additive-calculation-result">
            <div className="calculator-kpis additive-kpis">
              <span><small>Дозировка добавки</small><strong>{formatNumber(additiveResult.dosagePercent)}%</strong></span>
              <span><small>Требуется добавки</small><strong>{formatNumber(additiveResult.additiveQuantity)} кг</strong></span>
              <span><small>Стоимость добавки</small><strong>{formatMoney(additiveResult.totalCost, additiveResult.currency)}</strong></span>
              <span className={additiveResult.sufficient ? "sufficient" : "shortage"}><small>Готовность склада</small><strong>{additiveResult.sufficient ? "Компонентов достаточно" : "Есть дефицит"}</strong></span>
            </div>
            <div className="calculator-table-wrap"><table className="data-table calculator-table additive-calculation-table"><thead><tr><th>Компонент формулы</th><th>Доля</th><th>Требуется</th><th>Свободно</th><th>Стоимость</th><th>Проверка</th></tr></thead><tbody>{additiveResult.components.map((component) => <tr key={component.materialId}><td><strong>{component.name}</strong><small>{component.code}</small></td><td><strong>{formatNumber(component.percentage)}%</strong></td><td>{formatNumber(component.quantity)} {unitLabel[component.unit]}</td><td>{formatNumber(component.freeStock)} {unitLabel[component.unit]}</td><td>{formatMoney(component.componentCost, additiveResult.currency)}</td><td>{component.sufficient ? <span className="calculation-ok"><CheckCircle2 size={14} /> Достаточно</span> : <span className="calculation-shortage"><AlertTriangle size={14} /> −{formatNumber(component.shortage)} {unitLabel[component.unit]}</span>}</td></tr>)}</tbody></table></div>
          </div>
        )}
      </Panel>
      <Panel className="recipe-calculator-panel">
        <div className="calculator-heading"><span><Calculator size={21} /></span><div><h2>Расчёт замеса по рецептуре</h2></div></div>
        <div className="calculator-controls">
          <div className="form-field"><span>Рецептура</span><CustomSelect required ariaLabel="Рецептура для расчёта" value={activeCalculationRecipeId} onChange={(value) => { setCalculationRecipeId(value); setRecipeResult(null); }} options={recipeOptions} /></div>
          <label><span>Объём, м³</span><input required type="number" min="0.001" step="0.001" value={calculationVolume} onChange={(event) => setCalculationVolume(event.target.value)} /></label>
          <div className="form-field"><span>Дата расчёта</span><DateTimePicker required ariaLabel="Дата производственного расчёта" value={calculatedFor} onChange={setCalculatedFor} align="right" /></div>
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

      <div className="formula-section-heading"><h2>Редактор формул</h2></div>
      <div className="formula-layout">
        <Panel className="formula-library">
          <PanelHeader title="Библиотека" description={`${formulas.data?.items.length ?? 0} активных формул`} />
          <div className="formula-list">{formulas.data?.items.map((formula) => <button key={formula.id} className={selected?.id === formula.id ? "active" : ""} onClick={() => { setSelectedId(formula.id); setCustomExpression(""); setValues({}); setResult(null); }}><span><Sigma size={17} /></span><div><strong>{formula.name}</strong><small>{formula.code} · v{formula.versions[0]?.version}{formula.versions[0]?.dosagePercent === null || formula.versions[0]?.dosagePercent === undefined ? "" : ` · ${formatNumber(formula.versions[0].dosagePercent)}%`}</small></div><ChevronDown size={15} /></button>)}</div>
        </Panel>

        <Panel className="formula-editor">
          <div className="formula-editor-head"><div><span className="eyebrow">Редактор выражения</span><h2>{selected?.name ?? "Пользовательская формула"}</h2></div><span className="version-chip">v{version?.version ?? 1}</span></div>
          {version?.dosagePercent === null || version?.dosagePercent === undefined ? null : (
            <div className="formula-composition-summary">
              <div><span><Percent size={16} /></span><div><small>Рабочая дозировка</small><strong>{formatNumber(version.dosagePercent)}% от массы вяжущего</strong></div></div>
              <div className="formula-composition-list">{version.components.map((component) => <span key={component.id}><i style={{ width: `${Math.max(4, Math.min(100, Number(component.percentage)))}%` }} /><strong>{component.material.name}</strong><em>{formatNumber(component.percentage)}%</em></span>)}</div>
            </div>
          )}
          <label className="code-editor"><span><Braces size={16} /> expression</span><textarea spellCheck={false} value={expression} onChange={(event) => setCustomExpression(event.target.value)} /><small>Доступно: + − × ÷, %, скобки, сравнения, ? :, min, max, round, abs, if, convert.</small></label>
          <div className="variable-heading"><h3>Входные переменные</h3><span>{variableNames.length} значений</span></div>
          <div className="variable-grid">{variableNames.map((name) => <label key={name}><span>{humanize(name)}</span><div><input required type="number" step="0.001" value={valueForVariable(name)} onChange={(event) => setValues({ ...values, [name]: event.target.value })} /><em>{guessUnit(name)}</em></div><small>{name}</small></label>)}</div>
          {error === null ? null : <div className="form-error">{error}</div>}
          <button className="button primary evaluate-button" disabled={busy} onClick={() => void evaluate()}><Play size={17} /> {busy ? "Вычисляем…" : "Выполнить расчёт"}</button>
        </Panel>

        <Panel className="formula-result">
          <PanelHeader title="Результат" />
          {result === null ? <div className="formula-placeholder"><FlaskConical size={34} /><strong>Готово к расчёту</strong><p>Введите исходные значения и запустите формулу.</p></div> : <><div className="result-value"><span><CheckCircle2 size={18} /> Расчёт выполнен</span><strong>{formatNumber(result.value)} {result.unit ?? ""}</strong><small>Точность: {version?.precision ?? 3} знака · HALF_UP</small></div><div className="trace-title"><h3>Расшифровка</h3><span>{result.trace.length} шагов</span></div><div className="trace-list">{result.trace.map((step) => <div key={step.index}><span>{step.index}</span><div><strong>{step.explanation}</strong><code>{step.expression}</code><small>Результат: {formatResult(step.result)}</small></div></div>)}</div></>}
        </Panel>
      </div>
      {createAdditiveOpen ? <NewAdditiveFormulaModal materials={massMaterials} onClose={() => setCreateAdditiveOpen(false)} onCreated={async (formulaId) => { setCreateAdditiveOpen(false); setSelectedId(formulaId); await formulas.reload(); }} /> : null}
      {selectedWorkbookFormula ? <Modal title={`Состав добавки №${selectedWorkbookFormula.number}`} onClose={() => setSelectedWorkbookFormula(null)}>
        <div className="imported-record-detail">
          <p>{selectedWorkbookFormula.customer ?? "Клиент не указан"} · {selectedWorkbookFormula.fileName}</p>
          <h3>Компоненты</h3>
          {selectedWorkbookFormula.components.map((part) => <div key={part.sourceRow}><strong>{part.name}</strong><span>{formatNumber(part.quantity)}</span><small>Цена {formatNumber(part.unitPrice)} · сумма {formatNumber(part.lineTotal)}</small></div>)}
          <p className="imported-record-note">Лист «{selectedWorkbookFormula.sourceSheet}», строки {selectedWorkbookFormula.sourceRows[0]}–{selectedWorkbookFormula.sourceRows.at(-1)}. Единицы и дозировка в файле не указаны, поэтому состав пока не доступен в калькуляторе.</p>
        </div>
      </Modal> : null}
    </>
  );
}

let additiveComponentCounter = 0;

function createDraftAdditiveComponent(): DraftAdditiveComponent {
  additiveComponentCounter += 1;
  return { key: `additive-component-${additiveComponentCounter}`, materialId: "", percentage: "" };
}

function NewAdditiveFormulaModal({
  materials,
  onClose,
  onCreated,
}: {
  materials: Material[];
  onClose: () => void;
  onCreated: (formulaId: string) => Promise<void>;
}) {
  const [form, setForm] = useState({ code: "", name: "", description: "", dosagePercent: "" });
  const [components, setComponents] = useState<DraftAdditiveComponent[]>([createDraftAdditiveComponent()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const totalPercentage = components.reduce((total, component) => total + Number(component.percentage || 0), 0);

  function addComponent(): void {
    setComponents([...components, createDraftAdditiveComponent()]);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (form.code.trim() === "" || form.name.trim() === "" || form.description.trim() === "" || form.dosagePercent === "") {
      setError("Заполните код, название, описание и рабочую дозировку");
      return;
    }
    const dosage = Number(form.dosagePercent);
    if (!Number.isFinite(dosage) || dosage <= 0 || dosage > 100) {
      setError("Рабочая дозировка должна быть больше 0 и не больше 100%");
      return;
    }
    if (components.some((component) => component.materialId === "" || component.percentage === "" || Number(component.percentage) <= 0)) {
      setError("Выберите материал и укажите положительную долю для каждого компонента");
      return;
    }
    if (Math.abs(totalPercentage - 100) > 0.000001) {
      setError("Сумма долей компонентов рецептуры должна быть равна 100%");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await apiMutation<{ id: string }>("/formulas", {
        code: form.code,
        name: form.name,
        description: form.description,
        expression: "binderMass * dosagePercent / 100",
        precision: 6,
        roundingMode: "HALF_UP",
        dosagePercent: form.dosagePercent,
        components: components.map((component, position) => ({
          materialId: component.materialId,
          percentage: component.percentage,
          position,
        })),
        publish: true,
      });
      await onCreated(created.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось создать формулу добавки");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Новая формула добавки" onClose={onClose} wide>
      <form onSubmit={(event) => void submit(event)}>
        <div className="form-grid additive-formula-fields">
          <label><span>Код формулы</span><input required value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="Например, MC-KT1" /></label>
          <label><span>Название добавки</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Название готовой добавки" /></label>
          <label><span>Рабочая дозировка, %</span><input required type="number" min="0.001" max="100" step="0.001" value={form.dosagePercent} onChange={(event) => setForm({ ...form, dosagePercent: event.target.value })} placeholder="% от массы вяжущего" /></label>
          <label className="additive-description"><span>Описание</span><input required value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Назначение и условия применения" /></label>
        </div>
        <div className="section-title additive-builder-title">
          <div><h3>Рецептура формулы</h3><span>Укажите долю каждого реагента в готовой добавке</span></div>
          <button type="button" className="button ghost small" disabled={components.length >= materials.length} onClick={addComponent}><Plus size={15} /> Добавить компонент</button>
        </div>
        <div className="additive-builder-list">
          {components.map((component, index) => (
            <div key={component.key}>
              <span className="additive-component-number">{index + 1}</span>
              <div className="form-field"><span>Реагент со склада</span><CustomSelect required ariaLabel={`Компонент формулы ${index + 1}`} value={component.materialId} onChange={(materialId) => setComponents(components.map((item) => item.key === component.key ? { ...item, materialId } : item))} options={materials.filter((candidate) => candidate.id === component.materialId || !components.some((item) => item.materialId === candidate.id)).map((candidate) => ({ value: candidate.id, label: candidate.name, description: `${candidate.code} · ${unitLabel[candidate.baseUnit]}` }))} placeholder="Выберите реагент" /></div>
              <label><span>Доля в формуле, %</span><input required type="number" min="0.001" max="100" step="0.001" value={component.percentage} onChange={(event) => setComponents(components.map((item) => item.key === component.key ? { ...item, percentage: event.target.value } : item))} /></label>
              <button type="button" className="row-action danger" aria-label={`Удалить компонент ${index + 1}`} disabled={components.length === 1} onClick={() => setComponents(components.filter((item) => item.key !== component.key))}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
        <div className={`additive-percentage-total${Math.abs(totalPercentage - 100) <= 0.000001 ? " complete" : ""}`}>
          <span>Сумма состава</span><strong>{formatNumber(totalPercentage)}%</strong><small>{Math.abs(totalPercentage - 100) <= 0.000001 ? "Рецептура заполнена" : `Осталось распределить ${formatNumber(Math.max(0, 100 - totalPercentage))}%`}</small>
        </div>
        {error === null ? null : <div className="form-error modal-inline-error">{error}</div>}
        <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Отмена</button><button className="button primary" disabled={busy}><FlaskConical size={16} /> {busy ? "Сохраняем…" : "Создать формулу"}</button></div>
      </form>
    </Modal>
  );
}

function extractVariables(expression: string): string[] {
  const functions = new Set(["min", "max", "round", "abs", "if", "convert", "kg", "g", "t", "l", "ml", "m3"]);
  return [...new Set(expression.match(/[A-Za-z_][A-Za-z0-9_.]*/gu) ?? [])].filter((name) => !functions.has(name.toLowerCase()));
}

function humanize(value: string): string {
  const labels: Record<string, string> = { normPerM3: "Норма на 1 м³", plannedVolumeM3: "Плановый объём", waterMass: "Масса воды", cementMass: "Масса цемента", binderMass: "Масса вяжущего", dosagePercent: "Дозировка добавки", actual: "Фактический расход", planned: "Плановый расход", recipeWater: "Вода по рецептуре", aggregateWater: "Вода в заполнителях", batchCost: "Стоимость замеса", actualOutput: "Фактический выход" };
  return labels[value] ?? value;
}

function guessUnit(name: string): string {
  if (/volume|output/iu.test(name)) return "м³";
  if (/cost/iu.test(name)) return "₸";
  if (/percent/iu.test(name)) return "%";
  if (/water|cement|mass|norm|actual|planned/iu.test(name)) return "кг";
  return "";
}

function formatResult(value: Evaluation["trace"][number]["result"]): string {
  if (typeof value !== "object") return String(value);
  return `${formatNumber(value.value)}${value.unit === null ? "" : ` ${value.unit}`}`;
}
