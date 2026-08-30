import { useState } from "react";
import {
  Beaker,
  ChevronRight,
  CopyPlus,
  Droplets,
  FlaskConical,
  History,
  Layers3,
  Plus,
  Scale,
  Trash2,
} from "lucide-react";
import { apiMutation } from "../api.js";
import { CustomSelect } from "../components/CustomSelect.js";
import { DateTimePicker } from "../components/DateTimePicker.js";
import { useApi } from "../hooks/use-api.js";
import type { Material, MetaData, Recipe } from "../types.js";
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

interface DraftComponent {
  key: string;
  materialId: string;
  normPerM3: string;
  allowedDeviationPercent: string;
}

export function RecipesPage() {
  const recipes = useApi<{ items: Recipe[] }>("/recipes");
  const materials = useApi<{ items: Material[] }>("/materials");
  const meta = useApi<MetaData>("/meta");
  const [selected, setSelected] = useState<Recipe | null>(null);
  const [versionRecipe, setVersionRecipe] = useState<Recipe | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  if (recipes.loading || materials.loading || meta.loading) return <LoadingState />;
  if (recipes.error !== null) return <ErrorState message={recipes.error} retry={recipes.reload} />;
  if (materials.error !== null) return <ErrorState message={materials.error} retry={materials.reload} />;
  if (meta.error !== null) return <ErrorState message={meta.error} retry={meta.reload} />;
  const items = recipes.data?.items ?? [];
  const warehouse = materials.data?.items ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Технологическая база"
        title="Рецептуры бетона"
        description="Каждая рецептура закреплена за клиентом; новые версии сохраняют эту связь."
        actions={<button className="button primary" disabled={warehouse.length === 0 || (meta.data?.customers.length ?? 0) === 0} onClick={() => setCreateOpen(true)}><Plus size={17} /> Новая рецептура</button>}
      />
      <div className="recipe-summary">
        <Panel><span><Beaker size={20} /></span><div><strong>{items.filter((recipe) => recipe.status === "ACTIVE").length}</strong><small>активных рецептур</small></div></Panel>
        <Panel><span><History size={20} /></span><div><strong>{items.length}</strong><small>составов в базе</small></div></Panel>
        <Panel><span><Layers3 size={20} /></span><div><strong>{new Set(items.flatMap((recipe) => recipe.versions.map((version) => version.concreteGrade))).size}</strong><small>классов бетона</small></div></Panel>
      </div>
      {items.length === 0 ? <Panel><EmptyState title="Рецептур пока нет" text="Создайте первый состав из позиций склада." /></Panel> : (
        <div className="recipe-grid">
          {items.map((recipe) => {
            const version = recipe.versions[0];
            if (version === undefined) return null;
            return (
              <article className="recipe-card" key={recipe.id} onClick={() => setSelected(recipe)}>
                <div className="recipe-card-top"><span className="recipe-icon"><FlaskConical size={20} /></span><StatusBadge status={recipe.status} /></div>
                <span className="recipe-code">{recipe.code}</span><h2>{recipe.name}</h2><p>{version.concreteGrade} · {recipe.customer?.name ?? "Клиент не назначен"}</p>
                <div className="recipe-specs"><span><small>Версия</small><strong>v{version.version}</strong></span><span><small>В/Ц</small><strong>{version.waterCementRatio ?? "—"}</strong></span><span><small>Выход</small><strong>{formatNumber(version.plannedYield)} {unitLabel[version.yieldUnit]}</strong></span></div>
                <div className="component-dots">{version.components.slice(0, 8).map((component) => <i key={component.id} title={component.material.name} />)}<span>{version.components.length} компонентов</span></div>
                <small className="recipe-effective">Действует с {version.publishedAt === null ? "черновик" : formatDate(version.publishedAt, true)}</small>
                <button type="button" className="card-link" onClick={(event) => { event.stopPropagation(); setSelected(recipe); }}>Открыть технологическую карту <ChevronRight size={16} /></button>
              </article>
            );
          })}
        </div>
      )}
      {selected === null ? null : <RecipeDetail recipe={selected} onClose={() => setSelected(null)} onNewVersion={() => { setSelected(null); setVersionRecipe(selected); }} />}
      {versionRecipe === null ? null : <NewVersionModal recipe={versionRecipe} onClose={() => setVersionRecipe(null)} onCreated={async () => { setVersionRecipe(null); await recipes.reload(); }} />}
      {createOpen ? <NewRecipeModal materials={warehouse} customers={meta.data?.customers ?? []} onClose={() => setCreateOpen(false)} onCreated={async () => { setCreateOpen(false); await recipes.reload(); }} /> : null}
    </>
  );
}

