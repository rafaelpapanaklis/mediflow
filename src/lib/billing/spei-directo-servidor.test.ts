/**
 * SPEI POR TRANSFERENCIA DIRECTA — la lib de servidor DE VERDAD (ws1-t3).
 *
 * Run: npm run test:spei-directo
 *
 * `crearSolicitudSpei`, `confirmarSolicitudSpei` y `rechazarSolicitudSpei` reales,
 * con `mock.module` sobre prisma (un doble en memoria con dos clínicas
 * sembradas), sobre el catálogo de planes y sobre el correo. ⛔ Aquí no sale ni
 * un correo y no se toca ninguna base: el doble apunta lo que habría escrito.
 *
 * Lo que se vigila:
 *   · sin cuenta bancaria no se puede crear una solicitud;
 *   · el importe lo pone el SERVIDOR con el precio del plan (nada del cliente);
 *   · una pendiente por clínica: el doble clic no crea dos;
 *   · sin clinicId la lib corta antes de consultar (clinicId: undefined no filtra);
 *   · confirmar activa, pone el plan, extiende mes/año y crea UNA factura pagada;
 *   · confirmar dos veces no cobra dos periodos;
 *   · rechazar no toca a la clínica.
 */
import Module from "node:module";
import path from "node:path";
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

const CLABE_DE_PRUEBA = (() => {
  const p = "99900000000000012";
  const pesos = [3, 7, 1];
  const suma = p.split("").reduce((a, d, i) => a + ((Number(d) * pesos[i % 3]) % 10), 0);
  return p + String((10 - (suma % 10)) % 10);
})();

/* ── Estado del doble ──────────────────────────────────────────────────── */
let cuenta: any | null;
let solicitudes: any[];
let clinicas: Map<string, any>;
let facturas: any[];
let correos: any[];
let consultasSinClinica: number;
let siguienteId = 1;

const PLANES: Record<string, any> = {
  BASIC: { id: "BASIC", name: "Básico", priceMxn: 300, priceMxnAnnual: 2340, aiTokensDefault: 1000 },
  PRO: { id: "PRO", name: "Profesional", priceMxn: 700, priceMxnAnnual: 5460, aiTokensDefault: 5000 },
  CLINIC: { id: "CLINIC", name: "Clínica", priceMxn: 1200, priceMxnAnnual: 9360, aiTokensDefault: 20000 },
};

function coincide(fila: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v && typeof v === "object" && !(v instanceof Date)) {
      const o = v as any;
      if ("in" in o) return o.in.includes(fila[k]);
      if ("gte" in o) return fila[k] >= o.gte;
      return true;
    }
    if (v === undefined) return true; // Prisma descarta la clave: NO filtra (justo el peligro)
    return fila[k] === v;
  });
}

