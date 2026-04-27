"use client";

import { useState, useRef } from "react";
import toast from "react-hot-toast";
import { Trash2, Plus, GripVertical, Info } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useAgenda } from "./agenda-provider";
import { doctorColorFor, doctorInitials } from "@/lib/agenda/doctor-color";
import {
  createResource,
  deleteResource,
  reorderResources,
  updateResource,
  updateDoctor,
} from "@/lib/agenda/mutations";
import type { ResourceDTO, ResourceKind, DoctorColumnDTO } from "@/lib/agenda/types";
import styles from "./agenda.module.css";

const SWATCH_COLORS = [
  "#7c3aed", "#2563eb", "#ea580c", "#0891b2",
  "#059669", "#db2777", "#9333ea", "#0284c7",
  "#16a34a", "#dc2626", "#ca8a04", "#0d9488",
];

type Tab = "resources" | "doctors";

export function AgendaResourcesModal() {
  const { state, closeModal } = useAgenda();
  const [tab, setTab] = useState<Tab>("resources");

  const open = state.modalOpen === "resources";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeModal()}>
      <DialogContent className={styles.modal}>
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle}>Gestionar agenda</div>
          <div role="tablist" className={styles.modalTabs}>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "resources"}
              className={`${styles.modalTab} ${tab === "resources" ? styles.active : ""}`}
              onClick={() => setTab("resources")}
            >
              Sillones / Salas
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "doctors"}
              className={`${styles.modalTab} ${tab === "doctors" ? styles.active : ""}`}
              onClick={() => setTab("doctors")}
            >
              Doctores
            </button>
          </div>
        </div>
        <div className={styles.modalBody}>
          {tab === "resources" ? <ResourcesPanel /> : <DoctorsPanel />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────── Resources panel ─────────────── */

function ResourcesPanel() {
  const { state, dispatch } = useAgenda();
  const [adding, setAdding] = useState(false);
  const dragIndexRef = useRef<number | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const lastOrderRef = useRef<string[] | null>(null);

  const ordered = [...state.resources].sort((a, b) => a.orderIndex - b.orderIndex);

  function moveTo(toIdx: number) {
    if (dragIndexRef.current === null) return;
    if (dragIndexRef.current === toIdx) return;
    const next = ordered.slice();
    const [moved] = next.splice(dragIndexRef.current, 1);
    if (moved) next.splice(toIdx, 0, moved);
    dispatch({ type: "REORDER_RESOURCES", orderedIds: next.map((r) => r.id) });
    dragIndexRef.current = toIdx;
  }

  async function commitReorder() {
    const finalOrder = ordered.map((r) => r.id);
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
        dispatch({ type: "REORDER_RESOURCES", orderedIds: lastOrderRef.current });
      }
      const reason =
        (err as { reason?: string; error?: string })?.reason ??
        (err as { error?: string })?.error ??
        "No se pudo reordenar";
      toast.error(reason);
    }
  }

  return (
    <>
      {ordered.length === 0 && !adding && (
        <div className={styles.modalEmpty}>
          No hay sillones o salas. Añade uno para empezar.
        </div>
      )}
      {ordered.map((r, i) => (
        <ResourceRow
          key={r.id}
          resource={r}
          index={i}
          dragging={draggingId === r.id}
          onDragStart={() => {
            dragIndexRef.current = i;
            lastOrderRef.current = ordered.map((x) => x.id);
            setDraggingId(r.id);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            moveTo(i);
          }}
          onDragEnd={() => {
            dragIndexRef.current = null;
            setDraggingId(null);
            void commitReorder();
          }}
        />
      ))}
      {adding ? (
        <ResourceAddForm
          onCancel={() => setAdding(false)}
          onSave={async (name, kind, color) => {
            try {
              const created = await createResource({ name, kind, color });
              dispatch({ type: "UPSERT_RESOURCE", resource: created });
              toast.success("Recurso añadido");
              setAdding(false);
            } catch (err) {
              const reason =
                (err as { reason?: string; error?: string })?.reason ??
                (err as { error?: string })?.error ??
                "No se pudo crear";
              toast.error(reason);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className={styles.modalAddBtn}
          onClick={() => setAdding(true)}
        >
          <Plus size={12} /> Añadir sillón / sala / equipo
        </button>
      )}
    </>
  );
}

interface ResourceRowProps {
  resource: ResourceDTO;
  index: number;
  dragging: boolean;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}

function ResourceRow({
  resource,
  dragging,
  onDragStart,
  onDragOver,
  onDragEnd,
}: ResourceRowProps) {
  const { dispatch } = useAgenda();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [name, setName] = useState(resource.name);
  const [kind, setKind] = useState<ResourceKind>(resource.kind);
  const swatchColor = resource.color ?? "#7c3aed";

  async function commit(patch: Partial<ResourceDTO>) {
    const original = resource;
    const optimistic = { ...resource, name, kind, ...patch };
    dispatch({ type: "UPSERT_RESOURCE", resource: optimistic });

    try {
      const apiPatch = {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
        ...(patch.color !== undefined ? { color: patch.color } : {}),
      };
      const fallbackPatch = Object.keys(apiPatch).length
        ? apiPatch
        : { name, kind };
      const updated = await updateResource(resource.id, fallbackPatch);
      dispatch({ type: "UPSERT_RESOURCE", resource: updated });
    } catch (err) {
      dispatch({ type: "UPSERT_RESOURCE", resource: original });
      setName(original.name);
      setKind(original.kind);
      const reason =
        (err as { reason?: string; error?: string })?.reason ??
        (err as { error?: string })?.error ??
        "No se pudo guardar";
      toast.error(reason);
    }
  }

  async function remove() {
    const original = resource;
    dispatch({ type: "REMOVE_RESOURCE", id: resource.id });
    try {
      await deleteResource(resource.id);
      toast.success("Recurso eliminado");
    } catch (err) {
      dispatch({ type: "UPSERT_RESOURCE", resource: original });
      const reason =
        (err as { reason?: string; error?: string })?.reason ??
        (err as { error?: string })?.error ??
        "No se pudo eliminar";
      toast.error(reason);
    }
  }

  return (
    <div
      className={`${styles.modalRow} ${dragging ? styles.dragging : ""}`}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
    >
      <span className={styles.modalDragHandle} aria-hidden>
        <GripVertical size={12} />
      </span>
      <span style={{ position: "relative" }}>
        <span
          className={styles.modalSwatch}
          style={{ background: swatchColor }}
          onClick={() => setPickerOpen((v) => !v)}
          role="button"
          tabIndex={0}
          aria-label="Cambiar color"
        />
        {pickerOpen && (
          <div className={styles.modalSwatchPicker}>
            {SWATCH_COLORS.map((c) => (
              <span
                key={c}
                className={`${styles.modalSwatchOption} ${
                  c === swatchColor ? styles.selected : ""
                }`}
                style={{ background: c }}
                onClick={() => {
                  void commit({ color: c });
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
        className={styles.modalRowName}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name !== resource.name && void commit({ name })}
      />
      <select
        className={styles.modalKindSelect}
        value={kind}
        onChange={(e) => {
          const k = e.target.value as ResourceKind;
          setKind(k);
          void commit({ kind: k });
        }}
      >
        <option value="CHAIR">Sillón</option>
        <option value="ROOM">Sala</option>
        <option value="EQUIPMENT">Equipo</option>
      </select>
      <button
        type="button"
        className={styles.modalRowDelete}
        onClick={() => void remove()}
        aria-label={`Eliminar ${resource.name}`}
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

interface ResourceAddFormProps {
  onCancel: () => void;
  onSave: (name: string, kind: ResourceKind, color: string) => Promise<void>;
}

function ResourceAddForm({ onCancel, onSave }: ResourceAddFormProps) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ResourceKind>("CHAIR");
  const [color, setColor] = useState(SWATCH_COLORS[0]!);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  return (
    <form
      className={styles.modalAddForm}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim() || saving) return;
        setSaving(true);
        await onSave(name.trim(), kind, color);
        setSaving(false);
      }}
    >
      <span style={{ position: "relative" }}>
        <span
          className={styles.modalSwatch}
          style={{ background: color }}
          onClick={() => setPickerOpen((v) => !v)}
          role="button"
          tabIndex={0}
          aria-label="Color"
        />
        {pickerOpen && (
          <div className={styles.modalSwatchPicker}>
            {SWATCH_COLORS.map((c) => (
              <span
                key={c}
                className={`${styles.modalSwatchOption} ${
                  c === color ? styles.selected : ""
                }`}
                style={{ background: c }}
                onClick={() => {
                  setColor(c);
                  setPickerOpen(false);
                }}
                role="button"
                tabIndex={0}
              />
            ))}
          </div>
        )}
      </span>
      <input
        type="text"
        className={styles.modalAddInput}
        placeholder="Nombre (ej. Sillón 3)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <select
        className={styles.modalKindSelect}
        value={kind}
        onChange={(e) => setKind(e.target.value as ResourceKind)}
      >
        <option value="CHAIR">Sillón</option>
        <option value="ROOM">Sala</option>
        <option value="EQUIPMENT">Equipo</option>
      </select>
      <button
        type="button"
        className={styles.modalAddCancel}
        onClick={onCancel}
        disabled={saving}
      >
        Cancelar
      </button>
      <button
        type="submit"
        className={styles.modalAddSave}
        disabled={!name.trim() || saving}
      >
        {saving ? "…" : "Añadir"}
      </button>
    </form>
  );
}

/* ─────────────── Doctors panel ─────────────── */

function DoctorsPanel() {
  const { state } = useAgenda();

  return (
    <>
      <div
        className={styles.detailAlerts}
        style={{ margin: "0 0 10px", borderColor: "var(--border-soft)", background: "var(--bg-elev-2)" }}
      >
        <div
          className={styles.detailAlertsTitle}
          style={{ color: "var(--text-2)" }}
        >
          <Info size={12} aria-hidden /> Crear doctores
        </div>
        <div className={styles.detailAlertsContent}>
          Para añadir un doctor, invítalo desde la sección Equipo. Aquí solo
          puedes editar nombre y color.
        </div>
      </div>
      {state.doctors.length === 0 && (
        <div className={styles.modalEmpty}>No hay doctores configurados.</div>
      )}
      {state.doctors.map((d) => (
        <DoctorRow key={d.id} doctor={d} />
      ))}
    </>
  );
}

function DoctorRow({ doctor }: { doctor: DoctorColumnDTO }) {
  const { dispatch } = useAgenda();
  const [name, setName] = useState(doctor.shortName);
  const [pickerOpen, setPickerOpen] = useState(false);
  const color = doctorColorFor(doctor.id, doctor.color);

  async function commit(patch: Partial<DoctorColumnDTO>) {
    const original = doctor;
    const optimistic: DoctorColumnDTO = {
      ...doctor,
      shortName: name,
      displayName: name,
      ...patch,
    };
    dispatch({ type: "UPSERT_DOCTOR", doctor: optimistic });

    try {
      const apiPatch: { color?: string; firstName?: string } = {};
      if (patch.color !== undefined && patch.color !== null) {
        apiPatch.color = patch.color;
      }
      if (patch.shortName !== undefined && patch.shortName !== null) {
        apiPatch.firstName = patch.shortName.replace(/^Dr\.\s*/, "");
      } else if (name !== doctor.shortName) {
        apiPatch.firstName = name.replace(/^Dr\.\s*/, "");
      }

      if (Object.keys(apiPatch).length === 0) return;

      await updateDoctor(doctor.id, apiPatch);
      toast.success("Doctor actualizado");
    } catch (err) {
      dispatch({ type: "UPSERT_DOCTOR", doctor: original });
      setName(original.shortName);
      const reason =
        (err as { reason?: string; error?: string })?.reason ??
        (err as { error?: string })?.error ??
        "No se pudo guardar";
      toast.error(reason);
    }
  }

  return (
    <div className={styles.modalDoctorRow}>
      <span
        className={styles.modalDoctorAvatar}
        style={{ background: color }}
        aria-hidden
      >
        {doctorInitials(name)}
      </span>
      <span style={{ position: "relative" }}>
        <span
          className={styles.modalSwatch}
          style={{ background: color }}
          onClick={() => setPickerOpen((v) => !v)}
          role="button"
          tabIndex={0}
          aria-label="Cambiar color"
        />
        {pickerOpen && (
          <div className={styles.modalSwatchPicker}>
            {SWATCH_COLORS.map((c) => (
              <span
                key={c}
                className={`${styles.modalSwatchOption} ${
                  c === color ? styles.selected : ""
                }`}
                style={{ background: c }}
                onClick={() => {
                  void commit({ color: c });
                  setPickerOpen(false);
                }}
                role="button"
                tabIndex={0}
              />
            ))}
          </div>
        )}
      </span>
      <input
        type="text"
        className={styles.modalRowName}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name !== doctor.shortName && void commit({})}
      />
      <span aria-hidden />
    </div>
  );
}
