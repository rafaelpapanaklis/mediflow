/**
 * El doctor de la factura sigue la regla única de la Agenda — ws1-t10, revisión final (fallo 7), 2-oct-2026.
 *
 * `GET /api/agenda/doctors` (la lista del doctor en «Nueva factura», invoice-editor-modal) seguía con
 * `role: "DOCTOR"` a secas: el dueño o administrador que atiende no salía, y un doctor con «Aparece en la agenda»
 * apagada sí. `POST /api/invoices` validaba el doctor con la misma lista vieja: abrir la lista sin abrir la
 * validación habría dado «Doctor inválido para esta clínica» al elegir al dueño. Ahora las dos usan
 * `RECIBE_CITAS_WHERE` (DOCTOR, ADMIN o SUPER_ADMIN activo y con la casilla marcada), siempre con el clinicId de
 * la sesión.
 *
 * Run: npm run test:aparece-en-agenda
 *
 * Llama a los HANDLERS REALES con `mock.module` sobre prisma y la sesión: no toca ninguna base. Con el código
 * viejo fallan las dos: la lista no trae al dueño ni al admin (y sí al doctor apagado) y el POST rechaza al dueño.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

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

test("GET /api/agenda/doctors: el dueño y el admin que atienden salen; el apagado, la baja, recepción y otra clínica no", async () => {
  const { GET } = await import("@/app/api/agenda/doctors/route");
  const res: any = await GET();
  assert.equal(res.status, 200);
  const { doctors } = await res.json();
  assert.deepEqual(
    doctors.map((d: { id: string }) => d.id).sort(),
    ["admin", "doc", "dueno"],
  );
  assert.equal(doctors.find((d: { id: string }) => d.id === "dueno").name, "Johnnifer Dueño");
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
  assert.equal(await aceptaAlDoctor("dueno"), true, "el dueño que atiende ya sale en la lista: no puede rebotar");
  assert.equal(await aceptaAlDoctor("admin"), true);
  assert.equal(await aceptaAlDoctor("doc"), true);
  for (const id of ["dueno-fuera", "doc-apagado", "doc-baja", "recep", "doc-otra"]) {
    assert.equal(await aceptaAlDoctor(id), false, id);
  }
  for (const w of wheresDelDoctor) assert.equal(w.clinicId, "c1", "siempre con el clinicId de la sesión");
});