const prismaDoble: any = {
  platformBankAccount: {
    findUnique: async () => cuenta,
    upsert: async ({ create, update }: any) => (cuenta = { ...(cuenta ?? create), ...update, updatedAt: new Date() }),
  },
  speiTransferRequest: {
    findFirst: async ({ where }: any) => {
      if (where?.clinicId === undefined) consultasSinClinica++;
      return solicitudes.filter((s) => coincide(s, where)).slice(-1)[0] ?? null;
    },
    findUnique: async ({ where }: any) => solicitudes.find((s) => s.id === where.id) ?? null,
    findMany: async ({ where }: any) => solicitudes.filter((s) => coincide(s, where)),
    count: async ({ where }: any) => solicitudes.filter((s) => coincide(s, where)).length,
    create: async ({ data }: any) => {
      if (solicitudes.some((s) => s.clinicId === data.clinicId && s.status === "pending"))
        throw Object.assign(new Error("dup"), { code: "P2002" });
      const fila = { id: `sol${siguienteId++}`, createdAt: new Date(), resolvedAt: null, resolvedBy: null, rejectReason: null, invoiceId: null, ...data };
      solicitudes.push(fila);
      return fila;
    },
    updateMany: async ({ where, data }: any) => {
      const hit = solicitudes.filter((s) => coincide(s, where));
      hit.forEach((s) => Object.assign(s, data));
      return { count: hit.length };
    },
    update: async ({ where, data }: any) => {
      const s = solicitudes.find((x) => x.id === where.id);
      Object.assign(s, data);
      return s;
    },
  },
  clinic: {
    findMany: async ({ where }: any) => [...clinicas.values()].filter((c) => where.id.in.includes(c.id)),
    findUnique: async ({ where }: any) => clinicas.get(where.id) ?? null,
    update: async ({ where, data }: any) => {
      const c = clinicas.get(where.id);
      Object.assign(c, data);
      return c;
    },
  },
  subscriptionInvoice: {
    create: async ({ data }: any) => {
      if (facturas.some((f) => f.reference === data.reference)) throw Object.assign(new Error("dup"), { code: "P2002" });
      const f = { id: `fac${facturas.length + 1}`, ...data };
      facturas.push(f);
      return f;
    },
  },
  // Transacción interactiva: el doble no simula la reversa (la base de verdad la
  // hace). Lo que se prueba es que, si algo se adelantó, la reclamación
  // condicional falla ANTES de escribir factura ni clínica.
  $transaction: async (fn: any) => fn(prismaDoble),
};

/*
 * Sin `--experimental-test-module-mocks`: spei-directo.ts lleva `import
 * "server-only"` y con ese flag el paquete no se deja pisar. Se parchea
 * `Module._load` (mismo patrón que agenda-bloqueos/__tests__/politica.test.ts)
 * y los dobles se registran por ruta resuelta.
 */
