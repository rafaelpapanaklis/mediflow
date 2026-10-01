/**
 * Comportamiento REAL de las rutas tocadas por la auditoría del 30-sep-2026
 * (A1, A2, A3), con la base y la sesión falsas.
 *
 * Run: npm run test:seguridad-xss-arco
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ── Estado de los dobles ────────────────────────────────────────────────────
type Arco = { id: string; clinicId: string | null; status: string; resolvedNotes: string | null; resolvedAt: Date | null };
let arcos: Arco[] = [];
let usuario: any = null;
let admin: any = null;
let escrituras: any[] = [];
let facturaBd: any = null;
let clinicaEscrita: any = null;

beforeEach(() => {
  arcos = [
    { id: "propia", clinicId: "clinA", status: "PENDING", resolvedNotes: null, resolvedAt: null },
    { id: "ajena", clinicId: "clinB", status: "PENDING", resolvedNotes: null, resolvedAt: null },
    { id: "anonima", clinicId: null, status: "PENDING", resolvedNotes: null, resolvedAt: null },
  ];
  // El dueño de una clínica: SUPER_ADMIN, como todo el que se registra.
  usuario = { id: "u1", role: "SUPER_ADMIN", clinicId: "clinA", permissionsOverride: [] };
  admin = { user: { id: "adm1", email: "admin@dalecontrol.com" }, sessionId: "s1" };
  escrituras = [];
  facturaBd = null;
  clinicaEscrita = null;
});

(mock as any).module("@/lib/prisma", {
  namedExports: {
    prisma: {
      arcoRequest: {
        findUnique: async ({ where }: any) => arcos.find((a) => a.id === where.id) ?? null,
        findFirst: async ({ where }: any) =>
          arcos.find((a) => a.id === where.id && (where.clinicId === undefined || a.clinicId === where.clinicId)) ?? null,
        findMany: async ({ where }: any) => arcos.filter((a) => a.clinicId === where.clinicId),
        update: async ({ where, data }: any) => {
          escrituras.push({ via: "update", where, data });
          const a = arcos.find((x) => x.id === where.id)!;
          Object.assign(a, data);
          return a;
        },
        updateMany: async ({ where, data }: any) => {
          const a = arcos.find((x) => x.id === where.id && x.clinicId === where.clinicId);
          if (!a) return { count: 0 };
          escrituras.push({ via: "updateMany", where, data });
          Object.assign(a, data);
          return { count: 1 };
        },
      },
      subscriptionInvoice: { findUnique: async () => facturaBd },
      clinic: {
        findUnique: async () => ({ reminderSettings: null, category: "DENTAL" }),
        update: async ({ data }: any) => { clinicaEscrita = data; return { id: "clinA", ...data }; },
      },
    },
  },
});
(mock as any).module("@/lib/auth", { namedExports: { getCurrentUser: async () => usuario } });
(mock as any).module("@/lib/auth-context", {
  namedExports: { getAuthContext: async () => (usuario ? { ...usuario, clinicId: "clinA", user: usuario } : null) },
});
(mock as any).module("@/lib/audit", { namedExports: { logMutation: async () => undefined } });
(mock as any).module("@/lib/admin-auth", {
  namedExports: { getAdminSession: async () => admin, isAdminAuthed: async () => !!admin },
});
(mock as any).module("@/lib/admin-audit", { namedExports: { logAdminGlobalEvent: () => undefined } });
(mock as any).module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => undefined } });
(mock as any).module("@/lib/clinic-secrets", { namedExports: { stripClinicSecrets: (c: any) => c } });

const req = (body: unknown) => ({ json: async () => body, headers: new Headers() }) as any;
const ctx = (id: string) => ({ params: { id } });

// ═══ A3 · el dueño de clínica (SUPER_ADMIN) y las anónimas ═════════════════

test("A3: un SUPER_ADMIN de clínica NO lee una ARCO anónima", async () => {
  const { GET } = await import("@/app/api/arco/[id]/route");
  const res = await GET(req(null), ctx("anonima"));
  assert.equal(res.status, 404);
});

test("A3: un SUPER_ADMIN de clínica NO puede hacer PATCH a una ARCO anónima, y no se escribe nada", async () => {
  const { PATCH } = await import("@/app/api/arco/[id]/route");
  const res = await PATCH(req({ status: "RESOLVED", resolvedNotes: "cerrada por un tercero" }), ctx("anonima"));
  assert.equal(res.status, 404);
  assert.equal(escrituras.length, 0);
  assert.equal(arcos.find((a) => a.id === "anonima")!.status, "PENDING");
});

test("A3: tampoco ve ni edita la de OTRA clínica", async () => {
  const { GET, PATCH } = await import("@/app/api/arco/[id]/route");
  assert.equal((await GET(req(null), ctx("ajena"))).status, 404);
  assert.equal((await PATCH(req({ status: "RESOLVED" }), ctx("ajena"))).status, 404);
  assert.equal(escrituras.length, 0);
});

test("A3: la de la PROPIA clínica sigue funcionando (GET y PATCH)", async () => {
  const { GET, PATCH } = await import("@/app/api/arco/[id]/route");
  const g = await GET(req(null), ctx("propia"));
  assert.equal(g.status, 200);
  assert.equal((await g.json()).id, "propia");
  const p = await PATCH(req({ status: "RESOLVED", resolvedNotes: "atendida" }), ctx("propia"));
  assert.equal(p.status, 200);
  const cuerpo = await p.json();
  assert.equal(cuerpo.status, "RESOLVED");
  assert.equal(cuerpo.resolvedNotes, "atendida");
  assert.equal(typeof cuerpo.resolvedAt, "string"); // ISO tras el JSON
  assert.equal((await PATCH(req({ status: "NOPE" }), ctx("propia"))).status, 400);
});

test("A3: un usuario sin clínica resuelta no ve ni la anónima ni las de clínica", async () => {
  usuario = { ...usuario, clinicId: undefined };
  const { GET } = await import("@/app/api/arco/[id]/route");
  assert.equal((await GET(req(null), ctx("anonima"))).status, 404);
  assert.equal((await GET(req(null), ctx("propia"))).status, 404);
});

test("A3: el admin de plataforma SÍ lista y atiende las anónimas", async () => {
  const { GET } = await import("@/app/api/admin/arco/route");
  const lista = await (await GET()).json();
  assert.deepEqual(lista.map((a: Arco) => a.id), ["anonima"]);

  const { PATCH } = await import("@/app/api/admin/arco/[id]/route");
  const res = await PATCH(req({ status: "IN_PROGRESS", resolvedNotes: "en revisión" }), ctx("anonima"));
  assert.equal(res.status, 200);
  assert.equal(arcos.find((a) => a.id === "anonima")!.status, "IN_PROGRESS");
});

test("A3: el admin NO edita desde aquí una ARCO que es de una clínica, y sin sesión de admin es 401", async () => {
  const { PATCH } = await import("@/app/api/admin/arco/[id]/route");
  assert.equal((await PATCH(req({ status: "RESOLVED" }), ctx("propia"))).status, 404);
  assert.equal(escrituras.length, 0);

  admin = null;
  assert.equal((await PATCH(req({ status: "RESOLVED" }), ctx("anonima"))).status, 401);
  const { GET } = await import("@/app/api/admin/arco/route");
  assert.equal((await GET()).status, 401);
  // Un usuario de clínica NO es admin de plataforma: sin cookie admin_token no entra.
});

// ═══ A2 · el recibo ═════════════════════════════════════════════════════════

test("A2: el recibo con una clínica hostil no trae ni un <script> ajeno; la CSP solo admite el nonce", async () => {
  const sucio = '</div><script>fetch("/api/admin/clinics")</script>';
  facturaBd = {
    id: "pay1", status: "paid", currency: "MXN", amount: 999, method: "stripe", reference: sucio,
    createdAt: new Date(), periodStart: new Date(), periodEnd: new Date(),
    clinic: { name: sucio, email: '"><img src=x onerror=alert(1)>', city: sucio, address: sucio, taxId: sucio },
  };
  const { GET } = await import("@/app/api/admin/payments/[id]/receipt/route");
  const res = await GET(req(null), ctx("pay1"));
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.equal((html.match(/<script\b/gi) ?? []).length, 1);
  assert.doesNotMatch(html, /<img/i);
  assert.doesNotMatch(html, /fetch\("\/api\/admin/);
  const csp = res.headers.get("content-security-policy") ?? "";
  const nonce = /<script nonce="([^"]+)"/.exec(html)![1];
  assert.ok(csp.includes(`script-src 'nonce-${nonce}'`));
  assert.ok(!csp.includes("unsafe-inline'") || !/script-src[^;]*unsafe-inline/.test(csp));
});

test("A2: sin sesión de admin el recibo es 401", async () => {
  admin = null;
  const { GET } = await import("@/app/api/admin/payments/[id]/receipt/route");
  assert.equal((await GET(req(null), ctx("pay1"))).status, 401);
});

// ═══ A1 · el nombre entra limpio ════════════════════════════════════════════

test("A1: /api/clinic y /api/settings rechazan un nombre con etiquetas y guardan el limpio", async () => {
  const malo = '</script><script>alert(1)</script>';
  const clinic = await import("@/app/api/clinic/route");
  const settings = await import("@/app/api/settings/route");

  assert.equal((await clinic.PATCH(req({ name: malo }))).status, 400);
  assert.equal((await settings.PATCH(req({ name: malo }))).status, 400);
  assert.equal(clinicaEscrita, null, "no se escribió nada");

  assert.equal((await clinic.PATCH(req({ name: "  Clínica Sonrisa  " }))).status, 200);
  assert.equal(clinicaEscrita.name, "Clínica Sonrisa");
});

test("A2: /api/settings valida el RFC (formato) y lo guarda en mayúsculas; vacío lo limpia", async () => {
  const settings = await import("@/app/api/settings/route");
  const r = await settings.PATCH(req({ taxId: '<script>alert(1)</script>' }));
  assert.equal(r.status, 400);
  assert.equal(clinicaEscrita, null);

  assert.equal((await settings.PATCH(req({ taxId: " abc010101ab1 " }))).status, 200);
  assert.equal(clinicaEscrita.taxId, "ABC010101AB1");
  assert.equal((await settings.PATCH(req({ taxId: "" }))).status, 200);
  assert.equal(clinicaEscrita.taxId, null);
});
