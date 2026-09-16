"use client";

/**
 * Las piezas que comparten las tres vistas de «Hoy» (recepción, doctor y
 * admin): saludo, acciones rápidas, la barra de atajos del pie, la tarjeta,
 * el estado vacío, las iniciales y la etiqueta de estado de una cita.
 *
 * Todo lee los tokens `--m2-*` del menú por herencia desde `RaizHoy`; aquí
 * solo hay clases de `hoy.module.css`.
 */

import { useEffect, useState, type ReactNode } from "react";
import { CalendarPlus, Search, UserPlus, type LucideIcon } from "lucide-react";
import { useNewAppointmentDialog } from "@/components/dashboard/new-appointment/new-appointment-provider";
import { useNewPatientDialog } from "@/components/dashboard/new-patient/new-patient-provider";
import { useCommandPalette } from "@/hooks/use-command-palette";
import { useT } from "@/i18n/i18n-provider";
import { timeGreeting, formatLongDate, firstName } from "@/lib/home/greet";
import type { AppointmentStatus } from "@/lib/home/types";
import s from "./hoy.module.css";

/* ── Saludo ──────────────────────────────────────────────────────── */

/**
 * «Buenos días, Rafael.» + la fecha larga y, si la vista lo pide, una cola
 * («3 pacientes en sala»). El saludo cambia con la hora, así que se recalcula
 * cada minuto: es el MISMO reloj de cliente que ya tenía la home de siempre
 * (`home/parts/greeting.tsx`), sin ninguna petición de red.
 */
