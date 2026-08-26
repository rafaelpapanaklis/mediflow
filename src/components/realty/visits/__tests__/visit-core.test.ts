// ═══════════════════════════════════════════════════════════════════════
// Pruebas del núcleo PURO de Visitas y Llaves.
//
// Sin base de datos y sin red. Correr con:
//   npx tsx --test src/components/realty/visits/__tests__/visit-core.test.ts
//
// (No hay entrada en package.json a propósito: ese archivo lo tocan varias
// terminales de la ola a la vez y está FUERA de la allowlist de ésta.)
//
// Vive bajo components/ y no bajo src/lib/realty/__tests__/ por la misma
// razón que el módulo que prueba: es el territorio de esta terminal.
// ═══════════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import dict from "@/i18n/dictionaries/realty/visits.json";
import {
  REALTY_ROUTE_MAX_WAYPOINTS,
  REALTY_VISIT_BLOCK_MIN,
  addDaysISO,
  assignVisitLanes,
  buildMapsPlaceUrl,
  buildMapsRouteUrl,
  canVisitTransition,
  computeVisitGridBounds,
  daysBetween,
  formatVisitFeedback,
  haversineKm,
  isValidDateISO,
  isVisitMovable,
  labelToMinute,
  minuteToLabel,
  orderVisitsByProximity,
  parseVisitFeedback,
  realtyDateISO,
  realtyLocalToUtc,
  realtyMinuteOfDay,
  snapMinute,
  startOfWeekISO,
  visitMapQuery,
  weekDaysISO,
  weekdayOfISO,
  type RealtyVisitCardDTO,
} from "../visit-core";

// → raíz del repo desde src/components/realty/visits/__tests__/
const RAIZ = join(__dirname, "..", "..", "..", "..", "..");

function leer(rel: string): string {
  return readFileSync(join(RAIZ, rel), "utf8");
}

function visita(over: Partial<RealtyVisitCardDTO>): RealtyVisitCardDTO {
  return {
    id: "v1",
    propertyId: "p1",
    propertyTitle: "Casa",
    propertyAddress: null,
    propertyColonia: null,
    propertyCity: null,
    lat: null,
    lng: null,
    leadId: null,
    leadName: null,
    leadPhone: null,
    userId: null,
    userName: null,
    scheduledAt: "2026-08-25T17:00:00.000Z",
    status: "PROGRAMADA",
    outcome: null,
    note: null,
    ...over,
  };
}

// ── 1. Zona horaria ─────────────────────────────────────────────────────
//
// La columna es TIMESTAMP(3) SIN zona y la zona es un dato de NEGOCIO. En
// Vercel el proceso corre en UTC: si algo de esto se rompe, una visita de
// las 11:00 en Guadalajara se anuncia a las 17:00.

test("la hora local de la CUENTA se convierte a UTC, no la del servidor", () => {
  // México quitó el horario de verano en 2022: el centro es UTC-6 TODO el año.
  assert.equal(
    realtyLocalToUtc("2026-08-25", 11 * 60, "America/Mexico_City").toISOString(),
    "2026-08-25T17:00:00.000Z",
  );
  assert.equal(
    realtyLocalToUtc("2026-01-15", 11 * 60, "America/Mexico_City").toISOString(),
    "2026-01-15T17:00:00.000Z",
  );
  // Quintana Roo va una hora adelante y tampoco cambia.
  assert.equal(
    realtyLocalToUtc("2026-08-25", 11 * 60, "America/Cancun").toISOString(),
    "2026-08-25T16:00:00.000Z",
  );
});

test("la frontera norte SÍ cambia de horario y la segunda pasada lo agarra", () => {
  // Tijuana sigue el calendario de Estados Unidos: UTC-7 en verano, UTC-8 en
  // invierno. Sin la segunda pasada de convergencia, una de las dos falla.
  assert.equal(
    realtyLocalToUtc("2026-08-25", 11 * 60, "America/Tijuana").toISOString(),
    "2026-08-25T18:00:00.000Z",
  );
  assert.equal(
    realtyLocalToUtc("2026-01-15", 11 * 60, "America/Tijuana").toISOString(),
    "2026-01-15T19:00:00.000Z",
  );
});

