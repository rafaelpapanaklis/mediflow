"use client";

// «¿En qué cita se hizo?» — v17 (decisión 1 de Rafael, 28-oct-2026). Sale en la tarjeta del plan al pulsar
// «Hecho»: las citas recientes del paciente (GET /api/treatments/[id]/citas-para-hecho), la de HOY primero
// y ya elegida. «Se hizo sin cita» pide un motivo corto y obligatorio. Si la cita elegida no tiene nota
// clínica, AVISA y ofrece marcar y escribirla; nunca impide marcar. Si las citas no se pueden leer, se
// puede marcar sin cita.
//
// v18 (t5 de la v17, m2): «Marcar y escribir la nota» lleva la cita elegida a «Nueva consulta» y la nota se
// LIGA a ella (aunque sea de otro día u otro doctor), así el aviso se quita al guardarla. Si esa cita no
// admite la nota de quien marca (`notaLigable`: la cita de hoy de otro doctor, aún sin terminar), el aviso
// dice que la escribe su doctor y no hay botón.

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useLocale, useT } from "@/i18n/i18n-provider";
import { formatoEnZona } from "@/lib/fechas/fecha-en-zona";
import { useZonaDeLaClinica } from "@/lib/fechas/use-zona-de-la-clinica";
import { limpiarMotivoSinCita, MAX_MOTIVO_SIN_CITA, type CitaElegidaParaLaNota, type CitaParaHecho, type EleccionDeCita } from "@/lib/treatments/cita-del-hecho";
import s from "./expediente.module.css";

const SIN_CITA = "__sin_cita__";

