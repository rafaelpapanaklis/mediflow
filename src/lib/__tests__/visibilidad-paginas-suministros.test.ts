/**
 * ws1-t11 · lead 13 (auditoría run-2) — las páginas server de órdenes de
 * laboratorio, paquetes y teleconsulta respetan la visibilidad por paciente
 * (patients.visibleUserIds), igual que sus API.
 *
 * Run: npm run test:visibilidad-paginas-suministros
 *
 * Un paciente con lista de visibilidad «no existe» para el staff no-admin que
 * no está en ella (src/lib/patient-visibility.ts). GET /api/ordenes-laboratorio
 * excluye sus órdenes, GET /api/ordenes-laboratorio/[id] da 404 y
 * /api/packages/redeem lo valida; las páginas server los listaban con solo el
 * filtro de clínica (nombre del paciente, notas, paquetes, citas en línea).
 *
 * Se ejecutan las páginas REALES (imports doblados, ver
 * auth/__tests__/_arnes-paginas-server.ts) con la regla de visibilidad REAL y
 * un Prisma de mentira que SÍ evalúa los `where` sobre filas en memoria.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  preparar, respuestas, llamadas, propsDe, exportado, prismaFalso, Redireccion, NoEncontrado, cumple,
} from "../auth/__tests__/_arnes-paginas-server";

const LISTA_ORDENES = "src/app/dashboard/ordenes-laboratorio/page.tsx";
const DETALLE_ORDEN = "src/app/dashboard/ordenes-laboratorio/[orderId]/page.tsx";
const PAQUETES = "src/app/dashboard/packages/page.tsx";
const TELECONSULTA = "src/app/dashboard/teleconsulta/page.tsx";

const prisma = prismaFalso();
preparar({
  paginas: [LISTA_ORDENES, DETALLE_ORDEN, PAQUETES, TELECONSULTA],
  reales: ["@/lib/patient-visibility", "@/lib/laboratorios/ordenes-visibles", "@/lib/laboratorios/types", "react"],
  fijos: {
    "@/lib/prisma": { prisma },
    "next/navigation": {
      redirect: (d: string) => { throw new Redireccion(d); },
      notFound: () => { throw new NoEncontrado(); },
    },
  },
});

const PACIENTES = [
  { id: "p_pub", clinicId: "cli_a", firstName: "Pública", lastName: "Uno", visibleUserIds: [] as string[] },
  { id: "p_priv", clinicId: "cli_a", firstName: "Privada", lastName: "Dos", visibleUserIds: ["u_otro"] },
];
const pac = (id: string) => PACIENTES.find((p) => p.id === id)!;
const F = new Date("2026-10-01T15:00:00Z");
const LAB = {
  id: "lab1", name: "Lab", slug: "lab", rfc: null, email: null, phone: null, whatsapp: null, website: null, address: null,
  city: null, state: null, logoUrl: null, coverImageUrl: null, description: null, founded: null, services: [], hours: null,
  coverageZones: [], rating: 0, ratingCount: 0, onTimePct: 0, totalOrders: 0, status: "APPROVED", trafficLevel: "LOW",
  trafficManualMin: null, trafficManualMax: null, trafficNote: null, trafficUpdatedAt: F, createdAt: F, updatedAt: F,
};
const orden = (id: string, patientId: string | null, patientName: string | null) => ({
  id, orderNumber: id, clinicId: "cli_a", labId: "lab1", lab: LAB, serviceId: null, patientId, patientName,
  internalRef: null, status: "SOLICITADA", notes: `notas de ${patientName}`, basePrice: 0, extrasTotal: 0, total: 0,
  paymentStatus: "PENDING", paymentMethod: null, paidAt: null, priority: "NORMAL", pickupAt: null, etaAt: null,
  courier: null, events: [], files: [], createdAt: F, updatedAt: F,
});
const ORDENES = [orden("o_pub", "p_pub", "Pública Uno"), orden("o_priv", "p_priv", "Privada Dos"), orden("o_sin", null, null)];
const CANJES = PACIENTES.map((p) => ({
  id: `r_${p.id}`, clinicId: "cli_a", status: "ACTIVE", patientId: p.id, patient: p, package: { id: "pk", name: "Limpiezas" }, purchasedAt: F,
}));
const CITAS = PACIENTES.map((p) => ({
  id: `a_${p.id}`, clinicId: "cli_a", mode: "TELECONSULTATION", patientId: p.id, patient: p, startsAt: F,
  doctor: { firstName: "Doc", lastName: "Tor" }, paymentStatus: "paid", status: "SCHEDULED",
}));

let usuario: any;
function como(role: string, id = "u1") {
  usuario = { id, clinicId: "cli_a", role, permissionsOverride: [], clinic: { id: "cli_a", category: "MEDICINE", timezone: "America/Mexico_City" } };
}

beforeEach(() => {
  llamadas.length = 0;
  respuestas.clear();
  respuestas.set("@/lib/auth#getCurrentUser", async () => usuario);
  respuestas.set("@/lib/dashboard/guardia-categoria.server#exigirCategoriaParaPagina", async () => usuario);
  respuestas.set("@/i18n/server#getServerT", async () => ({ t: (k: string) => k, locale: "es" }));
  respuestas.set("prisma.patient.findMany", ({ where }: any) => PACIENTES.filter((p) => cumple(p, where)));
  respuestas.set("prisma.patient.findFirst", ({ where }: any) => PACIENTES.find((p) => cumple(p, where)) ?? null);
  respuestas.set("prisma.dentalLabOrder.findMany", ({ where }: any) => ORDENES.filter((o) => cumple(o, where)));
  respuestas.set("prisma.dentalLabOrder.findFirst", ({ where }: any) => ORDENES.find((o) => cumple(o, where)) ?? null);
  respuestas.set("prisma.servicePackage.findMany", () => []);
  respuestas.set("prisma.packageRedemption.findMany", ({ where }: any) => CANJES.filter((r) => cumple(r, where)));
  respuestas.set("prisma.appointment.findMany", ({ where }: any) => CITAS.filter((a) => cumple(a, where)));
});

async function correr(pagina: string, props: Record<string, unknown> = {}) {
  const mod = await import(`../../../${pagina}`);
  try {
    return { arbol: await mod.default(props), error: null as unknown };
  } catch (e) {
    return { arbol: null, error: e };
  }
}

/** Todo el texto que la página entrega (árbol + props), para buscar el nombre del paciente. */
function texto(x: unknown): string {
  const vistos = new WeakSet<object>();
  const out: string[] = [];
  const ir = (v: unknown) => {
    if (v == null) return;
    if (typeof v === "string" || typeof v === "number") { out.push(String(v)); return; }
    if (typeof v !== "object" || vistos.has(v as object)) return;
    vistos.add(v as object);
    if (v instanceof Date) return;
    for (const w of Array.isArray(v) ? v : Object.values(v as object)) ir(w);
  };
  ir(x);
  return out.join(" ");
}

