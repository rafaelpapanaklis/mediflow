"use client";

/**
 * «Hoy» para el doctor, con el diseño nuevo. Lo mismo que `home/home-doctor.tsx`
 * y con los mismos clics: el siguiente paciente con sus tres botones y sus
 * alertas, el resto del día, las tareas pendientes, los pacientes recientes y
 * los atajos del pie.
 *
 * «Ver agenda» manda a `/dashboard/agenda` (la nueva), no a la de siempre:
 * esta pantalla solo existe con la bandera `menu-dos-niveles` encendida, y con
 * ella la agenda es ésa. Ver `hoy-recepcion.tsx`.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  AlertTriangle, CalendarDays, Camera, ChevronRight, FileSignature, FileText, ListChecks,
  Pill, Play, Sparkles, Users, type LucideIcon,
} from "lucide-react";
import { AlergiesPopover } from "@/components/dashboard/alergies-popover";
import { useActiveConsult } from "@/hooks/use-active-consult";
import { useT } from "@/i18n/i18n-provider";
import { formatRelative, formatShortTime, formatTimeUntil } from "@/lib/home/greet";
import type { HomeDoctorData } from "@/lib/home/types";
import { AccionesRapidas, BarraAtajos, Iniciales, Saludo, Tarjeta, Vacio } from "./piezas";
import { FilaCita } from "./fila-cita";
import { VacioCitasHoy } from "./hoy-recepcion";
import s from "./hoy.module.css";

interface Props {
  user: { displayName: string };
  clinic: { name: string };
  data: HomeDoctorData;
}

export function HoyDoctor({ user, data }: Props) {
  const t = useT();
  const totalHoy = data.todayAppointments.length;
  const { draftNotes, unanalyzedXrays, unsignedConsents } = data.pendingTasks;
  const sinTareas = draftNotes + unanalyzedXrays + unsignedConsents === 0;

  const cola =
    totalHoy > 0
      ? `${t("home.doctor.patientsToday", { count: totalHoy })} · ${t("home.doctor.completedCount", {
          count: data.completedToday,
        })}`
      : t("home.doctor.noAppointmentsToday");

  const restoDelDia = data.nextAppointment
    ? data.todayAppointments.filter((a) => a.id !== data.nextAppointment!.id)
    : data.todayAppointments;

  return (
    <>
      <div className={s.cabecera}>
        <Saludo nombreCompleto={`Dr. ${user.displayName}`} cola={cola} />
        <AccionesRapidas />
      </div>

      {data.nextAppointment && <SiguientePaciente appt={data.nextAppointment} />}

      <div className={s.rejillaPar}>
        <Tarjeta
          icono={CalendarDays}
          titulo={t("home.doctor.restOfDayTitle")}
          sub={
            restoDelDia.length === 0
              ? data.nextAppointment
                ? t("home.doctor.noMoreAppointments")
                : t("home.doctor.noAppointments")
              : t("home.doctor.appointmentsCount", { count: restoDelDia.length })
          }
          accion={
            <Link href="/dashboard/agenda" className={s.tarjetaEnlace}>
              {t("home.doctor.viewAgenda")}
              <ChevronRight size={13} strokeWidth={1.75} aria-hidden />
            </Link>
          }
          lista
        >
          {restoDelDia.length === 0
            ? !data.nextAppointment && <VacioCitasHoy />
            : restoDelDia.map((appt) => <FilaCita key={appt.id} appt={appt} compacta />)}
        </Tarjeta>

        <Tarjeta
          icono={ListChecks}
          titulo={t("home.doctor.pendingTasksTitle")}
          sub={sinTareas ? t("home.recep.actionEmpty") : t("home.doctor.tasksSubtitle")}
          lista
        >
          {sinTareas ? (
            <div className={s.mensajeVacio}>{t("home.doctor.noPendingTasks")}</div>
          ) : (
            <>
              <FilaTarea
                icono={FileText}
                texto={t("home.doctor.draftSoapNotes", { count: draftNotes })}
                cuenta={draftNotes}
                href="/dashboard/patients"
                accion={t("home.doctor.complete")}
              />
              <FilaTarea
                icono={Camera}
                texto={t("home.doctor.unanalyzedXrays", { count: unanalyzedXrays })}
                cuenta={unanalyzedXrays}
                href="/dashboard/xrays?filter=unanalyzed"
                accion={t("home.doctor.analyzeWithAi")}
              />
              <FilaTarea
                icono={FileSignature}
                texto={t("home.doctor.unsignedConsents", { count: unsignedConsents })}
                cuenta={unsignedConsents}
                href="/dashboard/patients"
                accion={t("home.doctor.sendDigitalSignature")}
                alerta
              />
            </>
          )}
        </Tarjeta>
      </div>

      {data.recentPatients.length > 0 && (
        <Tarjeta
          icono={Users}
          titulo={t("home.doctor.recentPatientsTitle")}
          sub={t("home.doctor.recentPatientsSubtitle")}
        >
          <div role="list" aria-label={t("home.recentPatientsCarousel.ariaLabel")} className={s.carrusel}>
            {data.recentPatients.map((p) => (
              <Link key={p.id} role="listitem" href={`/dashboard/patients/${p.id}`} className={s.carruselItem}>
                <Iniciales nombre={p.name} />
                <span className={s.carruselNombre}>{p.name}</span>
                <span className={s.derecha}>{formatRelative(p.lastVisitAt)}</span>
              </Link>
            ))}
          </div>
        </Tarjeta>
      )}

      <BarraAtajos />
    </>
  );
}

/* ── Siguiente paciente ──────────────────────────────────────────── */

