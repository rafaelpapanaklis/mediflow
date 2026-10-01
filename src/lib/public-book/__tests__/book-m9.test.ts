/**
 * M9 (auditoría 30-sep-2026) — /api/public/book: topes persistentes y el
 * WhatsApp de confirmación solo a un teléfono confiable.
 *
 * Run: npm run test:seguridad-rapidos
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  elegirDestinoWhatsApp, nombreParaPlantilla, telefonoUtil, TOPE_CITAS_WEB_PENDIENTES,
} from "../destino-whatsapp";

// ═══ Piezas puras ═══════════════════════════════════════════════════════════
test("el teléfono del formulario no es destino: gana el del expediente, luego el de la cuenta", () => {
  assert.equal(
    elegirDestinoWhatsApp({ pacienteYaRegistrado: true, telefonoDelExpediente: "55 1111 2222", telefonoDeLaCuenta: "5599998888" }),
    "5511112222",
  );
  assert.equal(
    elegirDestinoWhatsApp({ pacienteYaRegistrado: true, telefonoDelExpediente: null, telefonoDeLaCuenta: "5599998888" }),
    "5599998888",
  );
  // Paciente creado por esta misma reserva: su "expediente" es lo que se tecleó → no cuenta.
  assert.equal(
    elegirDestinoWhatsApp({ pacienteYaRegistrado: false, telefonoDelExpediente: "5500000000", telefonoDeLaCuenta: "5599998888" }),
    "5599998888",
  );
  assert.equal(
    elegirDestinoWhatsApp({ pacienteYaRegistrado: false, telefonoDelExpediente: "5500000000", telefonoDeLaCuenta: null }),
    null,
  );
});

test("teléfonos que no sirven (cortos, largos, vacíos) no son destino", () => {
  for (const v of [null, undefined, "", "123", "1".repeat(16)]) assert.equal(telefonoUtil(v as any), null);
  assert.equal(telefonoUtil("+52 (55) 1234-5678"), "525512345678");
});

test("el nombre de la plantilla no puede llevar enlaces, saltos ni símbolos", () => {
  assert.equal(nombreParaPlantilla("María José"), "María José");
  assert.equal(nombreParaPlantilla("O'Brien-Pérez"), "O'Brien-Pérez");
  const sucio = nombreParaPlantilla("Gana un iPhone en https://evil.example/premio\nllama YA");
  assert.ok(!/[:/\n]/.test(sucio), sucio);
  assert.ok(sucio.length <= 40);
  assert.equal(nombreParaPlantilla("<<<>>>"), "paciente");
  assert.equal(nombreParaPlantilla(null), "paciente");
});

// ═══ La ruta ═════════════════════════════════════════════════════════════════
let limites: Array<{ scope: string; id?: string; limit: number; windowSec: number }>;
let bloquear: Set<string>;
let enviados: any[];
let cuenta: any;
let paciente: { patientId: string; created: boolean };
let telefonoExpediente: string | null;
let pendientes: number;
let citasCreadas: number;

beforeEach(() => {
  limites = [];
  bloquear = new Set();
  enviados = [];
  citasCreadas = 0;
  pendientes = 0;
  telefonoExpediente = "5511112222";
  paciente = { patientId: "pac1", created: false };
  cuenta = { id: "acc1", email: "a@b.mx", phone: "5599998888", name: "Ana" };
});

// api-helpers importa `server-only`, que no existe fuera de Next: se sustituye.
(mock as any).module("@/lib/agenda/api-helpers", { namedExports: { isOverlapError: () => false } });
(mock as any).module("@/lib/failban", {
  namedExports: {
    persistentRateLimit: async (_req: any, o: any) => {
      limites.push(o);
      return bloquear.has(o.scope)
        ? new Response(JSON.stringify({ error: "Demasiados intentos" }), { status: 429 })
        : null;
    },
  },
});
(mock as any).module("@/lib/whatsapp/send-and-log", { namedExports: { sendWhatsAppLogged: async (a: any) => { enviados.push(a); } } });
(mock as any).module("@/lib/agenda/google-sync", { namedExports: { sincronizarCitaEnSegundoPlano: async () => undefined } });
(mock as any).module("@/lib/patient-portal/guard", {
  namedExports: { getPatientPortalContext: async () => ({ account: cuenta, links: [] }) },
});
(mock as any).module("@/lib/patient-portal/link", {
  namedExports: { resolveBookingPatient: async () => paciente },
});
(mock as any).module("@/lib/agenda-bloqueos/consulta.server", { namedExports: { leerBloqueosDelRango: async () => [] } });
(mock as any).module("@/lib/horario-doctor/consulta.server", { namedExports: { leerHorariosDeDoctores: async () => new Map() } });
(mock as any).module("@/lib/movimientos-paciente/registrar", { namedExports: { registrarMovimientoExterno: async () => undefined } });
(mock as any).module("@/lib/prisma", {
  namedExports: {
    prisma: {
      clinic: {
        findUnique: async () => ({
          id: "c1", name: "Clínica A", phone: "5550001111", timezone: "America/Mexico_City",
          waConnected: true, waPhoneNumberId: "wa1", waAccessToken: "tok", waTemplates: null,
          schedules: Array.from({ length: 7 }, (_, i) => ({ dayOfWeek: i, enabled: true, openTime: "00:00", closeTime: "23:59" })),
        }),
      },
      user: { findMany: async () => [{ id: "d1", firstName: "Luis", lastName: "Mora" }] },
      patient: { findFirst: async () => ({ phone: telefonoExpediente }) },
      appointment: { count: async () => pendientes },
      $transaction: async (fn: any) =>
        fn({
          appointment: {
            findMany: async () => [],
            create: async ({ data }: any) => { citasCreadas++; return { id: "ap1", ...data }; },
          },
        }),
    },
  },
});

function pedido(over: Record<string, unknown> = {}) {
  const manana = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10);
  const body = {
    slug: "clinica-a", doctorId: "d1", date: manana, startTime: "10:00", type: "Limpieza",
    firstName: "Ana", lastName: "Pérez", phone: "5577776666", email: "a@b.mx", ...over,
  };
  return { json: async () => body, headers: new Headers(), nextUrl: { pathname: "/api/public/book" } } as any;
}
const reservar = async (over?: Record<string, unknown>) => {
  const { POST } = await import("@/app/api/public/book/route");
  return POST(pedido(over));
};

test("la reserva usa límites PERSISTENTES por IP y por cuenta", async () => {
  const res = await reservar();
  assert.equal(res.status, 200);
  assert.ok(limites.some((l) => l.scope === "public-book:ip"));
  const porCuenta = limites.find((l) => l.scope === "public-book:cuenta");
  assert.ok(porCuenta && porCuenta.id === "acc1" && porCuenta.windowSec === 3600);
});

test("cuenta que excede su tope: 429 y no se crea ninguna cita ni se manda WhatsApp", async () => {
  bloquear.add("public-book:cuenta");
  const res = await reservar();
  assert.equal(res.status, 429);
  assert.equal(citasCreadas, 0);
  assert.equal(enviados.length, 0);
});

test("el WhatsApp NO va al teléfono tecleado en el formulario: va al del expediente", async () => {
  const res = await reservar({ phone: "5577776666" });
  assert.equal(res.status, 200);
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].to, "5511112222");
  assert.notEqual(enviados[0].to, "5577776666");
});

test("paciente nuevo (creado en la reserva): va al teléfono de la CUENTA, nunca al tecleado", async () => {
  paciente = { patientId: "pac2", created: true };
  await reservar({ phone: "5577776666" });
  assert.equal(enviados[0].to, "5599998888");
});

test("sin teléfono confiable (paciente nuevo y cuenta sin teléfono): la cita se crea y no sale WhatsApp", async () => {
  paciente = { patientId: "pac2", created: true };
  cuenta = { ...cuenta, phone: null };
  const res = await reservar({ phone: "5577776666" });
  assert.equal(res.status, 200);
  assert.equal(citasCreadas, 1);
  assert.equal(enviados.length, 0);
});

test("cada teléfono destino tiene su tope diario: excedido, la cita se crea y no sale el mensaje", async () => {
  bloquear.add("public-book:wa-telefono");
  const res = await reservar();
  assert.equal(res.status, 200);
  assert.equal(citasCreadas, 1);
  assert.equal(enviados.length, 0);
  const l = limites.find((x) => x.scope === "public-book:wa-telefono")!;
  assert.equal(l.id, "5511112222");
  assert.equal(l.windowSec, 86400);
});

test("el nombre dentro de la plantilla sale saneado (sin enlaces)", async () => {
  await reservar({ firstName: "Gana en https://evil.example/x\nYA" });
  const nombre = enviados[0].templateParams[0] as string;
  assert.ok(!/[:/\n]/.test(nombre), nombre);
});

test(`con ${TOPE_CITAS_WEB_PENDIENTES} citas web pendientes con esa clínica: 429 y no se crea otra`, async () => {
  pendientes = TOPE_CITAS_WEB_PENDIENTES;
  const res = await reservar();
  assert.equal(res.status, 429);
  assert.equal(citasCreadas, 0);
  assert.equal(enviados.length, 0);
});
