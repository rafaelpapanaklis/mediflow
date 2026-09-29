/**
 * EL AVISO DE LA MENSUALIDAD POR VENCER — ws1-t3.
 *
 * Run: npm run test:cobranza-aviso
 *
 * Hoy la clínica avisa de la cita, del cumpleaños y del seguimiento. De la
 * mensualidad, nada. Esto prueba lo que el aviso nuevo NO puede hacer nunca:
 *
 *   1. Sin configuración guardada, el cron no encola NI UNO.
 *   2. Corriendo el barrido DOS veces, el paciente recibe UN mensaje.
 *   3. Una factura pagada o cancelada no se cobra por WhatsApp.
 *   4. Ni un paciente dado de baja o borrado.
 *
 * Cómo prueba: el barrido REAL (`sweepCobranzaClinica` / `sweepTodaLaCobranza`)
 * con `mock.module` sobre prisma y sobre el lector de condiciones. ⛔ Aquí no
 * sale ni un WhatsApp: el barrido solo ENCOLA, y el doble de `createMany`
 * apunta lo que habría escrito. El envío real es de la cola, que no se toca.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { CondicionesPago } from "@/lib/quotes/condiciones-pago";

const TZ = "America/Mexico_City";
/** 10:00 en México del 1 de marzo de 2026. */
const AHORA = new Date("2026-03-01T16:00:00.000Z");

/* ── Estado de los dobles ──────────────────────────────────────────────── */
/** Filas de `invoices` que ve el barrido. */
let facturas: any[];
/** Filas de `whatsapp_reminders` ya existentes (lo ya encolado). */
let encolados: any[];
/** Condiciones por factura (la tabla `invoice_payment_terms`). */
let condiciones: Map<string, CondicionesPago>;
/** Clínicas que devuelve `clinic.findMany`. */
let clinicas: any[];
/**
 * Planes de ortodoncia con responsable de pago (A11) — ws1-t10 (H·F "Menor
 * con tutor"): `invoiceId` → teléfono del Guardian. Vacío por defecto: la
 * mayoría de las facturas no son de un caso de ortodoncia con tutor.
 */
let planesOrtoConResponsable: any[];
/** ws1-t8: el último aviso de cobro (manual o automático) por teléfono, según `ultimoAvisoDeCobro`. */
let ultimosAvisos: Map<string, Date>;

const plazos = (over: Partial<CondicionesPago> = {}): CondicionesPago => ({
  modo: "plazos",
  metodo: null,
  enganche: 0,
  numPagos: 10,
  frecuencia: "MONTHLY",
  primerPago: "2026-03-03",
  difiereConSuBanco: false,
  ...over,
});

function factura(over: Partial<any> = {}) {
  return {
    id: "inv1",
    status: "PENDING",
    total: 10000,
    patientId: "p1",
    patient: {
      firstName: "Ana",
      lastName: "López",
      phone: "999 260 2093",
      status: "ACTIVE",
      deletedAt: null,
    },
    payments: [],
    ...over,
  };
}

function clinica(reminderSettings: unknown) {
  return { id: "c1", name: "Clínica QA", timezone: TZ, reminderSettings };
}

/** La config que enciende el aviso. Sin esto, no sale nada. */
const ENCENDIDO = { cobranza: { enabled: true, diasAntes: 3, bot: false } };

beforeEach(() => {
  facturas = [factura()];
  encolados = [];
  condiciones = new Map([["inv1", plazos()]]);
  clinicas = [clinica(ENCENDIDO)];
  planesOrtoConResponsable = [];
  ultimosAvisos = new Map();
});

// ws1-t8: el barrido pregunta por el tope de 24 h con la MISMA función que los avisos manuales.
(mock as any).module("@/lib/whatsapp/aviso-cobro-tope", {
  namedExports: {
    ultimoAvisoDeCobro: async (clinicId: string, phone: string) => {
      assert.equal(clinicId, "c1", "el tope se mira por clínica");
      return ultimosAvisos.get(phone.replace(/\D/g, "").slice(-10)) ?? null;
    },
  },
});

