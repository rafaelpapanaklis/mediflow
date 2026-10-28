"use client";

/**
 * «En esta cita: resina $700 (hecha) · Debe hoy $700» — v17 (decisión 2 de Rafael, 28-oct-2026). El bloque
 * del detalle de la cita (el panel que se abre a la derecha al pulsar la cita en la Agenda, la nueva y la de
 * siempre): los procedimientos del plan agendados para esa cita y/o hechos en ella, con su precio y estado, y
 * «Debe hoy» (la misma cifra de Pacientes y de la ficha). Lo lee GET /api/appointments/[id]/plan-de-la-cita.
 *
 * Lo ve todo el que ve la cita, doctor incluido. Si la cita no tiene nada del plan (o no se pudo leer), no sale.
 */

import { useEffect, useState } from "react";
import { useT } from "@/i18n/i18n-provider";
import { fmtMXNdec } from "@/lib/format";
import s from "./en-esta-cita.module.css";

interface FilaDeLaCita {
  id: string;
  nombre: string;
  importe: number;
  estado: string;
}

export function EnEstaCita({ appointmentId, clave, deSiempre = false }: {
  appointmentId: string;
  /** En el panel de la agenda de siempre (sus márgenes). */
  deSiempre?: boolean;
  /** Cambia cuando la cita cambia (estado, cobro): se relee. */
  clave?: unknown;
}) {
  const t = useT();
  const [datos, setDatos] = useState<{ cita: string; filas: FilaDeLaCita[]; debeHoy: number } | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/appointments/${encodeURIComponent(appointmentId)}/plan-de-la-cita`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { filas?: FilaDeLaCita[]; debeHoy?: unknown } | null) => {
        if (!vivo) return;
        const filas = Array.isArray(d?.filas) ? d.filas : [];
        setDatos(filas.length ? { cita: appointmentId, filas, debeHoy: Number(d?.debeHoy) || 0 } : null);
      })
      .catch(() => { if (vivo) setDatos(null); });
    return () => { vivo = false; };
  }, [appointmentId, clave]);

  // Lo de otra cita no se pinta mientras llega lo de esta.
  if (!datos || datos.cita !== appointmentId) return null;
  const estado = (e: string) =>
    e === "hecho" ? t("agenda.enEstaCita.hecho") : e === "en_curso" ? t("agenda.enEstaCita.enCurso") : t("agenda.enEstaCita.porHacer");
  return (
    <section className={`${s.enCita} ${deSiempre ? s.enCitaDeSiempre : ""}`} aria-label={t("agenda.enEstaCita.titulo")} data-en-esta-cita={appointmentId}>
      <div className={s.enCitaRotulo}>{t("agenda.enEstaCita.titulo")}</div>
      <ul className={s.enCitaLista}>
        {datos.filas.map((f) => (
          <li key={f.id} className={s.enCitaFila} data-fila-cita={f.id} data-estado={f.estado}>
            <span className={s.enCitaNombre}>{f.nombre}</span>
            <span className={s.enCitaImporte}>{fmtMXNdec(f.importe)}</span>
            <span className={`${s.enCitaEstado} ${f.estado === "hecho" ? s.enCitaHecho : ""}`}>({estado(f.estado)})</span>
          </li>
        ))}
      </ul>
      <div className={`${s.enCitaDebe} ${datos.debeHoy > 0.005 ? s.enCitaConDeuda : ""}`} data-debe-hoy={datos.debeHoy}>
        <span>{t("agenda.enEstaCita.debeHoy")}</span>
        <span>{fmtMXNdec(datos.debeHoy)}</span>
      </div>
    </section>
  );
}
