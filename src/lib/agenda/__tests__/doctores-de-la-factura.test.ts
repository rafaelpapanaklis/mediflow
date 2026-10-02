/**
 * El doctor de la factura: quien ATIENDE y está activo — ws1-t10, revisión final (fallo 7), 2-oct-2026.
 *
 * `GET /api/agenda/doctors` (la lista del doctor en «Nueva factura», invoice-editor-modal) seguía con
 * `role: "DOCTOR"` a secas: el dueño o administrador que atiende no salía. `POST /api/invoices` validaba el
 * doctor con la misma lista vieja: abrir la lista sin abrir la validación habría dado «Doctor inválido para esta
 * clínica» al elegir al dueño. Ahora las dos usan `ATIENDE_WHERE` (DOCTOR, ADMIN o SUPER_ADMIN activo), siempre
 * con el clinicId de la sesión. Decisión de Rafael (2-oct-2026): «Aparece en la agenda» SOLO controla la agenda,
 * así que en la factura salen también los que la tienen apagada; en la agenda, no.
 *
 * Run: npm run test:aparece-en-agenda
 *
 * Llama a los HANDLERS REALES con `mock.module` sobre prisma y la sesión: no toca ninguna base. Con el código
 * viejo fallan: la lista no trae al dueño ni al admin y el POST los rechaza.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { RECIBE_CITAS_WHERE, puedeRecibirCitas } from "@/lib/agenda/roles-que-atienden";

type Fila = { id: string; clinicId: string; role: string; isActive: boolean; agendaActive: boolean; firstName: string; lastName: string };

const USUARIOS: Fila[] = [
  { id: "dueno", clinicId: "c1", role: "SUPER_ADMIN", isActive: true, agendaActive: true, firstName: "Johnnifer", lastName: "Dueño" },
  { id: "dueno-fuera", clinicId: "c1", role: "SUPER_ADMIN", isActive: true, agendaActive: false, firstName: "Aarón", lastName: "Apagado" },
  { id: "admin", clinicId: "c1", role: "ADMIN", isActive: true, agendaActive: true, firstName: "Abril", lastName: "Admin" },
  { id: "doc", clinicId: "c1", role: "DOCTOR", isActive: true, agendaActive: true, firstName: "Luis", lastName: "Mora" },
  { id: "doc-apagado", clinicId: "c1", role: "DOCTOR", isActive: true, agendaActive: false, firstName: "Ana", lastName: "Apagada" },
  { id: "doc-baja", clinicId: "c1", role: "DOCTOR", isActive: false, agendaActive: true, firstName: "Beto", lastName: "Baja" },
  { id: "recep", clinicId: "c1", role: "RECEPTIONIST", isActive: true, agendaActive: true, firstName: "Lupe", lastName: "Mesa" },
  { id: "doc-otra", clinicId: "c2", role: "DOCTOR", isActive: true, agendaActive: true, firstName: "Otro", lastName: "Lado" },
];

/** Evalúa el `where` de Prisma que usan las rutas (clinicId, id, isActive, agendaActive, role o role.in). */
function cumple(u: Fila, w: Record<string, any>): boolean {
  for (const [k, v] of Object.entries(w)) {
    if (k === "role") {
      if (typeof v === "string" ? u.role !== v : !(v?.in ?? []).includes(u.role)) return false;
    } else if (["id", "clinicId", "isActive", "agendaActive"].includes(k)) {
      if ((u as Record<string, unknown>)[k] !== v) return false;
    } else {
      throw new Error(`clave de where no prevista en el doble: ${k}`);
    }
  }
  return true;
}

/** Lo que el POST hace DESPUÉS de validar al doctor no es de esta prueba: se corta ahí. */
class SiguioDeLargo extends Error {}
const wheresDelDoctor: Array<Record<string, unknown>> = [];

const prismaDoble: any = new Proxy(
  {
    user: {
      findMany: async ({ where }: any) =>
        USUARIOS.filter((u) => cumple(u, where))
          .sort((a, b) => a.firstName.localeCompare(b.firstName))
          .map((u) => ({ ...u, avatarUrl: null, color: null })),
      findFirst: async ({ where }: any) => {
        wheresDelDoctor.push(where);
        const u = USUARIOS.find((x) => cumple(x, where));
        return u ? { id: u.id } : null;
      },
    },
  },
  {
    get(target: any, prop: string) {
      if (prop in target) return target[prop];
      if (prop === "then") return undefined;
      throw new SiguioDeLargo(`prisma.${prop}`);
    },
  },
);