const RAIZ = path.resolve(__dirname, "../../..");
const dobles = new Map<string, unknown>();
type M = typeof Module & {
  _load: (req: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (req: string, parent: unknown, isMain: boolean) => string;
};
const Mod = Module as M;
const cargaOriginal = Mod._load;
Mod._load = function (req, parent, isMain) {
  if (req === "server-only" || req === "client-only") return {};
  let resuelto: string | null = null;
  try {
    resuelto = Mod._resolveFilename(req, parent, isMain);
  } catch {
    resuelto = null;
  }
  if (resuelto && dobles.has(resuelto)) return dobles.get(resuelto);
  return cargaOriginal.call(this, req, parent, isMain);
};

let lib: typeof import("./spei-directo");
before(async () => {
  dobles.set(path.join(RAIZ, "src/lib/prisma.ts"), { prisma: prismaDoble });
  dobles.set(path.join(RAIZ, "src/lib/plans.ts"), {
    getResolvedPlan: async (id: string) => PLANES[id] ?? PLANES.PRO,
    getPlanLimits: async (id: string) => ({ aiTokensDefault: (PLANES[id] ?? PLANES.PRO).aiTokensDefault }),
  });
  dobles.set(path.join(RAIZ, "src/lib/email.ts"), {
    sendEmail: async (m: any) => {
      correos.push({ tipo: "admin", ...m });
      return { delivered: true };
    },
    sendPlanActivatedEmail: async (m: any) => {
      correos.push({ tipo: "clinica", ...m });
    },
  });
  lib = await import("./spei-directo");
});

const ahoraReal = Date.now();
beforeEach(() => {
  cuenta = { id: "spei", banco: "Banco de prueba", beneficiario: "Empresa de prueba SA", clabe: CLABE_DE_PRUEBA };
  solicitudes = [];
  facturas = [];
  correos = [];
  consultasSinClinica = 0;
  siguienteId = 1;
  clinicas = new Map([
    ["cA", { id: "cA", name: "Clínica A", email: "a@ejemplo.mx", subscriptionStatus: "pending_payment", plan: "PRO", trialEndsAt: new Date(ahoraReal - 6 * 86_400_000), nextBillingDate: null, aiTokensLimit: 50000, stripeSubscriptionId: null }],
    ["cB", { id: "cB", name: "Clínica B", email: "b@ejemplo.mx", subscriptionStatus: "pending_payment", plan: "BASIC", trialEndsAt: new Date(ahoraReal - 6 * 86_400_000), nextBillingDate: null, aiTokensLimit: 50000 }],
  ]);
});

const nada = () => new Promise((r) => setImmediate(r));

test("sin cuenta bancaria (o con CLABE mala) no se crea ninguna solicitud", async () => {
  const { crearSolicitudSpei, leerCuentaSpei } = lib;
  for (const mala of [null, { ...cuenta, clabe: "" }, { ...cuenta, banco: " " }, { ...cuenta, clabe: "999000000000000129" }]) {
    cuenta = mala;
    assert.equal(await leerCuentaSpei(), null);
    await assert.rejects(() => crearSolicitudSpei({ clinicId: "cA", plan: "PRO", billing: "monthly" }), (e: any) => e.codigo === "no-disponible");
  }
  assert.equal(solicitudes.length, 0);
});

test("el importe lo pone el servidor: precio del plan + IVA 16 %, mensual o total anual", async () => {
  const { crearSolicitudSpei } = lib;
  const m = await crearSolicitudSpei({ clinicId: "cA", userId: "u1", plan: "PRO", billing: "monthly" });
  assert.equal(m.creada, true);
  assert.deepEqual([m.solicitud.subtotalCents, m.solicitud.ivaCents, m.solicitud.amountCents], [70000, 11200, 81200]);
  assert.equal(solicitudes[0].bankSnapshot.clabe, CLABE_DE_PRUEBA, "guarda la cuenta que se le mostró");
  const a = await crearSolicitudSpei({ clinicId: "cB", plan: "CLINIC", billing: "annual" });
  assert.deepEqual([a.solicitud.subtotalCents, a.solicitud.ivaCents, a.solicitud.amountCents], [936000, 149760, 1085760], "el TOTAL del año + IVA");
  // No importa el env de Stripe Tax: el IVA se suma igual.
  const antes = process.env.STRIPE_AUTOMATIC_TAX;
  process.env.STRIPE_AUTOMATIC_TAX = "true";
  try {
    clinicas.set("cC", { id: "cC" });
    const c = await crearSolicitudSpei({ clinicId: "cC", plan: "BASIC", billing: "monthly" });
    assert.deepEqual([c.solicitud.subtotalCents, c.solicitud.ivaCents, c.solicitud.amountCents], [30000, 4800, 34800]);
  } finally {
    if (antes === undefined) delete process.env.STRIPE_AUTOMATIC_TAX;
    else process.env.STRIPE_AUTOMATIC_TAX = antes;
  }
});

test("una pendiente por clínica: el doble clic devuelve la misma y no avisa dos veces", async () => {
  const { crearSolicitudSpei } = lib;
  const a = await crearSolicitudSpei({ clinicId: "cA", plan: "PRO", billing: "monthly" });
  const b = await crearSolicitudSpei({ clinicId: "cA", plan: "PRO", billing: "monthly" });
  assert.equal(b.creada, false);
  assert.equal(b.solicitud.id, a.solicitud.id);
  assert.equal(solicitudes.length, 1);
  await nada();
  assert.equal(correos.filter((c) => c.tipo === "admin").length, 1, "un solo aviso al admin");
});

test("declarar de nuevo con OTRO periodo actualiza la pendiente: la solicitud dice lo que la clínica ve y copió", async () => {
  const { crearSolicitudSpei } = lib;
  const a = await crearSolicitudSpei({ clinicId: "cA", plan: "PRO", billing: "monthly" });
  const b = await crearSolicitudSpei({ clinicId: "cA", plan: "PRO", billing: "annual" });
  assert.equal(b.solicitud.id, a.solicitud.id, "sigue siendo UNA fila");
  assert.equal(solicitudes.length, 1);
  assert.equal(b.solicitud.billing, "annual");
  assert.equal(b.solicitud.amountCents, 633360, "el importe del anual (+ IVA), no el viejo");
  assert.equal(b.creada, true);
  const c = await crearSolicitudSpei({ clinicId: "cA", plan: "CLINIC", billing: "annual" });
  assert.equal(c.solicitud.plan, "CLINIC");
  assert.equal(solicitudes.length, 1);
});

test("una pendiente vieja (>30 días) ya no tapa la pantalla de pago y declarar la sustituye", async () => {
  const { crearSolicitudSpei, solicitudPendienteDe } = lib;
  const vieja = await crearSolicitudSpei({ clinicId: "cA", plan: "PRO", billing: "monthly" });
  solicitudes[0].createdAt = new Date(Date.now() - 40 * 86_400_000);
  assert.equal(await solicitudPendienteDe("cA"), null, "no cuenta como vigente");
  const nueva = await crearSolicitudSpei({ clinicId: "cA", plan: "PRO", billing: "monthly" });
  assert.equal(nueva.creada, true, "aunque sea idéntica, la vieja se renueva");
  assert.equal(nueva.solicitud.id, vieja.solicitud.id);
  assert.ok(await solicitudPendienteDe("cA"));
});

test("si el precio cambió mientras la clínica miraba la pantalla, 409 y no se crea nada", async () => {
  const { crearSolicitudSpei } = lib;
  await assert.rejects(
    () => crearSolicitudSpei({ clinicId: "cA", plan: "PRO", billing: "monthly", amountCentsEsperado: 60000 }),
    (e: any) => e.codigo === "precio-cambio",
  );
  assert.equal(solicitudes.length, 0);
  const ok = await crearSolicitudSpei({ clinicId: "cA", plan: "PRO", billing: "monthly", amountCentsEsperado: 81200 });
  assert.equal(ok.creada, true);
});

test("confirmar suelta la suscripción de tarjeta CANCELADA (si no, un pago daría acceso indefinido) y respeta una viva", async () => {
  const { crearSolicitudSpei, confirmarSolicitudSpei } = lib;
  Object.assign(clinicas.get("cA"), { subscriptionStatus: "cancelled", stripeSubscriptionId: "sub_vieja" });
  const a = await crearSolicitudSpei({ clinicId: "cA", plan: "PRO", billing: "monthly" });
  await confirmarSolicitudSpei(a.solicitud.id, "admin1");
  assert.equal(clinicas.get("cA").stripeSubscriptionId, null);
  assert.equal(clinicas.get("cA").subscriptionStatus, "active");
  // past_due: Stripe sigue reintentando; NO se toca su id.
  Object.assign(clinicas.get("cB"), { subscriptionStatus: "past_due", stripeSubscriptionId: "sub_viva" });
  const b = await crearSolicitudSpei({ clinicId: "cB", plan: "BASIC", billing: "monthly" });
  await confirmarSolicitudSpei(b.solicitud.id, "admin1");
  assert.equal(clinicas.get("cB").stripeSubscriptionId, "sub_viva");
});

test("la lista del admin avisa de clínica ya activa y de tarjeta viva", async () => {
  const { crearSolicitudSpei, listarPendientesAdmin } = lib;
  Object.assign(clinicas.get("cA"), { subscriptionStatus: "past_due", stripeSubscriptionId: "sub_viva" });
  await crearSolicitudSpei({ clinicId: "cA", plan: "PRO", billing: "monthly" });
  await crearSolicitudSpei({ clinicId: "cB", plan: "BASIC", billing: "monthly" });
  const l = await listarPendientesAdmin();
  const a = l.find((x) => x.clinicId === "cA")!;
  const b = l.find((x) => x.clinicId === "cB")!;
  assert.equal(a.suscripcionTarjetaViva, true);
  assert.equal(b.suscripcionTarjetaViva, false);
  assert.equal(a.clinicName, "Clínica A");
});

test("avisa al admin con clínica, importe y referencia; el asunto no filtra la CLABE", async () => {
  const { crearSolicitudSpei } = lib;
  const { solicitud } = await crearSolicitudSpei({ clinicId: "cA", plan: "PRO", billing: "monthly" });
  await nada();
  await nada();
  const c = correos.find((x) => x.tipo === "admin")!;
  assert.ok(c, "hay aviso");
  assert.match(c.subject, /Clínica A/);
  assert.ok(c.html.includes(solicitud.reference) && c.text.includes(solicitud.reference));
  assert.ok(!c.html.includes(CLABE_DE_PRUEBA) && !c.text.includes(CLABE_DE_PRUEBA));
});

test("sin clinicId la lib corta ANTES de consultar (undefined no filtra en Prisma)", async () => {
  const { crearSolicitudSpei, solicitudPendienteDe, rechazoReciente } = lib;
  solicitudes.push({ id: "ajena", clinicId: "cB", status: "pending", createdAt: new Date() });
  assert.equal(await solicitudPendienteDe(undefined), null);
  assert.equal(await solicitudPendienteDe(null), null);
  assert.equal(await solicitudPendienteDe(""), null);
  assert.equal(await rechazoReciente(undefined), null);
  await assert.rejects(() => crearSolicitudSpei({ clinicId: undefined, plan: "PRO", billing: "monthly" }), (e: any) => e.codigo === "sin-clinica");
  assert.equal(consultasSinClinica, 0, "ninguna consulta salió sin filtro de clínica");
});

test("un plan inválido se rechaza sin tocar la base", async () => {
  const { crearSolicitudSpei } = lib;
  await assert.rejects(() => crearSolicitudSpei({ clinicId: "cA", plan: "ORO", billing: "monthly" }), (e: any) => e.codigo === "plan-invalido");
  assert.equal(solicitudes.length, 0);
});

test("la clínica solo ve SU solicitud", async () => {
  const { crearSolicitudSpei, solicitudPendienteDe } = lib;
  await crearSolicitudSpei({ clinicId: "cA", plan: "PRO", billing: "monthly" });
  assert.equal(await solicitudPendienteDe("cB"), null);
  assert.ok(await solicitudPendienteDe("cA"));
});

test("confirmar: clínica activa con el plan pagado, factura pagada y un mes más desde hoy", async () => {
  const { crearSolicitudSpei, confirmarSolicitudSpei } = lib;
  const { solicitud } = await crearSolicitudSpei({ clinicId: "cA", plan: "CLINIC", billing: "monthly" });
  const r = await confirmarSolicitudSpei(solicitud.id, "admin1");
  const c = clinicas.get("cA");
  assert.equal(c.subscriptionStatus, "active");
  assert.equal(c.plan, "CLINIC", "el plan que se pagó, no el del alta");
  assert.equal(c.aiTokensLimit, PLANES.CLINIC.aiTokensDefault);
  assert.ok(!("monthlyPrice" in c), "no toca monthlyPrice");
  assert.equal(c.nextBillingDate.getTime(), r.periodEnd.getTime());
  assert.equal(c.trialEndsAt.getTime(), r.periodEnd.getTime(), "las dos fechas juntas");
  const dias = Math.round((r.periodEnd.getTime() - Date.now()) / 86_400_000);
  assert.ok(dias >= 28 && dias <= 31, `un mes (${dias} días)`);
  assert.equal(facturas.length, 1);
  assert.deepEqual(
    { s: facturas[0].status, m: facturas[0].method, a: facturas[0].amount, ref: facturas[0].reference, clinicId: facturas[0].clinicId },
    { s: "paid", m: "transfer", a: solicitud.amountCents / 100, ref: `${solicitud.reference}-${solicitud.id.slice(-5)}`, clinicId: "cA" },
  );
  assert.ok(facturas[0].paidAt instanceof Date);
  const s = solicitudes[0];
  assert.deepEqual([s.status, s.resolvedBy, s.invoiceId], ["confirmed", "admin1", facturas[0].id]);
  await nada();
  await nada();
  const aviso = correos.find((x) => x.tipo === "clinica")!;
  assert.equal(aviso.email, "a@ejemplo.mx");
  assert.equal(aviso.planName, "Clínica");
  // La otra clínica ni se entera.
  assert.equal(clinicas.get("cB").subscriptionStatus, "pending_payment");
});

test("confirmar un anual extiende UN AÑO", async () => {
  const { crearSolicitudSpei, confirmarSolicitudSpei } = lib;
  const { solicitud } = await crearSolicitudSpei({ clinicId: "cB", plan: "BASIC", billing: "annual" });
  const r = await confirmarSolicitudSpei(solicitud.id, "admin1");
  const dias = Math.round((r.periodEnd.getTime() - Date.now()) / 86_400_000);
  assert.ok(dias >= 364 && dias <= 366, `un año (${dias} días)`);
  assert.equal(facturas[0].amount, 2714.4, "la factura guarda el total con IVA");
});

test("confirmar por adelantado SUMA los días que le quedaban", async () => {
  const { crearSolicitudSpei, confirmarSolicitudSpei } = lib;
  const finVigente = new Date(Date.now() + 10 * 86_400_000);
  Object.assign(clinicas.get("cA"), { subscriptionStatus: "active", trialEndsAt: finVigente, nextBillingDate: finVigente });
  const { solicitud } = await crearSolicitudSpei({ clinicId: "cA", plan: "PRO", billing: "monthly" });
  const r = await confirmarSolicitudSpei(solicitud.id, "admin1");
  assert.equal(r.periodStart.getTime(), finVigente.getTime());
  assert.ok(r.periodEnd.getTime() > finVigente.getTime() + 27 * 86_400_000);
});

test("confirmar dos veces NO cobra dos periodos", async () => {
  const { crearSolicitudSpei, confirmarSolicitudSpei } = lib;
  const { solicitud } = await crearSolicitudSpei({ clinicId: "cA", plan: "PRO", billing: "monthly" });
  await confirmarSolicitudSpei(solicitud.id, "admin1");
  const fin = clinicas.get("cA").nextBillingDate.getTime();
  await assert.rejects(() => confirmarSolicitudSpei(solicitud.id, "admin2"), (e: any) => e.codigo === "ya-resuelta");
  assert.equal(facturas.length, 1);
  assert.equal(clinicas.get("cA").nextBillingDate.getTime(), fin);
});

test("dos confirmaciones simultáneas: solo una sale bien", async () => {
  const { crearSolicitudSpei, confirmarSolicitudSpei } = lib;
  const { solicitud } = await crearSolicitudSpei({ clinicId: "cA", plan: "PRO", billing: "monthly" });
  const r = await Promise.allSettled([confirmarSolicitudSpei(solicitud.id, "a1"), confirmarSolicitudSpei(solicitud.id, "a2")]);
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(facturas.length, 1);
});

test("rechazar no toca a la clínica, guarda el motivo y confirmar después falla", async () => {
  const { crearSolicitudSpei, rechazarSolicitudSpei, confirmarSolicitudSpei, solicitudPendienteDe, rechazoReciente } = lib;
  const { solicitud } = await crearSolicitudSpei({ clinicId: "cA", plan: "PRO", billing: "monthly" });
  const antes = { ...clinicas.get("cA") };
  await rechazarSolicitudSpei(solicitud.id, "admin1", "  No llegó el depósito  ");
  assert.deepEqual(clinicas.get("cA"), antes);
  assert.equal(facturas.length, 0);
  assert.equal(await solicitudPendienteDe("cA"), null, "ya no espera");
  const rz = await rechazoReciente("cA");
  assert.equal(rz?.rejectReason, "No llegó el depósito");
  await assert.rejects(() => confirmarSolicitudSpei(solicitud.id, "admin1"), (e: any) => e.codigo === "ya-resuelta");
  // Y puede volver a intentarlo: una nueva pendiente sustituye al aviso de rechazo.
  await crearSolicitudSpei({ clinicId: "cA", plan: "PRO", billing: "monthly" });
  assert.equal(await rechazoReciente("cA"), null);
});

test("solicitud inexistente → no-encontrada", async () => {
  const { confirmarSolicitudSpei, rechazarSolicitudSpei } = lib;
  await assert.rejects(() => confirmarSolicitudSpei("nope", "a"), (e: any) => e.codigo === "no-encontrada");
  await assert.rejects(() => rechazarSolicitudSpei("nope", "a", "x"), (e: any) => e.codigo === "no-encontrada");
});

test("la referencia es el folio estable de la clínica: igual en cada pago, distinto entre clínicas", async () => {
  const { crearSolicitudSpei, rechazarSolicitudSpei, referenciaDeClinica } = lib;
  const a = await crearSolicitudSpei({ clinicId: "cA", plan: "PRO", billing: "monthly" });
  assert.equal(a.solicitud.reference, referenciaDeClinica("cA"), "la que se mostró ANTES de transferir");
  await rechazarSolicitudSpei(a.solicitud.id, "admin1", "no llegó");
  const otra = await crearSolicitudSpei({ clinicId: "cA", plan: "PRO", billing: "monthly" });
  assert.equal(otra.solicitud.reference, a.solicitud.reference, "no cambia entre intentos");
  const b = await crearSolicitudSpei({ clinicId: "cB", plan: "BASIC", billing: "monthly" });
  assert.notEqual(b.solicitud.reference, a.solicitud.reference);
});

test("referenciaDeClinica: formato válido, sin ambiguos, y casi sin colisiones", async () => {
  const { referenciaDeClinica } = lib;
  const { referenciaValida } = await import("./spei-directo-core");
  const vistas = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const r = referenciaDeClinica(`clinica_${i}_abcdefghijk`);
    assert.ok(referenciaValida(r), r);
    assert.match(r, /^[A-Z0-9]{8}$/);
    assert.ok(!/[01OI]/.test(r.slice(2)), `ambigua: ${r}`);
    vistas.add(r);
  }
  assert.ok(vistas.size >= 1995, `colisiones de más: ${2000 - vistas.size}`);
});