type SiguienteCita = NonNullable<HomeDoctorData["nextAppointment"]>;

function SiguientePaciente({ appt }: { appt: SiguienteCita }) {
  const t = useT();
  const router = useRouter();
  const { startConsult, consult } = useActiveConsult();
  const yaActiva = consult?.patientId === appt.patient.id;

  const iniciar = async () => {
    if (yaActiva) {
      toast(t("home.heroNextPatient.alreadyActive"), { icon: "ℹ️" });
      return;
    }
    // El aviso de éxito SOLO si la consulta se abrió de verdad (hallazgo 26).
    if (await startConsult(appt.patient.id)) {
      toast.success(t("home.heroNextPatient.consultStarted"));
    }
  };

  const edadSexo = [appt.patientAge != null ? `${appt.patientAge}a` : null, appt.patientGender ?? null]
    .filter(Boolean)
    .join(" · ");

  const primeraAlergia = appt.patientAlerts?.allergies?.[0];
  const primerMedicamento = appt.patientAlerts?.medications?.[0];
  const totalAlertas =
    (appt.patientAlerts?.allergies?.length ?? 0) +
    (appt.patientAlerts?.medications?.length ?? 0) +
    (appt.patientAlerts?.conditions?.length ?? 0);

  return (
    <section aria-label={t("home.heroNextPatient.sectionLabel")} className={s.heroe}>
      <div className={s.heroeCeja}>
        {t("home.heroNextPatient.eyebrow")} · {formatTimeUntil(appt.startsAt)}
      </div>

      <div className={s.heroeCuerpo}>
        <Iniciales nombre={appt.patient.name} />
        <div className={s.filaCuerpo}>
          <h2 className={s.heroeNombre}>{appt.patient.name}</h2>
          {edadSexo && <div className={s.heroeDatos}>{edadSexo}</div>}
          <div className={s.heroeMotivo}>
            <span className={s.hora}>{formatShortTime(appt.startsAt)}</span>
            <span>{appt.reason ?? t("home.heroNextPatient.defaultReason")}</span>
          </div>

          {(primeraAlergia || primerMedicamento) && (
            <div className={s.heroeChips}>
              {primeraAlergia && (
                <AlergiesPopover
                  apariencia="nueva"
                  alerts={appt.patientAlerts ?? {}}
                  trigger={
                    <button
                      type="button"
                      className={`${s.chip} ${s.chipPeligro}`}
                      aria-label={t("home.heroNextPatient.medicalAlerts", { count: totalAlertas })}
                    >
                      <AlertTriangle size={12} strokeWidth={1.75} aria-hidden />
                      {t("home.heroNextPatient.allergyLabel")}: {primeraAlergia}
                      {totalAlertas > 1 ? ` +${totalAlertas - 1}` : ""}
                    </button>
                  }
                />
              )}
              {primerMedicamento && !primeraAlergia && (
                <AlergiesPopover
                  apariencia="nueva"
                  alerts={appt.patientAlerts ?? {}}
                  trigger={
                    <button type="button" className={`${s.chip} ${s.chipAlerta}`}>
                      <Pill size={12} strokeWidth={1.75} aria-hidden />
                      {primerMedicamento}
                    </button>
                  }
                />
              )}
            </div>
          )}
        </div>
      </div>

      <div className={s.heroeAcciones}>
        <button type="button" onClick={iniciar} className={`${s.boton} ${s.botonPrincipal}`}>
          <Play size={16} strokeWidth={1.75} aria-hidden />
          {yaActiva ? t("home.heroNextPatient.consultInProgress") : t("home.heroNextPatient.startConsult")}
        </button>
        <button
          type="button"
          className={s.boton}
          onClick={() => router.push(`/dashboard/patients/${appt.patient.id}`)}
        >
          <FileText size={16} strokeWidth={1.75} aria-hidden />
          {t("home.heroNextPatient.viewRecord")}
        </button>
        <button
          type="button"
          className={s.boton}
          onClick={() => router.push(`/dashboard/ai-assistant?patient=${appt.patient.id}`)}
        >
          <Sparkles size={16} strokeWidth={1.75} aria-hidden />
          {t("home.heroNextPatient.aiAssist")}
        </button>
      </div>
    </section>
  );
}

/* ── Tarea pendiente ─────────────────────────────────────────────── */

function FilaTarea({
  icono: Icono,
  texto,
  cuenta,
  href,
  accion,
  alerta,
}: {
  icono: LucideIcon;
  texto: string;
  cuenta: number;
  href: string;
  accion: string;
  alerta?: boolean;
}) {
  if (cuenta <= 0) return null;
  return (
    <Link href={href} className={`${s.fila} ${s.filaBoton}`}>
      <span className={`${s.tareaIcono} ${alerta ? s.tareaIconoAlerta : ""}`}>
        <Icono size={16} strokeWidth={1.75} aria-hidden />
      </span>
      <div className={s.filaCuerpo}>
        <div className={s.tareaTexto}>
          <span className={`${s.tareaCuenta} ${alerta ? s.tareaCuentaAlerta : ""}`}>{cuenta}</span>
          {texto}
        </div>
        <span className={s.enlaceInterno} style={{ marginTop: 2 }}>
          {accion}
          <ChevronRight size={12} strokeWidth={1.75} aria-hidden />
        </span>
      </div>
    </Link>
  );
}