const sesionAgenda = {
  user: { id: "u1", role: "ADMIN", clinicId: "c1" },
  clinic: { id: "c1", timezone: "America/Mexico_City" },
};
const sesionFactura: any = { clinicId: "c1", userId: "u1", role: "ADMIN", permissionsOverride: null, timezone: "America/Mexico_City", clinic: { timezone: "America/Mexico_City" } };

(mock as any).module("@/lib/prisma", { namedExports: { prisma: prismaDoble } });
(mock as any).module("@/lib/agenda/api-helpers", { namedExports: { loadClinicSession: async () => sesionAgenda } });
(mock as any).module("@/lib/auth-context", { namedExports: { getAuthContext: async () => sesionFactura } });
(mock as any).module("@/lib/auth/require-permission", { namedExports: { denyIfMissingPermission: () => null } });
(mock as any).module("next/cache", { namedExports: { revalidatePath: () => {}, revalidateTag: () => {} } });
(mock as any).module("@/lib/audit", { namedExports: { logMutation: async () => {}, logAudit: async () => {} } });
(mock as any).module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => {} } });

async function listaDeLaFactura(): Promise<Array<{ id: string; name: string; activeInAgenda: boolean }>> {
  const { GET } = await import("@/app/api/agenda/doctors/route");
  const res: any = await GET();
  assert.equal(res.status, 200);
  return (await res.json()).doctors;
}

test("GET /api/agenda/doctors: todos los que atienden y están activos, con o sin la casilla; la baja, recepción y otra clínica no", async () => {
  const doctors = await listaDeLaFactura();
  assert.deepEqual(
    doctors.map((d) => d.id).sort(),
    ["admin", "doc", "doc-apagado", "dueno", "dueno-fuera"],
  );
  assert.equal(doctors.find((d) => d.id === "dueno")!.name, "Johnnifer Dueño");
});

test("el dueño con «Aparece en la agenda» apagada SÍ sale en la factura y NO en la agenda", async () => {
  const dueno = USUARIOS.find((u) => u.id === "dueno-fuera")!;
  // Factura: sale en la lista de «Nueva factura» (con su casilla tal cual) y el POST lo acepta.
  const enLaLista = (await listaDeLaFactura()).find((d) => d.id === dueno.id);
  assert.ok(enLaLista, "sale en la lista del doctor de la factura");
  assert.equal(enLaLista!.activeInAgenda, false);
  assert.equal(await aceptaAlDoctor(dueno.id), true, "el POST de la factura lo acepta");
  // Agenda: la regla de quién recibe citas (la que usan columnas, «Nueva cita», el POST/PATCH de citas, la lista
  // de espera y la reserva) lo deja fuera.
  assert.equal(puedeRecibirCitas(dueno), false);
  assert.equal(USUARIOS.some((u) => u.id === dueno.id && cumple(u, { clinicId: "c1", ...RECIBE_CITAS_WHERE })), false);
});

function crear(doctorId: string): any {
  const body = {
    patientId: "p1",
    doctorId,
    items: [{ description: "Limpieza", quantity: 1, unitPrice: 500, total: 500 }],
  };
  return { json: async () => body, headers: new Headers(), url: "http://localhost/api/invoices" };
}

/** `true` si el POST aceptó al doctor (siguió de largo hasta lo que el doble no conoce). */
async function aceptaAlDoctor(doctorId: string): Promise<boolean> {
  const { POST } = await import("@/app/api/invoices/route");
  try {
    const res: any = await POST(crear(doctorId));
    const cuerpo = await res.json().catch(() => ({}));
    if (res.status === 400 && cuerpo.error === "Doctor inválido para esta clínica") return false;
    // Cualquier otra respuesta: el doctor pasó y algo de más adelante (que el doble corta) respondió.
    return true;
  } catch (e) {
    if (e instanceof SiguioDeLargo) return true;
    throw e;
  }
}

test("POST /api/invoices valida el doctor con la MISMA regla que la lista (y por la clínica de la sesión)", async () => {
  const lista = (await listaDeLaFactura()).map((d) => d.id);
  for (const u of USUARIOS) {
    assert.equal(await aceptaAlDoctor(u.id), lista.includes(u.id), `${u.id}: lo que enseña la lista es lo que acepta el POST`);
  }
  assert.equal(await aceptaAlDoctor("dueno"), true, "el dueño que atiende ya sale en la lista: no puede rebotar");
  for (const id of ["doc-baja", "recep", "doc-otra"]) {
    assert.equal(await aceptaAlDoctor(id), false, id);
  }
  for (const w of wheresDelDoctor) assert.equal(w.clinicId, "c1", "siempre con el clinicId de la sesión");
});