test("la hora que NO existe (el salto de primavera) no revienta ni devuelve basura", () => {
  // El 8 de marzo de 2026 en Tijuana las 02:30 no existen: el reloj salta de
  // 2:00 a 3:00. Lo que NO puede pasar es un Invalid Date ni un bucle.
  const d = realtyLocalToUtc("2026-03-08", 150, "America/Tijuana");
  assert.ok(Number.isFinite(d.getTime()), "devolvió una fecha inválida");
  assert.equal(
    d.toISOString(),
    realtyLocalToUtc("2026-03-08", 150, "America/Tijuana").toISOString(),
    "no es determinista",
  );
});

test("ida y vuelta: fecha local → UTC → fecha local", () => {
  const zonas = ["America/Mexico_City", "America/Tijuana", "America/Cancun", "America/Monterrey"];
  const dias = ["2026-01-15", "2026-06-30", "2026-08-25", "2026-12-31"];
  const minutos = [0, 1, 7 * 60 + 45, 13 * 60, 23 * 60 + 59];
  for (let z = 0; z < zonas.length; z++) {
    for (let d = 0; d < dias.length; d++) {
      for (let m = 0; m < minutos.length; m++) {
        const utc = realtyLocalToUtc(dias[d], minutos[m], zonas[z]);
        assert.equal(realtyDateISO(utc, zonas[z]), dias[d], `día ${dias[d]} ${zonas[z]}`);
        assert.equal(
          realtyMinuteOfDay(utc, zonas[z]),
          minutos[m],
          `minuto ${minutos[m]} ${dias[d]} ${zonas[z]}`,
        );
      }
    }
  }
});

test("la medianoche es el minuto 0, no el 1440", () => {
  // Intl con hourCycle h23/h24 devuelve "24" para la medianoche en algunas
  // zonas. Sin la corrección, la primera visita del día se pintaba fuera de
  // la rejilla.
  const utc = realtyLocalToUtc("2026-08-25", 0, "America/Mexico_City");
  assert.equal(realtyMinuteOfDay(utc, "America/Mexico_City"), 0);
  assert.equal(realtyDateISO(utc, "America/Mexico_City"), "2026-08-25");
});

// ── 2. Calendario ───────────────────────────────────────────────────────

test("la aritmética de días cruza meses, años y bisiestos", () => {
  assert.equal(addDaysISO("2026-08-31", 1), "2026-09-01");
  assert.equal(addDaysISO("2026-01-01", -1), "2025-12-31");
  assert.equal(addDaysISO("2028-02-28", 1), "2028-02-29"); // 2028 sí es bisiesto
  assert.equal(addDaysISO("2026-02-28", 1), "2026-03-01"); // 2026 no
});

test("la semana laboral empieza en lunes, también si el ancla es domingo", () => {
  // 2026-08-25 es martes.
  assert.equal(weekdayOfISO("2026-08-25"), 2);
  assert.equal(startOfWeekISO("2026-08-25"), "2026-08-24");
  // El domingo pertenece a la semana que YA pasó, no a la que empieza.
  assert.equal(weekdayOfISO("2026-08-30"), 0);
  assert.equal(startOfWeekISO("2026-08-30"), "2026-08-24");
  const dias = weekDaysISO("2026-08-27");
  assert.equal(dias.length, 7);
  assert.equal(dias[0], "2026-08-24");
  assert.equal(dias[6], "2026-08-30");
});

test("una fecha imposible NO pasa la validación", () => {
  assert.equal(isValidDateISO("2026-02-31"), false, "31 de febrero");
  assert.equal(isValidDateISO("2026-13-01"), false, "mes 13");
  assert.equal(isValidDateISO("2026-8-25"), false, "sin cero a la izquierda");
  assert.equal(isValidDateISO("ayer"), false);
  assert.equal(isValidDateISO(null), false);
  assert.equal(isValidDateISO("2026-08-25"), true);
});

test("las horas van y vuelven de etiqueta a minuto", () => {
  assert.equal(minuteToLabel(0), "00:00");
  assert.equal(minuteToLabel(570), "09:30");
  assert.equal(labelToMinute("09:30"), 570);
  assert.equal(labelToMinute("24:00"), null);
  assert.equal(labelToMinute("9:5"), null);
  assert.equal(labelToMinute(""), null);
  assert.equal(snapMinute(608), 615); // el arrastre cae de 15 en 15
});

