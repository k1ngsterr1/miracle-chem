import { useState } from "react";
import {
  Beaker,
  ChevronRight,
  CopyPlus,
  Droplets,
  FlaskConical,
  History,
  Layers3,
  Scale,
} from "lucide-react";
import { apiMutation } from "../api.js";
import { useApi } from "../hooks/use-api.js";
import type { Recipe } from "../types.js";
import { formatNumber, unitLabel } from "../lib/format.js";
import {
  ErrorState,
  LoadingState,
  Modal,
  PageHeader,
  Panel,
  StatusBadge,
} from "../components/ui.js";

export function RecipesPage() {
  const recipes = useApi<{ items: Recipe[] }>("/recipes");
  const [selected, setSelected] = useState<Recipe | null>(null);
  const [versionRecipe, setVersionRecipe] = useState<Recipe | null>(null);
  if (recipes.loading) return <LoadingState />;
  if (recipes.error !== null) return <ErrorState message={recipes.error} retry={recipes.reload} />;
  const items = recipes.data?.items ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Технологическая база"
        title="Рецептуры бетона"
        description="Неизменяемые версии составов, нормативы, влажность заполнителей и технологические инструкции."
        actions={<button className="button primary" onClick={() => setVersionRecipe(items[0] ?? null)}><CopyPlus size={17} /> Новая версия</button>}
      />
      <div className="recipe-summary">
        <Panel><span><Beaker size={20} /></span><div><strong>{items.filter((recipe) => recipe.status === "ACTIVE").length}</strong><small>активных рецептур</small></div></Panel>
        <Panel><span><History size={20} /></span><div><strong>{items.reduce((sum, recipe) => sum + recipe.versions.length, 0)}</strong><small>версий в базе</small></div></Panel>
        <Panel><span><Layers3 size={20} /></span><div><strong>{new Set(items.flatMap((recipe) => recipe.versions.map((version) => version.concreteGrade))).size}</strong><small>классов бетона</small></div></Panel>
      </div>
      <div className="recipe-grid">
        {items.map((recipe) => {
          const version = recipe.versions[0];
          if (version === undefined) return null;
          return (
            <article className="recipe-card" key={recipe.id} onClick={() => setSelected(recipe)}>
              <div className="recipe-card-top"><span className="recipe-icon"><FlaskConical size={20} /></span><StatusBadge status={recipe.status} /></div>
              <span className="recipe-code">{recipe.code}</span><h2>{recipe.name}</h2><p>{version.concreteGrade}</p>
              <div className="recipe-specs"><span><small>Версия</small><strong>v{version.version}</strong></span><span><small>В/Ц</small><strong>{version.waterCementRatio ?? "—"}</strong></span><span><small>Выход</small><strong>{formatNumber(version.plannedYield)} {unitLabel[version.yieldUnit]}</strong></span></div>
              <div className="component-dots">{version.components.slice(0, 8).map((component) => <i key={component.id} title={component.material.name} />)}<span>{version.components.length} компонентов</span></div>
              <button className="card-link">Открыть технологическую карту <ChevronRight size={16} /></button>
            </article>
          );
        })}
      </div>
      {selected === null ? null : <RecipeDetail recipe={selected} onClose={() => setSelected(null)} onNewVersion={() => { setSelected(null); setVersionRecipe(selected); }} />}
      {versionRecipe === null ? null : <NewVersionModal recipe={versionRecipe} onClose={() => setVersionRecipe(null)} onCreated={async () => { setVersionRecipe(null); await recipes.reload(); }} />}
    </>
  );
}