export function Saludo({ nombreCompleto, cola }: { nombreCompleto: string; cola?: string }) {
  const t = useT();
  const [saludo, setSaludo] = useState(t("home.greeting.hello"));
  const [fecha, setFecha] = useState(formatLongDate());
  const [montado, setMontado] = useState(false);

  useEffect(() => {
    const actualizar = () => {
      setSaludo(timeGreeting());
      setFecha(formatLongDate());
    };
    actualizar();
    setMontado(true);
    const id = window.setInterval(actualizar, 60_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div>
      <h1 className={s.titulo}>
        {saludo}, {firstName(nombreCompleto)}.
      </h1>
      <p className={s.subtitulo} suppressHydrationWarning={!montado}>
        {fecha}
        {cola ? ` · ${cola}` : ""}
      </p>
    </div>
  );
}

/* ── Acciones rápidas (cabecera) y atajos (pie) ──────────────────── */

export function AccionesRapidas() {
  const t = useT();
  const { open: abrirCita } = useNewAppointmentDialog();
  const { open: abrirPaciente } = useNewPatientDialog();

  return (
    <div className={s.acciones}>
      <button
        type="button"
        className={`${s.boton} ${s.botonPrincipal}`}
        onClick={() => abrirCita({ openAgendaAfter: true })}
      >
        <CalendarPlus size={16} strokeWidth={1.75} aria-hidden />
        {t("home.quickActions.newAppointment")}
      </button>
      <button type="button" className={s.boton} onClick={() => abrirPaciente()}>
        <UserPlus size={16} strokeWidth={1.75} aria-hidden />
        {t("home.quickActions.newPatient")}
      </button>
    </div>
  );
}

export function BarraAtajos() {
  const t = useT();
  const { openPalette } = useCommandPalette();
  const { open: abrirCita } = useNewAppointmentDialog();
  const { open: abrirPaciente } = useNewPatientDialog();

  return (
    <div className={s.atajos}>
      <button
        type="button"
        className={`${s.boton} ${s.botonPrincipal}`}
        onClick={() => abrirCita({ openAgendaAfter: true })}
      >
        <CalendarPlus size={16} strokeWidth={1.75} aria-hidden />
        {t("home.shortcutBar.newAppointment")}
      </button>
      <button type="button" className={s.boton} onClick={() => abrirPaciente()}>
        <UserPlus size={16} strokeWidth={1.75} aria-hidden />
        {t("home.shortcutBar.newPatient")}
      </button>
      <button type="button" className={`${s.boton} ${s.botonSuave}`} onClick={openPalette}>
        <Search size={16} strokeWidth={1.75} aria-hidden />
        {t("home.shortcutBar.searchPatient")}
      </button>
    </div>
  );
}

/* ── Tarjeta ─────────────────────────────────────────────────────── */

export function Tarjeta({
  icono: Icono,
  titulo,
  sub,
  accion,
  lista,
  className,
  children,
}: {
  icono: LucideIcon;
  titulo: string;
  sub?: string;
  /** Lo que va a la derecha de la cabecera: un enlace, un control segmentado. */
  accion?: ReactNode;
  /** El cuerpo es una lista de filas (menos aire lateral). */
  lista?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={[s.tarjeta, className ?? ""].filter(Boolean).join(" ")}>
      <header className={s.tarjetaCabeza}>
        <span className={s.tarjetaIcono}>
          <Icono size={15} strokeWidth={1.75} aria-hidden />
        </span>
        <div className={s.tarjetaTextos}>
          <h2 className={s.tarjetaTitulo}>{titulo}</h2>
          {sub && <p className={s.tarjetaSub}>{sub}</p>}
        </div>
        {accion && <div className={s.tarjetaAccion}>{accion}</div>}
      </header>
      <div className={lista ? s.tarjetaLista : s.tarjetaCuerpo}>{children}</div>
    </section>
  );
}

/* ── Estado vacío ────────────────────────────────────────────────── */

export function Vacio({
  icono: Icono,
  titulo,
  pista,
  tono,
  acciones,
  alto,
}: {
  icono: LucideIcon;
  titulo: string;
  pista?: string;
  tono?: "exito" | "peligro";
  /** Los botones que la home de siempre ofrece en ese vacío, si los hay. */
  acciones?: ReactNode;
  /** Ocupa el alto de la gráfica (tendencia de ingresos). */
  alto?: boolean;
}) {
  const tonoClase = tono === "exito" ? s.vacioIconoExito : tono === "peligro" ? s.vacioIconoPeligro : "";
  return (
    <div role="status" aria-live="polite" className={`${s.vacio} ${alto ? s.vacioAlto : ""}`}>
      <span className={`${s.vacioIcono} ${tonoClase}`}>
        <Icono size={17} strokeWidth={1.75} aria-hidden />
      </span>
      <span className={s.vacioTitulo}>{titulo}</span>
      {pista && <span className={s.vacioPista}>{pista}</span>}
      {acciones && <div className={s.vacioAcciones}>{acciones}</div>}
    </div>
  );
}

/* ── Iniciales ───────────────────────────────────────────────────── */

function iniciales(nombre: string): string {
  return nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

/** Las iniciales de un nombre en el cuadro violeta suave del menú. */
export function Iniciales({ nombre, peq }: { nombre: string; peq?: boolean }) {
  return (
    <span className={`${s.iniciales} ${peq ? s.inicialesPeq : ""}`} aria-hidden>
      {iniciales(nombre)}
    </span>
  );
}

/* ── Etiqueta de estado de una cita ──────────────────────────────── */

/**
 * Los nombres y colores de estado son los MISMOS que ya unificaron la ficha
 * del paciente y la Agenda nueva (`pacientesRediseno.cita.*`,
 * `src/lib/agenda-nueva/estados.ts`): Rafael pidió que la misma cita se llame
 * igual en todas las pantallas. Ámbar = el paciente espera en la sala; rojo =
 * no vino; violeta = agendada o ya dentro; verde = confirmada.
 */
const ESTADO: Record<AppointmentStatus, { clave: string; tono: string }> = {
  SCHEDULED:   { clave: "pacientesRediseno.cita.agendada",   tono: s.etiquetaVioleta },
  CONFIRMED:   { clave: "pacientesRediseno.cita.confirmada", tono: s.etiquetaExito },
  CHECKED_IN:  { clave: "pacientesRediseno.cita.registrado", tono: s.etiquetaAmbar },
  IN_CHAIR:    { clave: "pacientesRediseno.cita.enSillon",   tono: s.etiquetaVioleta },
  IN_PROGRESS: { clave: "pacientesRediseno.cita.enConsulta", tono: s.etiquetaVioleta },
  COMPLETED:   { clave: "pacientesRediseno.cita.completada", tono: s.etiquetaNeutra },
  CHECKED_OUT: { clave: "pacientesRediseno.cita.salio",      tono: s.etiquetaNeutra },
  CANCELLED:   { clave: "pacientesRediseno.cita.cancelada",  tono: s.etiquetaNeutra },
  NO_SHOW:     { clave: "pacientesRediseno.cita.noAsistio",  tono: s.etiquetaPeligro },
};

export function EtiquetaEstado({ estado }: { estado: AppointmentStatus }) {
  const t = useT();
  const e = ESTADO[estado] ?? ESTADO.SCHEDULED;
  return <span className={`${s.etiqueta} ${e.tono}`}>{t(e.clave)}</span>;
}
