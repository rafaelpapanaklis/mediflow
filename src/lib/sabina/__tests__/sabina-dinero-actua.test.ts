/**
 * SABINA COBRA Y FACTURA DE VERDAD — el camino entero, con los handlers reales.
 *
 *   npm run test:sabina-dinero-actua
 *
 *   «cóbrale 500 a la MF-0011» → POST /api/sabina (motor + catálogo real)
 *      → Sabina pregunta el método → «en efectivo» → tarjeta guardada
 *      → «sí» en el chat no hace nada
 *      → POST /api/sabina/propuestas/:id/confirmar (el botón)
 *      → POST /api/invoices/[id] (el handler del modal de cobro) → el pago existe
 *
 * Corre de verdad: los handlers de Sabina, el motor, `SABINA_TOOLS` y
 * `ACCIONES_SABINA`, las cuatro herramientas de dinero, `guardarPropuesta` /
 * `confirmarPropuesta`, la llave, y los handlers de `POST /api/invoices`,
 * `POST /api/invoices/[id]`, `/confirm`, `/mark-paid`, `/send-whatsapp` y
 * `POST /api/quotes/[id]/invoice` con sus permisos, visibilidad y validaciones
 * (y el folio por máximo emitido).
 *
 * Se sustituye: la API de Anthropic (guion), la sesión, el monedero, el historial,
 * la bitácora, la revalidación, el PDF, y el ENVÍO a WhatsApp (`sendWhatsAppLogged`,
 * que aquí apunta lo que se habría mandado). `@/lib/prisma` es un doble que lee de
 * la siembra de dinero, guarda las propuestas en un `audit_logs` de memoria y
 * APUNTA cada escritura, que es lo que se mide.
 */
import "../engine-sin-server-only"; // PRIMERO
import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

import { crearBaseDePropuestas } from "../engine-propuestas-doble";
import { EVENTO, FRASE } from "../engine-propuestas-core";
import { idsQueCasan } from "../tools/__tests__/busqueda-falsa";
import { crearBase } from "../tools/__tests__/doble-base";
import { CL_A, TZ_A, U_DOC1, U_RECEP, datosDinero } from "../dinero/__tests__/dinero-siembra";

/* ═══════════════════════════════════════════════════════════════════════
   EL MUNDO
   ═══════════════════════════════════════════════════════════════════════ */

const m = {
  filas: datosDinero(),
  base: null as any,
  propuestas: crearBaseDePropuestas(() => Date.now()),
  escrituras: [] as Array<{ op: string; data: any; where?: any }>,
  enviados: [] as any[],
  whatsappFalla: null as Error | null,
  ultimoMensajeDelPaciente: new Date(Date.now() - 3600_000) as Date | null,
  sesion: null as any,
  guion: [] as any[],
  alModelo: [] as any[],
};

function sesionDe(userId: string, role: string, permissionsOverride: string[] = []) {
  return {
    userId, clinicId: CL_A, role, permissionsOverride,
    clinic: { id: CL_A, timezone: TZ_A, category: "DENTAL" },
    isSuperAdmin: role === "SUPER_ADMIN", isAdmin: role === "ADMIN" || role === "SUPER_ADMIN",
    isDoctor: role === "DOCTOR", isReceptionist: role === "RECEPTIONIST",
  };
}

beforeEach(() => {
  m.filas = datosDinero();
  m.base = crearBase(m.filas as any);
  m.propuestas = crearBaseDePropuestas(() => Date.now());
  m.escrituras = [];
  m.enviados = [];
  m.whatsappFalla = null;
  m.ultimoMensajeDelPaciente = new Date(Date.now() - 3600_000);
  m.sesion = sesionDe(U_RECEP, "RECEPTIONIST");
  m.guion = [];
  m.alModelo = [];
});

/* ── el doble de prisma ─────────────────────────────────────────────────── */

const TABLA: Record<string, keyof ReturnType<typeof datosDinero>> = {
  invoice: "invoices", payment: "payments", patient: "patients", quote: "quotes", clinic: "clinics", user: "users",
};

