// ws1-t11 (11d) — NINGÚN camino de envío a pacientes se salta el freno de
// «Paciente de prueba / no contactar». Lee el código: si mañana alguien llama a
// Meta o manda un correo a un paciente por un camino nuevo, esto falla y dice
// dónde.
// Correr: npm run test:paciente-de-prueba
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { calcularResumenFinanzas } from "@/lib/finanzas-resumen.server";
import { filtroSinPrueba } from "../paciente-de-prueba";

const RAIZ = join(__dirname, "../../../..");
const SRC = join(RAIZ, "src");
// Los otros verticales tienen sus propios pacientes/contactos (y su propia
// exclusión, p. ej. RealtyContactOptOut); esta marca es del dental.
const FUERA = /(__tests__|\/realty\/|\/barber\/|\/edu\/|\/app\/(b|i|barber|barberias|inmobiliaria|inmobiliarias|instituto|instituciones)\/)/;

function archivos(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...archivos(p));
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}
const TODOS = archivos(SRC)
  .map((p) => ({ ruta: relative(RAIZ, p).replace(/\\/g, "/"), texto: readFileSync(p, "utf8") }))
  .filter((f) => !FUERA.test("/" + f.ruta));

/** Quita comentarios para no contar menciones. */
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("WhatsApp: solo dos caminos hablan con Meta fuera de sendWhatsAppLogged, y los dos frenan", () => {
  const LLAMADA = /\bsendWhatsApp(Message|Template|Interactive|Document)\(/;
  const PERMITIDOS: Record<string, string> = {
    "src/lib/whatsapp.ts": "el cliente de Meta mismo",
    "src/lib/whatsapp/send-and-log.ts": "EL freno (sendWhatsAppLogged)",
    "src/app/api/whatsapp/webhook/route.ts": "respuestas del bot (frena con motivoParaNoContactar)",
    "src/app/api/inbox/threads/[id]/messages/route.ts": "respuesta a mano del Inbox (frena con motivoParaNoContactar)",
  };

  it("nadie más llama a Meta directo", () => {
    const fuera = TODOS.filter((f) => LLAMADA.test(sinComentarios(f.texto)) && !(f.ruta in PERMITIDOS)).map((f) => f.ruta);
    assert.deepEqual(fuera, [], "Envío a Meta sin pasar por sendWhatsAppLogged: usa sendWhatsAppLogged o añade el freno");
  });

  it("los caminos permitidos aplican el freno", () => {
    const sendAndLog = TODOS.find((f) => f.ruta === "src/lib/whatsapp/send-and-log.ts")!.texto;
    assert.match(sendAndLog, /motivoParaNoContactar\(/);
    assert.match(sendAndLog, /throw new PacienteNoContactarError\(\)/);
    // El freno va ANTES de la primera llamada a Meta.
    assert.ok(sendAndLog.indexOf("motivoParaNoContactar(") < sendAndLog.indexOf("await sendWhatsAppTemplate("));
    for (const ruta of ["src/app/api/whatsapp/webhook/route.ts", "src/app/api/inbox/threads/[id]/messages/route.ts"]) {
      const t = TODOS.find((f) => f.ruta === ruta)!.texto;
      assert.match(t, /motivoParaNoContactar\(/, `${ruta} no frena`);
    }
  });

  it("el bot ni piensa con el número de un paciente de prueba", () => {
    const t = TODOS.find((f) => f.ruta === "src/app/api/whatsapp/webhook/route.ts")!.texto;
    const turno = t.slice(t.indexOf("async function turnoDelBot("));
    assert.ok(turno.indexOf("motivoParaNoContactar(") < turno.indexOf("runBotTurn("));
  });
});

describe("Correo: todo correo a un paciente lleva `paciente` (o frena antes)", () => {
  // Correos que NO van a un paciente de una clínica: plataforma → clínica,
  // soporte, privacidad, afiliados, y el portal del paciente cuando ÉL pide
  // verificar su correo o recuperar su contraseña (no lo manda la clínica).
  const NO_PACIENTE = new Set([
    "src/lib/email.ts",
    "src/lib/affiliate-emails.ts",
    "src/lib/marketplace/module-activated-email.ts",
    "src/lib/billing/spei-directo.ts",
    "src/lib/support/notifications.ts",
    "src/lib/patient-portal/emails.ts",
    "src/app/api/arco/request/route.ts",
    "src/app/api/paciente/password/forgot/route.ts",
    "src/app/api/paciente/verify/resend/route.ts",
    "src/app/api/paciente/register/route.ts",
  ]);
  const FRENA_ANTES = new Set(["src/app/api/inbox/threads/[id]/messages/route.ts"]);

  it("cada sendEmail a un paciente pasa `paciente:`", () => {
    const faltan: string[] = [];
    for (const f of TODOS) {
      if (NO_PACIENTE.has(f.ruta)) continue;
      const t = sinComentarios(f.texto);
      let i = t.indexOf("sendEmail(");
      while (i !== -1) {
        const llamada = t.slice(i, i + 700);
        const cierre = llamada.indexOf("});");
        const cuerpo = cierre === -1 ? llamada : llamada.slice(0, cierre);
        if (!/paciente:/.test(cuerpo) && !FRENA_ANTES.has(f.ruta)) faltan.push(f.ruta);
        i = t.indexOf("sendEmail(", i + 1);
      }
    }
    assert.deepEqual(faltan, [], "Correo a paciente sin el freno: pasa `paciente: { clinicId, patientId }` a sendEmail");
  });

  it("la respuesta a mano por correo del Inbox frena antes de mandar", () => {
    const t = TODOS.find((f) => f.ruta === "src/app/api/inbox/threads/[id]/messages/route.ts")!.texto;
    assert.ok(t.indexOf("motivoParaNoContactar(") < t.indexOf("await sendEmail("));
  });
});

describe("Cargos automáticos", () => {
  it("firmar el control y la factura borrador de la nota clínica preguntan por la marca", () => {
    for (const ruta of ["src/app/actions/orthodontics/signTreatmentCard.ts", "src/app/api/clinical/route.ts"]) {
      const t = TODOS.find((f) => f.ruta === ruta)!.texto;
      assert.match(t, /esPacienteDePrueba\(/, `${ruta} factura solo sin mirar la marca`);
    }
  });
});

describe("Métricas: ninguna pantalla de números cuenta al paciente de prueba", () => {
  // Cada una carga EL filtro (`cargarFiltroSinPrueba`) y lo aplica. Si mañana
  // aparece una pantalla de métricas nueva, la búsqueda de abajo la encuentra.
  const PANTALLAS: Record<string, string> = {
    "src/app/dashboard/analytics/page.tsx": "Analítica → Resumen",
    "src/app/dashboard/reports/cargar-reportes.ts": "Reportes (y su pestaña en Analítica)",
    "src/app/api/dashboard/home/admin/route.ts": "tablero de inicio del dueño",
    "src/app/api/dashboard/home/revenue/route.ts": "gráfica de ingresos del inicio",
    "src/app/api/analytics/no-shows/route.ts": "Analítica → Inasistencias",
    "src/app/api/analytics/cohorts/route.ts": "Analítica → CRM (cohortes)",
    "src/app/api/analytics/churn-risk/route.ts": "Analítica → CRM (en riesgo)",
    "src/app/api/analytics/patients-value/route.ts": "Analítica → CRM (valor)",
    "src/app/api/analytics/doctor-performance/route.ts": "Analítica → Doctores",
    "src/app/api/analytics/payroll-pdf/route.ts": "Analítica → Doctores (nómina PDF)",
    "src/app/api/analytics/occupancy/route.ts": "Analítica → Ocupación",
    "src/app/api/analytics/efficiency-score/route.ts": "Analítica → Ocupación (eficiencia)",
    "src/app/api/analytics/procedures/route.ts": "Analítica → Procedimientos",
    "src/app/api/analytics/resource-costs/route.ts": "Analítica → Costos",
    "src/app/api/analytics/waiting-room/route.ts": "Analítica → Sala de espera",
    "src/app/api/analytics/journey/route.ts": "Analítica → Recorrido",
    "src/app/api/finanzas/route.ts": "Finanzas",
    "src/app/api/finanzas/ortodoncia/route.ts": "Finanzas → Ortodoncia",
    "src/app/dashboard/orthodontics/tablero/page.tsx": "tablero de Ortodoncia",
    "src/lib/sabina/tools/reportes.ts": "Sabina · reportes",
    "src/lib/sabina/tools/ingresos-por-periodo.ts": "Sabina · ingresos",
    "src/lib/sabina/tools/pacientes-nuevos.ts": "Sabina · pacientes nuevos",
    "src/lib/sabina/tools/tratamientos-por-ingreso.ts": "Sabina · tratamientos por ingreso",
    "src/lib/sabina/tools/orto-motor.ts": "Sabina · tablero de ortodoncia",
  };
  // De /api/analytics, lo que NO es una métrica de la clínica.
  const NO_METRICA: Record<string, string> = {
    "src/app/api/analytics/no-shows/predict/route.ts": "predicción de UNA cita (su propio historial)",
    "src/app/api/analytics/ai-insight/route.ts": "recibe los números que ya pintó la pantalla",
  };
  const texto = (ruta: string) => {
    const f = TODOS.find((x) => x.ruta === ruta);
    assert.ok(f, `no existe ${ruta}`);
    return sinComentarios(f.texto);
  };

  it("cada pantalla de métricas carga el filtro", () => {
    const faltan = Object.keys(PANTALLAS).filter((r) => !/cargarFiltroSinPrueba\(/.test(texto(r)));
    assert.deepEqual(faltan, [], "Estas pantallas cuentan al paciente de prueba");
  });

  it("toda ruta de /api/analytics que cuenta pacientes, citas o dinero está en la lista", () => {
    const LEE = /prisma\.(appointment|appointmentTimeline|patientSatisfaction|invoice|payment|patient|noShowPrediction)\.|FROM\s+"?(appointments|invoices|patients|payments)"?/;
    const nuevas = TODOS.filter((f) => f.ruta.startsWith("src/app/api/analytics/") && LEE.test(sinComentarios(f.texto)))
      .map((f) => f.ruta)
      .filter((r) => !(r in PANTALLAS) && !(r in NO_METRICA));
    assert.deepEqual(nuevas, [], "Ruta de analítica nueva: aplica cargarFiltroSinPrueba y añádela a PANTALLAS");
  });

  it("el SQL crudo de Analítica también saca a los de prueba", () => {
    for (const r of [
      "src/app/api/analytics/cohorts/route.ts",
      "src/app/api/analytics/churn-risk/route.ts",
      "src/app/api/analytics/patients-value/route.ts",
      "src/app/api/analytics/resource-costs/route.ts",
    ]) {
      assert.match(texto(r), /NOT \(\w+\."(id|patientId)" = ANY\(\$\{\w+\.ids\}::text\[\]\)\)/, `${r} sin el filtro en el SQL`);
    }
    // Las que cachean por clínica llevan el filtro en la llave (marcar a alguien no espera 5 minutos).
    for (const r of ["src/app/api/analytics/cohorts/route.ts", "src/app/api/analytics/churn-risk/route.ts", "src/app/api/analytics/patients-value/route.ts", "src/app/api/analytics/waiting-room/route.ts"]) {
      assert.match(texto(r), /\.clave\b/, `${r}: la caché no cambia al marcar a un paciente`);
    }
  });

  it("los cargadores compartidos aplican el filtro que reciben", () => {
    const fin = texto("src/lib/finanzas-resumen.server.ts");
    assert.match(fin, /sinPrueba\.pago\(revenuePaymentWhere\(/);
    assert.match(fin, /sinPrueba\.pago\(refundPaymentWhere\(/);
    assert.equal((fin.match(/\.\.\.sinPrueba\.porPatientId/g) ?? []).length, 3, "ventas, citas y facturas por doctor");
    assert.match(fin, /filtro: sinPrueba\.porPatientId/, "por cobrar / vencido");
    const tablero = texto("src/lib/orthodontics/tablero-data.ts");
    assert.match(tablero, /cases\.filter\(\(c\) => sinPrueba\.cuenta\(c\.patientId\)\)/);
    assert.match(texto("src/lib/orthodontics/produccion-db.ts"), /\.\.\.sinPrueba\.porPatientId/);
    assert.match(texto("src/lib/orthodontics/valoraciones-tablero-db.ts"), /\.\.\.sinPrueba\.porPatientId/);
    // Quien llama a los cargadores les pasa el filtro (sin él, el valor por defecto no saca a nadie).
    assert.match(texto("src/app/api/finanzas/route.ts"), /calcularResumenFinanzas\(\{[^}]*sinPrueba/);
    assert.equal((texto("src/lib/sabina/tools/reportes.ts").match(/conSaldos(: false)?, sinPrueba \}/g) ?? []).length, 2);
    assert.match(texto("src/app/dashboard/orthodontics/tablero/page.tsx"), /loadOrthoTableroData\(.*, sinPrueba\)/);
    for (const r of ["src/app/api/analytics/doctor-performance/route.ts", "src/app/api/analytics/payroll-pdf/route.ts"]) {
      assert.match(texto(r), /ingresosDeCasosSinCitaPorDoctor\([\s\S]*?sinPrueba,\s*\)/, `${r}: lo de ortodoncia cuenta al de prueba`);
    }
  });
});

describe("Finanzas (pantalla y Sabina) con un doble de base", () => {
  type Llamada = { modelo: string; op: string; where: unknown };
  function dobleDeBase() {
    const llamadas: Llamada[] = [];
    const op = (modelo: string, nombre: string, resp: unknown) => async (args?: { where?: unknown }) => {
      llamadas.push({ modelo, op: nombre, where: args?.where });
      return resp;
    };
    const db = {
      payment: { aggregate: op("payment", "aggregate", { _sum: { amount: 0 } }), findMany: op("payment", "findMany", []) },
      invoice: { count: op("invoice", "count", 0), findMany: op("invoice", "findMany", []) },
      appointment: { count: op("appointment", "count", 0) },
      expense: { findMany: op("expense", "findMany", []) },
      user: { findMany: op("user", "findMany", []) },
      clinic: { findUnique: op("clinic", "findUnique", { timezone: "America/Mexico_City" }) },
    };
    return { db, llamadas };
  }
  /** ¿Este where saca al paciente `id` (en `patientId`, a cualquier profundidad)? */
  function saca(where: unknown, id: string): boolean {
    if (!where || typeof where !== "object") return false;
    const w = where as Record<string, unknown>;
    const pid = w.patientId as { notIn?: unknown } | undefined;
    if (pid && Array.isArray(pid.notIn) && pid.notIn.includes(id)) return true;
    return Object.values(w).some((v) => (Array.isArray(v) ? v.some((x) => saca(x, id)) : saca(v, id)));
  }
  const ventana = { clinicId: "cl-1", from: new Date("2026-09-01T06:00:00Z"), to: new Date("2026-10-01T05:59:59Z"), expenseTo: new Date("2026-10-01T05:59:59Z") };
  const DE_DINERO_O_CITAS = new Set(["payment", "invoice", "appointment"]);

  it("con el filtro, cada cobro, reembolso, venta, cita y saldo por cobrar saca al paciente de prueba", async () => {
    const { db, llamadas } = dobleDeBase();
    await calcularResumenFinanzas({ ...ventana, sinPrueba: filtroSinPrueba(["pr-1"]) }, db);
    const deDinero = llamadas.filter((l) => DE_DINERO_O_CITAS.has(l.modelo));
    assert.ok(deDinero.length >= 7, `se esperaban las 7 lecturas de dinero/citas, hubo ${deDinero.length}`);
    const sinFiltro = deDinero.filter((l) => !saca(l.where, "pr-1")).map((l) => `${l.modelo}.${l.op}`);
    assert.deepEqual(sinFiltro, [], "Estas lecturas de Finanzas cuentan al paciente de prueba");
  });

  it("sin pacientes de prueba las consultas no cambian (nadie queda fuera)", async () => {
    const { db, llamadas } = dobleDeBase();
    await calcularResumenFinanzas({ ...ventana, sinPrueba: filtroSinPrueba([]) }, db);
    assert.ok(llamadas.every((l) => !JSON.stringify(l.where ?? {}).includes("notIn\":[\"pr")));
    assert.ok(llamadas.every((l) => !JSON.stringify(l.where ?? {}).includes("patientId")), "ningún filtro por paciente de más");
  });
});
