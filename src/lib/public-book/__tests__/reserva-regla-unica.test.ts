/**
 * La reserva web pública usa la MISMA regla única de la Agenda (ws1-t10, decisión 4 de Rafael, 2-oct-2026):
 * solo se reserva con quien puede recibir citas (`RECIBE_CITAS_WHERE`: DOCTOR, ADMIN o SUPER_ADMIN activo con
 * «Aparece en la agenda» marcada). Antes bastaba con el rol y la cuenta activa: un dueño desmarcado salía en
 * /reservar, en la landing y en el portal del paciente, y la reserva le creaba citas que la Agenda no acepta.
 *
 * Run: npm run test:aparece-en-agenda
 *
 * Con el código viejo fallan: la reserva con el dueño desmarcado devolvía 200 y «cualquiera» podía caer en él.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Fila = { id: string; clinicId: string; role: string; isActive: boolean; agendaActive: boolean; firstName: string; lastName: string };

// El dueño (desmarcado) se llama «Aarón» para que, ordenado por nombre, fuera el PRIMERO de «cualquiera».
const USUARIOS: Fila[] = [
  { id: "dueno", clinicId: "c1", role: "SUPER_ADMIN", isActive: true, agendaActive: false, firstName: "Aarón", lastName: "Dueño" },
  { id: "admin", clinicId: "c1", role: "ADMIN", isActive: true, agendaActive: false, firstName: "Abril", lastName: "Admin" },
  { id: "doc", clinicId: "c1", role: "DOCTOR", isActive: true, agendaActive: true, firstName: "Luis", lastName: "Mora" },
  { id: "doc-apagado", clinicId: "c1", role: "DOCTOR", isActive: true, agendaActive: false, firstName: "Ana", lastName: "Apagada" },
  { id: "recep", clinicId: "c1", role: "RECEPTIONIST", isActive: true, agendaActive: true, firstName: "Lupe", lastName: "Mesa" },
];

/** Evalúa el `where` de Prisma que usa la ruta (clinicId, id, isActive, agendaActive, role.in). */
function cumple(u: Fila, w: Record<string, any>): boolean {
  if (w.clinicId !== undefined && u.clinicId !== w.clinicId) return false;
  if (w.id !== undefined && u.id !== w.id) return false;
  if (w.isActive !== undefined && u.isActive !== w.isActive) return false;
  if (w.agendaActive !== undefined && u.agendaActive !== w.agendaActive) return false;
  if (w.role?.in && !w.role.in.includes(u.role)) return false;
  return true;
}

let creadas: Array<Record<string, unknown>>;
beforeEach(() => {
  creadas = [];
});

// Mismo arnés que book-m9.test.ts (sin Next ni base).
(mock as any).module("@/lib/agenda/api-helpers", { namedExports: { isOverlapError: () => false } });
(mock as any).module("@/lib/failban", { namedExports: { persistentRateLimit: async () => null } });
(mock as any).module("@/lib/whatsapp/send-and-log", { namedExports: { sendWhatsAppLogged: async () => undefined } });
(mock as any).module("@/lib/agenda/google-sync", { namedExports: { sincronizarCitaEnSegundoPlano: async () => undefined } });
(mock as any).module("@/lib/patient-portal/guard", {
  namedExports: { getPatientPortalContext: async () => ({ account: { id: "acc1", email: "a@b.mx", phone: null, name: "Ana" }, links: [] }) },
});
(mock as any).module("@/lib/patient-portal/link", {
  namedExports: { resolveBookingPatient: async () => ({ patientId: "pac1", created: false }) },
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
          waConnected: false, waPhoneNumberId: null, waAccessToken: null, waTemplates: null,
          schedules: Array.from({ length: 7 }, (_, i) => ({ dayOfWeek: i, enabled: true, openTime: "00:00", closeTime: "23:59" })),
        }),
      },
      user: {
        findMany: async ({ where }: any) =>
          USUARIOS.filter((u) => cumple(u, where))
            .sort((a, b) => a.firstName.localeCompare(b.firstName))
            .map(({ id, firstName, lastName }) => ({ id, firstName, lastName })),
      },
      patient: { findFirst: async () => ({ phone: null }) },
      appointment: { count: async () => 0 },
      $transaction: async (fn: any) =>
        fn({
          appointment: {
            findMany: async () => [],
            create: async ({ data }: any) => {
              creadas.push(data);
              return { id: "ap1", ...data };
            },
          },
        }),
    },
  },
});

function pedido(doctorId: string) {
  const manana = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10);
  const body = {
    slug: "clinica-a", doctorId, date: manana, startTime: "10:00", type: "Limpieza",
    firstName: "Ana", lastName: "Pérez", phone: "5577776666", email: "a@b.mx",
  };
  return { json: async () => body, headers: new Headers(), nextUrl: { pathname: "/api/public/book" } } as any;
}
const reservar = async (doctorId: string) => {
  const { POST } = await import("@/app/api/public/book/route");
  return POST(pedido(doctorId));
};

test("con el doctor que aparece en la agenda, la reserva entra", async () => {
  const res = await reservar("doc");
  assert.equal(res.status, 200);
  assert.equal(creadas[0]?.doctorId, "doc");
});

test("el dueño, el administrador y el doctor con la casilla APAGADA no reciben reservas web", async () => {
  for (const id of ["dueno", "admin", "doc-apagado", "recep"]) {
    const res = await reservar(id);
    assert.equal(res.status, 404, `${id} recibió una reserva`);
  }
  assert.equal(creadas.length, 0);
});

test("«cualquiera disponible» solo cae en quien aparece en la agenda", async () => {
  const res = await reservar("any");
  assert.equal(res.status, 200);
  assert.equal(creadas[0]?.doctorId, "doc", "cayó en alguien fuera de la agenda");
});

// ─── El resto de la reserva de cara al paciente: misma regla, sin lista propia de roles ───────────────

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8");
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const PUBLICOS = [
  "src/app/reservar/[slug]/page.tsx",
  "src/app/api/public/availability/route.ts",
  "src/app/api/public/book/route.ts",
  "src/app/api/public/booking-request/route.ts",
  "src/app/api/public/clinicas/route.ts",
  "src/app/[slug]/clinic-landing-server.tsx",
  "src/app/descubre/clinica/[slug]/page.tsx",
  "src/lib/directory/query.ts",
  "src/app/api/paciente/booking/options/route.ts",
  "src/app/api/paciente/booking/slots/route.ts",
  "src/app/api/paciente/appointments/route.ts",
];

test("reservar, disponibilidad, solicitud, landing, directorio y portal del paciente filtran con RECIBE_CITAS_WHERE", () => {
  for (const f of PUBLICOS) {
    const c = sinComentarios(leer(f));
    assert.match(c, /import \{ RECIBE_CITAS_WHERE \} from "@\/lib\/agenda\/roles-que-atienden"/, f);
    assert.match(c, /\.\.\.RECIBE_CITAS_WHERE/, f);
    assert.doesNotMatch(c, /role: \{ in: \[\s*"DOCTOR",\s*"ADMIN",\s*"SUPER_ADMIN"\s*\] \}/, `${f} conserva su propia lista de roles`);
  }
  // La solicitud de cita filtra igual el doctor pedido y la lista de «cualquiera».
  const solicitud = sinComentarios(leer("src/app/api/public/booking-request/route.ts"));
  assert.equal(solicitud.match(/\.\.\.RECIBE_CITAS_WHERE/g)?.length, 2);
});