/** Las relaciones que piden los handlers con `include`/`select` y que el doble de lectura no conoce. */
function relacion(modelo: string, fila: any, clave: string, spec: any): any {
  const f = m.filas as any;
  let out: any;
  if (modelo === "invoice" && clave === "patient") out = f.patients.find((p: any) => p.id === fila.patientId) ?? null;
  else if (modelo === "invoice" && clave === "clinic") out = f.clinics.find((c: any) => c.id === fila.clinicId) ?? null;
  else if (modelo === "invoice" && clave === "payments") out = f.payments.filter((p: any) => p.invoiceId === fila.id);
  else if (modelo === "quote" && clave === "items") out = f.quoteItems.filter((i: any) => i.quoteId === fila.id).sort((a: any, b: any) => a.sortOrder - b.sortOrder);
  else return undefined;
  const elegir = (o: any) => (spec && spec !== true && spec.select ? Object.fromEntries(Object.keys(spec.select).map((k) => [k, o[k] ?? null])) : { ...o });
  return Array.isArray(out) ? out.map(elegir) : out && elegir(out);
}

function forma(modelo: string, fila: any, args: any): any {
  if (!fila) return null;
  if (args?.select) {
    const r: any = {};
    for (const k of Object.keys(args.select)) {
      const rel = relacion(modelo, fila, k, args.select[k]);
      r[k] = rel === undefined ? fila[k] ?? null : rel;
    }
    return r;
  }
  const r = { ...fila };
  for (const k of Object.keys(args?.include ?? {})) r[k] = relacion(modelo, fila, k, args.include[k]);
  return r;
}

async function filasReales(modelo: string, where: any): Promise<any[]> {
  const ids = (await m.base[modelo].findMany({ where, select: { id: true } })).map((x: any) => x.id);
  return (m.filas as any)[TABLA[modelo]].filter((x: any) => ids.includes(x.id));
}

let secuencia = 0;
function delegado(modelo: string) {
  return new Proxy({}, {
    get(_t, op: string) {
      if (modelo === "cashRegister") return async () => null;
      if (op === "findFirst" || op === "findUnique") {
        return async (args: any) => forma(modelo, (await filasReales(modelo, args?.where))[0], args);
      }
      if (["findMany", "count", "aggregate", "groupBy"].includes(op)) return (...a: any[]) => m.base[modelo][op](...a);
      if (op === "create") {
        return async (args: any) => {
          secuencia += 1;
          const ahora = new Date();
          const fila = modelo === "invoice"
            ? { id: `inv-nueva-${secuencia}`, cfdiUuid: null, dueDate: null, createdAt: ahora, updatedAt: ahora, ...args.data }
            : { id: `${modelo}-nuevo-${secuencia}`, ...args.data, ...(modelo === "payment" && !args.data.paidAt ? { paidAt: ahora } : {}) };
          m.escrituras.push({ op: `${modelo}.create`, data: args.data });
          (m.filas as any)[TABLA[modelo]].push(fila);
          return forma(modelo, fila, args);
        };
      }
      if (op === "update" || op === "updateMany") {
        return async (args: any) => {
          const filas = await filasReales(modelo, args.where);
          m.escrituras.push({ op: `${modelo}.${op}`, data: args.data, where: args.where });
          for (const f of filas) Object.assign(f, Object.fromEntries(Object.entries(args.data).filter(([, v]) => v !== undefined)), { updatedAt: new Date() });
          return op === "update" ? filas[0] : { count: filas.length };
        };
      }
      return async () => { throw new Error(`operación no prevista en el doble: ${modelo}.${op}`); };
    },
  });
}

async function sqlCrudo(q: any, ...valores: unknown[]): Promise<any[]> {
  if (q?.__busqueda) return idsQueCasan(m.filas.patients, q.__busqueda).map((id) => ({ id }));
  const sql = Array.isArray(q) ? q.join("?") : "";
  if (/FOR UPDATE/.test(sql)) return [];
  if (/"invoiceNumber"/.test(sql)) {
    // El folio por MÁXIMO emitido, de la clínica que pide (primer valor).
    const nums = m.filas.invoices.filter((i: any) => i.clinicId === valores[0]).map((i: any) => Number(/(\d+)\D*$/.exec(i.invoiceNumber)?.[1] ?? 0));
    return [{ max: nums.length ? Math.max(...nums) : null }];
  }
  throw new Error(`SQL no previsto en el doble: ${sql.slice(0, 80)}`);
}

