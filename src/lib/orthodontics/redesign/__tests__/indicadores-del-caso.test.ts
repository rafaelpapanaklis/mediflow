// Los indicadores de la cabecera del caso dicen lo que pasó de verdad
// (ws1-t4 ronda 6, filas 8 y 9 de la revisión de lógica de uso).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  asistenciaDelCaso,
  proximaCitaDelCaso,
  usoDeElasticos,
  visitasDelCaso,
  type CitaDeControlDelCaso,
} from "../indicadores-del-caso";

const ZONA = "America/Mexico_City";
// Lunes 28-sep-2026, 12:30 en Ciudad de México.
const AHORA = new Date("2026-09-28T18:30:00.000Z");

let n = 0;
function cita(startsAt: string, status: string, id?: string): CitaDeControlDelCaso {
  n += 1;
  const inicio = new Date(startsAt);
  return { id: id ?? `cita-${n}`, startsAt: inicio, endsAt: new Date(inicio.getTime() + 30 * 60_000), status };
}

describe("asistenciaDelCaso", () => {
  it("sin controles no inventa un 100 %: devuelve null", () => {
    assert.deepEqual(asistenciaDelCaso([], [], AHORA), { pct: null, asistio: 0, falto: 0 });
  });

  it("tres faltas en la Agenda ya no son «asistencia 100 %»", () => {
    const r = asistenciaDelCaso(
      [
        cita("2026-06-10T16:00:00Z", "COMPLETED"),
        cita("2026-07-10T16:00:00Z", "NO_SHOW"),
        cita("2026-08-10T16:00:00Z", "NO_SHOW"),
        cita("2026-09-10T16:00:00Z", "NO_SHOW"),
      ],
      [],
      AHORA,
    );
    assert.deepEqual(r, { pct: 25, asistio: 1, falto: 3 });
  });

  it("la cita con hoja de control cuenta como asistencia aunque siga «agendada»", () => {
    const r = asistenciaDelCaso(
      [cita("2026-09-28T16:00:00Z", "SCHEDULED", "c-hoy")],
      [{ appointmentId: "c-hoy", visitDate: new Date("2026-09-28T16:10:00Z") }],
      AHORA,
    );
    assert.deepEqual(r, { pct: 100, asistio: 1, falto: 0 });
  });

  it("una hoja registrada sin cita también es una visita", () => {
    const r = asistenciaDelCaso([], [{ appointmentId: null, visitDate: new Date("2026-09-20T16:00:00Z") }], AHORA);
    assert.deepEqual(r, { pct: 100, asistio: 1, falto: 0 });
  });

  it("una cita pasada que nadie marcó no cuenta ni a favor ni en contra", () => {
    const r = asistenciaDelCaso(
      [cita("2026-09-01T16:00:00Z", "SCHEDULED"), cita("2026-09-15T16:00:00Z", "CONFIRMED")],
      [],
      AHORA,
    );
    assert.equal(r.pct, null);
  });

  it("no cuenta canceladas, futuras ni lo de hace más de seis meses", () => {
    const r = asistenciaDelCaso(
      [
        cita("2026-09-05T16:00:00Z", "CANCELLED"),
        cita("2026-10-05T16:00:00Z", "SCHEDULED"),
        cita("2026-02-01T16:00:00Z", "NO_SHOW"),
        cita("2026-09-12T16:00:00Z", "CHECKED_OUT"),
      ],
      [],
      AHORA,
    );
    assert.deepEqual(r, { pct: 100, asistio: 1, falto: 0 });
  });
});

describe("visitasDelCaso", () => {
  it("un control registrado hoy ya no es «Visitas 0 · Última visita —»", () => {
    const r = visitasDelCaso([], [{ appointmentId: null, visitDate: new Date("2026-09-28T16:00:00Z") }], AHORA, ZONA);
    assert.equal(r.total, 1);
    assert.equal(r.ultima?.toISOString(), "2026-09-28T16:00:00.000Z");
  });

  it("la cita atendida y su hoja son UNA visita, no dos", () => {
    const r = visitasDelCaso(
      [cita("2026-09-10T16:00:00Z", "COMPLETED", "c1")],
      [{ appointmentId: "c1", visitDate: new Date("2026-09-10T16:20:00Z") }],
      AHORA,
      ZONA,
    );
    assert.equal(r.total, 1);
  });

  it("la hoja suelta del mismo día que la cita atendida tampoco suma otra", () => {
    const r = visitasDelCaso(
      [cita("2026-09-10T16:00:00Z", "COMPLETED", "c1")],
      [{ appointmentId: null, visitDate: new Date("2026-09-10T17:00:00Z") }],
      AHORA,
      ZONA,
    );
    assert.equal(r.total, 1);
  });

  it("dice desde cuándo y cuál fue la última", () => {
    const r = visitasDelCaso(
      [
        cita("2026-07-28T16:00:00Z", "COMPLETED"),
        cita("2026-08-28T16:00:00Z", "CHECKED_OUT"),
        cita("2026-09-20T16:00:00Z", "NO_SHOW"),
      ],
      [],
      AHORA,
      ZONA,
    );
    assert.equal(r.total, 2);
    assert.equal(r.primera?.toISOString(), "2026-07-28T16:00:00.000Z");
    assert.equal(r.ultima?.toISOString(), "2026-08-28T16:00:00.000Z");
  });
});

