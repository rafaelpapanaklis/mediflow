"use client";

/**
 * LOS BLOQUEOS DE UN DÍA SUELTO, para las ventanas que no viven en la agenda.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 POR QUÉ ESTO EXISTE SI YA ESTÁ `useBloqueosAgenda`
 *
 * Aquél lee los del rango que la agenda YA tiene cargado, sin pedir nada, y es
 * lo que hay que usar siempre que se pueda (el arrastre, las tres vistas).
 *
 * Pero dos de los caminos por los que se agenda NO están atados a ese rango:
 *   · la ventana de reagendar se abre también desde el expediente del
 *     paciente, que no monta `AgendaProvider`, y deja elegir CUALQUIER fecha;
 *   · `/dashboard/appointments` tiene su propio estado y su propio calendario.
 * En los dos, el día elegido puede caer fuera de lo que la agenda cargó —o no
 * haber agenda cargada en absoluto—, y preguntar por el rango de la pantalla
 * daría «no hay bloqueo» en un día que sí lo tiene. Eso es peor que no
 * preguntar: promete que el día está libre.
 *
 * Se pide a `/api/settings/bloqueos`, que es la consulta MÁS BARATA de las
 * dos (una tabla, un rango, sin citas ni doctores ni unidades) y que solo
 * exige `agenda.view`: quien ve la rejilla tiene que poder leer por qué un
 * hueco está cerrado.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Degrada a lista vacía ante cualquier fallo —red, 403, tabla sin crear— y
 * entonces la pantalla se comporta EXACTAMENTE como antes de WS1-T3: se
 * guarda y el servidor avisa con su toast. Un aviso que no se pudo calcular
 * nunca puede impedir agendar.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { tzLocalToUtc } from "@/lib/agenda/time-utils";
import { sumarDiasISO } from "@/lib/agenda-bloqueos/core";
import { parseBloqueos, type BloqueoDTO } from "./tipos";

const VACIO: BloqueoDTO[] = [];

/**
 * ⛔ AQUÍ NO HAY CACHÉ, Y ES A PROPÓSITO.
 *
 * La primera versión guardaba las respuestas 30 s en un `Map` de módulo. Dos
 * razones para quitarlo, las dos de las que no se recupera uno:
 *
 *  · La clave era el día y la zona. El `Map` vive en el módulo, que sobrevive
 *    a cambiar de clínica activa sin recargar: una administradora con dos
 *    clínicas podía ver, en la segunda, el motivo del bloqueo de la primera.
 *    Un motivo puede ser «operación de rodilla».
 *  · Retirar un bloqueo desde Configuración dejaba esta ventana preguntando
 *    por un cierre que ya no existe, o callando ante uno recién creado.
 *
 * Lo que se ahorraba era una consulta por apertura de ventana, sobre una
 * tabla pequeña y con un rango de un día. No compensa.
 */

/**
 * Los bloqueos que solapan el día `dayISO` (calendario de la CLÍNICA).
 *
 * `activo` en `false` (la ventana cerrada) no pide nada: un modal montado y
 * oculto no puede estar consultando en segundo plano.
 */
export function useBloqueosDeDia(
  dayISO: string | null,
  timezone: string,
  activo: boolean,
): BloqueoDTO[] {
  const [bloqueos, setBloqueos] = useState<BloqueoDTO[]>(VACIO);
  // El día que se está pidiendo, para descartar la respuesta de una consulta
  // que ya no interesa: quien cambia de fecha dos veces rápido no puede
  // quedarse con el aviso de la primera.
  const pedidoRef = useRef<string | null>(null);

  const rango = useMemo(() => {
    if (!dayISO || !timezone) return null;
    const desde = tzLocalToUtc(dayISO, 0, 0, timezone);
    // Semiabierto `[inicio, fin)`, igual que todo lo demás de bloqueos: el
    // corte es la medianoche del día SIGUIENTE, o el último tramo del día se
    // quedaría fuera.
    const hasta = tzLocalToUtc(sumarDiasISO(dayISO, 1), 0, 0, timezone);
    if (Number.isNaN(desde.getTime()) || Number.isNaN(hasta.getTime())) return null;
    return { desde: desde.toISOString(), hasta: hasta.toISOString() };
  }, [dayISO, timezone]);

  useEffect(() => {
    if (!activo || !dayISO || !rango) {
      setBloqueos(VACIO);
      return;
    }

    const clave = `${dayISO}|${timezone}`;
    pedidoRef.current = clave;

    const ctrl = new AbortController();
    const url = `/api/settings/bloqueos?desde=${encodeURIComponent(
      rango.desde,
    )}&hasta=${encodeURIComponent(rango.hasta)}`;

    fetch(url, { credentials: "include", signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((cuerpo) => {
        // `parseBloqueos` descarta las filas que no se entienden en vez de
        // lanzar: un campo raro no puede tumbar la ventana de agendar.
        const lista = cuerpo ? parseBloqueos(cuerpo) : [];
        const util = lista.length > 0 ? lista : VACIO;
        if (pedidoRef.current === clave) setBloqueos(util);
      })
      .catch(() => {
        // Abortada o caída: se deja lo que hubiera. Ver la cabecera — el
        // aviso es una cortesía, nunca un obstáculo.
      });

    return () => ctrl.abort();
  }, [activo, dayISO, timezone, rango]);

  return bloqueos;
}