const prismaDoble: any = new Proxy({}, {
  get(_t, k: string) {
    if (k === "auditLog") return m.propuestas.db.auditLog;
    if (k === "$executeRaw") return m.propuestas.db.$executeRaw;
    if (k === "$transaction") {
      return (fn: (tx: any) => Promise<unknown>) =>
        m.propuestas.db.$transaction((tx) => fn(new Proxy(tx as any, { get: (t, c: string) => (c in t ? t[c] : prismaDoble[c]) })));
    }
    if (k === "$queryRaw") return sqlCrudo;
    if (k === "then") return undefined;
    return delegado(k);
  },
});

/* ── rutas ──────────────────────────────────────────────────────────────── */

let preguntar: (texto: string, conversacionId?: string) => Promise<any>;
let confirmar: (id: string) => Promise<{ status: number; json: any }>;
let catalogo: typeof import("../engine-catalog");

before(async () => {
  process.env.ANTHROPIC_API_KEY = "sk-prueba-no-es-real";
  globalThis.fetch = (async (url: unknown, init?: { body?: string }) => {
    assert.equal(String(url), "https://api.anthropic.com/v1/messages", "nadie más que el motor usa fetch");
    m.alModelo.push(JSON.parse(String(init?.body ?? "{}")));
    const siguiente = m.guion.shift();
    assert.ok(siguiente, "el modelo se llamó más veces que el guion");
    return new Response(JSON.stringify(siguiente), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  mock.module("@/lib/prisma", { namedExports: { prisma: prismaDoble } });
  mock.module("@/lib/auth/two-factor-identity", {
    namedExports: { personaTieneDosFactores: async () => false, dosFactoresDeLaPersona: async () => false },
  });
  mock.module("@/lib/patients/patient-search", {
    namedExports: {
      buildPatientSearchSql: (args: unknown) => ({ __busqueda: args }),
      findPatientIdsBySearch: async (args: any) => idsQueCasan(m.filas.patients, { ...args, limit: args.limit ?? 5000 }),
    },
  });
  const authReal = await import("@/lib/auth-context");
  mock.module("@/lib/auth-context", { namedExports: { ...authReal, getAuthContext: async () => m.sesion } });
  const auditReal = await import("@/lib/audit");
  mock.module("@/lib/audit", {
    namedExports: { ...auditReal, logMutation: async () => undefined, logAudit: async () => undefined },
  });
  mock.module("next/cache", {
    namedExports: { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: any) => fn, unstable_noStore: () => undefined },
  });
  mock.module("@/lib/cache/revalidate", {
    namedExports: { revalidateAfter: () => undefined, revalidatePatientProfile: () => undefined },
  });
  mock.module("@/lib/rate-limit", { namedExports: { rateLimit: () => null } });
  mock.module("@/lib/invoices/print-pdf", { namedExports: { buildInvoicePrintPdf: async () => null } });
  mock.module("@/lib/whatsapp/inbox-log", {
    namedExports: { lastInboundAtForPhone: async () => m.ultimoMensajeDelPaciente, linkOrphanThreadsToPatient: async () => undefined },
  });
  mock.module("@/lib/whatsapp/send-and-log", {
    namedExports: {
      sendWhatsAppLogged: async (args: any) => {
        if (m.whatsappFalla) throw m.whatsappFalla;
        m.enviados.push({ to: args.to, body: args.body, kind: args.kind, templateParams: args.templateParams });
        return { messages: [{ id: "wamid-1" }] };
      },
    },
  });
  mock.module("@/lib/failban", { namedExports: { persistentRateLimit: async () => null } });
  mock.module("@/lib/ai-billing/wallet", {
    namedExports: { canSpend: async () => true, chargeUsage: async () => ({ billedCents: 1, balanceAfterCents: 1, eventId: "ev" }) },
  });
  mock.module("@/lib/ai-assistant/conversations", { namedExports: { isAiHistoryStorageMissing: () => false } });
  mock.module("@/lib/sabina/engine-historial", {
    namedExports: {
      leerConversacionSabina: async (_s: unknown, id: string) =>
        id === "conv_1" ? { conversation: { id, title: "dinero", updatedAt: 1 }, messages: [] } : null,
      crearConversacionSabina: async () => "conv_1",
      anexarTurnosSabina: async () => true,
      listarConversacionesSabina: async () => [],
    },
  });

  const { NextRequest } = await import("next/server");
  const sabina = await import("@/app/api/sabina/route");
  const confirmarRuta = await import("@/app/api/sabina/propuestas/[id]/confirmar/route");
  catalogo = await import("../engine-catalog");

  preguntar = async (texto, conversacionId) => {
    const res = await sabina.POST(
      new NextRequest("http://app.test/api/sabina", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pregunta: texto, ...(conversacionId ? { conversacionId } : {}) }),
      }),
    );
    assert.equal(res.status, 200, `POST /api/sabina respondió ${res.status}`);
    return res.json();
  };
  confirmar = async (id) => {
    const res = await confirmarRuta.POST(
      new NextRequest(`http://app.test/api/sabina/propuestas/${id}/confirmar`, {
        method: "POST",
        headers: { host: "app.test", origin: "http://app.test", "content-type": "application/json", "user-agent": "prueba" },
        body: "{}",
      }),
      { params: { id } },
    );
    return { status: res.status, json: await res.json() };
  };
});

