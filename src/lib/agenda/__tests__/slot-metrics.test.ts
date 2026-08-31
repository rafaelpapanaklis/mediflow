/**
 * Tests de la métrica vertical de la agenda (slot-metrics), del arrastre
 * con alto de slot dinámico (drag-utils) y del contraste del rediseño
 * doctor/estado (doctor-color + tokens).
 *
 * Run: npm run test:agenda-metrics
 *
 * Foco crítico:
 *  - El alto de slot dejó de ser una constante: CSS y JS deben salir del
 *    MISMO número (provider.slotHpx). Aquí se fija que arrastrar N píxeles
 *    mueve la cita los minutos correctos con DOS densidades distintas, y
 *    que el fallback CSS (--mf-agenda-slot-h) coincide con DEFAULT_SLOT_HPX.
 *  - El rediseño pinta la card con el color del doctor (users.color es
 *    LIBRE): se demuestra que el texto conserva AA con cualquier color, en
 *    tema claro y oscuro, y que readableTextOn siempre logra ≥4.5:1 sobre
 *    el chip sólido.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_SLOT_HPX,
  DENSITY_SLOT_HPX,
  FIT_MIN_SLOT_HPX,
  showHalfHourLabels,
  slotHeightFor,
} from "../slot-metrics";
import { deltaYToSlots, recomputeTimes } from "../drag-utils";
import {
  DOCTOR_PALETTE,
  contrastRatio,
  readableTextOn,
  relativeLuminance,
} from "../doctor-color";
import type { AgendaAppointmentDTO } from "../types";

const TZ = "America/Mexico_City"; // UTC-6 sin DST desde 2022

/* ─────────────── slotHeightFor (densidad) ─────────────── */

test("fit reparte el alto disponible entre los slots del día (floor)", () => {
  // 720px para 48 slots (12h × 4 slots/h) → 15px exactos.
  assert.equal(slotHeightFor("fit", 720, 48), 15);
  // 745px → 15.52 → floor 15: el residuo queda como aire, nunca scroll.
  assert.equal(slotHeightFor("fit", 745, 48), 15);
  // Nunca por debajo del piso legible.
  assert.equal(slotHeightFor("fit", 240, 48), FIT_MIN_SLOT_HPX);
  // 500px → 10.41 → floor 10 (el caso laptop 768p).
  assert.equal(slotHeightFor("fit", 500, 48), 10);
});

test("fit garantiza que el día quepa cuando el piso no interviene", () => {
  for (const avail of [480, 600, 720, 900, 1200]) {
    const h = slotHeightFor("fit", avail, 48);
    assert.ok(h * 48 <= avail, `48 slots × ${h}px deben caber en ${avail}px`);
  }
});

test("fit sin medición (SSR) cae al mismo default que el CSS", () => {
  assert.equal(slotHeightFor("fit", null, 48), DEFAULT_SLOT_HPX);
  assert.equal(slotHeightFor("fit", 0, 48), DEFAULT_SLOT_HPX);
  assert.equal(slotHeightFor("fit", 720, 0), DEFAULT_SLOT_HPX);
});

test("densidades fijas: medium 20px, spacious 30px (la densidad histórica)", () => {
  assert.equal(slotHeightFor("medium", 9999, 48), DENSITY_SLOT_HPX.medium);
  assert.equal(slotHeightFor("medium", null, 48), 20);
  assert.equal(slotHeightFor("spacious", 300, 48), DENSITY_SLOT_HPX.spacious);
  assert.equal(DENSITY_SLOT_HPX.spacious, 30);
});

test("el fallback CSS --mf-agenda-slot-h es el MISMO número que DEFAULT_SLOT_HPX", () => {
  const css = readFileSync(
    join(process.cwd(), "src/components/dashboard/agenda/agenda.module.css"),
    "utf8",
  );
  const m = /--mf-agenda-slot-h:\s*(\d+)px/.exec(css);
  assert.ok(m, "agenda.module.css debe declarar el fallback --mf-agenda-slot-h");
  assert.equal(
    parseInt(m![1]!, 10),
    DEFAULT_SLOT_HPX,
    "si cambias el fallback CSS, cambia DEFAULT_SLOT_HPX (y viceversa)",
  );
});

