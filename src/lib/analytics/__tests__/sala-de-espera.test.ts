/**
 * Sala de espera sin alertas falsas (ws1-t2, auditoría de uso del 3/4-oct-2026,
 * C-27; t8 F-08, t9 F33).
 *
 * Run: npm run test:sala-de-espera
 *
 * La auditoría vio «5 pacientes esperando >20 min» con «1956m»: citas de días
 * anteriores que se quedaron en «Llegó». La consulta no tenía límite de fecha,
 * el tiempo salía en minutos crudos y la pantalla decía «threshold», «Hover» y
 * «1 no-shows». Con el código viejo falla: `sala-de-espera.ts` no existía, la
 * ruta filtraba solo `arrivedAt <= hace 20 min` y la lista pintaba «{min}m».
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { ESTADOS_QUE_NO_ESPERAN, duracionLegible, esperandoAhoraWhere } from "@/lib/analytics/sala-de-espera";
import { diaDeLaClinica } from "@/lib/agenda/citas-del-periodo";

const leer = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");
const TZ = "America/Mexico_City";
// 3-oct-2026, 23:10 en la Ciudad de México.
const AHORA = new Date("2026-10-04T05:10:00Z");

interface Linea { arrivedAt: Date | null; inChairAt: Date | null; consultStartAt: Date | null; status: string; clinicId: string }

/** Evalúa el `where` contra filas en memoria (lo que haría la base). */
function cumple(w: ReturnType<typeof esperandoAhoraWhere>, l: Linea): boolean {
  const a = w.arrivedAt as { gte: Date; lte: Date };
  const cita = w.appointment as { clinicId: string; status: { notIn: string[] } };
  return (
    l.clinicId === cita.clinicId &&
    !cita.status.notIn.includes(l.status) &&
    l.arrivedAt !== null && l.arrivedAt >= a.gte && l.arrivedAt <= a.lte &&
    l.inChairAt === null && l.consultStartAt === null
  );
}

test("C-27: solo cuenta quien llegó HOY, espera más del umbral y su cita sigue abierta", () => {
  const hoy = diaDeLaClinica(TZ, AHORA);
  const w = esperandoAhoraWhere("cl", AHORA, hoy.desde, 20);
  const linea = (minAtras: number, status = "CHECKED_IN", clinicId = "cl"): Linea => ({
    arrivedAt: new Date(AHORA.getTime() - minAtras * 60_000), inChairAt: null, consultStartAt: null, status, clinicId,
  });
  assert.equal(cumple(w, linea(1956)), false, "llegó hace 32 h (otro día): no es una alerta de hoy");
  assert.equal(cumple(w, linea(30)), true, "llegó hoy hace 30 min");
  assert.equal(cumple(w, linea(10)), false, "lleva 10 min: no pasa del umbral");
  assert.equal(cumple(w, linea(30, "COMPLETED")), false, "la cita ya se cerró");
  assert.equal(cumple(w, linea(30, "CHECKED_IN", "otra")), false, "otra clínica");
  assert.deepEqual([...ESTADOS_QUE_NO_ESPERAN].sort(), ["CANCELLED", "CHECKED_OUT", "COMPLETED", "NO_SHOW"]);
  assert.equal(hoy.desde.toISOString(), "2026-10-03T06:00:00.000Z");
  assert.throws(() => esperandoAhoraWhere("", AHORA, hoy.desde, 20), /clinicId/);
});

test("C-27: una espera larga se dice en horas, no «1956m»", () => {
  assert.equal(duracionLegible(1956), "32 h");
  assert.equal(duracionLegible(45), "45 min");
  assert.equal(duracionLegible(125), "2 h 5 min");
  assert.equal(duracionLegible(120), "2 h");
  assert.equal(duracionLegible(-3), "0 min");
});

test("C-27: la ruta y las dos pantallas usan la regla y el formato nuevos", () => {
  const ruta = leer("src/app/api/analytics/waiting-room/route.ts");
  assert.equal((ruta.match(/esperandoAhoraWhere\(clinicId,/g) ?? []).length, 2, "lista y pastilla del topbar");
  assert.doesNotMatch(ruta, /\.getHours\(\)|\.getDay\(\)/, "hora y día en la zona de la clínica");
  for (const f of ["src/app/dashboard/analytics/waiting-room/waiting-room-client.tsx", "src/app/dashboard/analytics/waiting-room/waiting-room-rediseno.tsx"]) {
    const s = leer(f);
    assert.match(s, /duracionLegible\(w\.waitedMin\)/, f);
    assert.doesNotMatch(s, /\{w\.waitedMin\}m/, f);
  }
});

test("textos: sin «threshold» ni «Hover», y «1 inasistencia» en singular", () => {
  const es = JSON.parse(leer("src/i18n/dictionaries/es.json"));
  const en = JSON.parse(leer("src/i18n/dictionaries/en.json"));
  const sinVariables = (x: string) => x.replace(/\{[^}]+\}/g, "");
  assert.doesNotMatch(sinVariables(es.analytics.waitingRoom.heatmapCaption), /threshold|Hover/);
  assert.doesNotMatch(sinVariables(en.analytics.waitingRoom.heatmapCaption), /threshold/);
  assert.equal(es.analytics.noShows.worstHint.one, "{rate}% ({count} inasistencia)");
  assert.equal(en.analytics.noShows.worstHint.one, "{rate}% ({count} no-show)");
});