describe("proximaCitaDelCaso", () => {
  it("a mediodía, el control de las 10:00 de hoy que nadie ha cerrado sigue siendo la cita de hoy", () => {
    const hoy = cita("2026-09-28T16:00:00Z", "SCHEDULED", "hoy-10");
    const r = proximaCitaDelCaso([cita("2026-10-26T16:00:00Z", "SCHEDULED"), hoy], AHORA, ZONA);
    assert.equal(r?.id, "hoy-10");
  });

  it("si la de hoy ya se atendió, la próxima es la siguiente", () => {
    const r = proximaCitaDelCaso(
      [cita("2026-09-28T16:00:00Z", "COMPLETED"), cita("2026-10-26T16:00:00Z", "SCHEDULED", "oct")],
      AHORA,
      ZONA,
    );
    assert.equal(r?.id, "oct");
  });

  it("una de ayer que se quedó sin marcar no es «la próxima»", () => {
    assert.equal(proximaCitaDelCaso([cita("2026-09-27T16:00:00Z", "SCHEDULED")], AHORA, ZONA), null);
  });

  it("canceladas y faltas no cuentan", () => {
    const r = proximaCitaDelCaso(
      [cita("2026-10-01T16:00:00Z", "CANCELLED"), cita("2026-10-02T16:00:00Z", "NO_SHOW")],
      AHORA,
      ZONA,
    );
    assert.equal(r, null);
  });

  it("«hoy» es el día de la clínica: las 19:30 de Ciudad de México ya son mañana en UTC", () => {
    // 29-sep 01:30 UTC = 28-sep 19:30 en Ciudad de México. Ahora: 28-sep 20:00 local.
    const tarde = cita("2026-09-29T01:30:00Z", "SCHEDULED", "tarde");
    const r = proximaCitaDelCaso([tarde], new Date("2026-09-29T02:00:00Z"), ZONA);
    assert.equal(r?.id, "tarde");
  });
});

describe("usoDeElasticos", () => {
  it("sin registros no es 0 %: es «sin datos»", () => {
    assert.deepEqual(usoDeElasticos([]), { pct: null, diasRegistrados: 0, ventanaDias: 14, metaHoras: 20 });
  });

  it("cuenta como el panel de la ficha: días cumplidos entre los días de la ventana", () => {
    const registros = Array.from({ length: 7 }, (_, i) => ({
      date: `2026-09-${String(20 + i).padStart(2, "0")}`,
      wornHours: null,
      usedElastics: true,
    }));
    const r = usoDeElasticos(registros);
    assert.equal(r.pct, 50);
    assert.equal(r.diasRegistrados, 7);
  });

  it("con horas, cumple quien llega a la meta", () => {
    const r = usoDeElasticos(
      [
        { date: "2026-09-27", wornHours: 22, usedElastics: true },
        { date: "2026-09-26", wornHours: 10, usedElastics: true },
      ],
      2,
      20,
    );
    assert.equal(r.pct, 50);
  });
});

describe("la cabecera del caso usa las visitas reales (fila 8, ws1-t4 ronda 6)", () => {
  it("«Última visita» y «Visitas» salen de vm.visitas cuando viene", () => {
    const pestana = readFileSync(
      join(__dirname, "../../../../components/specialties/orthodontics/redesign/OrthodonticsPatientTab.tsx"),
      "utf8",
    );
    assert.match(pestana, /lastVisitAt: orthoRedesignVM\.visitas \? orthoRedesignVM\.visitas\.ultima :/);
    assert.match(pestana, /count: orthoRedesignVM\.visitas\s*\?\s*orthoRedesignVM\.visitas\.total/);
  });
});
