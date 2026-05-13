"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Plus, GripVertical, Archive, RotateCcw, EyeOff, Eye } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  createResource,
  deleteResource,
  reorderResources,
  updateResource,
  type ApiError,
} from "@/lib/agenda/mutations";
import type { ResourceDTO, ResourceKind } from "@/lib/agenda/types";
import styles from "./resources-manager.module.css";

const SWATCH_COLORS = [
  "#7c3aed", "#2563eb", "#ea580c", "#0891b2",
  "#059669", "#db2777", "#9333ea", "#0284c7",
  "#16a34a", "#dc2626", "#ca8a04", "#0d9488",
];

// Set reducido para el form "Añadir" — 8 colores distintos + opción
// "sin color" (null). El picker del row de edición sigue usando los 12.
const ADD_FORM_SWATCHES = [
  "#7c3aed", "#2563eb", "#0891b2", "#059669",
  "#ca8a04", "#ea580c", "#dc2626", "#db2777",
];

export interface ResourcesManagerProps {
  initialResources: ResourceDTO[];
  clinicId: string;
  canEdit?: boolean;
  variant?: "page" | "modal";
  onChange?: (resources: ResourceDTO[]) => void;
}

function isApiError(err: unknown): err is ApiError {
  return typeof err === "object" && err !== null && "status" in err;
}

function isArchived(r: ResourceDTO): boolean {
  return r.isActive === false;
}

