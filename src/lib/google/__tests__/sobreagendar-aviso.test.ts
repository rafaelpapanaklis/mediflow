/**
 * Google Calendar → agenda (WS1-T9), segunda vuelta t8, C5: el «Mover la cita»
 * del aviso «El evento de Google cambió…» ofrece el «¿Seguro?» de sobreagendar
 * como «Convertir en cita» (contrato de ws1-t5: 409 `sobreagendable` →
 * reenviar con `sobreagendar`, `sobreagendarCita` y `sobreagendarOtras`).
 * Se ejecuta con un `fetch` falso que hace de `PATCH /api/appointments/[id]`.
 *
 * `npm run test:google-entrante`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  camposSobreagendar,
  confirmacionDesde409,
  moverCitaAlEvento,
  preguntarOtraVez,
} from "@/components/dashboard/agenda-nueva/google-sobreagendar";

const ZONA = "America/Mexico_City";
const INICIO = "2026-10-21T18:00:00.000Z";
const FIN = "2026-10-21T19:00:00.000Z";

/** El PATCH de ws1-t5 con la agenda flexible: choca con la cita de Luis (y 1 más) hasta que se confirma. */
function api(opts: { choque?: "cita" | "comida" | "ninguno"; otras?: number } = {}) {
  const cuerpos: Record<string, any>[] = [];
  const fetchFalso = (async (url: string, init: RequestInit) => {
    assert.equal(init.method, "PATCH");
    assert.equal(url, "/api/appointments/cita-1");
    const b = JSON.parse(String(init.body));
    cuerpos.push(b);
    const responder = (status: number, body: unknown) =>
      ({ ok: status < 400, status, json: async () => body }) as Response;
    const choque = opts.choque ?? "cita";
    if (choque === "cita" && b.sobreagendar !== true) {
      return responder(409, {
        error: "appointment_overlap",
        sobreagendable: true,
        conflictingAppointment: { id: "otra", patientName: "Luis Pérez", startsAt: INICIO, endsAt: FIN, otras: opts.otras ?? 1 },
        comida: null,
      });
    }
    if (choque === "comida" && b.sobreagendar !== true) {
      return responder(409, { error: "lunch_overlap", sobreagendable: true, conflictingAppointment: null, comida: { lunchStart: "14:00", lunchEnd: "15:00" } });
    }
    return responder(200, { appointment: { id: "cita-1", startsAt: b.startsAt, endsAt: b.endsAt }, whatsapp: null });
  }) as unknown as typeof fetch;
  return { fetchFalso, cuerpos };
}

test("C5: la hora del evento cae sobre otra cita → «¿Seguro?»; al confirmarlo se reenvía con sobreagendar y se mueve", async () => {
  const a = api();
  const base = { citaId: "cita-1", inicio: INICIO, fin: FIN, zona: ZONA, locale: "es-MX", fetch: a.fetchFalso };
  const r1 = await moverCitaAlEvento({ ...base, confirmada: null });
  assert.equal(r1.estado, "confirmar");
  if (r1.estado !== "confirmar") return;
  assert.deepEqual(r1.confirmacion, {
    tipo: "cita", citaId: "otra", paciente: "Luis Pérez", hora: "12:00–13:00",
    comidaDesde: null, comidaHasta: null, otras: 1,
  });
  // Sin confirmar, el primer PATCH no lleva sobreagendar (el servidor decide).
  assert.equal("sobreagendar" in a.cuerpos[0], false);
  assert.equal("bloqueoConfirmado" in a.cuerpos[0], false, "nadie vio un aviso de bloqueo: la auditoría no debe decir que sí");

  const r2 = await moverCitaAlEvento({ ...base, confirmada: r1.confirmacion });
  assert.equal(r2.estado, "ok");
  assert.deepEqual(
    { s: a.cuerpos[1].sobreagendar, c: a.cuerpos[1].sobreagendarCita, o: a.cuerpos[1].sobreagendarOtras, i: a.cuerpos[1].startsAt },
    { s: true, c: "otra", o: 1, i: INICIO },
  );
});

test("C5: en la comida del doctor → «¿Seguro?» de comida", async () => {
  const a = api({ choque: "comida" });
  const r = await moverCitaAlEvento({ citaId: "cita-1", inicio: INICIO, fin: FIN, confirmada: null, zona: ZONA, locale: "es-MX", fetch: a.fetchFalso });
  assert.equal(r.estado === "confirmar" && r.confirmacion.tipo, "comida");
  assert.equal(r.estado === "confirmar" && `${r.confirmacion.comidaDesde}-${r.confirmacion.comidaHasta}`, "14:00-15:00");
});

test("C5: sin la agenda flexible (409 sin `sobreagendable`) no se ofrece: es un error con su código", async () => {
  const fetchFalso = (async () =>
    ({ ok: false, status: 409, json: async () => ({ error: "appointment_overlap" }) }) as Response) as unknown as typeof fetch;
  const r = await moverCitaAlEvento({ citaId: "cita-1", inicio: INICIO, fin: FIN, confirmada: null, zona: ZONA, locale: "es-MX", fetch: fetchFalso });
  assert.deepEqual(r, { estado: "error", status: 409, codigo: "appointment_overlap", body: { error: "appointment_overlap" } });
});

test("C5: ya confirmado y el servidor sigue diciendo la MISMA cita → no se pregunta otra vez; si sale OTRA (o más), sí", () => {
  const c = confirmacionDesde409(
    { error: "appointment_overlap", sobreagendable: true, conflictingAppointment: { id: "otra", otras: 1 } },
    ZONA,
    "es-MX",
  )!;
  assert.equal(preguntarOtraVez(c, c), false);
  assert.equal(preguntarOtraVez({ ...c, citaId: "otra-mas" }, c), true);
  assert.equal(preguntarOtraVez({ ...c, otras: 2 }, c), true);
  assert.equal(preguntarOtraVez(c, null), true);
  assert.equal(preguntarOtraVez(null, null), false);
  assert.deepEqual(camposSobreagendar(c), { sobreagendar: true, sobreagendarCita: "otra", sobreagendarOtras: 1 });
  assert.deepEqual(camposSobreagendar(null), {});
});