test("medias horas del eje: solo con aire suficiente y frontera :30 exacta", () => {
  assert.equal(showHalfHourLabels(15, 30), true);  // 60px por media hora
  assert.equal(showHalfHourLabels(15, 14), true);  // 28px, justo el umbral
  assert.equal(showHalfHourLabels(15, 13), false); // 26px, apilado = ruido
  assert.equal(showHalfHourLabels(30, 20), false); // 20px
  assert.equal(showHalfHourLabels(30, 28), true);
  assert.equal(showHalfHourLabels(20, 30), false); // 30%20≠0: no hay :30 exacto
  assert.equal(showHalfHourLabels(60, 99), false); // sin subdivisión de hora
});

/* ─────────────── Arrastre con slot dinámico ─────────────── */

test("deltaYToSlots redondea al slot más cercano según la densidad", () => {
  assert.equal(deltaYToSlots(90, 30), 3);
  assert.equal(deltaYToSlots(90, 15), 6);
  assert.equal(deltaYToSlots(-40, 20), -2);
  assert.equal(deltaYToSlots(14, 30), 0); // 0.46 → 0
  assert.equal(deltaYToSlots(16, 30), 1); // 0.53 → 1
  // Alto inválido = no mover (jamás NaN ni un 30 implícito).
  assert.equal(deltaYToSlots(90, 0), 0);
  assert.equal(deltaYToSlots(90, Number.NaN), 0);
});

function apptAt(startISO: string, endISO: string): AgendaAppointmentDTO {
  return {
    id: "a1",
    startsAt: startISO,
    endsAt: endISO,
    status: "CONFIRMED",
    patient: { id: "p1", name: "Paciente Prueba" },
    doctor: { id: "d1", shortName: "Dr. Uno" },
    resourceId: null,
  } as unknown as AgendaAppointmentDTO;
}

const DRAG_BASE = {
  slotMinutes: 15,
  dayStart: 8,
  dayEnd: 20,
  fromDayISO: "2026-09-01",
  toDayISO: "2026-09-01",
  timezone: TZ,
};

// Cita 09:00–09:30 hora clínica = 15:00–15:30Z (MX = UTC-6 fijo).
const APPT = apptAt("2026-09-01T15:00:00.000Z", "2026-09-01T15:30:00.000Z");

test("arrastrar 90px con slots de 30px mueve +45 min (3 slots)", () => {
  const r = recomputeTimes({ appt: APPT, deltaY: 90, slotHpx: 30, ...DRAG_BASE });
  assert.equal(r.startsAt, "2026-09-01T15:45:00.000Z"); // 09:45 local
  assert.equal(r.endsAt, "2026-09-01T16:15:00.000Z");   // duración intacta
  assert.equal(r.durationMin, 30);
});

test("los MISMOS 90px con slots de 15px mueven +90 min (6 slots)", () => {
  // Esta es la trampa que rompía el arrastre: con el alto dinámico y un
  // SLOT_HPX=30 cableado, este caso habría movido la cita a las 09:45 en
  // vez de a las 10:30 — en silencio.
  const r = recomputeTimes({ appt: APPT, deltaY: 90, slotHpx: 15, ...DRAG_BASE });
  assert.equal(r.startsAt, "2026-09-01T16:30:00.000Z"); // 10:30 local
  assert.equal(r.endsAt, "2026-09-01T17:00:00.000Z");
});

test("arrastre hacia arriba: -40px con slots de 20px = -30 min", () => {
  const r = recomputeTimes({ appt: APPT, deltaY: -40, slotHpx: 20, ...DRAG_BASE });
  assert.equal(r.startsAt, "2026-09-01T14:30:00.000Z"); // 08:30 local
  assert.equal(r.endsAt, "2026-09-01T15:00:00.000Z");
});

test("el drop se clampa al final del horario preservando la duración", () => {
  const r = recomputeTimes({ appt: APPT, deltaY: 10_000, slotHpx: 10, ...DRAG_BASE });
  // Último inicio válido: 19:30 (para terminar 20:00) = 01:30Z del día sig.
  assert.equal(r.startsAt, "2026-09-02T01:30:00.000Z");
  assert.equal(r.endsAt, "2026-09-02T02:00:00.000Z");
  assert.equal(r.startSlot, 46);
});

test("slotHpx inválido no mueve la cita (defensa, no fallback a 30)", () => {
  const r = recomputeTimes({ appt: APPT, deltaY: 90, slotHpx: 0, ...DRAG_BASE });
  assert.equal(r.startsAt, "2026-09-01T15:00:00.000Z");
});

/* ─────────────── Contraste del rediseño doctor/estado ─────────────── */

