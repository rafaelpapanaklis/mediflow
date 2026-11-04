/**
 * Seguridad (auditoría «cloudflare», nº3): la dirección de entrada de Postmark
 * elige la clínica en el webhook de correo entrante. Una clínica no puede
 * quedarse con la de otra. (Twilio no se toca: la plataforma no lo usa.)
 *
 * Run: npm run test:seg-direcciones-entrada
 *   (--experimental-test-module-mocks: se ejecutan de verdad PATCH /api/settings
 *    y POST /api/webhooks/postmark/inbound, con Prisma y la auth sustituidas.
 *    Sin red ni base.)
 *
 * Con el código de 0f61a7e0d:
 *   · PATCH /api/settings guardaba la dirección de OTRA clínica (200);
 *   · el webhook de Postmark entregaba el correo a una de las dos clínicas
 *     que tenían la misma dirección (findFirst sin orden).
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface Clinica {
  id: string;
  postmarkInboundEmail: string | null;
  twilioWhatsappNumber: string | null;
  twilioAuthToken: string | null;
}

let clinicas: Clinica[] = [];
let escrito: any = null;
let hilosCreados: any[] = [];
let mensajesCreados: any[] = [];

function casa(c: Clinica, where: any): boolean {
  if (where.id?.not && c.id === where.id.not) return false;
  for (const campo of ["postmarkInboundEmail", "twilioWhatsappNumber"] as const) {
    if (!(campo in where)) continue;
    const cond = where[campo];
    const valor = c[campo];
    if (valor === null) return false;
    if (typeof cond === "string") {
      if (valor !== cond) return false;
    } else if (cond.in) {
      const lista: string[] = cond.in;
      const ok = cond.mode === "insensitive"
        ? lista.some((x) => x.toLowerCase() === valor.toLowerCase())
        : lista.includes(valor);
      if (!ok) return false;
    } else if ("equals" in cond) {
      const ok = cond.mode === "insensitive" ? valor.toLowerCase() === String(cond.equals).toLowerCase() : valor === cond.equals;
      if (!ok) return false;
    }
  }
  return true;
}

beforeEach(() => {
  clinicas = [
    { id: "cA", postmarkInboundEmail: null, twilioWhatsappNumber: null, twilioAuthToken: "tokA" },
    { id: "cB", postmarkInboundEmail: "clinica-b@inbox.test", twilioWhatsappNumber: "+5215500000000", twilioAuthToken: "tokB" },
  ];
  escrito = null;
  hilosCreados = [];
  mensajesCreados = [];
});

(mock as any).module("@/lib/prisma", {
  namedExports: {
    prisma: {
      clinic: {
        findFirst: async ({ where }: any) => clinicas.find((c) => casa(c, where)) ?? null,
        findMany: async ({ where, take }: any) => clinicas.filter((c) => casa(c, where)).slice(0, take ?? 1000),
        findUnique: async () => ({ reminderSettings: null }),
        update: async ({ where, data }: any) => {
          escrito = { where, data };
          const c = clinicas.find((x) => x.id === where.id)!;
          Object.assign(c, data);
          return { ...c };
        },
      },
      patient: { findFirst: async () => null },
      inboxThread: {
        findFirst: async () => null,
        create: async ({ data }: any) => { hilosCreados.push(data); return { id: `t${hilosCreados.length}` }; },
        update: async () => ({}),
      },
      inboxMessage: { create: async ({ data }: any) => { mensajesCreados.push(data); return { id: "m1" }; } },
    },
  },
});
(mock as any).module("@/lib/auth-context", {
  namedExports: { getAuthContext: async () => ({ clinicId: "cA", userId: "uA", role: "SUPER_ADMIN" }) },
});
(mock as any).module("@/lib/auth/require-permission", { namedExports: { denyIfMissingPermission: () => null } });
(mock as any).module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => undefined } });
(mock as any).module("@/lib/clinic-secrets", { namedExports: { stripClinicSecrets: (c: any) => c } });
(mock as any).module("@/lib/audit", { namedExports: { logMutation: async () => undefined } });
// postmark-inbound.ts importa `server-only`: se sustituye por la MISMA
// comparación de token plano que hace verifyPostmarkSecret.
(mock as any).module("@/lib/integrations/postmark-inbound", {
  namedExports: {
    verifyPostmarkSecret: (expected: string | null | undefined, auth: string | null) =>
      !!expected && !!auth && auth.replace(/^Bearer\s+|^Basic\s+/i, "").trim() === expected,
  },
});

async function patch(body: unknown) {
  const { PATCH } = await import("@/app/api/settings/route");
  const res = await PATCH({ json: async () => body } as any);
  return { status: res.status, body: await res.json() };
}

async function postmark(to: string) {
  process.env.POSTMARK_INBOUND_SECRET = "secreto-de-prueba";
  const { POST } = await import("@/app/api/webhooks/postmark/inbound/route");
  const payload = {
    From: "paciente@correo.test", To: to, ToFull: [{ Email: to }], Subject: "Cita", TextBody: "Hola",
    MessageID: "msg-1", Date: new Date().toISOString(), Attachments: [],
  };
  const req = {
    headers: new Headers({ Authorization: "Bearer secreto-de-prueba" }),
    json: async () => payload,
  };
  const res = await POST(req as any);
  return { status: res.status, body: await res.json() };
}


// ── PATCH /api/settings ─────────────────────────────────────────────────────

test("nº3 · settings: la dirección de Postmark de OTRA clínica → 409, también cambiando mayúsculas, y no se guarda", async () => {
  for (const v of ["clinica-b@inbox.test", "CLINICA-B@Inbox.Test", "  clinica-b@inbox.test  "]) {
    escrito = null;
    const r = await patch({ postmarkInboundEmail: v });
    assert.equal(r.status, 409, v);
    assert.equal(r.body.error, "direccion_en_uso");
    assert.equal(r.body.campo, "postmarkInboundEmail");
    assert.equal(escrito, null, "no se escribe nada");
  }
  assert.equal(clinicas.find((c) => c.id === "cA")!.postmarkInboundEmail, null);
});

test("nº3 · settings: una dirección libre, la propia o vaciarla siguen funcionando (comportamiento legítimo intacto)", async () => {
  let r = await patch({ postmarkInboundEmail: " clinica-a@inbox.test " });
  assert.equal(r.status, 200);
  assert.equal(escrito.data.postmarkInboundEmail, "clinica-a@inbox.test");
  // La propia clínica vuelve a guardar SU dirección: no es «de otra».
  r = await patch({ postmarkInboundEmail: "Clinica-A@inbox.test" });
  assert.equal(r.status, 200);
  r = await patch({ postmarkInboundEmail: "" });
  assert.equal(r.status, 200);
  assert.equal(escrito.data.postmarkInboundEmail, null);
});

// ── Webhook de Postmark ─────────────────────────────────────────────────────

test("nº3 · postmark: una dirección que tienen DOS clínicas es un error y el correo no se entrega a ninguna", async () => {
  // El estado que dejaba el código viejo: A guardó la dirección de B.
  clinicas[0].postmarkInboundEmail = "Clinica-B@inbox.test";
  const r = await postmark("clinica-b@inbox.test");
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "ambiguous_inbound_address");
  assert.equal(hilosCreados.length, 0, "no se crea hilo en ninguna clínica");
  assert.equal(mensajesCreados.length, 0, "no se guarda el correo");
});

test("nº3 · postmark: con un solo dueño se entrega a esa clínica, como siempre", async () => {
  const r = await postmark("CLINICA-B@inbox.test");
  assert.equal(r.status, 200);
  assert.equal(hilosCreados.length, 1);
  assert.equal(hilosCreados[0].clinicId, "cB");
  assert.equal(mensajesCreados.length, 1);
});
