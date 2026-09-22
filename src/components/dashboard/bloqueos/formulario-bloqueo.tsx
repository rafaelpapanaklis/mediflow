"use client";

/**
 * BLOQUEO PERSONALIZADO — el formulario corto.
 *
 * Tiene que servir para los dos casos reales, sin modo ni pestaña que elegir:
 *   «Del 24 de diciembre al 2 de enero — vacaciones» → un bloqueo, nueve días
 *   «El 12 de noviembre de 2 a 6 — congreso»          → un bloqueo, cuatro horas
 *
 * 🔴 EL AVISO SALE MIENTRAS SE ELIGEN LAS FECHAS, NO AL GUARDAR. En cuanto el
 * rango está completo se llama a `POST /api/settings/bloqueos/revision`, que
 * hace el mismo chequeo que el alta pero sin crear nada, y el botón de guardar
 * se queda deshabilitado con las citas en pantalla. Enterarse al pulsar
 * «Guardar» de que el día no se puede cerrar es enterarse tarde: ya se escribió
 * el motivo.
 *
 * El mismo 409 puede llegar igualmente al guardar, porque alguien pudo agendar
 * entre medias. Se trata igual y NO se pierde lo tecleado.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";
import { AvisoCitas } from "./aviso-citas";
import { esPosterior, fechaValida, rangoALaUtc, type RangoLocal } from "./fechas";
import {
  MAX_MOTIVO,
  TIPOS_BLOQUEO,
  parseConflicto,
  type ConflictoCitas,
  type TipoBloqueo,
} from "./tipos";
import s from "./bloqueos.module.css";

/** Retardo del rebote de `/revision`. Suficiente para no machacar el servidor
 *  mientras se teclea una fecha a mano, y corto para que el aviso no llegue
 *  después de que la mano ya esté en el motivo. */
const REBOTE_MS = 450;

export interface DoctorOpcion {
  id: string;
  nombre: string;
}

