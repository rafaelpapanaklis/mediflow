import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dripSlotFor, firstDripSlot } from "../import";
import { BLOG_IMPORT_LIMITS } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// firstDripSlot — el primer hueco del lote NUNCA puede quedar en el pasado.
//
// El bug (18-ago-2026): el último scheduledAt de la BD era del 11-ago y el
// importador devolvía "último + 1 día" = 12-ago sin mirar el reloj. Los 60
// artículos del lote cayeron del 12 al 17 (a 10 por día), todos vencidos, y el
// cron (status scheduled, scheduledAt <= now, take 200) los habría publicado
// de golpe. Estos tests fijan las dos ramas y, sobre todo, el camino inverso:
// un "último" en el pasado ya no arrastra el lote al pasado.
// ─────────────────────────────────────────────────────────────────────────────

const H = BLOG_IMPORT_LIMITS.publishHourUtc; // 13:00 UTC
const DAY_MS = 24 * 60 * 60 * 1000;

/** Fecha UTC; el mes va de 1 a 12. */
function utc(y: number, m: number, d: number, h = 0, min = 0): Date {
  return new Date(Date.UTC(y, m - 1, d, h, min, 0, 0));
}

function iso(d: Date): string {
  return d.toISOString();
}

describe("firstDripSlot — sin nada programado (rama del else, sin cambios)", () => {
  it("antes de las 13:00 UTC → hoy a las 13:00", () => {
    assert.equal(iso(firstDripSlot(null, utc(2026, 8, 18, 10))), iso(utc(2026, 8, 18, H)));
  });

  it("ya pasadas las 13:00 UTC → mañana a las 13:00", () => {
    assert.equal(iso(firstDripSlot(null, utc(2026, 8, 18, 15))), iso(utc(2026, 8, 19, H)));
  });

  it("justo a las 13:00:00 UTC → mañana (hoy ya no cuenta como futuro)", () => {
    assert.equal(iso(firstDripSlot(null, utc(2026, 8, 18, H))), iso(utc(2026, 8, 19, H)));
  });
});

describe("firstDripSlot — con último programado", () => {
  it("último en el FUTURO → el día siguiente al último (la regla de siempre)", () => {
    const last = utc(2026, 8, 30, H);
    assert.equal(iso(firstDripSlot(last, utc(2026, 8, 18, 10))), iso(utc(2026, 8, 31, H)));
  });

  it("el bug del 18-ago: último hace una semana → NO 'último + 1' (12-ago), sino hoy a las 13:00", () => {
    const last = utc(2026, 8, 11, H);
    const first = firstDripSlot(last, utc(2026, 8, 18, 10));
    assert.equal(iso(first), iso(utc(2026, 8, 18, H)));
    // El camino inverso, explícito: lo que devolvía antes ya no es aceptable.
    assert.notEqual(iso(first), iso(utc(2026, 8, 12, H)));
  });

  it("el mismo caso ya pasadas las 13:00 → mañana (hoy a las 13:00 también estaría vencido)", () => {
    const last = utc(2026, 8, 11, H);
    assert.equal(iso(firstDripSlot(last, utc(2026, 8, 18, 15))), iso(utc(2026, 8, 19, H)));
  });

  it("último AYER y aún no son las 13:00 → hoy (último + 1 y el hueco desde hoy coinciden)", () => {
    const last = utc(2026, 8, 17, H);
    assert.equal(iso(firstDripSlot(last, utc(2026, 8, 18, 10))), iso(utc(2026, 8, 18, H)));
  });

  it("último HOY → mañana aunque no sean las 13:00 (no rellena el día del último)", () => {
    const last = utc(2026, 8, 18, H);
    assert.equal(iso(firstDripSlot(last, utc(2026, 8, 18, 10))), iso(utc(2026, 8, 19, H)));
  });

  it("propiedad: para cualquier último en el pasado (0–90 días), el primer hueco es futuro y a las 13:00", () => {
    const now = utc(2026, 8, 18, 10, 30);
    for (let daysAgo = 0; daysAgo <= 90; daysAgo++) {
      const last = new Date(now.getTime() - daysAgo * DAY_MS);
      const first = firstDripSlot(last, now);
      assert.ok(
        first.getTime() > now.getTime(),
        `último hace ${daysAgo} días → primer hueco ${iso(first)} no es futuro`,
      );
      assert.equal(first.getUTCHours(), H);
      assert.equal(first.getUTCMinutes(), 0);
    }
  });
});

describe("dripSlotFor — el lote entero hereda la garantía del primer hueco", () => {
  it("60 artículos a 10 por día desde el hueco arreglado ocupan del 18 al 23 de agosto, nunca antes", () => {
    const now = utc(2026, 8, 18, 10);
    const first = firstDripSlot(utc(2026, 8, 11, H), now);
    const days = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const slot = dripSlotFor(first, i, 10);
      assert.ok(slot.getTime() > now.getTime(), `el artículo ${i} quedó vencido: ${iso(slot)}`);
      days.add(iso(slot));
    }
    assert.deepEqual(
      Array.from(days),
      [18, 19, 20, 21, 22, 23].map((d) => iso(utc(2026, 8, d, H))),
    );
  });
});
