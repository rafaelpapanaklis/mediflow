"use client";

import { FileText } from "lucide-react";
import type { TFunction } from "@/i18n/t";
import type { ChairStatus, LiveAppointment } from "@/lib/floor-plan/elements";
import { appointmentProgress, fmtHM, maskPatient } from "@/lib/floor-plan/live-mode";
import {
  FloorPopCard,
  FloorPopClock,
  FloorPopData,
  FloorPopLabel,
  FloorPopList,
  FloorPopName,
  FloorProgress,
} from "@/components/floor-plan/floor-chrome";
import { LABEL_KEY } from "./floor-copy";
import styles from "../clinic-layout.module.css";

/**
 * LA TARJETA DEL SILLÓN — lo que se abre al clicar uno en modo En Vivo.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * La caja, el encabezado con su estado, la barra de avance y las listas
 * las pone la capa compartida (src/components/floor-plan/floor-chrome).
 * Aquí queda lo que es del DENTAL y no puede subir allí: el vocabulario
 * ("Paciente", "Doctor", "Tratamiento"), el enmascarado y el botón que
 * abre el expediente.
 *
 * 🔴 LA MÁSCARA DEL PACIENTE NO SE RELAJA. Se llama a
 * `maskPatient(nombre, showFullNames)` con la MISMA bandera que el panel
 * de estado y el tooltip (`clinic.liveModeShowPatientNames`). Si la
 * clínica pidió iniciales, aquí también son iniciales — abrir una tarjeta
 * no es una puerta trasera al nombre completo.
 *
 * 🔴 NO PIDE NADA AL SERVIDOR. Sale de las mismas citas que ya pintaron el
 * halo, así que no puede contradecir al piso ni cuando se viaja por la
 * línea de tiempo.
 */

/** "42 min", "1 h 05". Tres cifras de minutos no se leen. */
function duracion(min: number, t: TFunction): string {
  if (min < 60) return t("pages.clinicLayout.durMinutes", { count: min });
  return t("pages.clinicLayout.durHours", {
    hours: Math.floor(min / 60),
    minutes: (min % 60).toString().padStart(2, "0"),
  });
}

export interface ChairCardData {
  chairName: string;
  status: ChairStatus;
  /** Cita en curso en el momento que se está viendo, o null. */
  current: LiveAppointment | null;
  /** Siguiente cita futura del sillón, o null. */
  next: LiveAppointment | null;
  /** Las que vienen después de la siguiente (máximo 4 se pintan). */
  upcoming: LiveAppointment[];
}

export function ChairCard({
  data,
  viewTime,
  showFullNames,
  onClose,
  onOpenRecord,
  t,
}: {
  data: ChairCardData;
  viewTime: Date;
  showFullNames: boolean;
  onClose: () => void;
  onOpenRecord: (apt: LiveAppointment) => void;
  t: TFunction;
}) {
  const { chairName, status, current, next, upcoming } = data;
  const elapsedMin = current
    ? Math.max(0, Math.floor((viewTime.getTime() - current.start.getTime()) / 60_000))
    : null;
  const startsInMin = next
    ? Math.max(0, Math.round((next.start.getTime() - viewTime.getTime()) / 60_000))
    : null;

  return (
    <FloorPopCard
      title={chairName}
      stateLabel={t(LABEL_KEY[status])}
      tone={status}
      variant="floating"
      onClose={onClose}
      closeLabel={t("pages.clinicLayout.cardClose")}
      ariaLabel={chairName}
    >
      {current ? (
        <>
          <FloorPopLabel>{t("pages.clinicLayout.cardPatient")}</FloorPopLabel>
          <FloorPopName>{maskPatient(current.patient, showFullNames)}</FloorPopName>
          <FloorPopData label={t("pages.clinicLayout.cardTreatment")}>
            {current.treatment}
          </FloorPopData>
          <FloorPopData label={t("pages.clinicLayout.cardDoctor")}>{current.doctor}</FloorPopData>
          <FloorPopClock>
            {t("pages.clinicLayout.cardSince", { time: fmtHM(current.start) })}
            {elapsedMin !== null
              ? ` · ${t("pages.clinicLayout.cardElapsed", { duration: duracion(elapsedMin, t) })}`
              : ""}
          </FloorPopClock>
          <FloorProgress value={appointmentProgress(current, viewTime)} />
          {current.patientId ? (
            <button
              type="button"
              className={styles.cardRecordBtn}
              onClick={() => onOpenRecord(current)}
            >
              <FileText size={13} aria-hidden="true" />{" "}
              {t("pages.clinicLayout.openRecordOdontogram")}
            </button>
          ) : null}
        </>
      ) : (
        <>
          {next ? (
            <FloorPopClock strong>
              {status === "proximo"
                ? t("pages.clinicLayout.cardNextAt", { time: fmtHM(next.start) })
                : t("pages.clinicLayout.cardFreeNext", { time: fmtHM(next.start) })}
              {startsInMin !== null
                ? ` · ${t("pages.clinicLayout.cardStartsIn", { duration: duracion(startsInMin, t) })}`
                : ""}
            </FloorPopClock>
          ) : (
            <FloorPopClock>{t("pages.clinicLayout.cardFreeNothing")}</FloorPopClock>
          )}

          {upcoming.length > 0 && (
            <>
              <FloorPopLabel>{t("pages.clinicLayout.cardComingUp")}</FloorPopLabel>
              <FloorPopList>
                {upcoming.slice(0, 4).map((a) => (
                  <li key={a.id}>
                    <b>{fmtHM(a.start)}</b> {maskPatient(a.patient, showFullNames)}
                    {a.treatment ? ` · ${a.treatment}` : ""}
                  </li>
                ))}
              </FloorPopList>
            </>
          )}
        </>
      )}
    </FloorPopCard>
  );
}
