/* ============================================================
   merge-consulta — el odontograma de «Nueva consulta» (modo controlado)
   frente al vivo del paciente.

   La consulta precarga el vivo y el doctor marca encima; «Guardar consulta»
   sincroniza REEMPLAZANDO el vivo (/api/odontogram/sync). Para no borrar
   nada de lo que no tocó —ni pisar lo que otra pestaña autoguardó en el
   vivo mientras tanto— lo que manda de cada diente tocado es su CAMBIO
   (cómo estaba al tocarlo → cómo lo dejó), aplicado sobre el vivo fresco.
   Es también lo que guarda el borrador de sesión (ws1-t11).
   ============================================================ */
import type { Records, ToothRecord } from "./types";

/** ¿El registro de un diente trae algo marcado? (superficies, hallazgos o nota) */
export function toothRecordHasContent(rec: ToothRecord | undefined): boolean {
  if (!rec) return false;
  if ((rec.tooth?.length ?? 0) > 0 || (rec.note ?? "").trim()) return true;
  return Object.values(rec.surfaces ?? {}).some(ids => ids.length > 0);
}

/**
 * Lo que el doctor cambió en un diente (de `base` a `now`) aplicado sobre
 * otro estado del mismo diente (`live`): suma lo que añadió, quita lo que
 * quitó y deja lo demás como venga. La nota manda la suya solo si la cambió.
 * Así, si otra pestaña tocó ese diente mientras tanto, no se pisa: se combina.
 */
export function applyToothDelta(live: ToothRecord | undefined, base: ToothRecord | undefined, now: ToothRecord | undefined): ToothRecord {
  const l = live ?? { surfaces: {}, tooth: [] };
  const b = base ?? { surfaces: {}, tooth: [] };
  const n = now ?? { surfaces: {}, tooth: [] };
  const merge = (lv: string[] = [], bv: string[] = [], nv: string[] = []) => {
    const added = nv.filter((id) => !bv.includes(id));
    const removed = bv.filter((id) => !nv.includes(id));
    return [...lv, ...added.filter((id) => !lv.includes(id))].filter((id) => !removed.includes(id));
  };
  const surfaces: Record<string, string[]> = {};
  const letters = new Set([...Object.keys(l.surfaces ?? {}), ...Object.keys(b.surfaces ?? {}), ...Object.keys(n.surfaces ?? {})]);
  letters.forEach((k) => {
    const ids = merge(l.surfaces?.[k], b.surfaces?.[k], n.surfaces?.[k]);
    if (ids.length) surfaces[k] = ids;
  });
  const out: ToothRecord = { surfaces, tooth: merge(l.tooth, b.tooth, n.tooth) };
  const note = (n.note ?? "") !== (b.note ?? "") ? n.note : l.note;
  if (note) out.note = note;
  return out;
}

/**
 * Mezcla la precarga del odontograma vivo con lo ya marcado localmente: los
 * dientes que el doctor TOCÓ en esta consulta (`bases`: cómo estaban cuando
 * los tocó por primera vez) llevan su cambio encima del vivo fresco; el resto
 * toma el estado vivo del paciente. Si quitó un hallazgo, no vuelve a aparecer
 * al llegar el vivo; si otra pestaña cambió ese diente, se combina.
 */
export function mergeLiveOdontogram(live: Records, local: Records, touched: boolean, bases?: ReadonlyMap<number, ToothRecord>): Records {
  if (!touched) return live;
  const merged: Records = { ...live };
  if (!bases) {
    for (const [fdi, rec] of Object.entries(local)) {
      if (toothRecordHasContent(rec)) merged[Number(fdi)] = rec;
    }
    return merged;
  }
  bases.forEach((base, fdi) => {
    const rec = applyToothDelta(live[fdi], base, local[fdi]);
    if (toothRecordHasContent(rec)) merged[fdi] = rec;
    else delete merged[fdi];
  });
  return merged;
}

/** Dientes cuyo registro cambió entre dos estados del odontograma. */
export function changedTeeth(prev: Records, next: Records): number[] {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)].map(Number));
  return [...keys].filter((fdi) => JSON.stringify(prev[fdi] ?? null) !== JSON.stringify(next[fdi] ?? null));
}