/* ── guion del modelo ───────────────────────────────────────────────────── */

const uso = { input_tokens: 10, output_tokens: 5 };
const pide = (name: string, input: unknown) => ({ content: [{ type: "tool_use", id: `tu_${name}_${Math.random()}`, name, input }], stop_reason: "tool_use", usage: uso });
const dice = (text: string) => ({ content: [{ type: "text", text }], stop_reason: "end_turn", usage: uso });

function ultimoToolResult(): any {
  for (let i = m.alModelo.length - 1; i >= 0; i--) {
    const ultimo = m.alModelo[i].messages[m.alModelo[i].messages.length - 1];
    if (Array.isArray(ultimo?.content)) {
      const r = ultimo.content.find((b: any) => b.type === "tool_result");
      if (r) return JSON.parse(r.content);
    }
  }
  return null;
}

const factura = (id: string) => m.filas.invoices.find((i: any) => i.id === id);

/** Pregunta con un guion de una herramienta y una respuesta, y devuelve la tarjeta. */
async function tarjetaDe(herramienta: string, input: unknown, texto = "Te lo propongo en la tarjeta.") {
  m.guion = [pide(herramienta, input), dice(texto)];
  const r = await preguntar("pedido");
  assert.equal(r.propuestas?.length, 1, JSON.stringify(ultimoToolResult()));
  return r.propuestas[0];
}

/* ═══════════════════════════════════════════════════════════════════════
   1. EL CATÁLOGO
   ═══════════════════════════════════════════════════════════════════════ */

test("el motor ve las cuatro de dinero; la confirmación ejecuta las tres que escriben, con la key de su endpoint", async () => {
  const { accionDeHerramienta } = await import("../engine-acciones");
  const nombres = catalogo.SABINA_TOOLS.map((t) => t.nombre);
  for (const n of ["facturas_de_paciente", "cobrar_factura", "crear_factura", "avisar_saldo_whatsapp"]) {
    assert.ok(nombres.includes(n), `el motor no ve ${n}`);
  }
  assert.equal(accionDeHerramienta(catalogo.SABINA_TOOLS.find((t) => t.nombre === "facturas_de_paciente")), null);
  const keys = Object.fromEntries(catalogo.ACCIONES_SABINA.map((a) => [a.nombre, a.permiso]));
  assert.equal(keys.cobrar_factura, "billing.charge");
  assert.equal(keys.crear_factura, "billing.create");
  assert.equal(keys.avisar_saldo_whatsapp, "whatsapp.send");
  for (const prohibida of ["timbrar", "cfdi", "reembols", "refund", "cancelar_factura", "anular", "editar_precio", "ortodoncia", "plan_de_pago"]) {
    assert.ok(!nombres.some((n) => n.includes(prohibida)), `hay una herramienta prohibida por MAPA-dinero §7: ${prohibida}`);
  }
});