(mock as any).module("@/lib/prisma", {
  namedExports: {
    prisma: {
      invoice: {
        findMany: async ({ where }: any) => {
          // (c) de la casa: el filtro de tenant va SIEMPRE.
          assert.equal(where.clinicId, "c1", "la consulta de facturas filtra por clínica");
          assert.deepEqual(
            where.patient,
            { deletedAt: null },
            "el paciente borrado se filtra en la base",
          );
          return facturas.filter((f) => !where.patientId || f.patientId === where.patientId);
        },
      },
      whatsAppReminder: {
        findMany: async ({ where }: any) => {
          assert.equal(where.clinicId, "c1", "el dedupe se lee por clínica");
          assert.equal(where.type, "PAYMENT_DUE");
          assert.ok(where.createdAt?.gte instanceof Date, "y acotado por fecha, no la tabla entera");
          // El doble aplica el MISMO filtro de status que pide el barrido: un
          // aviso FAILED no puede contar como «ya avisado».
          const permitidos: string[] = where.status?.in ?? [];
          return encolados.filter((e) => permitidos.includes(e.status));
        },
        createMany: async ({ data }: any) => {
          // Lo encolado se queda: así la SEGUNDA corrida lo ve como ya avisado,
          // igual que pasaría en la base de verdad.
          encolados.push(...data);
          return { count: data.length };
        },
      },
      clinic: {
        findMany: async () => clinicas,
      },
      orthodonticTreatmentPlan: {
        findMany: async ({ where }: any) => {
          assert.equal(where.clinicId, "c1", "el responsable de pago se lee por clínica");
          return planesOrtoConResponsable.filter((p) => where.invoiceId.in.includes(p.invoiceId));
        },
      },
    },
  },
});

(mock as any).module("@/lib/invoices/condiciones-pago-db", {
  namedExports: {
    leerCondicionesDeFacturas: async (_db: unknown, { clinicId, invoiceIds }: any) => {
      assert.equal(clinicId, "c1", "las condiciones se leen por clínica");
      const porFactura = new Map<string, CondicionesPago>();
      invoiceIds.forEach((id: string) => {
        const c = condiciones.get(id);
        if (c) porFactura.set(id, c);
      });
      return { porFactura, fallo: false, sinTabla: false };
    },
  },
});

async function barrer() {
  const { sweepCobranzaClinica } = await import("@/lib/whatsapp/cobranza/sweep");
  return sweepCobranzaClinica(clinicas[0], { now: AHORA });
}

async function barrerTodo() {
  const { sweepTodaLaCobranza } = await import("@/lib/whatsapp/cobranza/sweep");
  return sweepTodaLaCobranza({ now: AHORA });
}

/* ═══ 1. APAGADO POR DEFECTO ═══════════════════════════════════════════ */

test("sin configuración guardada, el barrido no encola NI UNO", async () => {
  clinicas = [clinica(null)];
  const r = await barrer();
  assert.equal(r.encolados, 0, "una clínica sin config no manda nada");
  assert.equal(encolados.length, 0, "no se escribió ninguna fila");
});

test("con el Json a medias (recordatorios sí, cobranza no) tampoco sale nada", async () => {
  // El caso real: la clínica ya configuró recordatorios de cita y recall, y
  // nunca tocó cobranza. Eso NO puede encender el aviso de rebote.
  clinicas = [clinica({ enabled: true, offsets: [1440], channel: "whatsapp", recall: { enabled: true } })];
  const r = await barrer();
  assert.equal(r.encolados, 0);
});

test("`cobranza.enabled` explícitamente en false no manda nada", async () => {
  clinicas = [clinica({ cobranza: { enabled: false, diasAntes: 3, bot: true } })];
  const r = await barrer();
  assert.equal(r.encolados, 0, "el interruptor del bot no enciende el aviso");
});

test("el barrido global solo mira a las clínicas que lo encendieron", async () => {
  clinicas = [clinica(null), { ...clinica(ENCENDIDO), id: "c1" }];
  const resumen = await barrerTodo();
  assert.equal(resumen.clinics, 1, "solo entra la que tiene el aviso encendido");
  assert.equal(resumen.encolados, 1);
});

/* ═══ 2. IDEMPOTENCIA ══════════════════════════════════════════════════ */

test("el cron DOS veces deja UN mensaje, no dos", async () => {
  const primera = await barrer();
  assert.equal(primera.encolados, 1, "la primera corrida sí encola");

  const segunda = await barrer();
  assert.equal(segunda.encolados, 0, "la segunda no vuelve a encolar");
  assert.equal(encolados.length, 1, "el paciente tiene UNA sola fila");
  assert.equal(
    segunda.motivos.yaAvisado,
    1,
    "y se descarta diciendo por qué, no en silencio",
  );
});

test("la llave de dedupe es determinista: factura, cuota y vencimiento", async () => {
  await barrer();
  const payload = encolados[0].payload;
  assert.equal(payload.dedupeKey, "inv1|1|2026-03-03");
  assert.equal(payload.installmentNumber, 1, "el nombre que el propio schema puso de ejemplo");
  assert.equal(payload.invoiceId, "inv1");
  assert.equal(payload.patientId, "p1");
});

