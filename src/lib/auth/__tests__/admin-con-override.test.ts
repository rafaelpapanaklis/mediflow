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
};

const prisma = prismaFalso();
preparar({
  paginas: Object.values(R),
  reales: ["next/server", "@/lib/auth/require-permission", "@/lib/auth/permissions", "@/lib/ai-billing/interruptores", "@/lib/cfdi/mensajes", "@/lib/invoices/cfdi-cancelacion"],
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

const LLAMADAS: Record<keyof typeof R, { llave: string; correr: () => Promise<Response> }> = {
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

for (const [nombre, { llave, correr }] of Object.entries(LLAMADAS)) {
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
