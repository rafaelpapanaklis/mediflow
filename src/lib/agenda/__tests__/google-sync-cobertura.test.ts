// Red contra el olvido: cada camino que crea, mueve o cancela una cita tiene que
// dejar a Google Calendar al día. Son 8+ rutas; si alguien añade una nueva que
// cancele citas y no llama a la sincronización, esta prueba lo dice.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(__dirname, "../../../..");
const leer = (rel: string) => fs.readFileSync(path.join(RAIZ, rel), "utf8");

/** Rutas y servicios que DEBEN llamar a la sincronización, y por qué. */
const DEBEN_SINCRONIZAR: [string, string][] = [
  ["src/app/api/appointments/route.ts", "alta desde la agenda, la ficha y Sabina"],
  ["src/app/api/appointments/[id]/route.ts", "mover (PATCH) y cancelar (DELETE)"],
  ["src/app/api/appointments/[id]/status/route.ts", "cancelar / no-asistió / reactivar desde la agenda nueva y la ficha"],
  ["src/app/api/appointments/batch-validate/route.ts", "rechazar citas por validar"],
  ["src/app/api/appointment-change-requests/[id]/resolve/route.ts", "aprobar cambio o cancelación del portal"],
  ["src/app/api/paciente/appointments/route.ts", "alta desde el portal del paciente"],
  ["src/app/api/paciente/appointments/[id]/change-request/route.ts", "portal con auto-aprobación (mover / cancelar)"],
  ["src/app/api/public/book/route.ts", "reserva pública"],
  ["src/app/api/public/appointment-confirm/route.ts", "cancelar desde el enlace de confirmación"],
  ["src/app/api/whatsapp/webhook/route.ts", "el paciente cancela contestando el recordatorio"],
  ["src/app/api/booking-requests/[id]/route.ts", "aprobar una solicitud web"],
  ["src/lib/agenda/bot-booking-service.ts", "el bot de WhatsApp agenda y reagenda"],
  ["src/app/api/patients/[id]/route.ts", "archivar un paciente cancela sus citas futuras"],
  ["src/app/api/cron/anticipos/route.ts", "el cron cancela citas apartadas vencidas"],
];

test("cada camino que crea, mueve o cancela una cita llama a la sincronización con Google", () => {
  for (const [rel, que] of DEBEN_SINCRONIZAR) {
    assert.match(leer(rel), /sincronizarCitaEnSegundoPlano\(/, `${rel} (${que})`);
  }
});

test("ya nadie usa las funciones viejas de Google (copias por ruta, events.update, calendario «primary»)", () => {
  for (const [rel] of DEBEN_SINCRONIZAR) {
    const src = leer(rel);
    for (const viejo of ["syncCreateToGoogleCalendar", "syncUpdateToGoogleCalendar", "syncDeleteFromGoogleCalendar", "createCalendarEvent", "getOrCreateClinicCalendar", "refreshAccessToken"]) {
      assert.equal(src.includes(viejo), false, `${rel} todavía usa ${viejo}`);
    }
  }
  const low = leer("src/lib/google-calendar.ts");
  assert.equal(/events\.update\(/.test(low), false, "mover usa events.patch");
  assert.equal(/"primary"/.test(low.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")), false, "no hay calendario personal de reserva");
  assert.equal(/"primary"/.test(leer("src/lib/agenda/google-sync-nucleo.ts").replace(/\/\/.*$/gm, "")), false);
});

test("la ruta de estado solo sincroniza cuando la cita entra o sale de cancelada/no-asistió", () => {
  const src = leer("src/app/api/appointments/[id]/status/route.ts");
  assert.match(src, /closesAppointment !== \(existing\.status === "CANCELLED" \|\| existing\.status === "NO_SHOW"\)/);
});

test("ningún archivo nuevo que escriba una cita CANCELLED se queda sin sincronizar", () => {
  // Quien ponga `status: "CANCELLED"` en una cita debe llamar a la sincronización o estar aquí con su razón.
  const EXENTOS: Record<string, string> = {
    "src/lib/anticipos/servicio.server.ts": "lo hace el cron con la dependencia alCancelarCita (ver src/app/api/cron/anticipos/route.ts)",
    "src/lib/barber/whatsapp.ts": "citas de barbería: no se sincronizan con Google Calendar",
    "src/app/dashboard/analytics/page.tsx": "solo lee",
  };
  const halladas: string[] = [];
  const recorrer = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "__tests__" && e.name !== "node_modules") recorrer(p); continue; }
      if (!/\.(ts|tsx)$/.test(e.name) || /\.test\./.test(e.name)) continue;
      const s = fs.readFileSync(p, "utf8");
      if (/status: *"(CANCELLED|NO_SHOW)"/.test(s) && /appointment\.(update|updateMany)|appointment: *\{/.test(s)) halladas.push(path.relative(RAIZ, p));
    }
  };
  recorrer(path.join(RAIZ, "src"));
  const sinSync = halladas.filter((f) => !leer(f).includes("sincronizarCitaEnSegundoPlano") && !(f in EXENTOS));
  assert.deepEqual(sinSync, [], `escriben citas canceladas sin sincronizar con Google: ${sinSync.join(", ")}`);
});