/* ═══════════════════════════════════════════════════════════════════════
   2. COBRAR, POR LOS HANDLERS DE LA PANTALLA
   ═══════════════════════════════════════════════════════════════════════ */

test("«cóbrale 500 a la MF-0011» → pregunta el método → «efectivo» → tarjeta → «sí» no cobra → botón → el pago existe, una sola vez", async () => {
  /* 1. Sin método no hay tarjeta: se pregunta. */
  m.guion = [pide("cobrar_factura", { factura: "MF-0011", monto: 500 }), dice("¿Con qué método pagó?")];
  const r1 = await preguntar("cóbrale 500 a la MF-0011");
  assert.equal(r1.propuestas, undefined);
  assert.equal(ultimoToolResult().datos.estado, "falta_aclarar");
  assert.match(m.alModelo[0].system, /cobrar facturas; crear facturas; mandar avisos de saldo por WhatsApp/);
  assert.doesNotMatch(m.alModelo[0].system, /no cobras/, "el prompt ya no le prohíbe cobrar a quien tiene la herramienta");

  /* 2. Con método: tarjeta. */
  m.guion = [pide("cobrar_factura", { factura: "MF-0011", monto: 500, metodo: "cash" }), dice("Te propongo registrar $500 en efectivo.")];
  const r2 = await preguntar("en efectivo", "conv_1");
  const t = r2.propuestas[0];
  assert.equal(t.accion, "cobrar_factura");
  assert.equal(t.boton, "Sí, registrar el cobro");
  assert.equal(t.deshacer.reversible, false);
  assert.ok(t.tarjeta.detalles.some((d: any) => d.etiqueta === "Saldo" && d.antes === "$2,000.00" && d.valor === "$1,500.00"));
  assert.deepEqual(m.escrituras, [], "proponer no escribió nada");

  /* 3. Un «sí» escrito no cobra. */
  m.guion = [dice("Para cobrarlo toca el botón de la tarjeta.")];
  await preguntar("sí, cóbralo", "conv_1");
  assert.deepEqual(m.escrituras, []);

  /* 4. El botón → POST /api/invoices/[id] real. */
  const c = await confirmar(t.id);
  assert.equal(c.json.propuesta.estado, "hecha", JSON.stringify(c.json.propuesta.resultado));
  assert.match(c.json.propuesta.resultado.frase, /registré \$500\.00 \(efectivo\) a la factura MF-0011 de Juan Pérez\. Le quedan \$1,500\.00\./);
  assert.match(c.json.propuesta.resultado.frase, /sin caja abierta/, "el aviso del handler (efectivo sin caja) llega al usuario");
  assert.deepEqual(c.json.propuesta.resultado.enlace, { texto: "Comprobante MF-0011", url: "/api/invoices/inv-juan-2/print" });
  const pagos = m.escrituras.filter((e) => e.op === "payment.create");
  assert.equal(pagos.length, 1);
  assert.equal(pagos[0].data.invoiceId, "inv-juan-2");
  assert.equal(pagos[0].data.amount, 500);
  assert.equal(pagos[0].data.method, "cash");
  assert.equal(pagos[0].data.paidAt, undefined, "sin fecha: la pone el servidor (hoy)");
  assert.equal(factura("inv-juan-2").paid, 1500);
  assert.equal(factura("inv-juan-2").status, "PARTIAL");

  /* 5. Otro toque no cobra dos veces. */
  const otra = await confirmar(t.id);
  assert.equal(otra.status, 409);
  assert.equal(m.escrituras.filter((e) => e.op === "payment.create").length, 1);
});

