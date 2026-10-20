/* ============================================================
   recuperar — leer el odontograma vivo del servidor (ws1-t11).

   Sin React, para poder ejecutarlo en las pruebas tal como lo usa la pantalla:
   - cargarOdontograma: lo que hace el odontograma vivo al abrir y al volver a
     la pestaña. Anota de qué sesión es la cola (la que pintó la página o, si
     no, la que devuelve el GET), lee sin pintar lecturas que cruzaron una
     escritura ya confirmada y, sin red, devuelve el mensaje en español y lo
     pendiente pintado.
   - quitarDelDibujo: lo que el servidor descartó (o el doctor tiró) se quita
     del dibujo aunque la relectura falle.

   Revisión t8, tercera vuelta (decisión del gerente): ya NO hay copia en el
   navegador entre sesiones ni nada que «recuperar» al reabrir; lo que no se
   guardó mientras la pestaña estuvo abierta, con el aviso a la vista, se
   pierde al cerrarla.
   ============================================================ */
import type { SaveOp, SaveQueue, SessionInfo } from "./autosave";
import type { OdontogramRead } from "./adapter";
import type { Records, ToothRecord } from "./types";

export type Sesion = SessionInfo;

export interface ResultadoCarga {
  records: Records | null;
  /** mensaje en español si no se pudo leer (sin red, sesión vencida…) */
  error: string | null;
}

export async function cargarOdontograma(args: {
  patientId: string;
  queue: SaveQueue | null;
  sesion: Sesion | null;
  leer: (patientId: string) => Promise<OdontogramRead>;
  force: boolean;
}): Promise<ResultadoCarga> {
  const { patientId, queue, sesion, leer, force } = args;
  if (queue && sesion) queue.setOwner(sesion);
  try {
    for (let i = 0; i < 4; i++) {
      const v = queue?.getVersion();
      const r = await leer(patientId);
      if (!queue) return { records: r.records, error: null };
      if (r.clinicId && r.userId) queue.setOwner({ clinicId: r.clinicId, userId: r.userId });
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

/** Deshace en el dibujo lo que no se guardó (lo que el servidor descartó o el doctor tiró). */
export function quitarDelDibujo(records: Records, ops: SaveOp[]): Records {
  if (!ops.length) return records;
  const out: Records = JSON.parse(JSON.stringify(records));
  for (const op of ops) {
    if (op.kind === "reset" || op.kind === "note") continue; // sin «antes» que reponer: lo dirá la relectura
    const r: ToothRecord | undefined = out[op.toothNumber];
    if (op.kind === "put") {
      if (!r) continue;
      const arr = op.surface ? r.surfaces[op.surface] : r.tooth;
      const i = arr ? arr.indexOf(op.conditionId) : -1;
      if (arr && i >= 0) arr.splice(i, 1);
      if (op.surface && arr && !arr.length) delete r.surfaces[op.surface];
    } else {
      const rec = (out[op.toothNumber] ??= { surfaces: {}, tooth: [] });
      const arr = op.surface ? (rec.surfaces[op.surface] ??= []) : rec.tooth;
      if (!arr.includes(op.conditionId)) arr.push(op.conditionId);
    }
  }
  return out;
}