function RecipeDetail({ recipe, onClose, onNewVersion }: { recipe: Recipe; onClose: () => void; onNewVersion: () => void }) {
  const version = recipe.versions[0];
  if (version === undefined) return null;
  return (
    <Modal title={recipe.name} onClose={onClose} wide>
      <div className="recipe-detail-head"><div><span className="recipe-code">{recipe.code}</span><h3>{version.concreteGrade}</h3><p>{recipe.customer?.name ?? "Клиент не назначен"} · версия {version.version} · с {version.publishedAt === null ? "не опубликована" : formatDate(version.publishedAt, true)}</p></div><div className="recipe-detail-stats"><span><Droplets size={17} /><small>В/Ц</small><strong>{version.waterCementRatio ?? "—"}</strong></span><span><Scale size={17} /><small>Базовый замес</small><strong>{formatNumber(version.baseBatchVolume)} {unitLabel[version.volumeUnit]}</strong></span></div></div>
      <div className="section-title"><h3>Состав на 1 м³</h3><button className="button ghost small" onClick={onNewVersion}><CopyPlus size={15} /> Создать версию</button></div>
      <div className="recipe-components-table"><div className="recipe-component header"><span>Компонент</span><span>Норма</span><span>Допуск</span><span>Влажность</span><span>Поглощение</span></div>{version.components.map((component) => <div className="recipe-component" key={component.id}><span><i />{component.material.name}<small>{component.material.code}</small></span><strong>{formatNumber(component.normPerM3)} {unitLabel[component.unit]}</strong><span>±{formatNumber(component.allowedDeviationPercent)}%</span><span>{formatNumber(component.moisturePercent)}%</span><span>{formatNumber(component.absorptionPercent)}%</span></div>)}</div>
      <div className="technology-note"><strong>Технологическая инструкция</strong><p>{version.technologyInstructions}</p></div>
      <div className="immutability-note"><History size={18} /><span><strong>Версия неизменяема</strong><small>Новый состав выпускается отдельной версией или отдельной рецептурой; прошлые замесы сохраняют свой snapshot.</small></span></div>
    </Modal>
  );
}

