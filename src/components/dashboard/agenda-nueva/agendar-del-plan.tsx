"use client";

/**
 * La agenda nueva «agendando del plan» (ws1-t1 · plan fase 2 · P8).
 *
 * «Agendar lo pendiente» manda aquí con `?agendarPlan=<planId>&filas=<ids>`. La agenda es la de
 * siempre; lo único que cambia mientras dure:
 *  · abajo, un aviso «Agendando del plan de Ana · Resina 16 · Endodoncia 26 · 90 min» con
 *    «Elegir hora» y «Salir»;
 *  · todo «Nueva cita» que se abra desde la cuadrícula, la barra o el buscador de huecos lleva el
 *    paciente, el doctor y el motivo del plan, la duración del tarifario y las filas (el POST las liga
 *    a la cita). El panel de una cita ya existente NO (reagendar otra cita no se lleva el plan);
 *  · al guardar, se sale del modo y la agenda resalta la cita nueva.
 * De entrada se abre la Nueva cita una vez, para que con un toque más ya se elija la hora.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarPlus } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { useAgenda } from "@/components/dashboard/agenda/agenda-provider";
import { useNewAppointmentDialog } from "@/components/dashboard/new-appointment/new-appointment-provider";
import type { OpenNewAppointmentParams } from "@/lib/new-appointment/types";
import {
  PARAM_FILAS,
  PARAM_PLAN,
  leerUrlDeAgendaDelPlan,
  paramsDeNuevaCita,
  type DatosDePlanPendiente,
} from "@/components/dashboard/plan-a-agenda/agendar-plan-datos";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import ag from "./agenda-nueva.module.css";
import s from "./agendar-plan.module.css";

export interface AgendaDelPlan {
  /** Lo que se suma a cada Nueva cita; null = la agenda normal. */
  extra: OpenNewAppointmentParams | null;
  aviso: React.ReactNode;
}

export function useAgendarDelPlan(): AgendaDelPlan {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { state } = useAgenda();
  const { open: abrirNuevaCita } = useNewAppointmentDialog();

  const pedido = useMemo(() => leerUrlDeAgendaDelPlan(searchParams), [searchParams]);
  const planId = pedido?.planId ?? null;
  const filasClave = pedido?.filaIds.join(",") ?? "";
  const [datos, setDatos] = useState<DatosDePlanPendiente | null>(null);
  const [cargado, setCargado] = useState(false);

  useEffect(() => {
    setDatos(null);
    setCargado(false);
    if (!planId) return;
    let cancelado = false;
    fetch(`/api/appointments/plan-pendiente?planId=${encodeURIComponent(planId)}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: DatosDePlanPendiente | null) => { if (!cancelado) { setDatos(b); setCargado(true); } })
      .catch(() => { if (!cancelado) { setDatos(null); setCargado(true); } });
    return () => { cancelado = true; };
  }, [planId]);

  /** Quita `agendarPlan` y `filas` de la URL; con una cita, salta a su día y la resalta. */
  const salir = useCallback(
    (cita?: { id: string; startsAt: string }) => {
      const q = new URLSearchParams(searchParams.toString());
      q.delete(PARAM_PLAN);
      q.delete(PARAM_FILAS);
      if (cita) {
        const dia = new Intl.DateTimeFormat("en-CA", { timeZone: state.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(cita.startsAt));
        q.set("date", dia);
        q.set("highlight", cita.id);
      }
      const qs = q.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [searchParams, pathname, router, state.timezone],
  );

  const extra = useMemo<OpenNewAppointmentParams | null>(() => {
    const p = paramsDeNuevaCita(datos, filasClave ? filasClave.split(",") : [], t("planTratamiento.citas.prefijoMotivo"));
    return p ? { ...p, onCreated: (cita) => salir(cita) } : null;
  }, [datos, filasClave, salir, t]);

  // Una vez por pedido: la Nueva cita abierta de entrada (con su propia rejilla de horas).
  const abierta = useRef<string | null>(null);
  useEffect(() => {
    if (!extra || !planId) return;
    const clave = `${planId}|${filasClave}`;
    if (abierta.current === clave) return;
    abierta.current = clave;
    abrirNuevaCita(extra);
  }, [extra, planId, filasClave, abrirNuevaCita]);

  if (!pedido) return { extra: null, aviso: null };

  const aviso = !cargado ? null : (
    // Con sus propios tokens: dentro de la agenda ya los hereda de `.raiz`, pero así no depende de dónde se monte.
    <div className={`${CLASES_MENU} ${ag.tokensAgenda} ${s.aviso}`} role="status" data-agendando-del-plan>
      <span className={s.cabeceraIcono}><CalendarPlus size={17} strokeWidth={2} aria-hidden /></span>
      <span className={s.avisoTextos}>
        {extra ? (
          <>
            <span className={s.avisoTitulo}>
              {t("planTratamiento.citas.aviso.titulo", { paciente: datos?.plan?.paciente.nombre ?? "" })}
            </span>
            <span className={s.avisoDetalle}>
              {`${extra.delPlan?.resumen ?? ""} · ${t("planTratamiento.citas.minutos", { n: extra.initialDurationMin ?? 0 })} — ${t("planTratamiento.citas.aviso.ayuda")}`}
            </span>
          </>
        ) : (
          <span className={s.avisoDetalle}>{t("planTratamiento.citas.aviso.yaNoHay")}</span>
        )}
      </span>
      <span className={s.avisoBotones}>
        {extra && (
          <button type="button" className={s.botonPrincipal} onClick={() => abrirNuevaCita(extra)}>
            {t("planTratamiento.citas.aviso.elegirHora")}
          </button>
        )}
        <button type="button" className={s.botonSecundario} onClick={() => salir()}>
          {t("planTratamiento.citas.aviso.salir")}
        </button>
      </span>
    </div>
  );
  return { extra, aviso };
}
