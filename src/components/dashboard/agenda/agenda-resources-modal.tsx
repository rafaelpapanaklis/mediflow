"use client";

import { useState, useRef } from "react";
import { Trash2, Plus, GripVertical } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useAgenda } from "./agenda-provider";
import { doctorColorFor, doctorInitials } from "@/lib/agenda/doctor-color";
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
            setDraggingId(r.id);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            moveTo(i);
          }}
          onDragEnd={() => {
            dragIndexRef.current = null;
            setDraggingId(null);
          }}
        />
      ))}
      {adding ? (
        <ResourceAddForm
          onCancel={() => setAdding(false)}
          onSave={(name, kind, color) => {
            const id = `tmp-${Date.now()}`;
            dispatch({
              type: "UPSERT_RESOURCE",
              resource: {
                id,
                name,
                kind,
                color,
                orderIndex: ordered.length,
              },
            });
            setAdding(false);
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

  function commit(patch: Partial<ResourceDTO>) {
    dispatch({
      type: "UPSERT_RESOURCE",
      resource: { ...resource, name, kind, ...patch },
    });
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
                  commit({ color: c });
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
        onBlur={() => name !== resource.name && commit({ name })}
      />
      <select
        className={styles.modalKindSelect}
        value={kind}
        onChange={(e) => {
          const k = e.target.value as ResourceKind;
          setKind(k);
          commit({ kind: k });
        }}
      >
        <option value="CHAIR">Sillón</option>
        <option value="ROOM">Sala</option>
        <option value="EQUIPMENT">Equipo</option>
      </select>
      <button
        type="button"
        className={styles.modalRowDelete}
        onClick={() => dispatch({ type: "REMOVE_RESOURCE", id: resource.id })}
        aria-label={`Eliminar ${resource.name}`}
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

interface ResourceAddFormProps {
  onCancel: () => void;
  onSave: (name: string, kind: ResourceKind, color: string) => void;
}

function ResourceAddForm({ onCancel, onSave }: ResourceAddFormProps) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ResourceKind>("CHAIR");
  const [color, setColor] = useState(SWATCH_COLORS[0]!);
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <form
      className={styles.modalAddForm}
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSave(name.trim(), kind, color);
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
      >
        Cancelar
      </button>
      <button
        type="submit"
        className={styles.modalAddSave}
        disabled={!name.trim()}
      >
        Añadir
      </button>
    </form>
  );
}

/* ─────────────── Doctors panel ─────────────── */

function DoctorsPanel() {
  const { state, dispatch } = useAgenda();
  const [adding, setAdding] = useState(false);

  return (
    <>
      {state.doctors.length === 0 && !adding && (
        <div className={styles.modalEmpty}>No hay doctores configurados.</div>
      )}
      {state.doctors.map((d) => (
        <DoctorRow key={d.id} doctor={d} />
      ))}
      {adding ? (
        <DoctorAddForm
          onCancel={() => setAdding(false)}
          onSave={(name, color) => {
            const id = `tmp-${Date.now()}`;
            dispatch({
              type: "UPSERT_DOCTOR",
              doctor: {
                id,
                displayName: name,
                shortName: name,
                color,
              },
            });
            setAdding(false);
          }}
        />
      ) : (
        <button
          type="button"
          className={styles.modalAddBtn}
          onClick={() => setAdding(true)}
        >
          <Plus size={12} /> Añadir doctor
        </button>
      )}
    </>
  );
}

function DoctorRow({ doctor }: { doctor: DoctorColumnDTO }) {
  const { dispatch } = useAgenda();
  const [name, setName] = useState(doctor.shortName);
  const [pickerOpen, setPickerOpen] = useState(false);
  const color = doctorColorFor(doctor.id, doctor.color);

  function commit(patch: Partial<DoctorColumnDTO>) {
    dispatch({
      type: "UPSERT_DOCTOR",
      doctor: { ...doctor, shortName: name, displayName: name, ...patch },
    });
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
                  commit({ color: c });
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
        onBlur={() => name !== doctor.shortName && commit({})}
      />
      <button
        type="button"
        className={styles.modalRowDelete}
        onClick={() => dispatch({ type: "REMOVE_DOCTOR", id: doctor.id })}
        aria-label={`Eliminar ${doctor.shortName}`}
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

interface DoctorAddFormProps {
  onCancel: () => void;
  onSave: (name: string, color: string) => void;
}

function DoctorAddForm({ onCancel, onSave }: DoctorAddFormProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(SWATCH_COLORS[0]!);
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <form
      className={styles.modalAddForm}
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSave(name.trim(), color);
      }}
    >
      <span style={{ position: "relative" }}>
        <span
          className={styles.modalSwatch}
          style={{ background: color }}
          onClick={() => setPickerOpen((v) => !v)}
          role="button"
          tabIndex={0}
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
        placeholder="Nombre (ej. Dr. Pérez)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <span aria-hidden />
      <button
        type="button"
        className={styles.modalAddCancel}
        onClick={onCancel}
      >
        Cancelar
      </button>
      <button
        type="submit"
        className={styles.modalAddSave}
        disabled={!name.trim()}
      >
        Añadir
      </button>
    </form>
  );
}