export function FormularioBloqueo({
  timezone,
  locale,
  doctores,
  modoDoctor,
  onCreado,
}: {
  timezone: string;
  locale: string;
  doctores: DoctorOpcion[];
  /**
   * El doctor NO elige a quién cierra: el selector no existe (no está
   * deshabilitado, ni con una sola opción — no está) y su bloqueo sale siempre
   * a su nombre, que es lo que hace el servidor con un doctor autenticado.
   */
  modoDoctor: boolean;
  onCreado: () => void;
}) {
  const t = useT();

  const [doctorId, setDoctorId] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [diaCompleto, setDiaCompleto] = useState(true);
  const [horaInicio, setHoraInicio] = useState("09:00");
  const [horaFin, setHoraFin] = useState("14:00");
  const [tipo, setTipo] = useState<TipoBloqueo>("VACACIONES");
  const [motivo, setMotivo] = useState("");

  const [conflicto, setConflicto] = useState<ConflictoCitas | null>(null);
  const [revisando, setRevisando] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const rango: RangoLocal = { desde, hasta, diaCompleto, horaInicio, horaFin };
  const utc = rangoALaUtc(rango, timezone);

  // Qué le pasa al rango, para decirlo en vez de dejar el botón muerto sin
  // explicación. `null` = el rango está bien (o todavía está vacío).
  const problemaRango =
    !desde || !fechaValida(desde)
      ? null
      : diaCompleto && hasta && fechaValida(hasta) && esPosterior(desde, hasta)
      ? t("settings.bloqueos.rangoInvalido")
      : !diaCompleto && utc === null
      ? t("settings.bloqueos.horasInvalidas")
      : null;

  const cuerpoRango = utc
    ? {
        doctorId: modoDoctor ? undefined : doctorId || null,
        inicio: utc.inicio,
        fin: utc.fin,
        diaCompleto,
      }
    : null;

  /* ── La revisión con rebote ──────────────────────────────────────────────
     Se dispara con el RANGO, no con el motivo ni con el tipo: escribir el
     motivo no tiene por qué costar una llamada por tecla. El `AbortController`
     evita que una respuesta lenta de un rango viejo pise el aviso del nuevo. */
  const clave = cuerpoRango ? JSON.stringify(cuerpoRango) : "";

  useEffect(() => {
    if (!clave) {
      setConflicto(null);
      setRevisando(false);
      return;
    }
    const ctrl = new AbortController();
    let vivo = true;
    setRevisando(true);
    const id = setTimeout(async () => {
      try {
        const res = await fetch("/api/settings/bloqueos/revision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: clave,
          signal: ctrl.signal,
        });
        const datos = await res.json().catch(() => null);
        if (!vivo) return;
        // Fail-OPEN a propósito: si la revisión no contesta (red, 500, o el
        // endpoint todavía no existe porque ws1-t2 no ha integrado), NO se
        // bloquea el formulario. El alta vuelve a comprobarlo en el servidor y
        // devuelve su 409; quien manda es esa, no esta.
        setConflicto(parseConflicto(datos));
      } catch {
        if (vivo) setConflicto(null);
      } finally {
        if (vivo) setRevisando(false);
      }
    }, REBOTE_MS);

    return () => {
      vivo = false;
      clearTimeout(id);
      ctrl.abort();
      // No se apaga `revisando` aquí: el efecto que entra lo vuelve a encender
      // de inmediato y apagarlo haría parpadear el rótulo en cada tecla.
    };
  }, [clave]);

  const limpiar = useCallback(() => {
    setDesde("");
    setHasta("");
    setDiaCompleto(true);
    setHoraInicio("09:00");
    setHoraFin("14:00");
    setMotivo("");
    setConflicto(null);
  }, []);

  const motivoLimpio = motivo.trim();
  // Lo que deshabilita el botón es el CHOQUE, no que la revisión esté en el
  // aire. Si la revisión se quedara colgada (red lenta, endpoint caído), un
  // `!revisando` aquí dejaría el único botón del formulario muerto para
  // siempre — y no protegería de nada: el alta vuelve a comprobarlo en el
  // servidor y su 409 se trata igual, con el mismo aviso y sin perder lo
  // tecleado.
  const puedeGuardar = !!cuerpoRango && !!motivoLimpio && !conflicto && !guardando;

  async function guardar() {
    if (!cuerpoRango) return;
    // El asterisco va en serio: el servidor rechaza el motivo vacío. Se dice
    // aquí para no gastar un viaje en enterarse.
    if (!motivoLimpio) {
      toast.error(t("settings.bloqueos.motivoFalta"));
      return;
    }
    setGuardando(true);
    try {
      const res = await fetch("/api/settings/bloqueos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...cuerpoRango, kind: tipo, reason: motivoLimpio.slice(0, MAX_MOTIVO) }),
      });
      if (res.ok) {
        toast.success(t("settings.bloqueos.creadoToast"));
        limpiar();
        onCreado();
        return;
      }
      const datos = await res.json().catch(() => null);
      const choque = parseConflicto(datos);
      if (res.status === 409 && choque) {
        // Alguien agendó entre la revisión y el guardar. Mismo aviso, y el
        // formulario se queda tal cual: no se pierde ni el motivo tecleado.
        setConflicto(choque);
        return;
      }
      toast.error(
        (datos && typeof datos.error === "string" && datos.error) ||
          t("settings.bloqueos.errorToast"),
      );
    } catch {
      toast.error(t("settings.bloqueos.errorToast"));
    } finally {
      setGuardando(false);
    }
  }

  const idMotivo = "bloqueo-motivo";
  const idAyuda = "bloqueo-motivo-ayuda";

  return (
    <div className={s.tarjeta}>
      <h3 className={s.tarjetaTitulo}>{t("settings.bloqueos.nuevoTitulo")}</h3>

      <div className={s.campos}>
        {/* ¿A quién cierra? — el doctor no lo ve. */}
        {!modoDoctor && (
          <label className={s.campo}>
            <span className={s.etiqueta}>{t("settings.bloqueos.aQuienCierra")}</span>
            <select
              className={s.control}
              value={doctorId}
              onChange={(e) => setDoctorId(e.target.value)}
            >
              <option value="">{t("settings.bloqueos.todaLaClinica")}</option>
              {doctores.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nombre}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className={s.campo}>
          <span className={s.etiqueta}>{t("settings.bloqueos.desde")}</span>
          <input
            type="date"
            className={s.control}
            value={desde}
            onChange={(e) => {
              const v = e.target.value;
              setDesde(v);
              // «Hasta» sigue a «Desde» mientras no se haya tocado o se quede
              // atrás: teclear una sola fecha es el caso común (un día suelto).
              setHasta((h) => (!h || (v && h < v) ? v : h));
            }}
          />
        </label>

        {diaCompleto && (
          <label className={s.campo}>
            <span className={s.etiqueta}>{t("settings.bloqueos.hasta")}</span>
            <input
              type="date"
              className={s.control}
              value={hasta}
              min={desde || undefined}
              onChange={(e) => setHasta(e.target.value)}
            />
          </label>
        )}

        <label className={`${s.campo} ${s.campoAncho}`}>
          <span className={s.casillaFila}>
            <input
              type="checkbox"
              className={s.casilla}
              checked={diaCompleto}
              onChange={(e) => setDiaCompleto(e.target.checked)}
            />
            <span className={s.etiqueta}>{t("settings.bloqueos.diaCompleto")}</span>
          </span>
        </label>

        {!diaCompleto && (
          <>
            <label className={s.campo}>
              <span className={s.etiqueta}>{t("settings.bloqueos.horaInicio")}</span>
              <input
                type="time"
                className={s.control}
                value={horaInicio}
                onChange={(e) => setHoraInicio(e.target.value)}
              />
            </label>
            <label className={s.campo}>
              <span className={s.etiqueta}>{t("settings.bloqueos.horaFin")}</span>
              <input
                type="time"
                className={s.control}
                value={horaFin}
                onChange={(e) => setHoraFin(e.target.value)}
              />
            </label>
          </>
        )}

        <label className={s.campo}>
          <span className={s.etiqueta}>{t("settings.bloqueos.tipo")}</span>
          <select
            className={s.control}
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoBloqueo)}
          >
            {TIPOS_BLOQUEO.map((k) => (
              <option key={k} value={k}>
                {t(`settings.bloqueos.tipo${k}`)}
              </option>
            ))}
          </select>
        </label>

        <div className={`${s.campo} ${s.campoAncho}`}>
          <label className={s.etiqueta} htmlFor={idMotivo}>
            {t("settings.bloqueos.motivo")} <span className={s.obligatorio}>*</span>
          </label>
          <input
            id={idMotivo}
            type="text"
            className={s.control}
            value={motivo}
            maxLength={MAX_MOTIVO}
            aria-describedby={idAyuda}
            onChange={(e) => setMotivo(e.target.value)}
          />
          <p className={s.ayuda} id={idAyuda}>
            {t("settings.bloqueos.motivoAyuda")}
          </p>
        </div>
      </div>

      {problemaRango && <p className={s.error}>{problemaRango}</p>}

      {revisando && !conflicto && (
        <p className={s.revisando}>{t("settings.bloqueos.revisando")}</p>
      )}

      {conflicto && <AvisoCitas conflicto={conflicto} timezone={timezone} locale={locale} />}

      <div className={s.acciones}>
        <button type="button" className={s.botonPrincipal} disabled={!puedeGuardar} onClick={guardar}>
          {guardando ? t("settings.bloqueos.guardando") : t("settings.bloqueos.guardar")}
        </button>
      </div>
    </div>
  );
}