// ── 3. Estados ──────────────────────────────────────────────────────────

test("una visita cerrada no se arrastra ni resucita sola", () => {
  assert.equal(isVisitMovable("PROGRAMADA"), true);
  assert.equal(isVisitMovable("CONFIRMADA"), true);
  assert.equal(isVisitMovable("REALIZADA"), false);
  assert.equal(isVisitMovable("CANCELADA"), false);
  assert.equal(isVisitMovable("NO_ASISTIO"), false);

  assert.equal(canVisitTransition("PROGRAMADA", "CONFIRMADA"), true);
  assert.equal(canVisitTransition("CANCELADA", "PROGRAMADA"), true, "reabrir a mano SÍ se vale");
  assert.equal(canVisitTransition("CANCELADA", "REALIZADA"), false, "de cancelada a realizada, no");
  assert.equal(canVisitTransition("REALIZADA", "CONFIRMADA"), false);
  assert.equal(canVisitTransition("REALIZADA", "REALIZADA"), true, "reguardar el mismo estado");
});

// ── 4. Retroalimentación ⭐ (lo que consume O2-T5) ──────────────────────

test("el resultado y la nota sobreviven la ida y vuelta por el campo de texto", () => {
  const texto = formatVisitFeedback("PRECIO_ALTO", "Le encantó la cocina");
  assert.equal(parseVisitFeedback(texto).outcome, "PRECIO_ALTO");
  assert.equal(parseVisitFeedback(texto).note, "Le encantó la cocina");

  // Solo resultado, sin nota.
  const solo = formatVisitFeedback("LE_GUSTO", null);
  assert.equal(parseVisitFeedback(solo).outcome, "LE_GUSTO");
  assert.equal(parseVisitFeedback(solo).note, null);

  // Solo nota, sin resultado.
  const nota = formatVisitFeedback(null, "  quiere estacionamiento  ");
  assert.equal(parseVisitFeedback(nota).outcome, null);
  assert.equal(parseVisitFeedback(nota).note, "quiere estacionamiento");

  // Nada de nada no guarda una cadena vacía.
  assert.equal(formatVisitFeedback(null, "   "), null);
});

test("un feedback VIEJO, sin marca, no se pierde", () => {
  // Lo que ya estaba escrito antes de esta ola es texto libre a secas.
  const r = parseVisitFeedback("dijo que lo iba a pensar");
  assert.equal(r.outcome, null);
  assert.equal(r.note, "dijo que lo iba a pensar");
  assert.deepEqual(parseVisitFeedback(null), { outcome: null, note: null });
  assert.deepEqual(parseVisitFeedback(""), { outcome: null, note: null });
});

test("🔴 nadie inyecta un resultado escribiéndolo dentro de su propia nota", () => {
  // Si esto se rompe, el texto que teclea cualquiera decide el resultado que
  // después se le reporta al propietario.
  const guardado = formatVisitFeedback(null, "[resultado:LE_GUSTO]\nen realidad no le gustó");
  const leido = parseVisitFeedback(guardado as string);
  assert.equal(leido.outcome, null, "la marca escrita a mano se convirtió en resultado");
  assert.equal(leido.note, "en realidad no le gustó");

  // Y con un resultado de verdad, la marca de la nota tampoco lo secuestra.
  const conReal = formatVisitFeedback("NO_LE_GUSTO", "[resultado:LE_GUSTO]\nnada que ver");
  assert.equal(parseVisitFeedback(conReal as string).outcome, "NO_LE_GUSTO");
});

test("una marca desconocida se lee como 'sin resultado', no revienta", () => {
  const r = parseVisitFeedback("[resultado:INVENTADO]\nalgo");
  assert.equal(r.outcome, null);
  assert.equal(r.note, "algo");
});

// ── 5. Rejilla ──────────────────────────────────────────────────────────