test("saldar un BORRADOR con tarjeta: el botón confirma (POST /confirm) y después marca pagada con ESE método, no efectivo", async () => {
  const t = await tarjetaDe("cobrar_factura", { factura: "MF-0012", metodo: "debit" });
  assert.ok(t.tarjeta.avisos.some((a: string) => /BORRADOR: primero la voy a confirmar/.test(a)));
  const c = await confirmar(t.id);
  assert.equal(c.json.propuesta.estado, "hecha", JSON.stringify(c.json.propuesta.resultado));
  assert.deepEqual(m.escrituras.map((e) => e.op), ["invoice.updateMany", "payment.create", "invoice.updateMany"]);
  assert.equal(m.escrituras[0].data.status, "PENDING");
  assert.equal(m.escrituras[1].data.method, "debit");
  assert.equal(m.escrituras[1].data.amount, 800);
  assert.equal(factura("inv-mg1-borrador").status, "PAID");
  const resultado = m.propuestas.filas.find((f) => f.entityId === t.id && f.action === EVENTO.resultado)!;
  assert.deepEqual(resultado.changes.llamadas.map((l: any) => `${l.metodo} ${l.ruta} ${l.status}`), [
    "POST /api/invoices/inv-mg1-borrador/confirm 200",
    "POST /api/invoices/inv-mg1-borrador/mark-paid 200",
  ]);
});

test("🔴 si en la pantalla cobran esa factura entre la tarjeta y el botón, Sabina NO cobra", async () => {
  const t = await tarjetaDe("cobrar_factura", { factura: "MF-0010", metodo: "transfer" });
  Object.assign(factura("inv-juan-1"), { paid: 200, status: "PARTIAL", updatedAt: new Date() });
  const c = await confirmar(t.id);
  assert.equal(c.json.propuesta.estado, "fallida");
  assert.equal(c.json.propuesta.resultado.frase, FRASE.cambio);
  assert.deepEqual(m.escrituras, []);
});

test("un doctor no cobra: ni tarjeta, y se dice", async () => {
  m.sesion = sesionDe(U_DOC1, "DOCTOR");
  m.guion = [pide("cobrar_factura", { factura: "MF-0010", metodo: "cash" }), dice("No puedo cobrar.")];
  const r = await preguntar("cobra la MF-0010 en efectivo");
  assert.equal(r.propuestas, undefined);
  assert.match(r.respuesta, /No tienes permiso para cobrar facturas/);
  assert.deepEqual(m.escrituras, []);
});

/* ═══════════════════════════════════════════════════════════════════════
   3. FACTURAR
   ═══════════════════════════════════════════════════════════════════════ */

test("🔴 crear factura: el total de la tarjeta es el que guarda POST /api/invoices, con el IVA de la clínica y las mismas líneas", async () => {
  const t = await tarjetaDe("crear_factura", {
    paciente: "Juan Pérez",
    conceptos: [{ concepto: "Limpieza", precio: 800 }, { concepto: "Resina", cantidad: 2, precio: 350.5, descuento: 50 }],
    descuento: 100,
  });
  assert.match(t.tarjeta.frase, /por \$1,351\.00/);
  assert.ok(t.tarjeta.tabla, "la tarjeta trae la tabla de conceptos");
  assert.deepEqual(t.tarjeta.tabla.pie.at(-1), { etiqueta: "Total", valor: "$1,351.00", fuerte: true });
  assert.ok(t.tarjeta.avisos.some((a: string) => /folio MF-0016 .*no se puede borrar, solo anular/.test(a)), JSON.stringify(t.tarjeta.avisos));
  assert.deepEqual(m.escrituras, []);

  const c = await confirmar(t.id);
  assert.equal(c.json.propuesta.estado, "hecha", JSON.stringify(c.json.propuesta.resultado));
  const alta = m.escrituras.find((e) => e.op === "invoice.create")!;
  assert.equal(alta.data.total, 1351, "lo guardado es lo que dijo la tarjeta");
  assert.equal(alta.data.taxRate, 0);
  assert.equal(alta.data.taxIncluded, true);
  assert.equal(alta.data.status, "PENDING");
  assert.equal(alta.data.invoiceNumber, "MF-0016");
  assert.deepEqual(alta.data.items, [
    { description: "Limpieza", quantity: 1, unitPrice: 800, total: 800 },
    { description: "Resina", quantity: 2, unitPrice: 350.5, discount: 50, total: 651 },
  ]);
  assert.match(c.json.propuesta.resultado.frase, /^Listo: creé la factura MF-0016 de Juan Pérez por \$1,351\.00/);
  assert.equal(c.json.propuesta.resultado.enlace.texto, "Comprobante MF-0016");
});