function NewRecipeModal({ materials, customers, onClose, onCreated }: { materials: Material[]; customers: MetaData["customers"]; onClose: () => void; onCreated: () => Promise<void> }) {
  const [form, setForm] = useState({
    code: "",
    name: "",
    customerId: "",
    concreteGrade: "",
    baseBatchVolume: "",
    waterCementRatio: "",
    plannedYield: "",
    effectiveAt: "",
    technologyInstructions: "",
  });
  const [components, setComponents] = useState<DraftComponent[]>([]);
  const [error, setError] = useState<string | null>(null);

  function addComponent(): void {
    setComponents([...components, { key: crypto.randomUUID(), materialId: "", normPerM3: "", allowedDeviationPercent: "" }]);
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (form.code.trim() === "" || form.name.trim() === "" || form.customerId === "" || form.concreteGrade.trim() === "" || form.baseBatchVolume === "" || form.plannedYield === "" || form.effectiveAt === "" || form.technologyInstructions.trim() === "") { setError("Заполните обязательные поля рецептуры"); return; }
    if (components.length === 0) { setError("Добавьте хотя бы один компонент"); return; }
    if (components.some((component) => component.materialId === "" || component.normPerM3 === "" || component.allowedDeviationPercent === "")) { setError("Заполните все поля компонентов"); return; }
    try {
      await apiMutation("/recipes", {
        code: form.code,
        name: form.name,
        customerId: form.customerId,
        status: "ACTIVE",
        version: {
          concreteGrade: form.concreteGrade,
          baseBatchVolume: form.baseBatchVolume,
          volumeUnit: "M3",
          waterCementRatio: form.waterCementRatio || undefined,
          plannedYield: form.plannedYield,
          yieldUnit: "M3",
          technologyInstructions: form.technologyInstructions,
          publish: true,
          effectiveAt: new Date(form.effectiveAt).toISOString(),
          components: components.map((component, position) => {
            const material = materials.find((item) => item.id === component.materialId);
            return {
              materialId: component.materialId,
              normPerM3: component.normPerM3,
              unit: material?.baseUnit ?? "KG",
              allowedDeviationPercent: component.allowedDeviationPercent,
              moisturePercent: "0",
              absorptionPercent: "0",
              position,
            };
          }),
        },
      });
      await onCreated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось создать рецептуру"); }
  }

  return (
    <Modal title="Новая рецептура" onClose={onClose} wide>
      <form onSubmit={(event) => void submit(event)}>
        <div className="form-grid">
          <label><span>Код</span><input required value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} /></label>
          <label><span>Название</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Например, Бетон B25 для фундамента" /></label>
          <div className="form-field span-2"><span>Клиент</span><CustomSelect required ariaLabel="Клиент рецептуры" value={form.customerId} onChange={(customerId) => setForm({ ...form, customerId })} options={customers.map((customer) => ({ value: customer.id, label: customer.name, description: [customer.taxId, customer.contactPerson].filter(Boolean).join(" · ") || "Клиент" }))} placeholder="Выберите клиента" /></div>
          <label><span>Марка / класс</span><input required value={form.concreteGrade} onChange={(event) => setForm({ ...form, concreteGrade: event.target.value })} placeholder="B25 П4 F150 W6" /></label>
          <div className="form-field"><span>Дата начала действия</span><DateTimePicker required ariaLabel="Дата начала действия рецептуры" value={form.effectiveAt} onChange={(effectiveAt) => setForm({ ...form, effectiveAt })} align="right" /></div>
          <label><span>Базовый замес, м³</span><input required type="number" min="0.001" step="0.001" value={form.baseBatchVolume} onChange={(event) => setForm({ ...form, baseBatchVolume: event.target.value })} /></label>
          <label><span>Плановый выход, м³</span><input required type="number" min="0.001" step="0.001" value={form.plannedYield} onChange={(event) => setForm({ ...form, plannedYield: event.target.value })} /></label>
          <label className="span-2"><span>Водоцементное отношение</span><input type="number" min="0" step="0.001" value={form.waterCementRatio} onChange={(event) => setForm({ ...form, waterCementRatio: event.target.value })} /></label>
        </div>
        <div className="section-title recipe-builder-title"><h3>Компоненты на 1 м³</h3><button type="button" className="button ghost small" disabled={components.length >= materials.length} onClick={addComponent}><Plus size={15} /> Добавить компонент</button></div>
        <div className="recipe-builder-list">
          {components.map((component) => {
            const material = materials.find((item) => item.id === component.materialId);
            return (
              <div key={component.key}>
                <div className="form-field"><span>Материал</span><CustomSelect required ariaLabel="Компонент рецептуры" value={component.materialId} onChange={(materialId) => setComponents(components.map((item) => item.key === component.key ? { ...item, materialId } : item))} options={materials.filter((candidate) => candidate.id === component.materialId || !components.some((item) => item.materialId === candidate.id)).map((candidate) => ({ value: candidate.id, label: candidate.name, description: `${candidate.code} · ${unitLabel[candidate.baseUnit]}` }))} placeholder="Выберите реагент" /></div>
                <label><span>Норма, {unitLabel[material?.baseUnit ?? "KG"]}</span><input required type="number" min="0" step="0.001" value={component.normPerM3} onChange={(event) => setComponents(components.map((item) => item.key === component.key ? { ...item, normPerM3: event.target.value } : item))} /></label>
                <label><span>Допуск, %</span><input required type="number" min="0" step="0.1" value={component.allowedDeviationPercent} onChange={(event) => setComponents(components.map((item) => item.key === component.key ? { ...item, allowedDeviationPercent: event.target.value } : item))} /></label>
                <button type="button" className="row-action danger" aria-label="Удалить компонент" onClick={() => setComponents(components.filter((item) => item.key !== component.key))}><Trash2 size={16} /></button>
              </div>
            );
          })}
        </div>
        <label className="full-label"><span>Технологическая инструкция</span><textarea required rows={4} value={form.technologyInstructions} onChange={(event) => setForm({ ...form, technologyInstructions: event.target.value })} placeholder="Порядок загрузки, время перемешивания, особенности выпуска…" /></label>
        {error === null ? null : <div className="form-error modal-inline-error">{error}</div>}
        <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Отмена</button><button className="button primary"><FlaskConical size={16} /> Создать рецептуру</button></div>
      </form>
    </Modal>
  );
}

