"use client";

/**
 * Admin UI para que la clínica registre las marcas/modelos de implante
 * que usa habitualmente (Straumann SLActive, Zimmer T3, Nobel Replace,
 * etc.) con plataformas y diámetros disponibles.
 *
 * El selector de "marca/modelo" al colocar un implante consulta esta
 * tabla en lugar del enum global.
 */

import * as React from "react";
import { Plus, Pencil, Trash2, Save, X, AlertTriangle } from "lucide-react";
import {
  upsertImplantCatalogModel,
  deleteImplantCatalogModel,
  type CatalogModelDto,
  type UpsertImplantCatalogModelInput,
} from "@/app/actions/implants/catalogActions";
import { isFailure } from "@/app/actions/implants/result";

const BRAND_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "STRAUMANN", label: "Straumann" },
  { value: "NOBEL_BIOCARE", label: "Nobel Biocare" },
  { value: "NEODENT", label: "Neodent" },
  { value: "MIS", label: "MIS" },
  { value: "BIOHORIZONS", label: "BioHorizons" },
  { value: "ZIMMER_BIOMET", label: "Zimmer Biomet" },
  { value: "IMPLANT_DIRECT", label: "Implant Direct" },
  { value: "ODONTIT", label: "Odontit" },
  { value: "OTRO", label: "Otra (especificar)" },
];

const SURFACE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "SLA", label: "SLA" },
  { value: "SLActive", label: "SLActive" },
  { value: "TiUnite", label: "TiUnite" },
  { value: "OsseoSpeed", label: "OsseoSpeed" },
  { value: "LASER_LOK", label: "Laser-Lok" },
  { value: "OTRO", label: "Otra" },
];

const CONNECTION_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "EXTERNAL_HEX", label: "Hex externo" },
  { value: "INTERNAL_HEX", label: "Hex interno" },
  { value: "CONICAL_MORSE", label: "Cono Morse" },
  { value: "TRI_CHANNEL", label: "Tri-Channel" },
  { value: "OTRO", label: "Otra" },
];

interface DraftState {
  id?: string;
  brand: string;
  brandCustomName: string;
  modelName: string;
  platforms: string;
  diametersMm: string;
  lengthsMm: string;
  surfaceTreatment: string;
  connectionType: string;
  notes: string;
  isActive: boolean;
}

const EMPTY_DRAFT: DraftState = {
  brand: "STRAUMANN",
  brandCustomName: "",
  modelName: "",
  platforms: "",
  diametersMm: "",
  lengthsMm: "",
  surfaceTreatment: "",
  connectionType: "",
  notes: "",
  isActive: true,
};

function parseList<T>(s: string, parse: (chunk: string) => T): T[] {
  return s
    .split(/[,\n]+/)
    .map((c) => c.trim())
    .filter(Boolean)
    .map(parse);
}