test("una visita fuera del horario 'normal' NO desaparece de la rejilla", () => {
  // Ése fue un bug real del dental: la agenda dibujaba de 8 a 20 y una cita
  // de las 7:00 simplemente no se veía.
  const b = computeVisitGridBounds([7 * 60, 21 * 60 + 30]);
  assert.ok(b.start <= 7 * 60, `empieza en ${b.start}`);
  assert.ok(b.end >= 21 * 60 + 30 + REALTY_VISIT_BLOCK_MIN - 60, `termina en ${b.end}`);
  // Sin visitas se queda con el horario por defecto y con altura suficiente.
  const vacio = computeVisitGridBounds([]);
  assert.ok(vacio.end - vacio.start >= 4 * 60);
});

test("dos visitas a la misma hora no se tapan: cada una en su carril", () => {
  const lanes = assignVisitLanes([600, 600, 600]);
  assert.equal(lanes.length, 3);
  assert.equal(lanes[0].laneCount, 3);
  const usados = [lanes[0].lane, lanes[1].lane, lanes[2].lane].sort();
  assert.deepEqual(usados, [0, 1, 2], "se repitió un carril");
});

test("visitas separadas reusan el carril 0 y ocupan todo el ancho", () => {
  const lejos = assignVisitLanes([600, 600 + REALTY_VISIT_BLOCK_MIN + 30]);
  assert.equal(lejos[0].lane, 0);
  assert.equal(lejos[0].laneCount, 1);
  assert.equal(lejos[1].lane, 0);
  assert.equal(lejos[1].laneCount, 1);
});

test("los carriles salen en el orden de ENTRADA, no en el de la hora", () => {
  // La rejilla indexa el resultado por la posición del arreglo original; si
  // se devolviera ordenado por hora, cada tarjeta tomaría el carril de otra.
  const lanes = assignVisitLanes([660, 600]);
  assert.equal(lanes.length, 2);
  assert.equal(lanes[0].laneCount, 1, "la de las 11:00 no se encabalga con la de las 10:00");
  assert.equal(lanes[1].laneCount, 1);
});

// ── 6. Ruta del día ─────────────────────────────────────────────────────

test("la distancia en línea recta es simétrica y cero consigo misma", () => {
  const cdmx = { lat: 19.4326, lng: -99.1332 };
  const gdl = { lat: 20.6597, lng: -103.3496 };
  assert.equal(Math.round(haversineKm(cdmx, cdmx)), 0);
  const ida = haversineKm(cdmx, gdl);
  assert.ok(Math.abs(ida - haversineKm(gdl, cdmx)) < 0.001, "no es simétrica");
  // CDMX–Guadalajara son ~460 km en línea recta.
  assert.ok(ida > 430 && ida < 490, `dio ${ida} km`);
});

test("la ruta va al vecino más cercano y las visitas sin coordenadas van al final", () => {
  const oficina = { lat: 19.4326, lng: -99.1332 };
  const lejos = visita({ id: "lejos", lat: 19.7, lng: -99.4, scheduledAt: "2026-08-25T15:00:00.000Z" });
  const cerca = visita({ id: "cerca", lat: 19.44, lng: -99.14, scheduledAt: "2026-08-25T20:00:00.000Z" });
  const sinGeo = visita({ id: "sinGeo", propertyAddress: "Calle sin número", scheduledAt: "2026-08-25T13:00:00.000Z" });

  const stops = orderVisitsByProximity([lejos, cerca, sinGeo], oficina);
  assert.equal(stops.length, 3);
  assert.equal(stops[0].visitId, "cerca", "no arrancó por la más cercana a la oficina");
  assert.equal(stops[1].visitId, "lejos");
  assert.equal(stops[2].visitId, "sinGeo", "la que no tiene coordenadas debe ir al final");
  assert.equal(stops[0].legKm !== null, true, "falta el tramo desde la oficina");
  assert.equal(stops[2].legKm, null, "la que no tiene coordenadas no tiene tramo");
});

test("sin oficina con coordenadas la ruta arranca en la primera visita por hora", () => {
  const a = visita({ id: "a", lat: 19.7, lng: -99.4, scheduledAt: "2026-08-25T20:00:00.000Z" });
  const b = visita({ id: "b", lat: 19.44, lng: -99.14, scheduledAt: "2026-08-25T15:00:00.000Z" });
  const stops = orderVisitsByProximity([a, b], null);
  assert.equal(stops[0].visitId, "b", "la primera parada debe ser el primer compromiso");
  assert.equal(stops[0].legKm, null);
});