export function ElegirCitaDelHecho({ planId, filaId, nombre, enviando, onElegir, onVolver, puedeEscribirNota }: {
  planId: string;
  filaId: string;
  /** «Resina 16 (MO)». */
  nombre: string;
  enviando: boolean;
  /** `escribirNota`: después de marcar, abrir la nota LIGADA a la cita (la cita no tenía). v19: viaja la cita con su fecha. */
  onElegir: (eleccion: EleccionDeCita, opciones: { escribirNota: boolean; cita?: CitaElegidaParaLaNota }) => void;
  onVolver: () => void;
  /** Quien marca puede escribir notas (la ficha sabe a dónde llevarlo). */
  puedeEscribirNota: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const zona = useZonaDeLaClinica();
  const [citas, setCitas] = useState<CitaParaHecho[] | null>(null);
  const [error, setError] = useState(false);
  const [elegida, setElegida] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");

  useEffect(() => {
    let vivo = true;
    setCitas(null);
    setError(false);
    fetch(`/api/treatments/${encodeURIComponent(planId)}/citas-para-hecho`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { citas?: CitaParaHecho[] }) => {
        if (!vivo) return;
        const lista = Array.isArray(d?.citas) ? d.citas : [];
        setCitas(lista);
        // La de hoy, ya elegida; sin citas, «Se hizo sin cita».
        setElegida(lista[0]?.esHoy ? lista[0].id : lista.length === 0 ? SIN_CITA : null);
      })
      .catch(() => {
        if (!vivo) return;
        setError(true);
        setCitas([]);
        setElegida(SIN_CITA);
      });
    return () => { vivo = false; };
  }, [planId]);

  const loc = locale === "en" ? "en-US" : "es-MX";
  const etiqueta = (c: CitaParaHecho) => {
    const hora = formatoEnZona(c.startsAt, { hour: "numeric", minute: "2-digit" }, zona, loc) ?? "";
    const dia = c.esHoy
      ? t("planTratamiento.hecho.cita.hoy", { hora })
      : formatoEnZona(c.startsAt, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }, zona, loc) ?? "";
    return { dia, detalle: [c.doctor, c.motivo].filter(Boolean).join(" · ") };
  };

  const cita = citas?.find((c) => c.id === elegida) ?? null;
  const motivoListo = limpiarMotivoSinCita(motivo);
  const lista = elegida === SIN_CITA ? !!motivoListo : !!cita;
  const eleccion = (): EleccionDeCita | null =>
    elegida === SIN_CITA ? (motivoListo ? { sinCita: true, motivo: motivoListo } : null) : cita ? { citaId: cita.id } : null;
  const elegir = (escribirNota: boolean) => {
    const e = eleccion();
    if (e && !enviando) onElegir(e, { escribirNota, ...(cita ? { cita: { id: cita.id, startsAt: cita.startsAt } } : {}) });
  };
  const grupo = `cita-hecho-${filaId}`;

  return (
    <div className={s.citaHecho} role="group" aria-labelledby={`${grupo}-titulo`} data-cita-hecho={filaId}>
      <p className={s.cuentaPlanCierreTitulo} id={`${grupo}-titulo`}>{t("planTratamiento.hecho.cita.titulo", { nombre })}</p>
      {citas === null && <p className={s.cuentaPlanAyuda}>{t("planTratamiento.hecho.cita.cargando")}</p>}
      {error && <p className={s.cuentaPlanAyuda} data-cita-hecho-error>{t("planTratamiento.hecho.cita.errorCarga")}</p>}
      {citas !== null && !error && citas.length === 0 && <p className={s.cuentaPlanAyuda}>{t("planTratamiento.hecho.cita.ninguna")}</p>}
      {citas !== null && (
        <fieldset className={s.citaHechoLista} aria-labelledby={`${grupo}-titulo`}>
          {citas.map((c) => {
            const { dia, detalle } = etiqueta(c);
            return (
              <label key={c.id} className={s.citaHechoOpcion} data-cita-opcion={c.id}>
                <input type="radio" name={grupo} checked={elegida === c.id} onChange={() => setElegida(c.id)} />
                <span>
                  {dia}
                  {!c.tieneNota && <span className={s.citaHechoSinNota} data-cita-sin-nota>{t("planTratamiento.hecho.cita.sinNota")}</span>}
                  {detalle && <small>{detalle}</small>}
                </span>
              </label>
            );
          })}
          <label className={s.citaHechoOpcion} data-cita-opcion="sin-cita">
            <input type="radio" name={grupo} checked={elegida === SIN_CITA} onChange={() => setElegida(SIN_CITA)} />
            <span>{t("planTratamiento.hecho.cita.sinCita")}</span>
          </label>
        </fieldset>
      )}
      {elegida === SIN_CITA && (
        <label className={s.cuentaPlanCierreCampo}>
          <span>{t("planTratamiento.hecho.cita.motivo")}</span>
          <textarea
            value={motivo}
            maxLength={MAX_MOTIVO_SIN_CITA}
            rows={2}
            placeholder={t("planTratamiento.hecho.cita.motivoPh")}
            onChange={(e) => setMotivo(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            data-cita-hecho-motivo
          />
        </label>
      )}
      {cita && !cita.tieneNota && (
        <p className={s.citaHechoAviso} role="status" data-cita-hecho-aviso>
          <AlertTriangle size={14} strokeWidth={1.75} aria-hidden />
          <span>
            {cita.notaLigable
              ? t("planTratamiento.hecho.cita.avisoSinNota")
              : t("planTratamiento.hecho.cita.avisoSinNotaDeOtro", { doctor: cita.doctor ?? t("planTratamiento.hecho.cita.suDoctor") })}
          </span>
          {puedeEscribirNota && cita.notaLigable && (
            <button type="button" className={`${s.boton} ${s.botonChico}`} onClick={() => elegir(true)} disabled={enviando} data-cita-hecho-escribir>
              {t("planTratamiento.hecho.cita.marcarYEscribir")}
            </button>
          )}
        </p>
      )}
      <div className={s.cuentaPlanAcciones}>
        <button type="button" className={`${s.boton} ${s.botonChico}`} onClick={onVolver} disabled={enviando}>
          {t("planTratamiento.hecho.cita.volver")}
        </button>
        <button type="button" className={`${s.boton} ${s.botonChico} ${s.botonPrincipal}`} onClick={() => elegir(false)} disabled={!lista || enviando} data-cita-hecho-confirmar>
          <CheckCircle2 size={13} strokeWidth={2} aria-hidden />
          {enviando ? t("planTratamiento.hecho.marcando") : t("planTratamiento.hecho.cita.confirmar")}
        </button>
      </div>
    </div>
  );
}
