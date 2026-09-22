"use client";

/**
 * LA SECCIÓN «BLOQUEOS» de Configuración → Horarios y bloqueos.
 *
 * Va DEBAJO del horario semanal, que no se toca: el horario semanal es la
 * jornada normal y funciona. Esto es lo otro — los días y las horas en que,
 * excepcionalmente, no se agenda.
 *
 * Una sola sección para los dos caminos de render de `settings-client.tsx` (el
 * de siempre y el del rediseño de ws1-t2, que se enciende con la bandera
 * `menu-dos-niveles`). Trae su propio CSS y no lee ni una clase de ninguno de
 * los dos: así no hay dos versiones de la misma pantalla que se separen con el
 * primer arreglo que se le haga a una.
 *
 * ── El doctor ───────────────────────────────────────────────────────────
 * Ve la pestaña, pero recortada: sin festivos (eso cierra la clínica entera,
 * no es suyo) y sin el selector «¿A quién cierra?» — que NO está deshabilitado
 * ni reducido a una opción: no está. Su bloqueo sale siempre a su nombre.
 *
 * 🔴 Y esconder no es permitir: el servidor ya rechaza al doctor que intente
 * cerrar la clínica o tocar a otro. Esto es para que no vea una puerta que va
 * a darle 403, no para sustituir la cerradura.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useT, useLocale } from "@/i18n/i18n-provider";
import { FestivosCard } from "./festivos-card";
import { FormularioBloqueo, type DoctorOpcion } from "./formulario-bloqueo";
import { ListaBloqueos } from "./lista-bloqueos";
import { parseBloqueos, type BloqueoDTO } from "./tipos";
import { getTzParts } from "@/lib/agenda/time-utils";
import s from "./bloqueos.module.css";

/** Años hacia atrás y hacia delante que trae la lista. Cubre el selector de
 *  año de los festivos (año anterior, actual y siguiente) sin pedir más. */
const ANIOS_ATRAS = 1;
const ANIOS_ADELANTE = 1;

export function SeccionBloqueos({
  timezone,
  doctores,
  modoDoctor,
}: {
  /** La zona de la CLÍNICA. Todo lo que se pinta pasa por ella. */
  timezone: string;
  doctores: DoctorOpcion[];
  /** true = quien mira no es admin: sin festivos y sin selector de alcance. */
  modoDoctor: boolean;
}) {
  const t = useT();
  const locale = useLocale();

  const [bloqueos, setBloqueos] = useState<BloqueoDTO[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(false);
  const [version, setVersion] = useState(0);

  // Hoy EN LA ZONA DE LA CLÍNICA. De aquí salen el año de los festivos y el
  // corte entre pasado y futuro de la lista. Con `new Date().getFullYear()`
  // una clínica de Tijuana el 31 de diciembre a las 17:00 vería ya el año
  // siguiente, porque el proceso corre en UTC.
  const ahoraClinica = useMemo(() => {
    const p = getTzParts(new Date(), timezone);
    return {
      anio: p.year,
      mes: p.month,
      hoyISO: `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`,
    };
    // Se calcula una vez por montaje: la pantalla de Configuración no vive
    // abierta de un año para otro, y recalcularlo en cada render sería un
    // `new Date()` por tecla del formulario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timezone]);

  const recargar = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    setError(false);
    const desde = `${ahoraClinica.anio - ANIOS_ATRAS}-01-01`;
    const hasta = `${ahoraClinica.anio + ANIOS_ADELANTE}-12-31`;
    (async () => {
      try {
        const res = await fetch(
          `/api/settings/bloqueos?desde=${desde}&hasta=${hasta}`,
        );
        if (!res.ok) throw new Error();
        const datos = await res.json();
        if (!vivo) return;
        setBloqueos(parseBloqueos(datos));
      } catch {
        // Sin lista no se rompe la pestaña: el horario semanal de arriba
        // sigue funcionando y el formulario sigue pudiendo crear.
        if (vivo) {
          setBloqueos([]);
          setError(true);
        }
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [version, ahoraClinica.anio]);

  // Por `holidayKey`: de aquí saca la tarjeta de festivos el id con el que
  // retirar uno ya aplicado, y su `puedoRetirarlo`.
  const bloqueoPorFestivo = useMemo(() => {
    const mapa = new Map<string, BloqueoDTO>();
    for (const b of bloqueos) if (b.holidayKey) mapa.set(b.holidayKey, b);
    return mapa;
  }, [bloqueos]);

  return (
    <section className={s.seccion} aria-labelledby="bloqueos-titulo">
      <div className={s.seccionCabecera}>
        <h2 className={s.seccionTitulo} id="bloqueos-titulo">
          {t("settings.bloqueos.titulo")}
        </h2>
        <p className={s.seccionSub}>{t("settings.bloqueos.sub")}</p>
      </div>

      {/* Festivos: cierran la clínica ENTERA, así que no son del doctor. */}
      {!modoDoctor && (
        <FestivosCard
          anioActual={ahoraClinica.anio}
          mesActual={ahoraClinica.mes}
          locale={locale}
          bloqueoPorFestivo={bloqueoPorFestivo}
          onCambio={recargar}
        />
      )}

      <FormularioBloqueo
        timezone={timezone}
        locale={locale}
        doctores={doctores}
        modoDoctor={modoDoctor}
        onCreado={recargar}
      />

      {/* La lista la ve también el doctor: los suyos y los de toda la clínica,
          para que sepa que el 25 está cerrado. Qué puede retirar lo dice
          `puedoRetirarlo`, no esta pantalla. */}
      <ListaBloqueos
        bloqueos={bloqueos}
        timezone={timezone}
        locale={locale}
        hoyISO={ahoraClinica.hoyISO}
        cargando={cargando}
        error={error}
        onCambio={recargar}
      />
    </section>
  );
}