test("si la cuota cambia de fecha, ESE sí es un aviso nuevo", async () => {
  await barrer();
  assert.equal(encolados.length, 1);
  // La clínica reescribió las condiciones: la cuota 1 ahora vence el día 2.
  condiciones.set("inv1", plazos({ primerPago: "2026-03-02" }));
  const r = await barrer();
  assert.equal(r.encolados, 1, "un plan reprogramado no se queda callado para siempre");
});

test("la misma factura repetida en la lista no produce dos avisos", async () => {
  facturas = [factura(), factura()];
  const r = await barrer();
  assert.equal(r.encolados, 1, "dentro de la MISMA corrida tampoco se repite");
});

/* ═══ 3. A QUIÉN NO SE LE COBRA ════════════════════════════════════════ */

test("una factura PAGADA no se avisa", async () => {
  // La cargamos igual que si llegara por otra vía: la regla vive en el núcleo,
  // no solo en el `where` de la consulta.
  facturas = [factura({ status: "PAID" })];
  const r = await barrer();
  assert.equal(r.encolados, 0);
  assert.equal(r.motivos.facturaPagada, 1);
});

test("una factura CANCELADA no se avisa", async () => {
  facturas = [factura({ status: "CANCELLED" })];
  const r = await barrer();
  assert.equal(r.encolados, 0);
  assert.equal(r.motivos.facturaCancelada, 1);
});

test("un borrador todavía no se le enseñó al paciente", async () => {
  facturas = [factura({ status: "DRAFT" })];
  const r = await barrer();
  assert.equal(r.encolados, 0);
  assert.equal(r.motivos.facturaBorrador, 1);
});

test("un paciente dado de baja no recibe cobranza", async () => {
  facturas = [factura({ patient: { ...factura().patient, status: "INACTIVE" } })];
  const r = await barrer();
  assert.equal(r.encolados, 0);
  assert.equal(r.motivos.pacienteDadoDeBaja, 1);
});

test("un paciente borrado tampoco", async () => {
  facturas = [factura({ patient: { ...factura().patient, deletedAt: new Date() } })];
  const r = await barrer();
  assert.equal(r.encolados, 0);
  assert.equal(r.motivos.pacienteBorrado, 1);
});

test("un plan ya saldado por los pagos no se cobra aunque la factura siga PENDING", async () => {
  // El `status` lo mueve Caja; el plan lo deriva el dinero. Manda el dinero.
  facturas = [factura({ payments: [{ amount: 10000, method: "cash" }] })];
  const r = await barrer();
  assert.equal(r.encolados, 0);
  assert.equal(r.motivos.planSaldado, 1);
});

test("un reembolso REABRE el plan (method refund cuenta en contra)", async () => {
  // En `payments` un reembolso es method "refund" con amount POSITIVO: sumar a
  // secas lo contaría como cobro y el paciente se quedaría sin su aviso.
  facturas = [
    factura({
      payments: [
        { amount: 10000, method: "cash" },
        { amount: 10000, method: "refund" },
      ],
    }),
  ];
  const r = await barrer();
  assert.equal(r.encolados, 1, "devuelto el dinero, la mensualidad vuelve a deberse");
});

test("una factura que no es a plazos no genera aviso", async () => {
  condiciones = new Map();
  const r = await barrer();
  assert.equal(r.encolados, 0);
  assert.equal(r.motivos.sinPlanAPlazos, 1);
});

test("un plan sin fechas no vence nunca: no se inventa una", async () => {
  condiciones.set("inv1", plazos({ primerPago: null }));
  const r = await barrer();
  assert.equal(r.encolados, 0);
  assert.equal(r.motivos.sinFechaDeVencimiento, 1);
});

test("sin teléfono no hay a quién mandarle", async () => {
  facturas = [factura({ patient: { ...factura().patient, phone: null } })];
  const r = await barrer();
  assert.equal(r.encolados, 0);
  assert.equal(r.motivos.sinTelefono, 1);
});

/* ═══ 4. LA VENTANA: ni antes de tiempo ni de las vencidas ═════════════ */

test("una cuota que vence MÁS ALLÁ de la ventana todavía no se avisa", async () => {
  condiciones.set("inv1", plazos({ primerPago: "2026-04-15" }));
  const r = await barrer();
  assert.equal(r.encolados, 0);
  assert.equal(r.motivos.todaviaNoTocaAvisar, 1);
});