export function ResourcesManager({
  initialResources,
  canEdit = true,
  variant = "page",
  onChange,
}: ResourcesManagerProps) {
  const askConfirm = useConfirm();
  const [resources, setResources] = useState<ResourceDTO[]>(initialResources);
  const [showArchived, setShowArchived] = useState(false);
  const [archivedLoaded, setArchivedLoaded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const dragIndexRef = useRef<number | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const lastOrderRef = useRef<string[] | null>(null);

  useEffect(() => {
    onChange?.(resources);
    // intentionally exclude onChange to avoid loop when parent recreates the callback
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resources]);

  const active = resources
    .filter((r) => !isArchived(r))
    .sort((a, b) => a.orderIndex - b.orderIndex);
  const archived = resources
    .filter(isArchived)
    .sort((a, b) => a.name.localeCompare(b.name));

  const reload = useCallback(async (includeArchived: boolean) => {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/agenda/resources${includeArchived ? "?includeArchived=1" : ""}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("fetch_failed");
      const body = (await res.json()) as { resources: ResourceDTO[] };
      setResources(body.resources);
    } catch {
      toast.error("No se pudo cargar la lista");
    } finally {
      setBusy(false);
    }
  }, []);

  async function toggleArchived() {
    const next = !showArchived;
    setShowArchived(next);
    if (next && !archivedLoaded) {
      await reload(true);
      setArchivedLoaded(true);
    }
  }

  function moveTo(toIdx: number) {
    if (dragIndexRef.current === null) return;
    if (dragIndexRef.current === toIdx) return;
    const reordered = active.slice();
    const [moved] = reordered.splice(dragIndexRef.current, 1);
    if (moved) reordered.splice(toIdx, 0, moved);
    const renumbered = reordered.map((r, i) => ({ ...r, orderIndex: i }));
    // keep archived intact, replace active set
    setResources((prev) => [
      ...renumbered,
      ...prev.filter(isArchived),
    ]);
    dragIndexRef.current = toIdx;
  }

  async function commitReorder() {
    const finalOrder = active.map((r) => r.id);
    if (
      lastOrderRef.current &&
      finalOrder.length === lastOrderRef.current.length &&
      finalOrder.every((id, i) => id === lastOrderRef.current![i])
    ) {
      return;
    }
    try {
      await reorderResources(finalOrder);
    } catch (err) {
      if (lastOrderRef.current) {
        const order = lastOrderRef.current;
        const map = new Map(resources.map((r) => [r.id, r] as const));
        const rebuilt: ResourceDTO[] = [];
        order.forEach((id, idx) => {
          const r = map.get(id);
          if (r) rebuilt.push({ ...r, orderIndex: idx });
        });
        setResources([...rebuilt, ...resources.filter(isArchived)]);
      }
      const reason = isApiError(err)
        ? err.reason ?? err.error ?? "No se pudo reordenar"
        : "No se pudo reordenar";
      toast.error(reason);
    }
  }

  async function handleUpdate(id: string, patch: Partial<ResourceDTO>) {
    const original = resources.find((r) => r.id === id);
    if (!original) return;
    const optimistic = { ...original, ...patch };
    setResources((prev) => prev.map((r) => (r.id === id ? optimistic : r)));
    try {
      const apiPatch: { name?: string; kind?: ResourceKind; color?: string | null; isActive?: boolean } = {};
      if (patch.name !== undefined) apiPatch.name = patch.name;
      if (patch.kind !== undefined) apiPatch.kind = patch.kind;
      if (patch.color !== undefined) apiPatch.color = patch.color;
      if (patch.isActive !== undefined) apiPatch.isActive = patch.isActive;
      const updated = await updateResource(id, apiPatch);
      setResources((prev) => prev.map((r) => (r.id === id ? { ...optimistic, ...updated } : r)));
    } catch (err) {
      setResources((prev) => prev.map((r) => (r.id === id ? original : r)));
      const reason = isApiError(err)
        ? err.reason ?? err.error ?? "No se pudo guardar"
        : "No se pudo guardar";
      toast.error(reason);
    }
  }

  async function handleArchive(id: string) {
    const target = resources.find((r) => r.id === id);
    if (!target) return;
    const confirmed = await askConfirm({
      title: `¿Archivar "${target.name}"?`,
      description:
        "Las citas existentes no se borran. Puedes restaurarlo desde 'Ver archivados'.",
      variant: "warning",
      confirmText: "Archivar",
    });
    if (!confirmed) return;

    const original = resources;
    // Optimistic: mark as archived locally
    setResources((prev) =>
      prev.map((r) => (r.id === id ? { ...r, isActive: false } : r)),
    );
    try {
      await deleteResource(id);
      toast.success("Recurso archivado");
    } catch (err) {
      setResources(original);
      if (
        isApiError(err) &&
        err.status === 409 &&
        err.error === "resource_has_active_appointments"
      ) {
        const n = err.count ?? 0;
        toast.error(
          n > 0
            ? `No se puede archivar: ${n} cita${n === 1 ? "" : "s"} activa${n === 1 ? "" : "s"}. Cancela o reagenda primero.`
            : "No se puede archivar: tiene citas activas asociadas.",
        );
      } else {
        const reason = isApiError(err)
          ? err.reason ?? err.error ?? "No se pudo archivar"
          : "No se pudo archivar";
        toast.error(reason);
      }
    }
  }

  async function handleRestore(id: string) {
    const original = resources;
    setResources((prev) =>
      prev.map((r) => (r.id === id ? { ...r, isActive: true } : r)),
    );
    try {
      const updated = await updateResource(id, { isActive: true });
      setResources((prev) => prev.map((r) => (r.id === id ? { ...r, ...updated, isActive: true } : r)));
      toast.success("Recurso restaurado");
    } catch (err) {
      setResources(original);
      const reason = isApiError(err)
        ? err.reason ?? err.error ?? "No se pudo restaurar"
        : "No se pudo restaurar";
      toast.error(reason);
    }
  }

  async function handleAdd(name: string, kind: ResourceKind, color: string | null) {
    try {
      const created = await createResource({ name, kind, color });
      setResources((prev) => [...prev, { ...created, isActive: true }]);
      toast.success("Recurso añadido");
      setAdding(false);
    } catch (err) {
      const reason = isApiError(err)
        ? err.reason ?? err.error ?? "No se pudo crear"
        : "No se pudo crear";
      toast.error(reason);
    }
  }

  const showingList = showArchived ? archived : active;

  return (
    <div className={styles.container}>
      {variant === "page" && (
        <div className={styles.pageHeader}>
          <div>
            <h1 className={styles.pageTitle}>Recursos</h1>
            <p className={styles.pageSubtitle}>
              Sillones, salas y equipos disponibles para asignar a citas.
            </p>
          </div>
          <div className={styles.toolbar}>
            <button
              type="button"
              className={`${styles.toolbarBtn} ${showArchived ? styles.on : ""}`}
              onClick={() => void toggleArchived()}
              disabled={busy}
              aria-pressed={showArchived}
            >
              {showArchived ? <Eye size={14} /> : <EyeOff size={14} />}
              {showArchived ? "Ocultar archivados" : "Ver archivados"}
            </button>
          </div>
        </div>
      )}

      {variant === "modal" && (
        <div className={styles.toolbar}>
          <button
            type="button"
            className={`${styles.toolbarBtn} ${showArchived ? styles.on : ""}`}
            onClick={() => void toggleArchived()}
            disabled={busy}
            aria-pressed={showArchived}
          >
            {showArchived ? <Eye size={14} /> : <EyeOff size={14} />}
            {showArchived ? "Ocultar archivados" : "Ver archivados"}
          </button>
        </div>
      )}

      <div className={styles.list}>
        {showingList.length === 0 && !adding && (
          <div className={styles.empty}>
            {showArchived
              ? "No hay recursos archivados."
              : "No hay sillones, salas ni equipos. Añade uno para empezar."}
          </div>
        )}

        {showingList.map((r, i) => (
          <ResourceRow
            key={r.id}
            resource={r}
            archived={showArchived}
            canEdit={canEdit}
            dragging={draggingId === r.id}
            onDragStart={() => {
              if (showArchived) return;
              dragIndexRef.current = i;
              lastOrderRef.current = active.map((x) => x.id);
              setDraggingId(r.id);
            }}
            onDragOver={(e) => {
              if (showArchived) return;
              e.preventDefault();
              moveTo(i);
            }}
            onDragEnd={() => {
              if (showArchived) return;
              dragIndexRef.current = null;
              setDraggingId(null);
              void commitReorder();
            }}
            onUpdate={(patch) => void handleUpdate(r.id, patch)}
            onArchive={() => void handleArchive(r.id)}
            onRestore={() => void handleRestore(r.id)}
          />
        ))}

        {!showArchived && canEdit && (
          adding ? (
            <ResourceAddForm
              onCancel={() => setAdding(false)}
              onSave={handleAdd}
            />
          ) : (
            <button
              type="button"
              className={styles.addBtn}
              onClick={() => setAdding(true)}
            >
              <Plus size={12} /> Añadir sillón / sala / equipo
            </button>
          )
        )}
      </div>
    </div>
  );
}

