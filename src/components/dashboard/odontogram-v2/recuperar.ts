/* ============================================================
   recuperar — lo que quedó sin guardar en este navegador y la carga del
   odontograma vivo (ws1-t11, revisión t8).

   - planRecovery: lo recuperado de una carga anterior NO se repite a ciegas
     (N-O2). Al pulsar «Guardar» se aplica diente por diente sobre lo que hay
     HOY en la base:
       · una marca puesta se añade si hoy no está;
       · una marca quitada se quita solo si nadie la volvió a tocar después
         (su `updatedAt` es anterior al cambio recuperado);
       · un «Limpiar todo» quita solo lo que ya existía cuando se hizo: lo que
         el equipo registró después se queda;
       · una nota se escribe si la de hoy es la misma que había cuando el
         doctor empezó a teclear (o no hay); si alguien la cambió después, se
         conservan las dos (la de hoy y, debajo, la recuperada con su fecha).
   - cargarOdontograma: lo que hace la pantalla al abrir (sin React, para
     poder ejecutarlo en las pruebas): engancha la copia del navegador con la
     sesión, lee del servidor sin pintar lecturas que cruzaron una escritura y,
     sin red, deja un mensaje en español y lo pendiente a la vista.
   ============================================================ */
import { opKey, bindBrowserCopy, type OpGuardada, type SaveOp, type SaveQueue, type KeyValueStore } from "./autosave";
import { fromServerSurface, type OdontogramRead } from "./adapter";
import type { Records } from "./types";

export interface PlanRecuperado {
  ops: SaveOp[];
  /** cambios recuperados que no se aplicaron porque alguien tocó eso después */
  omitidos: number;
}

/** Fecha y hora de un cambio, como se le enseña a la clínica. */
export function fechaRecuperado(at: number): string {
  try {
    return new Date(at).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return new Date(at).toISOString().slice(0, 16).replace("T", " ");
  }
}

export function planRecovery(recuperado: OpGuardada[], hoy: OdontogramRead): PlanRecuperado {
  // hoy, en letras de la pantalla, con cuándo se tocó por última vez cada cosa
  const presente = new Map<string, number>();
  const op = (toothNumber: number, surface: string | null, conditionId: string): SaveOp =>
    ({ kind: "put", toothNumber, surface, conditionId });
  for (const e of hoy.entries) {
    if (e.conditionId === "__note__") continue;
    const s = fromServerSurface(e.toothNumber, e.surface);
    presente.set(opKey(op(e.toothNumber, s, e.conditionId)), e.updatedAt ? Date.parse(e.updatedAt) || 0 : 0);
  }
  const notas = new Map<number, { text: string; t: number }>();
  for (const [fdi, rec] of Object.entries(hoy.records)) {
    if (rec.note) notas.set(Number(fdi), { text: rec.note, t: Date.parse(hoy.noteTimes[Number(fdi)] ?? "") || 0 });
  }
  const inicial = new Map(presente);
  const notasIniciales = new Map([...notas].map(([k, v]) => [k, v.text]));
  const detalle = new Map<string, SaveOp>(); // opKey → la forma de la marca, para rehacer el put/delete
  let omitidos = 0;

  for (const { op: o, at } of [...recuperado].sort((a, b) => a.at - b.at)) {
    if (o.kind === "reset") {
      let quedan = 0;
      for (const [k, t] of [...presente]) { if (t <= at) presente.delete(k); else quedan++; }
      for (const [n, v] of [...notas]) { if (v.t <= at) notas.delete(n); else quedan++; }
      if (quedan) omitidos++;
      continue;
    }
    if (o.kind === "note") {
      const hoyNota = notas.get(o.toothNumber)?.text ?? "";
      if (hoyNota === o.text) continue;
      if (hoyNota === "" || hoyNota === (o.prev ?? "")) {
        if (o.text) notas.set(o.toothNumber, { text: o.text, t: at }); else notas.delete(o.toothNumber);
      } else if (o.text) {
        // alguien la cambió después: no se pisa, se conservan las dos
        notas.set(o.toothNumber, { text: `${hoyNota}\n\n[Recuperado del ${fechaRecuperado(at)}] ${o.text}`, t: at });
        omitidos++;
      } else {
        omitidos++; // borrar una nota que otro cambió después: no
      }
      continue;
    }
    const k = opKey(o);
    detalle.set(k, o);
    if (o.kind === "put") {
      if (!presente.has(k)) presente.set(k, at);
    } else {
      const t = presente.get(k);
      if (t === undefined) continue;
      if (t <= at) presente.delete(k); else omitidos++;
    }
  }

  const ops: SaveOp[] = [];
  for (const k of inicial.keys()) {
    if (!presente.has(k) && detalle.has(k)) {
      const d = detalle.get(k) as { toothNumber: number; surface: string | null; conditionId: string };
      ops.push({ kind: "delete", toothNumber: d.toothNumber, surface: d.surface, conditionId: d.conditionId });
    } else if (!presente.has(k)) {
      // quitada por un «Limpiar todo» recuperado: se rehace desde la clave
      const [, n, s, c] = k.split(":");
      ops.push({ kind: "delete", toothNumber: Number(n), surface: s === "-" ? null : s, conditionId: c });
    }
  }
  for (const k of presente.keys()) {
    if (inicial.has(k)) continue;
    const d = detalle.get(k) as { toothNumber: number; surface: string | null; conditionId: string };
    ops.push({ kind: "put", toothNumber: d.toothNumber, surface: d.surface, conditionId: d.conditionId });
  }
  const dientesNota = new Set([...notasIniciales.keys(), ...notas.keys()]);
  for (const n of dientesNota) {
    const antes = notasIniciales.get(n) ?? "", despues = notas.get(n)?.text ?? "";
    if (antes !== despues) ops.push({ kind: "note", toothNumber: n, text: despues });
  }
  return { ops, omitidos };
}