// Espejo de src/app/globals.css (:root claro / .dark). Si esos tokens
// cambian, actualizar aquí — el test protege las DECISIONES de contraste
// de la agenda, no el archivo global.
const THEME = {
  light: { bg: "#F8F7FC", bgElev: "#FFFFFF", text1: "#14101F", text2: "#4A4560", text3: "#7D7892" },
  dark:  { bg: "#0B0815", bgElev: "#121020", text1: "#E8E8EC", text2: "#A0A0AB", text3: "#6B6B78" },
} as const;

function ratio(a: string, b: string): number {
  const r = contrastRatio(a, b);
  assert.ok(r !== null, `colores no parseables: ${a} / ${b}`);
  return r!;
}

test("eje horario: la hora en punto (--text-2) es AA sobre --bg en ambos temas", () => {
  assert.ok(ratio(THEME.light.text2, THEME.light.bg) >= 4.5);
  assert.ok(ratio(THEME.dark.text2, THEME.dark.bg) >= 4.5);
});

test("eje horario: la media hora (--text-3) mantiene ≥3:1 en ambos temas", () => {
  assert.ok(ratio(THEME.light.text3, THEME.light.bg) >= 3);
  assert.ok(ratio(THEME.dark.text3, THEME.dark.bg) >= 3);
});

test("readableTextOn logra ≥4.5:1 sobre CUALQUIER color de doctor", () => {
  // La luminancia determina el contraste por completo, y los grises barren
  // todas las luminancias posibles [0,1]: probar 256 grises es probar el
  // peor caso de todos los colores (el mínimo teórico es ~4.58:1).
  for (let v = 0; v <= 255; v++) {
    const hex = `#${v.toString(16).padStart(2, "0").repeat(3)}`;
    const ink = readableTextOn(hex);
    assert.ok(
      ratio(hex, ink) >= 4.5,
      `gris ${hex}: ${ink} da ${ratio(hex, ink).toFixed(2)}:1`,
    );
  }
  // Y los colores reales: la paleta por defecto + los clásicos traicioneros.
  for (const hex of [...DOCTOR_PALETTE, "#eab308", "#00ffff", "#f8f7fc", "#808080", "#7D7892"]) {
    assert.ok(ratio(hex, readableTextOn(hex)) >= 4.5, `color ${hex}`);
  }
});

/** color-mix(in srgb, a P%, b) = interpolación lineal por canal sRGB. */
function mixHex(a: string, pct: number, b: string): string {
  const pa = a.replace("#", "");
  const pb = b.replace("#", "");
  const out = [0, 1, 2].map((i) => {
    const ca = parseInt(pa.slice(i * 2, i * 2 + 2), 16);
    const cb = parseInt(pb.slice(i * 2, i * 2 + 2), 16);
    return Math.round(ca * (pct / 100) + cb * (1 - pct / 100));
  });
  return `#${out.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

test("la card tintada por el doctor conserva --text-1 AA con cualquier color y tema", () => {
  // El % real se lee del CSS: si alguien lo sube, este test lo re-verifica.
  const css = readFileSync(
    join(process.cwd(), "src/components/dashboard/agenda/agenda.module.css"),
    "utf8",
  );
  const pcts = Array.from(
    css.matchAll(
      /background:\s*color-mix\(in srgb,\s*var\(--mf-doc-color, var\(--brand\)\)\s+(\d+)%\s*,\s*var\(--bg-elev\)\)/g,
    ),
  ).map((m) => parseInt(m[1]!, 10));
  assert.ok(pcts.length > 0, "el CSS debe tintar la card con color-mix doctor→bg-elev");
  const worstPct = Math.max(...pcts);
  assert.ok(worstPct <= 30, `un tinte de ${worstPct}% ya compromete el peor caso AA`);

  // Peor caso REAL para el texto del tema: el doctor que más acerque el
  // fondo a la tinta. Negro y blanco puros acotan a todos los demás
  // (la mezcla es lineal en sRGB); se añaden la paleta y amarillo puro.
  const extremes = ["#000000", "#ffffff", "#eab308", ...DOCTOR_PALETTE];
  for (const [name, th] of Object.entries(THEME)) {
    for (const doc of extremes) {
      const surface = mixHex(doc, worstPct, th.bgElev);
      const r = ratio(th.text1, surface);
      assert.ok(
        r >= 4.5,
        `${name}: doctor ${doc} al ${worstPct}% deja --text-1 en ${r.toFixed(2)}:1`,
      );
    }
  }
});

test("relativeLuminance devuelve null para entradas no-hex (var(--brand))", () => {
  assert.equal(relativeLuminance("var(--brand)"), null);
  assert.equal(readableTextOn("var(--brand)"), "#FFFFFF");
  assert.equal(readableTextOn("#fff"), "#000000"); // forma corta soportada
});