function NewVersionModal({ recipe, onClose, onCreated }: { recipe: Recipe; onClose: () => void; onCreated: () => Promise<void> }) {
  const latest = recipe.versions[0];
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    grade: "",
    waterCement: "",
    baseBatchVolume: "",
    plannedYield: "",
    effectiveAt: "",
    instructions: "",
  });
  const [norms, setNorms] = useState<Record<string, string>>({});
  if (latest === undefined) return null;
  const source = latest;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (form.grade.trim() === "" || form.baseBatchVolume === "" || form.plannedYield === "" || form.effectiveAt === "" || form.instructions.trim() === "") { setError("Заполните обязательные поля новой версии"); return; }
    if (source.components.some((component) => (norms[component.id] ?? "") === "")) { setError("Укажите нормы для всех компонентов"); return; }
    try {
      await apiMutation(`/recipes/${recipe.id}/versions`, {
        concreteGrade: form.grade,
        baseBatchVolume: form.baseBatchVolume,
        volumeUnit: source.volumeUnit,
        waterCementRatio: form.waterCement || undefined,
        plannedYield: form.plannedYield,
        yieldUnit: source.yieldUnit,
        technologyInstructions: form.instructions,
        publish: true,
        effectiveAt: new Date(form.effectiveAt).toISOString(),
        components: source.components.map((component, position) => ({
          materialId: component.materialId,
          normPerM3: norms[component.id] ?? "",
          unit: component.unit,
          allowedDeviationPercent: component.allowedDeviationPercent,
          moisturePercent: component.moisturePercent,
          absorptionPercent: component.absorptionPercent,
          position,
        })),
      });
      await onCreated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось создать версию"); }
  }
  return (
    <Modal title={`Новая версия · ${recipe.name}`} onClose={onClose} wide>
      <form onSubmit={(event) => void submit(event)}>
        <div className="form-grid">
          <label><span>Марка / класс</span><input required value={form.grade} onChange={(event) => setForm({ ...form, grade: event.target.value })} /></label>
          <div className="form-field"><span>Дата начала действия</span><DateTimePicker required ariaLabel="Дата начала действия версии" value={form.effectiveAt} onChange={(effectiveAt) => setForm({ ...form, effectiveAt })} align="right" /></div>
          <label><span>Базовый замес, {unitLabel[latest.volumeUnit]}</span><input required type="number" min="0.001" step="0.001" value={form.baseBatchVolume} onChange={(event) => setForm({ ...form, baseBatchVolume: event.target.value })} /></label>
          <label><span>Плановый выход, {unitLabel[latest.yieldUnit]}</span><input required type="number" min="0.001" step="0.001" value={form.plannedYield} onChange={(event) => setForm({ ...form, plannedYield: event.target.value })} /></label>
          <label className="span-2"><span>Водоцементное отношение</span><input type="number" step="0.001" value={form.waterCement} onChange={(event) => setForm({ ...form, waterCement: event.target.value })} /></label>
        </div>
        <div className="section-title"><h3>Нормативы на 1 м³</h3><span>Версия {latest.version + 1}</span></div>
        <div className="version-norm-grid">{latest.components.map((component) => <label key={component.id}><span>{component.material.name}</span><div><input required type="number" step="0.001" value={norms[component.id] ?? ""} onChange={(event) => setNorms({ ...norms, [component.id]: event.target.value })} /><em>{unitLabel[component.unit]}</em></div></label>)}</div>
        <label className="full-label"><span>Технологическая инструкция</span><textarea required rows={4} value={form.instructions} onChange={(event) => setForm({ ...form, instructions: event.target.value })} /></label>
        {error === null ? null : <div className="form-error modal-inline-error">{error}</div>}
        <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Отмена</button><button className="button primary"><CopyPlus size={16} /> Опубликовать версию</button></div>
      </form>
    </Modal>
  );
}