test("la cuota que vence HOY sí entra: avisar el mismo día sigue sirviendo", async () => {
  condiciones.set("inv1", plazos({ primerPago: "2026-03-01" }));
  const r = await barrer();
  assert.equal(r.encolados, 1);
  assert.equal(encolados[0].payload.dueDate, "2026-03-01");
});

test("se avisa de la PRÓXIMA por vencer, no de la que ya venció", async () => {
  // Plan que arrancó en enero y va atrasado: la cuota 1 y la 2 ya vencieron.
  condiciones.set("inv1", plazos({ primerPago: "2026-01-03" }));
  const r = await barrer();
  assert.equal(r.encolados, 1);
  assert.equal(
    encolados[0].payload.installmentNumber,
    3,
    "el aviso es de la que está POR vencer; lo vencido es otra conversación",
  );
});

test("el importe que se anuncia es lo que FALTA de esa cuota, no su nominal", async () => {
  // $10,000 en 10 cuotas de $1,000. Ya pagó $500 a cuenta.
  facturas = [factura({ payments: [{ amount: 500, method: "cash" }] })];
  const r = await barrer();
  assert.equal(r.encolados, 1);
  assert.equal(encolados[0].payload.amount, 500, "pide los $500 que quedan, no $1,000");
});

/* ═══ 5. LA FILA QUE SE ENCOLA ═════════════════════════════════════════ */

test("la fila encolada es la que la cola de siempre sabe enviar", async () => {
  await barrer();
  const fila = encolados[0];
  assert.equal(fila.clinicId, "c1", "multi-tenant: la fila lleva su clínica");
  assert.equal(fila.type, "PAYMENT_DUE");
  assert.equal(fila.status, "PENDING", "la cola la recoge; aquí no se envía nada");
  assert.equal(fila.appointmentId, null, "no cuelga de una cita");
  assert.equal(fila.patientPhone, "999 260 2093");
  assert.match(fila.message, /Ana/, "el mensaje lleva el nombre del paciente");
  assert.match(fila.message, /Clínica QA/);
  assert.match(fila.message, /\$1,000\.00/, "y el importe, formateado en pesos");
});

test("ws1-t10 (H·F «Menor con tutor»): con responsable de pago, el aviso va a SU teléfono, no al del niño", async () => {
  planesOrtoConResponsable = [
    { invoiceId: "inv1", responsibleGuardian: { phone: "555 111 2222" } },
  ];
  const r = await barrer();
  assert.equal(r.encolados, 1);
  assert.equal(encolados[0].patientPhone, "555 111 2222", "no el 999 260 2093 del paciente");
});

test("sin responsable de pago (o sin caso de ortodoncia), el aviso sigue yendo al paciente", async () => {
  planesOrtoConResponsable = [{ invoiceId: "inv1", responsibleGuardian: null }];
  const r = await barrer();
  assert.equal(r.encolados, 1);
  assert.equal(encolados[0].patientPhone, "999 260 2093");
});

test("ws1-t10 (H·F «Pausa»): un caso ON_HOLD no genera aviso automático de su mensualidad", async () => {
  planesOrtoConResponsable = [{ invoiceId: "inv1", status: "ON_HOLD", responsibleGuardian: null }];
  const r = await barrer();
  assert.equal(r.encolados, 0, "la clínica ya pausó la cobranza desde el caso; el barrido no debe insistir");
});

test("ws1-t10 (H·F «Abandono»): un caso DROPPED_OUT tampoco", async () => {
  planesOrtoConResponsable = [{ invoiceId: "inv1", status: "DROPPED_OUT", responsibleGuardian: null }];
  const r = await barrer();
  assert.equal(r.encolados, 0);
});

test("un caso EN CURSO (IN_PROGRESS) sigue avisando normal", async () => {
  planesOrtoConResponsable = [{ invoiceId: "inv1", status: "IN_PROGRESS", responsibleGuardian: null }];
  const r = await barrer();
  assert.equal(r.encolados, 1, "solo pausa/abandono detienen el aviso; un plan en curso no");
});

test("la plantilla de la clínica manda sobre la de fábrica", async () => {
  clinicas = [
    clinica({
      cobranza: {
        enabled: true,
        diasAntes: 3,
        bot: false,
        message: "Hola {nombre}, debes {importe} el {fecha}. Cuota {cuota} de {total}.",
      },
    }),
  ];
  await barrer();
  assert.equal(
    encolados[0].message,
    "Hola Ana, debes $1,000.00 el 3 de marzo de 2026. Cuota 1 de 10.",
  );
});