// ══════════════════ órdenes de laboratorio ══════════════════

test("lista de órdenes · doctor fuera de la lista del paciente: no recibe su orden (ni el nombre ni las notas)", async () => {
  como("DOCTOR");
  const { arbol, error } = await correr(LISTA_ORDENES);
  assert.equal(error, null, String(error));
  const [p] = propsDe(arbol, exportado("./ordenes-client", "OrdenesClient"));
  const ids = (p.orders as Array<{ id: string }>).map((o) => o.id).sort();
  assert.deepEqual(ids, ["o_pub", "o_sin"], "la orden del paciente restringido viaja al cliente");
  assert.doesNotMatch(texto(p), /Privada Dos/);
});

test("lista de órdenes · el admin y quien está en la lista las ven todas", async () => {
  como("ADMIN");
  let { arbol } = await correr(LISTA_ORDENES);
  let [p] = propsDe(arbol, exportado("./ordenes-client", "OrdenesClient"));
  assert.equal((p.orders as unknown[]).length, 3);
  como("DOCTOR", "u_otro");
  ({ arbol } = await correr(LISTA_ORDENES));
  [p] = propsDe(arbol, exportado("./ordenes-client", "OrdenesClient"));
  assert.equal((p.orders as unknown[]).length, 3);
});

test("detalle de la orden · doctor fuera de la lista: 404 (no existe para él)", async () => {
  como("RECEPTIONIST");
  const { error } = await correr(DETALLE_ORDEN, { params: Promise.resolve({ orderId: "o_priv" }) });
  assert.ok(error instanceof NoEncontrado, `esperaba 404 y fue: ${String(error)}`);
});

test("detalle de la orden · la de un paciente visible y la que no tiene paciente se siguen abriendo", async () => {
  como("RECEPTIONIST");
  for (const orderId of ["o_pub", "o_sin"]) {
    const { error } = await correr(DETALLE_ORDEN, { params: Promise.resolve({ orderId }) });
    assert.ok(!(error instanceof NoEncontrado), `${orderId} dio 404`);
  }
  como("ADMIN");
  const { error } = await correr(DETALLE_ORDEN, { params: Promise.resolve({ orderId: "o_priv" }) });
  assert.ok(!(error instanceof NoEncontrado), "el admin ve todo");
});

// ══════════════════ paquetes ══════════════════

test("paquetes · staff fuera de la lista: los paquetes activos del paciente restringido no salen", async () => {
  como("RECEPTIONIST");
  const { arbol, error } = await correr(PAQUETES);
  assert.equal(error, null, String(error));
  const [p] = propsDe(arbol, exportado("./packages-client", "PackagesClient"));
  assert.deepEqual((p.initialRedemptions as Array<{ id: string }>).map((r) => r.id), ["r_p_pub"]);
  como("ADMIN");
  const [q] = propsDe((await correr(PAQUETES)).arbol, exportado("./packages-client", "PackagesClient"));
  assert.equal((q.initialRedemptions as unknown[]).length, 2);
});

// ══════════════════ teleconsulta ══════════════════

test("teleconsulta · staff fuera de la lista: la cita en línea del paciente restringido no se pinta", async () => {
  como("DOCTOR");
  const { arbol, error } = await correr(TELECONSULTA);
  assert.equal(error, null, String(error));
  const t = texto(arbol);
  assert.match(t, /Pública/);
  assert.doesNotMatch(t, /Privada/);
  como("ADMIN");
  assert.match(texto((await correr(TELECONSULTA)).arbol), /Privada/);
});
