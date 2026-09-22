"use client";

/**
 * BLOQUEO PERSONALIZADO — el formulario corto.
 *
 * Tiene que servir para los dos casos reales, sin modo ni pestaña que elegir:
 *   «Del 24 de diciembre al 2 de enero — vacaciones» → un bloqueo, nueve días
 *   «El 12 de noviembre de 2 a 6 — congreso»          → un bloqueo, cuatro horas
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 LO QUE VIAJA ES LO QUE SE TECLEÓ, NO INSTANTES UTC
 *
 * El cuerpo lo arma `cuerpoDeBloqueo` (fechas.ts) y lleva `desdeDia`,
 * `hastaDia` y, si no es día completo, `desdeHora`/`hastaHora`. La conversión
 * a instantes la hace el SERVIDOR con la zona de la CLÍNICA, que el navegador
 * no conoce. Esta pantalla convirtió a UTC en el navegador hasta ws1-t3 y era
 * doblemente malo: mandaba `inicio`/`fin` —que es el DTO de RESPUESTA, no el
 * cuerpo de PETICIÓN, así que el servidor contestaba `RANGO_REQUERIDO` y el
 * bloqueo no se creaba nunca— y encima usaba la zona del DISPOSITIVO.
 * ═══════════════════════════════════════════════════════════════════════
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

import { useCallback, useEffect, useState } from "react";
import { CalendarX2, Clock, Sun } from "lucide-react";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";
import { DateField } from "@/components/ui/date-field";
import { AvisoCitas } from "./aviso-citas";
import { cuerpoDeBloqueo, type RangoLocal } from "./fechas";
import {
  MAX_MOTIVO,
  TIPOS_BLOQUEO,
  mensajeDeError,
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
  miDoctorId,
  minDia,
  maxDia,
  onCreado,
}: {
  timezone: string;
  locale: string;
  doctores: DoctorOpcion[];
  /**
   * El doctor NO elige a quién cierra: el selector no existe (no está
   * deshabilitado, ni con una sola opción — no está) y su bloqueo sale siempre
   * a su nombre.
   */
  modoDoctor: boolean;
  /**
   * Su propio id, SOLO si quien mira es DOCTOR. Va en el cuerpo: el servidor
   * exige que un doctor diga a quién cierra y que sea él mismo. Ver
   * `alcanceDelBloqueo`.
   */
  miDoctorId: string | null;
  /** Los bordes del calendario: la MISMA ventana que la lista consulta. */
  minDia: string;
  maxDia: string;
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
  const cuerpoRango = cuerpoDeBloqueo(rango, { modoDoctor, miDoctorId, doctorElegido: doctorId });

  // Qué le pasa al rango, para decirlo en vez de dejar el botón muerto sin
  // explicación. `null` = el rango está bien (o todavía está vacío).
  const problemaRango =
    !desde || cuerpoRango
      ? null
      : diaCompleto
      ? t("settings.bloqueos.rangoInvalido")
      : t("settings.bloqueos.horasInvalidas");

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
        // Fail-OPEN a propósito: si la revisión no contesta (red, 500, o un
        // rango que ella rechaza), NO se bloquea el formulario. El alta vuelve
        // a comprobarlo en el servidor y devuelve su 409; quien manda es esa,
        // no esta. Y su error NO se pinta: es una comprobación de cortesía, y
        // un aviso rojo mientras se teclea una fecha a medias sería ruido.
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
      // 🔴 La FRASE del servidor, nunca su código. Ver `mensajeDeError`.
      toast.error(mensajeDeError(datos, t("settings.bloqueos.errorToast")));
    } catch {
      toast.error(t("settings.bloqueos.errorToast"));
    } finally {
      setGuardando(false);
    }
  }

  const idMotivo = "bloqueo-motivo";
  const idAyuda = "bloqueo-motivo-ayuda";
  const idDesde = "bloqueo-desde";
  const idHasta = "bloqueo-hasta";

  return (
    <div className={s.tarjeta}>
      <div className={s.tarjetaCabecera}>
        <span className={`${s.iconoCaja} ${s.iconoCajaMarca}`} aria-hidden>
          <CalendarX2 size={17} strokeWidth={2} />
        </span>
        <div className={s.tarjetaTextos}>
          <h3 className={s.tarjetaTitulo}>{t("settings.bloqueos.nuevoTitulo")}</h3>
          <p className={s.tarjetaSub}>{t("settings.bloqueos.nuevoSub")}</p>
        </div>
      </div>

      <div className={s.tarjetaCuerpo}>
        {/* ① A QUIÉN CIERRA — el doctor no lo ve: el suyo sale a su nombre. */}
        {!modoDoctor && (
          <fieldset className={s.bloque}>
            <legend className={s.bloqueTitulo}>{t("settings.bloqueos.aQuienCierra")}</legend>
            <select
              className={s.control}
              value={doctorId}
              onChange={(e) => setDoctorId(e.target.value)}
              aria-label={t("settings.bloqueos.aQuienCierra")}
            >
              <option value="">{t("settings.bloqueos.todaLaClinica")}</option>
              {doctores.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nombre}
                </option>
              ))}
            </select>
          </fieldset>
        )}

        {/* ② CUÁNDO — el interruptor primero, porque decide qué campos hay
            debajo, y los campos APARECEN donde el ojo ya está mirando. */}
        <fieldset className={s.bloque}>
          <legend className={s.bloqueTitulo}>{t("settings.bloqueos.cuandoTitulo")}</legend>

          <div className={s.segmentado} role="radiogroup" aria-label={t("settings.bloqueos.cuandoTitulo")}>
            <label className={s.segmento}>
              <input
                type="radio"
                name="bloqueo-duracion"
                className={s.segmentoRadio}
                checked={diaCompleto}
                onChange={() => setDiaCompleto(true)}
              />
              <span className={s.segmentoCara}>
                <Sun size={14} strokeWidth={2.2} aria-hidden />
                {t("settings.bloqueos.diaCompleto")}
              </span>
            </label>
            <label className={s.segmento}>
              <input
                type="radio"
                name="bloqueo-duracion"
                className={s.segmentoRadio}
                checked={!diaCompleto}
                onChange={() => setDiaCompleto(false)}
              />
              <span className={s.segmentoCara}>
                <Clock size={14} strokeWidth={2.2} aria-hidden />
                {t("settings.bloqueos.soloUnasHoras")}
              </span>
            </label>
          </div>

          <div className={s.parejaCampos}>
            <div className={s.campo}>
              <label className={s.etiqueta} htmlFor={idDesde}>
                {diaCompleto ? t("settings.bloqueos.desde") : t("settings.bloqueos.dia")}
              </label>
              <DateField
                id={idDesde}
                className={s.control}
                value={desde}
                min={minDia}
                max={maxDia}
                onChange={(e) => {
                  const v = e.target.value;
                  setDesde(v);
                  // «Hasta» sigue a «Desde» mientras no se haya tocado o se
                  // quede atrás: teclear una sola fecha es el caso común.
                  setHasta((h) => (!h || (v && h < v) ? v : h));
                }}
              />
            </div>

            {diaCompleto ? (
              <div className={s.campo}>
                <label className={s.etiqueta} htmlFor={idHasta}>
                  {t("settings.bloqueos.hasta")}
                </label>
                <DateField
                  id={idHasta}
                  className={s.control}
                  value={hasta}
                  min={desde || minDia}
                  max={maxDia}
                  onChange={(e) => setHasta(e.target.value)}
                />
                {/* «Hasta el 23» cubre el 23 entero. Decirlo evita el bloqueo
                    que acaba un día antes de lo que la persona creía. */}
                <p className={s.ayuda}>{t("settings.bloqueos.hastaAyuda")}</p>
              </div>
            ) : (
              <div className={s.dosHoras}>
                <div className={s.campo}>
                  <label className={s.etiqueta} htmlFor="bloqueo-hora-inicio">
                    {t("settings.bloqueos.horaInicio")}
                  </label>
                  <input
                    id="bloqueo-hora-inicio"
                    type="time"
                    className={s.control}
                    value={horaInicio}
                    onChange={(e) => setHoraInicio(e.target.value)}
                  />
                </div>
                <div className={s.campo}>
                  <label className={s.etiqueta} htmlFor="bloqueo-hora-fin">
                    {t("settings.bloqueos.horaFin")}
                  </label>
                  <input
                    id="bloqueo-hora-fin"
                    type="time"
                    className={s.control}
                    value={horaFin}
                    onChange={(e) => setHoraFin(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          {problemaRango && <p className={s.error}>{problemaRango}</p>}
        </fieldset>

        {/* ③ QUÉ ES Y POR QUÉ. */}
        <fieldset className={s.bloque}>
          <legend className={s.bloqueTitulo}>{t("settings.bloqueos.queEsTitulo")}</legend>

          <div className={s.campo}>
            <label className={s.etiqueta} htmlFor="bloqueo-tipo">
              {t("settings.bloqueos.tipo")}
            </label>
            <select
              id="bloqueo-tipo"
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
          </div>

          <div className={s.campo}>
            <label className={s.etiqueta} htmlFor={idMotivo}>
              {t("settings.bloqueos.motivo")} <span className={s.obligatorio}>*</span>
            </label>
            <input
              id={idMotivo}
              type="text"
              className={s.control}
              value={motivo}
              maxLength={MAX_MOTIVO}
              placeholder={t("settings.bloqueos.motivoEjemplo")}
              aria-describedby={idAyuda}
              onChange={(e) => setMotivo(e.target.value)}
            />
            <p className={s.ayuda} id={idAyuda}>
              {t("settings.bloqueos.motivoAyuda")}
            </p>
          </div>
        </fieldset>

        {revisando && !conflicto && (
          <p className={s.revisando}>{t("settings.bloqueos.revisando")}</p>
        )}

        {conflicto && <AvisoCitas conflicto={conflicto} timezone={timezone} locale={locale} />}
      </div>

      <div className={s.tarjetaPie}>
        <button type="button" className={s.botonPrincipal} disabled={!puedeGuardar} onClick={guardar}>
          {guardando ? t("settings.bloqueos.guardando") : t("settings.bloqueos.guardar")}
        </button>
      </div>
    </div>
  );
}