test("facturar el presupuesto P-0001 por POST /api/quotes/[id]/invoice: borrador, mismo total, y ligado", async () => {
  const t = await tarjetaDe("crear_factura", { presupuesto: "P-0001" });
  assert.equal(t.deshacer.reversible, true);
  assert.match(t.tarjeta.frase, /\$2,900\.00, en borrador/);
  const c = await confirmar(t.id);
  assert.equal(c.json.propuesta.estado, "hecha", JSON.stringify(c.json.propuesta.resultado));
  const alta = m.escrituras.find((e) => e.op === "invoice.create")!;
  assert.equal(alta.data.status, "DRAFT");
  assert.equal(alta.data.total, 2900);
  assert.equal(m.filas.quotes.find((q: any) => q.id === "q-juan").invoiceId, m.filas.invoices.at(-1).id);
  assert.match(c.json.propuesta.resultado.frase, /facturé el presupuesto P-0001 de Juan Pérez en la factura MF-0016 por \$2,900\.00, en borrador/);

  // Ya tiene factura: la segunda vez ni tarjeta.
  m.guion = [pide("crear_factura", { presupuesto: "P-0001" }), dice("Ya tiene factura.")];
  const r = await preguntar("factura otra vez el P-0001");
  assert.equal(r.propuestas, undefined);
  assert.match(ultimoToolResult().datos.frase, /ya tiene su factura, la MF-0016/);
});

/* ═══════════════════════════════════════════════════════════════════════
   4. EL AVISO POR WHATSAPP
   ═══════════════════════════════════════════════════════════════════════ */

test("🔴 aviso: lo que sale por WhatsApp es EXACTAMENTE el texto de la tarjeta; y ese día no se ofrece otro", async () => {
  const t = await tarjetaDe("avisar_saldo_whatsapp", { factura: "MF-0010" });
  const texto = t.tarjeta.detalles.find((d: any) => d.etiqueta === "Mensaje que recibe").valor.replace(/^«|»$/g, "");
  assert.deepEqual(m.enviados, []);

  const c = await confirmar(t.id);
  assert.equal(c.json.propuesta.estado, "hecha", JSON.stringify(c.json.propuesta.resultado));
  assert.equal(m.enviados.length, 1);
  assert.equal(m.enviados[0].body, texto, "la tarjeta prometió ese texto");
  assert.equal(m.enviados[0].to, "5599990000");
  assert.equal(m.enviados[0].kind, "payment_notice");

  m.guion = [pide("avisar_saldo_whatsapp", { factura: "MF-0010" }), dice("Ya se le avisó hoy.")];
  const otra = await preguntar("mándale otra vez el aviso");
  assert.equal(otra.propuestas, undefined);
  assert.match(ultimoToolResult().datos.frase, /ya le mandé un aviso de saldo a Juan Pérez/);
});

test("🔴 aviso con 502: no se reintenta, y ese día no se vuelve a ofrecer (pudo llegar aunque el Inbox no lo tenga)", async () => {
  m.whatsappFalla = new Error("Meta no respondió");
  const t = await tarjetaDe("avisar_saldo_whatsapp", { factura: "MF-0010" });
  const c = await confirmar(t.id);
  assert.equal(c.json.propuesta.estado, "fallida");
  assert.match(c.json.propuesta.resultado.frase, /no sé si el mensaje le llegó.*hoy no lo vuelvo a intentar/);
  assert.equal(m.enviados.length, 0);

  m.whatsappFalla = null;
  m.guion = [pide("avisar_saldo_whatsapp", { factura: "MF-0010" }), dice("Hoy no puedo volver a mandarlo.")];
  const otra = await preguntar("mándaselo otra vez");
  assert.equal(otra.propuestas, undefined);
  assert.match(ultimoToolResult().datos.frase, /pudo haberle llegado aunque no aparezca en el Inbox/);
  assert.equal(m.enviados.length, 0);
});
