"use client";

import { useState, useRef } from "react";
import toast from "react-hot-toast";
import { Trash2, Plus, GripVertical } from "lucide-react";
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
      {state.doctors.length === 0 ? (
        <div className={styles.modalEmpty}>
          No hay doctores en esta clínica.{" "}
          <a className={styles.modalLink} href="/dashboard/team">
            Invítalos desde Equipo →
          </a>
        </div>
      ) : (
        <>
          {state.doctors.map((d) => (
            <DoctorRow key={d.id} doctor={d} />
          ))}
          <a className={styles.modalHelperLink} href="/dashboard/team">
            Para invitar nuevos doctores ve a Equipo →
          </a>
        </>
      )}
    </>
  );
}

function DoctorRow({ doctor }: { doctor: DoctorColumnDTO }) {
  const { dispatch } = useAgenda();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [savingActive, setSavingActive] = useState(false);
  const color = doctorColorFor(doctor.id, doctor.color);

  async function setColor(nextColor: string) {
    const original = doctor;
    const optimistic: DoctorColumnDTO = { ...doctor, color: nextColor };
    dispatch({ type: "UPSERT_DOCTOR", doctor: optimistic });
    try {
      await updateDoctor(doctor.id, { color: nextColor });
      toast.success("Color actualizado");
    } catch (err) {
      dispatch({ type: "UPSERT_DOCTOR", doctor: original });
      const reason =
        (err as { reason?: string; error?: string })?.reason ??
        (err as { error?: string })?.error ??
        "No se pudo guardar";
      toast.error(reason);
    }
  }

  async function toggleActive() {
    if (savingActive) return;
    const original = doctor;
    const next = !doctor.activeInAgenda;
    setSavingActive(true);
    dispatch({
      type: "UPSERT_DOCTOR",
      doctor: { ...doctor, activeInAgenda: next },
    });
    try {
      await updateDoctor(doctor.id, { activeInAgenda: next });
    } catch (err) {
      dispatch({ type: "UPSERT_DOCTOR", doctor: original });
      const reason =
        (err as { reason?: string; error?: string })?.reason ??
        (err as { error?: string })?.error ??
        "No se pudo guardar";
      toast.error(reason);
    } finally {
      setSavingActive(false);
    }
  }

  return (
    <div className={styles.modalDoctorRow}>
      <span
        className={styles.modalDoctorAvatar}
        style={{ background: color }}
        aria-hidden
      >
        {doctor.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={doctor.avatarUrl}
            alt=""
            style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }}
          />
        ) : (
          doctorInitials(doctor.shortName)
        )}
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
                  void setColor(c);
                  setPickerOpen(false);
                }}
                role="button"
                tabIndex={0}
              />
            ))}
          </div>
        )}
      </span>
      <span className={styles.modalDoctorName}>
        <span className={styles.modalDoctorDisplayName}>{doctor.shortName}</span>
        <span className={styles.modalDoctorFullName}>{doctor.displayName}</span>
      </span>
      <button
        type="button"
        className={`${styles.modalToggle} ${doctor.activeInAgenda ? styles.on : ""}`}
        onClick={() => void toggleActive()}
        role="switch"
        aria-checked={doctor.activeInAgenda}
        aria-label={doctor.activeInAgenda ? "Quitar de la agenda" : "Mostrar en la agenda"}
        disabled={savingActive}
        title={doctor.activeInAgenda ? "Activo en agenda" : "Inactivo en agenda"}
      >
        <span className={styles.modalToggleKnob} />
      </button>
    </div>
  );
}