interface ResourceRowProps {
  resource: ResourceDTO;
  archived: boolean;
  canEdit: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onUpdate: (patch: Partial<ResourceDTO>) => void;
  onArchive: () => void;
  onRestore: () => void;
}

function ResourceRow({
  resource,
  archived,
  canEdit,
  dragging,
  onDragStart,
  onDragOver,
  onDragEnd,
  onUpdate,
  onArchive,
  onRestore,
}: ResourceRowProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [name, setName] = useState(resource.name);
  const [kind, setKind] = useState<ResourceKind>(resource.kind);
  const swatchColor = resource.color ?? "#7c3aed";

  useEffect(() => {
    setName(resource.name);
    setKind(resource.kind);
  }, [resource.name, resource.kind]);

  const rowClass = `${styles.row} ${dragging ? styles.dragging : ""} ${archived ? styles.archived : ""}`;
  const draggable = !archived && canEdit;

  return (
    <div
      className={rowClass}
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
      onDragOver={draggable ? onDragOver : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
    >
      <span
        className={`${styles.dragHandle} ${!draggable ? styles.disabled : ""}`}
        aria-hidden
      >
        <GripVertical size={12} />
      </span>
      <span style={{ position: "relative" }}>
        <span
          className={styles.swatch}
          style={{ background: swatchColor }}
          onClick={() => canEdit && !archived && setPickerOpen((v) => !v)}
          role="button"
          tabIndex={0}
          aria-label="Cambiar color"
        />
        {pickerOpen && (
          <div className={styles.swatchPicker}>
            {SWATCH_COLORS.map((c) => (
              <span
                key={c}
                className={`${styles.swatchOption} ${
                  c === swatchColor ? styles.selected : ""
                }`}
                style={{ background: c }}
                onClick={() => {
                  onUpdate({ color: c });
                  setPickerOpen(false);
                }}
                role="button"
                tabIndex={0}
                aria-label={`Color ${c}`}
              />
            ))}
          </div>
        )}
      </span>
      <input
        type="text"
        className={styles.rowName}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name !== resource.name && onUpdate({ name })}
        disabled={archived || !canEdit}
      />
      <select
        className={styles.kindSelect}
        value={kind}
        onChange={(e) => {
          const k = e.target.value as ResourceKind;
          setKind(k);
          onUpdate({ kind: k });
        }}
        disabled={archived || !canEdit}
      >
        <option value="CHAIR">Sillón</option>
        <option value="ROOM">Sala</option>
        <option value="EQUIPMENT">Equipo</option>
      </select>
      {archived ? (
        <span className={styles.archivedBadge}>Archivado</span>
      ) : (
        <span />
      )}
      {canEdit && (
        archived ? (
          <button
            type="button"
            className={`${styles.rowAction} ${styles.rowActionRestore}`}
            onClick={onRestore}
            aria-label={`Restaurar ${resource.name}`}
            title="Restaurar"
          >
            <RotateCcw size={12} />
          </button>
        ) : (
          <button
            type="button"
            className={styles.rowAction}
            onClick={onArchive}
            aria-label={`Archivar ${resource.name}`}
            title="Archivar"
          >
            <Archive size={12} />
          </button>
        )
      )}
    </div>
  );
}