function brandLabel(value: string): string {
  return BRAND_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

export interface ImplantCatalogManagerProps {
  initialModels: CatalogModelDto[];
}

export default function ImplantCatalogManager({
  initialModels,
}: ImplantCatalogManagerProps) {
  const [models, setModels] = React.useState<CatalogModelDto[]>(initialModels);
  const [draft, setDraft] = React.useState<DraftState | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const startCreate = () => {
    setError(null);
    setDraft({ ...EMPTY_DRAFT });
  };

  const startEdit = (m: CatalogModelDto) => {
    setError(null);
    setDraft({
      id: m.id,
      brand: m.brand,
      brandCustomName: m.brandCustomName ?? "",
      modelName: m.modelName,
      platforms: m.platforms.join(", "),
      diametersMm: m.diametersMm.join(", "),
      lengthsMm: m.lengthsMm.join(", "),
      surfaceTreatment: m.surfaceTreatment ?? "",
      connectionType: m.connectionType ?? "",
      notes: m.notes ?? "",
      isActive: m.isActive,
    });
  };

  const cancelEdit = () => {
    setDraft(null);
    setError(null);
  };

  const handleSave = async () => {
    if (!draft) return;
    setError(null);
    setSaving(true);
    try {
      const input: UpsertImplantCatalogModelInput = {
        id: draft.id ?? null,
        brand: draft.brand as never,
        brandCustomName: draft.brandCustomName.trim() || null,
        modelName: draft.modelName.trim(),
        platforms: parseList(draft.platforms, (s) => s),
        diametersMm: parseList(draft.diametersMm, parseFloat).filter((n) =>
          Number.isFinite(n),
        ),
        lengthsMm: parseList(draft.lengthsMm, parseFloat).filter((n) =>
          Number.isFinite(n),
        ),
        surfaceTreatment: (draft.surfaceTreatment || null) as never,
        connectionType: (draft.connectionType || null) as never,
        notes: draft.notes.trim() || null,
        isActive: draft.isActive,
      };
      const result = await upsertImplantCatalogModel(input);
      if (isFailure(result)) {
        setError(result.error);
        return;
      }
      // Replace or insert
      setModels((prev) => {
        const next = prev.filter((p) => p.id !== result.data.id);
        return [...next, result.data].sort(
          (a, b) =>
            (b.isActive ? 1 : 0) - (a.isActive ? 1 : 0) ||
            a.brand.localeCompare(b.brand) ||
            a.modelName.localeCompare(b.modelName),
        );
      });
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar este modelo del catálogo?")) return;
    const result = await deleteImplantCatalogModel({ id });
    if (isFailure(result)) {
      setError(result.error);
      return;
    }
    setModels((prev) => prev.filter((m) => m.id !== id));
  };

  return (
    <section
      aria-label="Catálogo de implantes"
      className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--card)] p-4"
    >
      <header className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Catálogo de implantes</h3>
          <p className="text-xs text-[var(--color-muted-fg)]">
            Marcas y modelos que su clínica usa. Aparecen en el selector al
            colocar un implante.
          </p>
        </div>
        {!draft && (
          <button
            type="button"
            onClick={startCreate}
            className="inline-flex items-center gap-1 rounded bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-[var(--primary-fg)] hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Agregar
          </button>
        )}
      </header>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded border border-[var(--color-danger-fg)]/30 bg-[var(--color-danger-bg)] p-2 text-xs text-[var(--color-danger-fg)]"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {/* form de creación / edición */}
      {draft && (
        <div className="rounded-md border border-[var(--border)] bg-[var(--background)] p-3">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold">
              {draft.id ? "Editar modelo" : "Nuevo modelo"}
            </h4>
            <button
              type="button"
              onClick={cancelEdit}
              aria-label="Cancelar"
              className="rounded p-1 text-[var(--color-muted-fg)] hover:bg-[var(--accent)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Marca">
              <select
                value={draft.brand}
                onChange={(e) =>
                  setDraft((d) => (d ? { ...d, brand: e.target.value } : d))
                }
                className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm"
              >
                {BRAND_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            {draft.brand === "OTRO" && (
              <Field label="Nombre comercial">
                <input
                  type="text"
                  value={draft.brandCustomName}
                  onChange={(e) =>
                    setDraft((d) =>
                      d ? { ...d, brandCustomName: e.target.value } : d,
                    )
                  }
                  className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm"
                />
              </Field>
            )}
            <Field label="Modelo *" hint='ej. "SLActive Bone Level Tapered"'>
              <input
                type="text"
                value={draft.modelName}
                onChange={(e) =>
                  setDraft((d) => (d ? { ...d, modelName: e.target.value } : d))
                }
                className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm"
                required
              />
            </Field>
            <Field label="Plataformas" hint='ej. "RC, NC"'>
              <input
                type="text"
                value={draft.platforms}
                onChange={(e) =>
                  setDraft((d) => (d ? { ...d, platforms: e.target.value } : d))
                }
                className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm"
              />
            </Field>
            <Field label="Diámetros mm" hint='ej. "3.3, 4.1, 4.8"'>
              <input
                type="text"
                value={draft.diametersMm}
                onChange={(e) =>
                  setDraft((d) =>
                    d ? { ...d, diametersMm: e.target.value } : d,
                  )
                }
                className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm"
              />
            </Field>
            <Field label="Longitudes mm" hint='ej. "8, 10, 12, 14"'>
              <input
                type="text"
                value={draft.lengthsMm}
                onChange={(e) =>
                  setDraft((d) => (d ? { ...d, lengthsMm: e.target.value } : d))
                }
                className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm"
              />
            </Field>
            <Field label="Superficie">
              <select
                value={draft.surfaceTreatment}
                onChange={(e) =>
                  setDraft((d) =>
                    d ? { ...d, surfaceTreatment: e.target.value } : d,
                  )
                }
                className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm"
              >
                <option value="">—</option>
                {SURFACE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Conexión">
              <select
                value={draft.connectionType}
                onChange={(e) =>
                  setDraft((d) =>
                    d ? { ...d, connectionType: e.target.value } : d,
                  )
                }
                className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm"
              >
                <option value="">—</option>
                {CONNECTION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Notas" className="md:col-span-2">
              <textarea
                value={draft.notes}
                onChange={(e) =>
                  setDraft((d) => (d ? { ...d, notes: e.target.value } : d))
                }
                rows={2}
                className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm"
              />
            </Field>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={(e) =>
                setDraft((d) => (d ? { ...d, isActive: e.target.checked } : d))
              }
            />
            Activo (mostrar en selector)
          </label>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={cancelEdit}
              className="rounded border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--accent)]"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !draft.modelName.trim()}
              className="inline-flex items-center gap-1 rounded bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-[var(--primary-fg)] hover:opacity-90 disabled:opacity-50"
            >
              <Save className="h-4 w-4" /> {saving ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>
      )}

      {/* tabla de catálogo */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-[var(--color-muted-fg)]">
            <tr className="border-b border-[var(--border)]">
              <th className="px-2 py-2 font-medium">Marca / Modelo</th>
              <th className="px-2 py-2 font-medium">Plataformas</th>
              <th className="px-2 py-2 font-medium">Diámetros</th>
              <th className="px-2 py-2 font-medium">Longitudes</th>
              <th className="px-2 py-2 font-medium">Superficie</th>
              <th className="px-2 py-2 font-medium">Estado</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {models.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-2 py-6 text-center text-[var(--color-muted-fg)]"
                >
                  No hay modelos registrados.
                </td>
              </tr>
            ) : (
              models.map((m) => (
                <tr key={m.id} className="border-b border-[var(--border)]">
                  <td className="px-2 py-2">
                    <p className="font-medium">{m.brandCustomName ?? brandLabel(m.brand)}</p>
                    <p className="text-xs text-[var(--color-muted-fg)]">
                      {m.modelName}
                    </p>
                  </td>
                  <td className="px-2 py-2 text-xs">
                    {m.platforms.join(", ") || "—"}
                  </td>
                  <td className="px-2 py-2 text-xs">
                    {m.diametersMm.length > 0
                      ? m.diametersMm.map((n) => n.toFixed(1)).join(", ")
                      : "—"}
                  </td>
                  <td className="px-2 py-2 text-xs">
                    {m.lengthsMm.length > 0
                      ? m.lengthsMm.map((n) => n.toFixed(1)).join(", ")
                      : "—"}
                  </td>
                  <td className="px-2 py-2 text-xs">
                    {m.surfaceTreatment ?? "—"}
                  </td>
                  <td className="px-2 py-2 text-xs">
                    {m.isActive ? (
                      <span className="rounded-full bg-[var(--color-success-bg)] px-2 py-0.5 text-[10px] text-[var(--color-success-fg)]">
                        Activo
                      </span>
                    ) : (
                      <span className="rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-[10px] text-[var(--color-muted-fg)]">
                        Inactivo
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <div className="inline-flex gap-1">
                      <button
                        type="button"
                        onClick={() => startEdit(m)}
                        aria-label="Editar"
                        className="rounded p-1 text-[var(--color-muted-fg)] hover:bg-[var(--accent)]"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(m.id)}
                        aria-label="Eliminar"
                        className="rounded p-1 text-[var(--color-danger-fg)] hover:bg-[var(--accent)]"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block text-xs ${className ?? ""}`}>
      <span className="mb-1 block font-medium text-[var(--foreground)]">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="mt-0.5 block text-[10px] text-[var(--color-muted-fg)]">
          {hint}
        </span>
      ) : null}
    </label>
  );
}
