/**
 * ws1-t11 v3 · H3 de la revisión de t2 — las rutas de CAMBIO que pedían solo
 * `requireAdmin` (el ROL) respetan también el interruptor que el dueño apaga
 * en Equipo → Permisos (permissionsOverride). Misma decisión que el lead 15
 * (WhatsApp Cloud): el override del dueño se respeta y el SUPER_ADMIN no se
 * bloquea.
 *
 * Run: npm run test:admin-con-override
 *
 *   • POST /api/cfdi/[cfdiId]/cancelar   → billing.refund («Reembolsar / cancelar»)
 *   • POST /api/auth/2fa/clinic-policy    → settings.edit
 *   • PATCH /api/ai-wallet/funciones      → settings.edit
 *   • POST /api/whatsapp/send             → whatsapp.send
 *
 * Route handlers REALES con sus imports doblados (_arnes-paginas-server.ts) y
 * la regla de permisos REAL; ni Facturapi, ni Meta, ni base.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";
import { preparar, respuestas, llamadas, prismaFalso, Redireccion } from "./_arnes-paginas-server";

const R = {
  cancelar: "src/app/api/cfdi/[cfdiId]/cancelar/route.ts",
  politica2fa: "src/app/api/auth/2fa/clinic-policy/route.ts",
  funcionesIa: "src/app/api/ai-wallet/funciones/route.ts",
  whatsapp: "src/app/api/whatsapp/send/route.ts",
  facturaCfdi: "src/app/api/cfdi/factura/[invoiceId]/route.ts",
};

const prisma = prismaFalso();
preparar({
  paginas: Object.values(R),
  reales: ["next/server", "@/lib/auth/require-permission", "@/lib/auth/permissions", "@/lib/ai-billing/interruptores", "@/lib/cfdi/mensajes", "@/lib/invoices/cfdi-cancelacion", "@/lib/auth/admin-con-permiso"],
  fijos: {
    "@/lib/prisma": { prisma },
    "next/navigation": { redirect: (d: string) => { throw new Redireccion(d); }, notFound: () => { throw new Error("404"); } },
  },
});

let ctx: any;
function como(role: string, permissionsOverride: string[] = []) {
  ctx = {
    userId: "u1", clinicId: "cli_a", role, permissionsOverride, clinicCategory: "DENTAL",
    isAdmin: role === "ADMIN" || role === "SUPER_ADMIN", isSuperAdmin: role === "SUPER_ADMIN",
  };
}
// El dueño le dejó lo de todos los días y le apagó lo que prueba cada ruta.
const RECORTADO = ["today.view", "agenda.view", "patients.view", "billing.view"];

beforeEach(() => {
  llamadas.length = 0;
  respuestas.clear();
  respuestas.set("@/lib/auth-context#getAuthContext", async () => ctx);
  // Copia literal de requireAdmin (src/lib/auth-context.ts): solo el rol.
  respuestas.set("@/lib/auth-context#requireAdmin", (c: any) =>
    !c ? NextResponse.json({ error: "No autenticado" }, { status: 401 })
      : !c.isAdmin ? NextResponse.json({ error: "Solo administradores" }, { status: 403 }) : null);
  respuestas.set("@/lib/rate-limit#rateLimit", () => null);
  respuestas.set("prisma.cfdiRecord.findFirst", () => ({ invoiceId: null, id: "cfdi1", status: "valid" }));
  respuestas.set("prisma.clinic.findUnique", () => ({ id: "cli_a", aiSettings: null, name: "Clínica A", timezone: "America/Mexico_City", waConnected: true }));
  respuestas.set("prisma.appointment.findFirst", () => null);
});

const escrituras = () =>
  llamadas.filter((l) => /^prisma\.\w+\.(update|updateMany|create|upsert|delete|\$transaction|\$executeRaw|\$queryRaw)|#(pedirCancelacion|sendWhatsAppLogged|logAudit|logMutation)$/.test(l.quien)).map((l) => l.quien);

const json = (url: string, method: string, body: unknown) =>
  new NextRequest(url, { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });

const LLAMADAS: Record<Exclude<keyof typeof R, "facturaCfdi">, { llave: string; correr: () => Promise<Response> }> = {
  cancelar: {
    llave: "billing.refund",
    correr: async () => (await import(`../../../../${R.cancelar}`)).POST(
      json("http://x/api/cfdi/cfdi1/cancelar", "POST", { motive: "02", reason: "error en el monto" }),
      { params: Promise.resolve({ cfdiId: "cfdi1" }) },
    ),
  },
  politica2fa: {
    llave: "settings.edit",
    correr: async () => (await import(`../../../../${R.politica2fa}`)).POST(json("http://x/api/auth/2fa/clinic-policy", "POST", { require2fa: false })),
  },
  funcionesIa: {
    llave: "settings.edit",
    correr: async () => (await import(`../../../../${R.funcionesIa}`)).PATCH(json("http://x/api/ai-wallet/funciones", "PATCH", { funcion: "dictation", encendida: false })),
  },
  whatsapp: {
    llave: "whatsapp.send",
    correr: async () => (await import(`../../../../${R.whatsapp}`)).POST(json("http://x/api/whatsapp/send", "POST", { appointmentId: "a1" })),
  },
};

const LLAMADAS_DE_CAMBIO = LLAMADAS;
for (const [nombre, { llave, correr }] of Object.entries(LLAMADAS_DE_CAMBIO)) {
  test(`${nombre} · ADMIN al que el dueño le apagó «${llave}»: 403 y no toca nada`, async () => {
    como("ADMIN", RECORTADO);
    const r = await correr();
    assert.equal(r.status, 403, `respondió ${r.status}`);
    assert.deepEqual(escrituras(), []);
    const cuerpo = await r.json();
    assert.equal(cuerpo.permiso, llave, JSON.stringify(cuerpo));
  });

  test(`${nombre} · ADMIN con su default pasa la puerta como siempre`, async () => {
    como("ADMIN");
    const r = await correr();
    assert.notEqual(r.status, 403, `respondió 403: ${JSON.stringify(await r.json())}`);
  });

  test(`${nombre} · el SUPER_ADMIN no se bloquea aunque su override no traiga «${llave}»`, async () => {
    como("SUPER_ADMIN", RECORTADO);
    const r = await correr();
    assert.notEqual(r.status, 403, `respondió 403: ${JSON.stringify(await r.json())}`);
  });

  test(`${nombre} · un DOCTOR sigue fuera aunque le den «${llave}» (no se abre a nadie nuevo)`, async () => {
    como("DOCTOR", [llave]);
    const r = await correr();
    assert.equal(r.status, 403);
    assert.deepEqual(escrituras(), []);
  });
}

// ══════════════════ ws1-t11 v5 · el espejo de la UI dice lo mismo que el servidor ══════════════════

test("adminConPermiso (lo que la UI enseña) == lo que cada ruta acepta, rol por rol y override por override", async () => {
  const { adminConPermiso } = await import("@/lib/auth/admin-con-permiso");
  for (const [nombre, { llave, correr }] of Object.entries(LLAMADAS_DE_CAMBIO)) {
    for (const role of ["SUPER_ADMIN", "ADMIN", "DOCTOR", "RECEPTIONIST", "READONLY"]) {
      for (const override of [[], RECORTADO, [llave], [...RECORTADO, llave]]) {
        como(role, override);
        const r = await correr();
        const servidor = r.status !== 403 && r.status !== 401;
        assert.equal(adminConPermiso(ctx, llave as never), servidor, `${nombre} · ${role} · [${override.join(",")}]: la UI y el servidor no coinciden`);
      }
    }
  }
});

test("GET /api/ai-wallet/funciones: «puedeCambiar» sigue el criterio del PATCH", async () => {
  const { GET } = await import(`../../../../${R.funcionesIa}`);
  const casos: Array<[string, string[], boolean]> = [["ADMIN", [], true], ["ADMIN", RECORTADO, false], ["SUPER_ADMIN", RECORTADO, true], ["DOCTOR", ["settings.edit"], false]];
  for (const [role, override, esperado] of casos) {
    como(role, override);
    const d = await (await GET()).json();
    assert.equal(d.puedeCambiar, esperado, `${role} [${override.join(",")}]`);
  }
});

test("GET /api/cfdi/factura/[invoiceId]: cancelar, timbrar y devolver salen con el criterio de SU ruta", async () => {
  respuestas.set("prisma.invoice.findFirst", () => ({ patientId: null, cfdiUuid: "U-1", paid: 100, balance: 0 }));
  respuestas.set("@/lib/invoices/cfdi-cancelacion.server#cfdisDeLaFactura", async () => ({ listo: true, sqlPendiente: null, cfdis: [] }));
  const { GET } = await import(`../../../../${R.facturaCfdi}`);
  const pedir = async () => (await GET(new NextRequest("http://x/api/cfdi/factura/f1"), { params: Promise.resolve({ invoiceId: "f1" }) })).json();
  como("ADMIN", RECORTADO);
  let d = await pedir();
  assert.deepEqual([d.puedeCancelar, d.puedeTimbrar, d.puedeDevolver], [false, true, false], "ADMIN sin «Reembolsar / cancelar»");
  como("ADMIN");
  d = await pedir();
  assert.deepEqual([d.puedeCancelar, d.puedeTimbrar, d.puedeDevolver], [true, true, true], "ADMIN por defecto");
  como("SUPER_ADMIN", RECORTADO);
  d = await pedir();
  assert.equal(d.puedeCancelar, true, "el dueño cancela aunque su override no traiga la llave (como la ruta)");
});
