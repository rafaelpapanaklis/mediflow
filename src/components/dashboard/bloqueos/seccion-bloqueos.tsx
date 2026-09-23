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
import { PoliticaCard } from "./politica-card";
import { mensajeDeError, parseBloqueos, type BloqueoDTO } from "./tipos";
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
  miDoctorId = null,
}: {
  /** La zona de la CLÍNICA. Todo lo que se pinta pasa por ella. */
  timezone: string;
  doctores: DoctorOpcion[];
  /** true = quien mira no es admin: sin festivos y sin selector de alcance. */
  modoDoctor: boolean;
  /**
   * El id de quien mira, SOLO si su rol es DOCTOR. Cualquier otro rol: `null`.
   *
   * 🔴 No se deduce de `modoDoctor`: ese es «no es admin», que también cubre a
   * recepción con el permiso `agenda.bloqueos` concedido a mano. A recepción
   * el servidor SÍ le acepta cerrar la clínica entera (`esAdministrativo`), y
   * mandarle su propio id le colgaría el bloqueo como si fuera un doctor.
   */
  miDoctorId?: string | null;
}) {
  const t = useT();
  const locale = useLocale();

  const [bloqueos, setBloqueos] = useState<BloqueoDTO[]>([]);
  const [cargando, setCargando] = useState(true);
  // La FRASE del fallo, no un booleano: si el servidor explica qué pasa
  // («falta aplicar sql/agenda-bloqueos.sql»), eso es lo que se enseña.
  const [error, setError] = useState<string | null>(null);
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

  /**
   * LA VENTANA DE LA SECCIÓN, en un solo sitio.
   *
   * La consulta de la lista y los bordes del calendario del formulario son la
   * MISMA ventana a propósito: un bloqueo creado fuera de ella se guardaría y
   * después no saldría en «Bloqueos activos», y nadie entendería por qué.
   */
  const ventana = useMemo(
    () => ({
      desde: `${ahoraClinica.anio - ANIOS_ATRAS}-01-01`,
      hasta: `${ahoraClinica.anio + ANIOS_ADELANTE}-12-31`,
    }),
    [ahoraClinica.anio],
  );

  const recargar = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/settings/bloqueos?desde=${ventana.desde}&hasta=${ventana.hasta}`,
        );
        const datos = await res.json().catch(() => null);
        if (!vivo) return;
        if (!res.ok) {
          // 🔴 La frase del servidor, nunca su código. Ver `mensajeDeError`.
          setBloqueos([]);
          setError(mensajeDeError(datos, t("settings.bloqueos.listaError")));
          return;
        }
        setBloqueos(parseBloqueos(datos));
      } catch {
        // Sin lista no se rompe la pestaña: el horario semanal de arriba
        // sigue funcionando y el formulario sigue pudiendo crear.
        if (vivo) {
          setBloqueos([]);
          setError(t("settings.bloqueos.listaError"));
        }
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
    // `t` cambia de identidad en cada render del proveedor de idioma; meterlo
    // en las dependencias volvería a pedir la lista en cada uno.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, ventana.desde, ventana.hasta]);

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
        miDoctorId={miDoctorId}
        minDia={ventana.desde}
        maxDia={ventana.hasta}
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

      {/* «¿Recepción puede agendar sobre un día bloqueado?» — ajuste de la
          clínica, así que tampoco es del doctor. Va al final: es la regla de
          qué pasa con TODO lo de arriba. */}
      {!modoDoctor && <PoliticaCard />}
    </section>
  );
}