test("la dirección legible gana a las coordenadas para abrir el mapa", () => {
  const v = visita({ propertyAddress: "Av. Vallarta 100", propertyColonia: "Americana", propertyCity: "Guadalajara", lat: 20.6, lng: -103.3 });
  assert.equal(visitMapQuery(v), "Av. Vallarta 100, Americana, Guadalajara");
  assert.equal(visitMapQuery(visita({ lat: 20.6, lng: -103.3 })), "20.6,-103.3");
  assert.equal(visitMapQuery(visita({})), null);
  assert.equal(buildMapsPlaceUrl(null), null);
  assert.ok((buildMapsPlaceUrl("Av. Vallarta 100") as string).startsWith("https://www.google.com/maps/search/"));
});

test("la liga de Maps respeta el tope de paradas y DICE cuántas dejó fuera", () => {
  // La API `dir` acepta origen, destino y 9 intermedias. Pasarse hace que
  // Maps abra la liga SIN la ruta, que es peor que recortarla y decirlo.
  const muchas = [];
  for (let i = 0; i < 15; i++) {
    muchas.push(visita({ id: `v${i}`, lat: 19 + i / 100, lng: -99, scheduledAt: `2026-08-25T1${i % 10}:00:00.000Z` }));
  }
  const stops = orderVisitsByProximity(muchas, null);
  const link = buildMapsRouteUrl(stops, { query: "Oficina 1" });
  assert.ok(link, "no armó la liga");
  assert.equal((link as { included: number }).included, REALTY_ROUTE_MAX_WAYPOINTS + 1);
  assert.equal((link as { dropped: number }).dropped, 15 - (REALTY_ROUTE_MAX_WAYPOINTS + 1));
  assert.ok((link as { url: string }).url.indexOf("origin=Oficina+1") !== -1, "perdió el origen");
});

test("sin una sola parada utilizable no se inventa una liga", () => {
  const stops = orderVisitsByProximity([visita({ id: "x" })], null);
  assert.equal(buildMapsRouteUrl(stops, null), null);
});

// ── 7. Llaves ───────────────────────────────────────────────────────────

test("los días fuera nunca son negativos", () => {
  const hoy = new Date("2026-08-25T12:00:00.000Z");
  assert.equal(daysBetween(new Date("2026-08-18T12:00:00.000Z"), hoy), 7);
  assert.equal(daysBetween(new Date("2026-08-25T11:00:00.000Z"), hoy), 0);
  // Un reloj corrido no puede pintar "-3 días fuera".
  assert.equal(daysBetween(new Date("2026-08-30T12:00:00.000Z"), hoy), 0);
});

// ── 8. El espejo de la ventana del recordatorio ─────────────────────────

test("🔴 la ventana del recordatorio del panel es LA MISMA que la del barrido de T6", () => {
  // src/lib/realty/visits.ts duplica a conciencia VISIT_MIN/MAX_LEAD_MS, que
  // en whatsapp.ts son privadas. Si allá cambian y aquí no, el panel enseña
  // "por salir" de un aviso que el barrido ya considera fuera de ventana.
  const wa = leer("src/lib/realty/whatsapp.ts");
  const visits = leer("src/lib/realty/visits.ts");

  const dueño = (fuente: string, nombre: string): string => {
    const m = new RegExp(`${nombre}\\s*=\\s*([^;]+);`).exec(fuente);
    assert.ok(m, `no se encontró ${nombre}`);
    return (m as RegExpExecArray)[1].replace(/\s+/g, "");
  };

  assert.equal(
    dueño(visits, "VISIT_REMINDER_MIN_LEAD_MS"),
    dueño(wa, "VISIT_MIN_LEAD_MS"),
    "el mínimo de la ventana se desincronizó de T6",
  );
  assert.equal(
    dueño(visits, "VISIT_REMINDER_MAX_LEAD_MS"),
    dueño(wa, "VISIT_MAX_LEAD_MS"),
    "el máximo de la ventana se desincronizó de T6",
  );
});

