"use client";

import { CalendarDays, XCircle } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { useT } from "@/i18n/i18n-provider";
import { RaizExpediente } from "./raiz";
import s from "./expediente.module.css";

/**
 * Citas del paciente, con el diseño nuevo. La MISMA tabla que el apartado
 * de siempre (patient-detail-client.tsx, `tab === "agenda"`): fecha, hora,
 * tipo, doctor, estado y «Cancelar» en las que aún se pueden cancelar; el
 * mismo «Agendar» arriba. Solo cambia la ropa.
 *
 * El estado se pinta con la etiqueta que manda el padre: el mapa de estados
 * (`APPT_STATUS_FULL`) sigue viviendo en patient-detail-client.tsx porque un
 * candado (`agenda-nueva/__tests__/estados.test.ts`) lo compara allí con el
 * del Resumen y el de la Agenda. Aquí no se duplica.
 */

export interface CitasProps {
  citas: any[];
  /** Etiqueta unificada del estado: texto ya traducido y tono (`etiquetaExito`…). */
  estado: (status: string) => { texto: string; tono: string };
  onAgendar: () => void;
  onCancelar: (cita: any) => void;
}

export function Citas({ citas, estado, onAgendar, onCancelar }: CitasProps) {
  const t = useT();

  return (
    <RaizExpediente>
      <section className={s.tarjeta}>
        <header className={s.tarjetaCabeza}>
          <span className={s.cabeceraIcono}>
            <CalendarDays size={16} strokeWidth={1.75} aria-hidden />
          </span>
          <h2 className={s.titulo}>{t("patients.agenda.title", { count: citas.length })}</h2>
          <div className={s.acciones}>
            <button type="button" className={s.enlace} onClick={onAgendar}>
              {t("patients.agenda.schedule")}
            </button>
          </div>
        </header>

        <div className={s.tablaCaja}>
          <table className={s.tabla}>
            <thead>
              <tr>
                <th>{t("common.date")}</th>
                <th>{t("patients.agenda.colTime")}</th>
                <th>{t("patients.agenda.colType")}</th>
                <th>{t("patients.agenda.colDoctor")}</th>
                <th>{t("common.status")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {citas.length === 0 ? (
                <tr><td colSpan={6} className={s.tablaVacia}>{t("patients.agenda.empty")}</td></tr>
              ) : citas.map((a) => {
                const e = estado(a.status);
                return (
                  <tr key={a.id}>
                    <td className={s.fuerte}>{formatDate(a.date)}</td>
                    <td className={s.suave}>{a.startTime}</td>
                    <td>{a.type}</td>
                    <td className={s.suave}>{a.doctor?.firstName} {a.doctor?.lastName}</td>
                    <td>
                      <span className={`${s.etiqueta} ${(s as Record<string, string>)[e.tono] ?? s.etiquetaNeutra}`}>{e.texto}</span>
                    </td>
                    <td className={s.derecha}>
                      {a.status !== "CANCELLED" && a.status !== "COMPLETED" && (
                        <button
                          type="button"
                          className={`${s.icono} ${s.iconoPeligro}`}
                          onClick={() => onCancelar(a)}
                          aria-label={t("patients.agenda.cancelAppt")}
                          title={t("patients.agenda.cancelAppt")}
                        >
                          <XCircle size={15} strokeWidth={1.75} aria-hidden />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </RaizExpediente>
  );
}
