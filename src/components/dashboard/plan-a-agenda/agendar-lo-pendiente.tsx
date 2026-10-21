"use client";

/**
 * «Agendar lo pendiente» (ws1-t1 · plan fase 2 · P8) — el botón del plan y su hoja.
 *
 * Se monta en la ventana del plan (`<AgendarLoPendiente planId={plan.id} />`) y se cuida solo:
 * pregunta a `GET /api/appointments/plan-pendiente` y, si falta el SQL, si quien mira no puede
 * agendar o si no queda nada pendiente, no pinta el botón (todo como hoy).
 *
 * La hoja lista lo pendiente del plan: lo que ya tiene cita sale marcado y no se elige. Al tocar
 * «Elegir hora en la agenda» se abre la AGENDA NORMAL con lo elegido (`?agendarPlan=&filas=`): el
 * clic en un hueco abre la Nueva cita de siempre con paciente, doctor, motivo y duración del
 * tarifario, y la cita es una cita normal (horario, comida, sobreagendar, doctor: las reglas de la
 * agenda, en el servidor). Con la agenda de siempre (sin el rediseño) se abre la Nueva cita aquí
 * mismo, con lo mismo.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, CalendarPlus, Check, X } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import { useNewAppointmentDialog } from "@/components/dashboard/new-appointment/new-appointment-provider";
import { formatoEnZona } from "@/lib/fechas/fecha-en-zona";
import { useZonaDeLaClinica } from "@/lib/fechas/use-zona-de-la-clinica";
import { MINUTOS_POR_DEFECTO } from "@/lib/treatments/citas-del-plan";
import {
  etiquetaDeFila,
  paramsDeNuevaCita,
  porAgendar,
  totalElegido,
  urlDeAgendaDelPlan,
  type DatosDePlanPendiente,
} from "./agendar-plan-datos";
import s from "./agendar-lo-pendiente.module.css";

export function AgendarLoPendiente({ planId, onAbrirAgenda }: {
  planId: string;
  /** Se llama justo antes de ir a la agenda (p. ej. para cerrar la ventana del plan). */
  onAbrirAgenda?: () => void;
}) {
  const t = useT();
  const [datos, setDatos] = useState<DatosDePlanPendiente | null>(null);
  const [abierta, setAbierta] = useState(false);

  useEffect(() => {
    let cancelado = false;
    fetch(`/api/appointments/plan-pendiente?planId=${encodeURIComponent(planId)}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: DatosDePlanPendiente | null) => { if (!cancelado) setDatos(b); })
      .catch(() => { if (!cancelado) setDatos(null); });
    return () => { cancelado = true; };
  }, [planId]);

  if (!datos?.disponible || !datos.puedeAgendar || datos.plan?.status !== "ACTIVE") return null;
  const libres = porAgendar(datos);
  const vivas = (datos.filas ?? []).filter((f) => f.agenda !== "no_aplica");
  if (vivas.length === 0) return null;
  if (libres.length === 0) {
    return (
      <span className={`${CLASES_MENU} ${s.listo}`} data-plan-todo-agendado>
        <CalendarCheck size={14} strokeWidth={2} aria-hidden /> {t("planTratamiento.citas.todoAgendado")}
      </span>
    );
  }

  return (
    <>
      <button type="button" className={`${CLASES_MENU} ${s.boton}`} onClick={() => setAbierta(true)} data-agendar-lo-pendiente>
        <CalendarPlus size={15} strokeWidth={2} aria-hidden />
        {t("planTratamiento.citas.botonConN", { n: libres.length })}
      </button>
      {abierta && <HojaAgendar datos={datos} onCerrar={() => setAbierta(false)} onAbrirAgenda={onAbrirAgenda} />}
    </>
  );
}

function HojaAgendar({ datos, onCerrar, onAbrirAgenda }: {
  datos: DatosDePlanPendiente;
  onCerrar: () => void;
  onAbrirAgenda?: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const zona = useZonaDeLaClinica();
  const { open: abrirNuevaCita, apariencia } = useNewAppointmentDialog();
  const filas = useMemo(() => (datos.filas ?? []).filter((f) => f.agenda !== "no_aplica"), [datos]);
  // De entrada, todo lo que se puede agendar (lo más común: «agendar lo pendiente»).
  const [elegidas, setElegidas] = useState<string[]>(() => porAgendar(datos).map((f) => f.id));
  const total = totalElegido(datos, elegidas);

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => { if (e.key === "Escape") onCerrar(); };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [onCerrar]);

  const alternar = useCallback((id: string) => {
    setElegidas((xs) => (xs.indexOf(id) === -1 ? [...xs, id] : xs.filter((x) => x !== id)));
  }, []);

  const elegirHora = () => {
    if (!datos.plan || elegidas.length === 0) return;
    onCerrar();
    if (apariencia === "nueva") {
      onAbrirAgenda?.();
      router.push(urlDeAgendaDelPlan(datos.plan.id, elegidas));
      return;
    }
    // Agenda de siempre: la Nueva cita de siempre, aquí mismo, y luego a la agenda con la cita.
    const p = paramsDeNuevaCita(datos, elegidas, t("planTratamiento.citas.prefijoMotivo"));
    if (p) abrirNuevaCita({ ...p, openAgendaAfter: true });
  };

  const fecha = (iso: string) =>
    formatoEnZona(iso, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }, zona) ?? "";

  return (
    <div className={`${CLASES_MENU} ${s.velo}`} onClick={onCerrar}>
      <div
        className={s.hoja}
        role="dialog"
        aria-modal="true"
        aria-labelledby="agendar-plan-titulo"
        onClick={(e) => e.stopPropagation()}
      >
        <header className={s.cabecera}>
          <span className={s.cabeceraIcono}><CalendarPlus size={17} strokeWidth={2} aria-hidden /></span>
          <div>
            <h3 id="agendar-plan-titulo" className={s.titulo}>{t("planTratamiento.citas.titulo")}</h3>
            <p className={s.intro}>{t("planTratamiento.citas.intro")}</p>
          </div>
          <button type="button" className={s.cerrar} onClick={onCerrar} aria-label={t("common.close")}>
            <X size={16} strokeWidth={2} aria-hidden />
          </button>
        </header>

        <ul className={s.lista}>
          {filas.map((f) => {
            const libre = f.agenda === "por_agendar";
            const marcada = libre && elegidas.indexOf(f.id) !== -1;
            const minutos = (f.minutos ?? MINUTOS_POR_DEFECTO) * (f.cantidad || 1);
            return (
              <li key={f.id}>
                <label className={`${s.casilla} ${marcada ? s.casillaElegida : ""} ${libre ? "" : s.casillaApagada}`}>
                  <input type="checkbox" checked={marcada} disabled={!libre} onChange={() => alternar(f.id)} />
                  <span className={s.casillaTextos}>
                    <span className={s.casillaNombre}>{etiquetaDeFila(f)}</span>
                    <span className={s.casillaDato}>
                      {f.minutos == null
                        ? t("planTratamiento.citas.sinDuracion", { n: minutos })
                        : t("planTratamiento.citas.minutos", { n: minutos })}
                    </span>
                    {/* Debajo del nombre y no a su lado: a 390 px el chip se comía el nombre. */}
                    {!libre && f.cita && (
                      <span className={s.etiquetaAgendada}>
                        <Check size={12} strokeWidth={2.4} aria-hidden /> {t("planTratamiento.citas.yaAgendada", { fecha: fecha(f.cita.startsAt) })}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        <footer className={s.pie}>
          <span className={s.total} aria-live="polite">
            {total.n === 0 ? (
              t("planTratamiento.citas.ninguno")
            ) : (
              <strong>
                {total.n === 1
                  ? t("planTratamiento.citas.totalUno", { min: total.minutos })
                  : t("planTratamiento.citas.total", { n: total.n, min: total.minutos })}
              </strong>
            )}
          </span>
          <span className={s.pieBotones}>
            <button type="button" className={s.botonSecundario} onClick={onCerrar}>{t("planTratamiento.citas.cancelar")}</button>
            <button type="button" className={s.botonPrincipal} disabled={total.n === 0} onClick={elegirHora} data-elegir-hora>
              <CalendarPlus size={15} strokeWidth={2} aria-hidden /> {t("planTratamiento.citas.elegirHora")}
            </button>
          </span>
        </footer>
      </div>
    </div>
  );
}