/** «Guardar» lo recuperado: lee lo de HOY, decide qué aplicar y lo encola. */
export async function aplicarRecuperado(
  queue: SaveQueue, leer: () => Promise<OdontogramRead>,
): Promise<PlanRecuperado> {
  const hoy = await leer();
  const plan = planRecovery(queue.getRecovered(), hoy);
  queue.applyRecovered(plan.ops);
  return plan;
}

export interface Sesion { clinicId: string; userId: string }

export interface ResultadoCarga {
  records: Records | null;
  /** mensaje en español si no se pudo leer (sin red, sesión vencida…) */
  error: string | null;
}

/**
 * Lo que hace el odontograma vivo al abrir:
 *  1. con la sesión que manda la página (servidor), engancha la copia del
 *     navegador ANTES de leer: aunque no haya red, lo que se marque queda
 *     guardado con la llave correcta (N-O3) y lo de una carga anterior de este
 *     usuario se ofrece «Guardar / Descartar» (N-O2);
 *  2. lee del servidor y repite si la cola confirmó algo mientras tanto (una
 *     lectura vieja haría «desaparecer» una marca); sin sesión de la página,
 *     engancha con la clínica y el usuario que devuelve el GET (los de la
 *     sesión, nunca los de otra persona);
 *  3. si falla (sin red…), devuelve el mensaje en español del adaptador y lo
 *     pendiente pintado sobre un odontograma vacío.
 */
export async function cargarOdontograma(args: {
  patientId: string;
  queue: SaveQueue | null;
  sesion: Sesion | null;
  store: KeyValueStore | null;
  leer: (patientId: string) => Promise<OdontogramRead>;
  force: boolean;
  tabId?: string;
}): Promise<ResultadoCarga> {
  const { patientId, queue, sesion, store, leer, force, tabId } = args;
  if (queue && sesion) bindBrowserCopy(queue, store, sesion, patientId, tabId);
  try {
    for (let i = 0; i < 4; i++) {
      const v = queue?.getVersion();
      const r = await leer(patientId);
      if (!queue) return { records: r.records, error: null };
      if (!sesion && r.clinicId && r.userId) {
        bindBrowserCopy(queue, store, { clinicId: r.clinicId, userId: r.userId }, patientId, tabId);
        if (queue.getVersion() !== v) continue;
      }
      if (queue.getVersion() === v || (force && i === 3)) return { records: queue.overlay(r.records), error: null };
    }
    return { records: null, error: null };
  } catch (e) {
    return {
      records: queue ? queue.overlay({}) : null,
      error: e instanceof Error && e.message ? e.message : "No se pudo cargar el odontograma.",
    };
  }
}
