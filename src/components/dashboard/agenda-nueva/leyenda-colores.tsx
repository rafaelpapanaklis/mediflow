"use client";

/**
 * WS1-T5 (grupo Salamanca) — LA LEYENDA DE COLORES de Día y Semana.
 *
 * Solo con la bandera `agenda-flexible`; sin ella no se monta y la agenda se
 * ve como siempre. Cambia según «Colorear las citas por»:
 *  · Doctor        → los doctores visibles con su color.
 *  · Procedimiento → los procedimientos que de verdad aparecen en las citas
 *                    cargadas (no el catálogo entero) y, si alguna cita no
 *                    casa con ninguno, «Sin procedimiento: color del doctor».
 */

import { useMemo } from "react";
import { useAgenda } from "@/components/dashboard/agenda/agenda-provider";
import { citaContada } from "@/lib/agenda-nueva/estados";
import { cssDeColor, leyendaDeProcedimientos } from "@/lib/agenda/color-procedimiento";
import { useT } from "@/i18n/i18n-provider";
import { useAgendaNueva } from "./contexto-agenda-nueva";
import { useColoresDeCitas } from "./usar-agenda-flexible";
import s from "./agenda-nueva.module.css";

/** Más de esto no cabe en una línea: el resto va como «+N». */
const MAX_EN_LEYENDA = 12;

export function LeyendaColores() {
  const { state } = useAgenda();
  const { responsablesVisibles, citaVisible } = useAgendaNueva();
  const colores = useColoresDeCitas();
  const t = useT();

  const items = useMemo(() => {
    if (!colores?.indice) {
      return {
        titulo: t("agenda.flexible.leyenda.porDoctor"),
        lista: responsablesVisibles.map((r) => ({ clave: r.id, nombre: r.nombreCorto, color: r.color })),
        sinProcedimiento: false,
      };
    }
    const motivos = state.appointments
      .filter((a) => citaContada(a.status) && citaVisible(a.doctor?.id ?? null, a.resourceId))
      .map((a) => a.reason);
    const { procedimientos, haySinProcedimiento } = leyendaDeProcedimientos(motivos, colores.indice);
    return {
      titulo: t("agenda.flexible.leyenda.porProcedimiento"),
      lista: procedimientos.map((p) => ({ clave: p.id, nombre: p.nombre, color: cssDeColor(p.color) })),
      sinProcedimiento: haySinProcedimiento,
    };
  }, [colores, responsablesVisibles, state.appointments, citaVisible, t]);

  if (!state.agendaFlexible?.encendida) return null;
  if (items.lista.length === 0 && !items.sinProcedimiento) return null;

  const visibles = items.lista.slice(0, MAX_EN_LEYENDA);
  const resto = items.lista.length - visibles.length;

  return (
    <div className={s.leyendaColores} aria-label={items.titulo}>
      <span className={s.leyendaColoresTitulo}>{items.titulo}</span>
      {visibles.map((it) => (
        <span key={it.clave} className={s.leyendaColoresItem} title={it.nombre}>
          <span className={s.leyendaColoresPunto} style={{ background: it.color }} aria-hidden />
          {it.nombre}
        </span>
      ))}
      {resto > 0 && <span className={s.leyendaColoresItem}>+{resto}</span>}
      {items.sinProcedimiento && (
        <span className={s.leyendaColoresItem}>
          <span className={`${s.leyendaColoresPunto} ${s.leyendaColoresPuntoDoctor}`} aria-hidden />
          {t("agenda.flexible.leyenda.sinProcedimiento")}
        </span>
      )}
    </div>
  );
}