/* ═══ 6. LO QUE ENCONTRÓ LA AUDITORÍA ══════════════════════════════════ */

test("un aviso que FALLÓ no queda suprimido para siempre", async () => {
  // El caso real: la cola intenta enviarlo, la ventana de 24 h está cerrada y
  // la fila queda FAILED. Si el dedupe contara ese fallo como «ya avisado», el
  // aviso no volvería a intentarse NUNCA — ni cuando el paciente escriba a la
  // clínica y la ventana se abra. La clínica encendería el interruptor y no le
  // llegaría nada a nadie, sin enterarse.
  await barrer();
  assert.equal(encolados.length, 1);
  encolados[0].status = "FAILED";

  const r = await barrer();
  assert.equal(r.encolados, 1, "se vuelve a intentar");
});

test("uno CANCELADO tampoco bloquea el reintento", async () => {
  await barrer();
  encolados[0].status = "CANCELLED";
  const r = await barrer();
  assert.equal(r.encolados, 1);
});

test("pero uno que salió bien (SENT) sí sigue bloqueando", async () => {
  await barrer();
  encolados[0].status = "SENT";
  const r = await barrer();
  assert.equal(r.encolados, 0, "el paciente no recibe el mismo aviso dos veces");
});

test("un paciente con DOS planes a plazos recibe UN aviso, no dos", async () => {
  // Un tratamiento partido en dos facturas con el mismo día de pago es un caso
  // real. Dos WhatsApp seguidos diciendo casi lo mismo no se leen como dos
  // avisos: se leen como el sistema fallando.
  facturas = [factura(), factura({ id: "inv2" })];
  condiciones.set("inv2", plazos());
  const r = await barrer();
  assert.equal(r.encolados, 1, "un solo mensaje");
  assert.equal(r.motivos.otroAvisoDelMismoPaciente, 1, "y consta por qué se dejó el otro");
});

test("entre dos planes del mismo paciente gana la cuota que vence ANTES", async () => {
  facturas = [factura(), factura({ id: "inv2" })];
  condiciones.set("inv1", plazos({ primerPago: "2026-03-03" }));
  condiciones.set("inv2", plazos({ primerPago: "2026-03-02" }));
  const r = await barrer();
  assert.equal(r.encolados, 1);
  assert.equal(encolados[0].payload.invoiceId, "inv2", "la que urge");
  assert.equal(encolados[0].payload.dueDate, "2026-03-02");
});

test("dos pacientes distintos sí reciben su aviso cada uno", async () => {
  facturas = [
    factura(),
    factura({ id: "inv2", patientId: "p2", patient: { ...factura().patient, firstName: "Beto" } }),
  ];
  condiciones.set("inv2", plazos());
  const r = await barrer();
  assert.equal(r.encolados, 2, "el tope es por paciente, no por clínica");
});

/* ═══ ws1-t8 (auditoría de conexiones, punto 1): el tope de 24 h frente a los avisos MANUALES ═══ */

test("ws1-t8: si recepción ya mandó un aviso de cobro a ese teléfono hoy, el barrido NO encola otro", async () => {
  ultimosAvisos.set("9992602093", new Date(AHORA.getTime() - 3 * 60 * 60 * 1000));
  const r = await barrer();
  assert.equal(r.encolados, 0);
  assert.equal(encolados.length, 0, "no se escribió ninguna fila");
  assert.equal(r.motivos.avisoDeCobroReciente, 1, "y consta por qué");
});

test("ws1-t8: otro teléfono sin aviso reciente sí sale, aunque un vecino esté topado", async () => {
  ultimosAvisos.set("9992602093", new Date(AHORA.getTime() - 60 * 1000));
  facturas = [
    factura(),
    factura({ id: "inv2", patientId: "p2", patient: { ...factura().patient, firstName: "Beto", phone: "999 111 2222" } }),
  ];
  condiciones.set("inv2", plazos());
  const r = await barrer();
  assert.equal(r.encolados, 1);
  assert.equal(encolados[0].patientPhone, "999 111 2222");
});

test("ws1-t8: sin aviso previo el barrido sigue igual, y usa ultimoAvisoDeCobro (sin duplicar la lógica)", async () => {
  const r = await barrer();
  assert.equal(r.encolados, 1);
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(require("node:path").join(__dirname, "..", "sweep.ts"), "utf8");
  assert.match(src, /ultimoAvisoDeCobro/);
  assert.doesNotMatch(src, /lastSentOfKind|payment_notice/, "no reimplementa la consulta del tope");
});
