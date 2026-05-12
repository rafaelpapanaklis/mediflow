"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useAgenda } from "./agenda-provider";
import { doctorColorFor, doctorInitials } from "@/lib/agenda/doctor-color";
import { updateDoctor } from "@/lib/agenda/mutations";
import { ResourcesManager } from "@/components/dashboard/resources/resources-manager";
import type { DoctorColumnDTO } from "@/lib/agenda/types";
import styles from "./agenda.module.css";

const SWATCH_COLORS = [
  "#7c3aed", "#2563eb", "#ea580c", "#0891b2",
  "#059669", "#db2777", "#9333ea", "#0284c7",
  "#16a34a", "#dc2626", "#ca8a04", "#0d9488",
];

/**
 * Modal embebido en la agenda con dos modos:
 *  - "team"      → DoctorsPanel (color + activeInAgenda toggle)
 *  - "resources" → ResourcesPanelWrapper que renderiza <ResourcesManager variant="modal" />
 *
 * El CRUD canónico de Resource vive en `<ResourcesManager />`
 * (también usado en `/dashboard/resources`). Este modal solo es un atajo.
 */
export function AgendaResourcesModal() {
  const { state, closeModal } = useAgenda();
  const open = state.modalOpen === "team" || state.modalOpen === "resources";
  const isTeam = state.modalOpen === "team";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeModal()}>
      <DialogContent className={styles.modal}>
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle}>
            {isTeam ? "Equipo" : "Sillones / Salas / Equipo"}
          </div>
          <div className={styles.modalSubtitle}>
            {isTeam
              ? "Doctores de la clínica que aparecen como columnas en la agenda."
              : "Sillones, salas y equipos disponibles para asignar a citas."}
          </div>
        </div>
        <div className={styles.modalBody}>
          {isTeam ? <DoctorsPanel /> : <ResourcesPanelWrapper />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────── Resources panel (delegates to shared component) ─────────────── */

function ResourcesPanelWrapper() {
  const { state, dispatch } = useAgenda();
  // Only active resources live in the store (the agenda never shows archived).
  // The shared component manages its own state (including archived view).
  return (
    <ResourcesManager
      variant="modal"
      canEdit={true}
      initialResources={state.resources}
      clinicId=""
      onChange={(next) => {
        // Sync agenda store with active resources only so columns refresh.
        const activeOnly = next.filter((r) => r.isActive !== false);
        dispatch({ type: "SET_RESOURCES", resources: activeOnly });
      }}
    />
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