test("clínica de antes que renueva su MISMO plan por SPEI: precio tal cual, sin IVA; otro plan, con IVA", async () => {
  const { crearSolicitudSpei, rechazarSolicitudSpei } = lib;
  Object.assign(clinicas.get("cA"), { createdAt: new Date("2025-11-03"), plan: "PRO", nextBillingDate: new Date("2026-09-30") });
  const igual = await crearSolicitudSpei({ clinicId: "cA", plan: "PRO", billing: "monthly" });
  assert.deepEqual([igual.solicitud.subtotalCents, igual.solicitud.ivaCents, igual.solicitud.amountCents], [70000, 0, 70000]);
  await rechazarSolicitudSpei(igual.solicitud.id, "admin1", "prueba");
  const otro = await crearSolicitudSpei({ clinicId: "cA", plan: "CLINIC", billing: "monthly" });
  assert.deepEqual([otro.solicitud.subtotalCents, otro.solicitud.ivaCents, otro.solicitud.amountCents], [120000, 19200, 139200]);
});

test("la excepción de SPEI no depende de lo que mande el cliente: una clínica nueva paga IVA aunque pida el mismo plan", async () => {
  const { crearSolicitudSpei } = lib;
  Object.assign(clinicas.get("cB"), { createdAt: new Date("2026-10-10"), plan: "BASIC", nextBillingDate: new Date("2026-11-01") });
  const r = await crearSolicitudSpei({ clinicId: "cB", plan: "BASIC", billing: "monthly" });
  assert.equal(r.solicitud.ivaCents, 4800);
});