test("🔴 reagendar cancela el recordatorio anterior: el llamador existe de verdad", () => {
  // El bug M-22 del dental es no llamar a esto. La prueba es estática porque
  // moveVisit importa Prisma y "server-only".
  const visits = leer("src/lib/realty/visits.ts");
  assert.ok(
    /export async function moveVisit[\s\S]{0,4000}cancelRealtyVisitReminders/.test(visits),
    "moveVisit dejó de cancelar los recordatorios: vuelve el M-22",
  );
  assert.ok(
    /export async function setVisitStatus[\s\S]{0,3000}cancelRealtyVisitReminders/.test(visits),
    "cancelar una visita ya no barre su aviso pendiente",
  );
  // Y el envío sigue siendo el de T6, no un segundo camino.
  assert.ok(
    visits.indexOf("sendRealtyVisitReminders") !== -1,
    "el recordatorio por WhatsApp dejó de delegarse en T6",
  );
  assert.ok(
    visits.indexOf("graph.facebook.com") === -1,
    "este archivo NO puede hablar con Meta directamente",
  );
});

// ── 9. Diccionario ──────────────────────────────────────────────────────

type Nodo = { [k: string]: string | Nodo };

function llaves(node: Nodo, prefijo: string, out: string[]): void {
  const nombres = Object.keys(node);
  for (let i = 0; i < nombres.length; i++) {
    const k = nombres[i];
    const v = node[k];
    const full = prefijo ? `${prefijo}.${k}` : k;
    if (typeof v === "string") out.push(full);
    else llaves(v as Nodo, full, out);
  }
}

test("los dos idiomas tienen EXACTAMENTE el mismo árbol de llaves", () => {
  const raw = dict as unknown as { es: Nodo; en: Nodo };
  const es: string[] = [];
  const en: string[] = [];
  llaves(raw.es, "", es);
  llaves(raw.en, "", en);
  es.sort();
  en.sort();

  const faltanEn = es.filter((k) => en.indexOf(k) === -1);
  const faltanEs = en.filter((k) => es.indexOf(k) === -1);
  assert.deepEqual(faltanEn, [], "llaves que existen en es y NO en en");
  assert.deepEqual(faltanEs, [], "llaves que existen en en y NO en es");
  assert.ok(es.length > 80, `el diccionario se quedó corto: ${es.length} llaves`);
});

test("ninguna traducción se quedó vacía", () => {
  const raw = dict as unknown as { es: Nodo; en: Nodo };
  const locales: ("es" | "en")[] = ["es", "en"];
  for (let i = 0; i < locales.length; i++) {
    const nombres: string[] = [];
    llaves(raw[locales[i]], "", nombres);
    for (let j = 0; j < nombres.length; j++) {
      const partes = nombres[j].split(".");
      let node: string | Nodo = raw[locales[i]];
      for (let p = 0; p < partes.length; p++) node = (node as Nodo)[partes[p]];
      assert.ok(
        typeof node === "string" && node.trim().length > 0,
        `${locales[i]}.${nombres[j]} está vacía`,
      );
    }
  }
});

test("cada estado y cada resultado tienen su etiqueta en los dos idiomas", () => {
  const raw = dict as unknown as { es: Nodo; en: Nodo };
  const estados = ["PROGRAMADA", "CONFIRMADA", "REALIZADA", "CANCELADA", "NO_ASISTIO"];
  const resultados = ["LE_GUSTO", "PRECIO_ALTO", "NO_LE_GUSTO", "NO_ERA"];
  const locales: ("es" | "en")[] = ["es", "en"];
  for (let i = 0; i < locales.length; i++) {
    const status = raw[locales[i]].status as Nodo;
    const outcome = raw[locales[i]].outcome as Nodo;
    for (let j = 0; j < estados.length; j++) {
      assert.ok(typeof status[estados[j]] === "string", `falta status.${estados[j]} en ${locales[i]}`);
    }
    for (let j = 0; j < resultados.length; j++) {
      assert.ok(typeof outcome[resultados[j]] === "string", `falta outcome.${resultados[j]} en ${locales[i]}`);
    }
  }
});