function RecipeDetail({ recipe, onClose, onNewVersion }: { recipe: Recipe; onClose: () => void; onNewVersion: () => void }) {
  const version = recipe.versions[0];
  if (version === undefined) return null;
  return (
    <Modal title={recipe.name} onClose={onClose} wide>
      <div className="recipe-detail-head"><div><span className="recipe-code">{recipe.code}</span><h3>{version.concreteGrade}</h3><p>Версия {version.version} · hash {version.snapshotHash.slice(0, 12)}…</p></div><div className="recipe-detail-stats"><span><Droplets size={17} /><small>В/Ц</small><strong>{version.waterCementRatio ?? "—"}</strong></span><span><Scale size={17} /><small>Базовый замес</small><strong>{formatNumber(version.baseBatchVolume)} {unitLabel[version.volumeUnit]}</strong></span></div></div>
      <div className="section-title"><h3>Состав на 1 м³</h3><button className="button ghost small" onClick={onNewVersion}><CopyPlus size={15} /> Создать версию</button></div>
      <div className="recipe-components-table"><div className="recipe-component header"><span>Компонент</span><span>Норма</span><span>Допуск</span><span>Влажность</span><span>Поглощение</span></div>{version.components.map((component) => <div className="recipe-component" key={component.id}><span><i />{component.material.name}<small>{component.material.code}</small></span><strong>{formatNumber(component.normPerM3)} {unitLabel[component.unit]}</strong><span>±{formatNumber(component.allowedDeviationPercent)}%</span><span>{formatNumber(component.moisturePercent)}%</span><span>{formatNumber(component.absorptionPercent)}%</span></div>)}</div>
      <div className="technology-note"><strong>Технологическая инструкция</strong><p>{version.technologyInstructions}</p></div>
      <div className="immutability-note"><History size={18} /><span><strong>Версия неизменяема</strong><small>Завершённые замесы сохраняют полный snapshot состава, цен и формул.</small></span></div>
    </Modal>
  );
}

function NewVersionModal({ recipe, onClose, onCreated }: { recipe: Recipe; onClose: () => void; onCreated: () => Promise<void> }) {
  const latest = recipe.versions[0];
  const [error, setError] = useState<string | null>(null);
  const [grade, setGrade] = useState(latest?.concreteGrade ?? "");
  const [waterCement, setWaterCement] = useState(latest?.waterCementRatio ?? "");
  const [instructions, setInstructions] = useState(latest?.technologyInstructions ?? "");
  const [norms, setNorms] = useState<Record<string, string>>(Object.fromEntries((latest?.components ?? []).map((component) => [component.id, component.normPerM3])));
  if (latest === undefined) return null;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const source = latest;
    if (source === undefined) return;
    try {
      await apiMutation(`/recipes/${recipe.id}/versions`, {
        concreteGrade: grade,
        baseBatchVolume: source.baseBatchVolume,
        volumeUnit: source.volumeUnit,
        waterCementRatio: waterCement || undefined,
        plannedYield: source.plannedYield,
        yieldUnit: source.yieldUnit,
        technologyInstructions: instructions,
        publish: true,
        components: source.components.map((component, position) => ({
          materialId: component.materialId,
          normPerM3: norms[component.id] ?? component.normPerM3,
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
  return <Modal title={`Новая версия · ${recipe.name}`} onClose={onClose} wide><form onSubmit={(event) => void submit(event)}><div className="form-grid"><label><span>Марка / класс</span><input required value={grade} onChange={(event) => setGrade(event.target.value)} /></label><label><span>Водоцементное отношение</span><input type="number" step="0.001" value={waterCement} onChange={(event) => setWaterCement(event.target.value)} /></label></div><div className="section-title"><h3>Нормативы на 1 м³</h3><span>Будет создана версия {latest.version + 1}</span></div><div className="version-norm-grid">{latest.components.map((component) => <label key={component.id}><span>{component.material.name}</span><div><input type="number" step="0.001" value={norms[component.id] ?? ""} onChange={(event) => setNorms({ ...norms, [component.id]: event.target.value })} /><em>{unitLabel[component.unit]}</em></div></label>)}</div><label className="full-label"><span>Технологическая инструкция</span><textarea rows={4} value={instructions} onChange={(event) => setInstructions(event.target.value)} /></label>{error === null ? null : <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Отмена</button><button className="button primary"><CopyPlus size={16} /> Опубликовать версию</button></div></form></Modal>;
}