interface ResourceAddFormProps {
  onCancel: () => void;
  onSave: (name: string, kind: ResourceKind, color: string | null) => Promise<void>;
}

function ResourceAddForm({ onCancel, onSave }: ResourceAddFormProps) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ResourceKind>("CHAIR");
  const [color, setColor] = useState<string | null>(ADD_FORM_SWATCHES[0]!);
  const [saving, setSaving] = useState(false);

  return (
    <form
      className={styles.addForm}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim() || saving) return;
        setSaving(true);
        await onSave(name.trim(), kind, color);
        setSaving(false);
      }}
    >
      <div className={styles.addFormRow}>
        <input
          type="text"
          className={styles.addInput}
          placeholder="Nombre (ej. Sillón 3)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <label className={styles.addLabel} htmlFor="resource-add-kind">
          Tipo
        </label>
        <select
          id="resource-add-kind"
          className={styles.kindSelect}
          value={kind}
          onChange={(e) => setKind(e.target.value as ResourceKind)}
        >
          <option value="CHAIR">Sillón</option>
          <option value="ROOM">Sala</option>
          <option value="EQUIPMENT">Equipo</option>
        </select>
      </div>
      <div className={styles.addFormRow}>
        <span className={styles.addLabel}>Color</span>
        <div className={styles.swatchInlineRow} role="radiogroup" aria-label="Color del recurso">
          {ADD_FORM_SWATCHES.map((c) => (
            <span
              key={c}
              role="radio"
              aria-checked={c === color}
              aria-label={`Color ${c}`}
              tabIndex={0}
              className={`${styles.swatchInline} ${c === color ? styles.selected : ""}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setColor(c);
                }
              }}
            />
          ))}
          <span
            role="radio"
            aria-checked={color === null}
            aria-label="Sin color"
            tabIndex={0}
            title="Sin color"
            className={`${styles.swatchInline} ${styles.swatchNone} ${color === null ? styles.selected : ""}`}
            onClick={() => setColor(null)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setColor(null);
              }
            }}
          />
        </div>
      </div>
      <div className={styles.addFormActions}>
        <button
          type="button"
          className={styles.addBtnCancel}
          onClick={onCancel}
          disabled={saving}
        >
          Cancelar
        </button>
        <button
          type="submit"
          className={styles.addBtnSave}
          disabled={!name.trim() || saving}
        >
          {saving ? "Guardando…" : "Añadir"}
        </button>
      </div>
    </form>
  );
}
