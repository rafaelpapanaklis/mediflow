/**
 * Pruebas de la cartera de un cliente. Sin base de datos y sin React.
 *
 *   npm run test:cartera-clientes
 *
 * Las tres primeras son los casos que motivaron el rediseño de la lista:
 * un cliente con dos clínicas y una apagada, un cliente que en realidad son
 * cuentas de prueba, y el MRR de un cliente con precio negociado.
 *
 * Los PRECIOS de los planes se inyectan (vienen de plan_configs en la app), y
 * a propósito NO son los de producción: si alguien los cambia desde
 * /admin/settings, estas pruebas siguen valiendo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  valorarCliente,
  valorarClientes,
  resumirClientes,
  ordenarPorAtencionCliente,
  estadoDeCartera,
  repartirIngresos,
  ETIQUETA_ESTADO_CLIENTE,
  type ClienteCrudo,
  type ClinicaDeCliente,
} from "./cartera";
import { DIAS_APAGADA } from "@/lib/admin/salud-clinica";

/** El "hoy" de todas las pruebas. */
const AHORA = new Date("2026-09-20T12:00:00.000Z");
const DIA = 86_400_000;

/** Precios de lista inyectados, como los daría plan_configs. */
const PRECIOS = { BASIC: 100, PRO: 200, CLINIC: 300 };

function haceDias(dias: number): string {
  return new Date(AHORA.getTime() - dias * DIA).toISOString();
}
function enDias(dias: number): string {
  return new Date(AHORA.getTime() + dias * DIA).toISOString();
}

/** Clínica sana, pagando y con trabajo reciente. Cada caso pisa lo suyo. */
function clinica(over: Partial<ClinicaDeCliente> = {}): ClinicaDeCliente {
  const base: ClinicaDeCliente = {
    id: "c1",
    nombre: "Clínica Uno",
    slug: "clinica-uno",
    plan: "PRO",
    monthlyPrice: null,
    subscriptionStatus: "active",
    trialEndsAt: enDias(20),
    nextBillingDate: enDias(20),
    cancelRequested: false,
    createdAt: haceDias(400),
    archivada: false,
    cupo: { used: 120, max: 500, remaining: 380, unlimited: false, canCreate: true },
    citasPasadas: 900,
    citasVentana: 60,
    citasVentanaPrevia: 55,
    citasFuturas: 20,
    facturasVentana: 30,
    facturasVentanaPrevia: 28,
    notasVentana: 40,
    notasVentanaPrevia: 38,
    ultimaCitaAt: haceDias(1),
    proximaCitaAt: enDias(2),
    ultimoAccesoAt: haceDias(0),
    enLinea: false,
    pagosRegistrados: 12,
    ultimoPagoAt: haceDias(10),
    totalPagado: 2400,
    aiTokensUsed: 1000,
    aiTokensLimit: 50000,
  };
  return { ...base, ...over };
}

/** Una clínica APAGADA: paga, pero lleva más de 60 días sin una cita. */
function apagada(over: Partial<ClinicaDeCliente> = {}): ClinicaDeCliente {
  return clinica({
    id: "c2",
    nombre: "Sede Norte",
    slug: "sede-norte",
    citasVentana: 0,
    citasVentanaPrevia: 0,
    citasFuturas: 0,
    facturasVentana: 0,
    notasVentana: 0,
    ultimaCitaAt: haceDias(DIAS_APAGADA + 30),
    proximaCitaAt: null,
    ...over,
  });
}

/** Cuenta de prueba: sin pacientes, sin citas y sin un solo pago. */
function prueba(over: Partial<ClinicaDeCliente> = {}): ClinicaDeCliente {
  return clinica({
    id: "cp",
    nombre: "Prueba Demo",
    slug: "prueba-demo",
    subscriptionStatus: null,
    trialEndsAt: haceDias(200),
    nextBillingDate: null,
    createdAt: haceDias(210),
    cupo: { used: 0, max: 500, remaining: 500, unlimited: false, canCreate: true },
    citasPasadas: 0,
    citasVentana: 0,
    citasVentanaPrevia: 0,
    citasFuturas: 0,
    facturasVentana: 0,
    notasVentana: 0,
    ultimaCitaAt: null,
    proximaCitaAt: null,
    ultimoAccesoAt: null,
    pagosRegistrados: 0,
    ultimoPagoAt: null,
    totalPagado: 0,
    ...over,
  });
}

function cliente(clinicas: ClinicaDeCliente[], over: Partial<ClienteCrudo> = {}): ClienteCrudo {
  return {
    supabaseId: "sup-1",
    nombre: "Dra. Ana López",
    email: "ana@ejemplo.mx",
    telefono: "9991234567",
    afiliado: null,
    altaAt: haceDias(400),
    clinicas,
    ...over,
  };
}

// ── 1. Dos clínicas, una apagada: la fila TIENE que decirlo ────────────────

test("un cliente con dos clínicas y una apagada lo dice en su fila", () => {
  const fila = valorarCliente(cliente([clinica(), apagada()]), PRECIOS, AHORA);

  // El agregado ya no esconde a la sede muerta.
  assert.equal(fila.vigentes.length, 2);
  assert.equal(fila.resumen.porActividad.activa, 1);
  assert.equal(fila.resumen.porActividad.apagada, 1);

  // Y sube a la bandeja con el nombre de LA clínica, no del cliente.
  assert.equal(fila.riesgos.length, 1);
  assert.equal(fila.riesgos[0].clinicaNombre, "Sede Norte");
  assert.equal(fila.riesgos[0].riesgo.clave, "apagada");
  assert.equal(fila.severidadMaxima, "alto");
  assert.ok(fila.prioridad > 0, "un cliente con una sede apagada no puede tener prioridad 0");

  // El detalle trae el número que lo sostiene, no una frase genérica.
  assert.match(fila.riesgos[0].riesgo.detalle, /Sin citas desde hace \d+ días/);

  // Las dos pagan, así que la cartera sigue siendo "pagando": lo que cambia
  // es que ahora hay un riesgo visible, no el estado de cobro.
  assert.equal(fila.estado, "pagando");
  assert.equal(ETIQUETA_ESTADO_CLIENTE[fila.estado], "Pagando");

  // La clínica que arde va primero en la ficha.
  assert.equal(fila.clinicas[0].clinica.nombre, "Sede Norte");
});

test("una clínica con el trial vencido y usando manda sobre las demás", () => {
  const vencida = clinica({
    id: "c3",
    nombre: "Sede Centro",
    // "trialing" es un status con ACCESO para el gate: la clínica entra al
    // panel aunque su periodo terminara hace meses y no haya pagado nunca.
    subscriptionStatus: "trialing",
    trialEndsAt: haceDias(75),
    nextBillingDate: null,
    pagosRegistrados: 0,
    ultimoPagoAt: null,
    totalPagado: 0,
  });
  const fila = valorarCliente(cliente([clinica(), vencida]), PRECIOS, AHORA);

  assert.equal(fila.riesgos[0].riesgo.clave, "trial-vencido-usando");
  assert.equal(fila.riesgos[0].riesgo.severidad, "critico");
  assert.equal(fila.riesgos[0].clinicaNombre, "Sede Centro");
  assert.equal(fila.resumen.porEstado["trial-vencido"], 1);

  // Paga por una y por la otra no: el estado que la lista vieja no tenía.
  assert.equal(fila.estado, "mixto");
  assert.equal(ETIQUETA_ESTADO_CLIENTE[fila.estado], "Paga en parte");

  // Y solo cobra por la que paga.
  assert.equal(fila.mrr.total, PRECIOS.PRO);
});

// ── 2. Todo pruebas: no es un cliente ──────────────────────────────────────

test("un cliente cuyas clínicas son todas de prueba no cuenta como cliente real", () => {
  const fila = valorarCliente(
    cliente([prueba(), prueba({ id: "cp2", nombre: "Prueba Dos", slug: "prueba-dos" })]),
    PRECIOS,
    AHORA,
  );

  assert.equal(fila.esReal, false);
  assert.equal(fila.estado, "prueba");
  assert.equal(fila.resumen.reales, 0);
  assert.equal(fila.resumen.pruebas, 2);
  // Una prueba no genera riesgos: si lo hiciera llenaría la bandeja y taparía
  // lo real.
  assert.deepEqual(fila.riesgos, []);
  assert.equal(fila.prioridad, 0);
  assert.equal(fila.mrr.total, 0);

  // Y no entra en los totales de la pantalla.
  const resumen = resumirClientes([fila]);
  assert.equal(resumen.total, 1);
  assert.equal(resumen.reales, 0);
  assert.equal(resumen.pruebas, 1);
  assert.equal(resumen.clinicas, 0);
});

test("basta UNA clínica real para que el cliente cuente", () => {
  const fila = valorarCliente(cliente([prueba(), clinica()]), PRECIOS, AHORA);
  assert.equal(fila.esReal, true);
  assert.equal(fila.resumen.reales, 1);
  assert.equal(fila.resumen.pruebas, 1);
  // Su estado lo decide la clínica real; la de prueba no vota.
  assert.equal(fila.estado, "pagando");
});

// ── 3. El dinero ───────────────────────────────────────────────────────────

test("el MRR del cliente es la suma del de sus clínicas, con precios negociados", () => {
  const lista = clinica({ id: "a", nombre: "A", monthlyPrice: null });          // precio de lista
  const negociada = clinica({ id: "b", nombre: "B", monthlyPrice: 1234 });      // precio negociado
  const enTrial = clinica({                                                     // no paga: $0
    id: "c", nombre: "C", subscriptionStatus: null, trialEndsAt: enDias(10),
  });
  const fila = valorarCliente(cliente([lista, negociada, enTrial]), PRECIOS, AHORA);

  // Suma exacta: precio de lista del plan + el negociado. El trial no aporta.
  assert.equal(fila.mrr.total, PRECIOS.PRO + 1234);
  // Y es EXACTAMENTE la suma de lo que aporta cada clínica.
  assert.equal(
    fila.mrr.total,
    fila.vigentes.reduce((s, v) => s + v.mrr, 0),
  );
  assert.equal(fila.vigentes.find((v) => v.clinica.id === "b")!.mrr, 1234);
  assert.equal(fila.vigentes.find((v) => v.clinica.id === "c")!.mrr, 0);

  // El desglose sirve para auditar el total.
  const linea = fila.mrr.byPlan.find((l) => l.plan === "PRO")!;
  assert.equal(linea.clinics, 2, "solo las active entran al desglose");
  assert.equal(linea.negotiated, 1);
  assert.equal(linea.listPrice, PRECIOS.PRO);

  // Paga por unas y por otras no.
  assert.equal(fila.estado, "mixto");
});

test("un precio negociado de 0 no borra el precio de lista", () => {
  const fila = valorarCliente(cliente([clinica({ monthlyPrice: 0 })]), PRECIOS, AHORA);
  assert.equal(fila.mrr.total, PRECIOS.PRO);
});

test("una clínica archivada no suma MRR ni genera riesgos", () => {
  const fila = valorarCliente(
    cliente([clinica(), apagada({ archivada: true })]),
    PRECIOS,
    AHORA,
  );
  assert.equal(fila.vigentes.length, 1);
  assert.equal(fila.archivadas.length, 1);
  assert.equal(fila.mrr.total, PRECIOS.PRO);
  assert.deepEqual(fila.riesgos, []);
  // Pero sigue estando: no desaparece de la ficha sin explicación.
  assert.equal(fila.clinicas.length, 2);
  assert.equal(fila.clinicas[1].clinica.archivada, true);
});

// ── 4. Estado de la cartera ────────────────────────────────────────────────

test("estadoDeCartera distingue los cinco casos", () => {
  const evaluar = (clinicas: ClinicaDeCliente[]) =>
    valorarCliente(cliente(clinicas), PRECIOS, AHORA).estado;

  assert.equal(evaluar([clinica(), clinica({ id: "x" })]), "pagando");
  assert.equal(evaluar([clinica(), clinica({ id: "x", subscriptionStatus: null, trialEndsAt: enDias(5) })]), "mixto");
  assert.equal(evaluar([clinica({ subscriptionStatus: null, trialEndsAt: enDias(5) })]), "en-trial");
  // Periodo terminado y sin suscripción viva: el gate la bloquea y no entra
  // dinero por ninguna parte.
  assert.equal(evaluar([clinica({ subscriptionStatus: null, trialEndsAt: haceDias(30) })]), "sin-cobro");
  assert.equal(evaluar([prueba()]), "prueba");
});

test("un cobro fallido no cuenta como pagando", () => {
  const fila = valorarCliente(cliente([clinica({ subscriptionStatus: "past_due" })]), PRECIOS, AHORA);
  assert.equal(fila.estado, "sin-cobro");
  assert.equal(fila.riesgos[0].riesgo.clave, "cobro-fallido");
  // past_due no aporta MRR: la fuente única solo cuenta "active".
  assert.equal(fila.mrr.total, 0);
});

test("un cliente sin clínicas vigentes no revienta", () => {
  assert.equal(estadoDeCartera([]), "prueba");
  const fila = valorarCliente(cliente([clinica({ archivada: true })]), PRECIOS, AHORA);
  assert.equal(fila.esReal, false);
  assert.equal(fila.mrr.total, 0);
  assert.equal(fila.cupo.used, 0);
});

// ── 5. A quién se llama primero ────────────────────────────────────────────

test("manda la peor clínica del cliente, y las demás pesan un décimo", () => {
  const critico = cliente([
    clinica({ id: "k", subscriptionStatus: "trialing", trialEndsAt: haceDias(60), pagosRegistrados: 0 }),
  ], { supabaseId: "critico", nombre: "Crítico" });
  const dosAltos = cliente([apagada({ id: "a1" }), apagada({ id: "a2", nombre: "Sede Sur" })], {
    supabaseId: "dos-altos", nombre: "Dos altos",
  });
  const sano = cliente([clinica()], { supabaseId: "sano", nombre: "Sano" });

  const filas = valorarClientes([sano, dosAltos, critico], PRECIOS, AHORA);
  const orden = ordenarPorAtencionCliente(filas).map((f) => f.supabaseId);

  assert.deepEqual(orden, ["critico", "dos-altos"], "el sano no entra a la bandeja");

  const dos = filas.find((f) => f.supabaseId === "dos-altos")!;
  const uno = filas.find((f) => f.supabaseId === "critico")!;
  assert.ok(dos.riesgos.length === 2);
  assert.ok(uno.prioridad > dos.prioridad, "un crítico pesa más que dos altos");
});

test("los totales de la pantalla cuentan clientes, no clínicas", () => {
  const filas = valorarClientes(
    [
      cliente([clinica(), apagada()], { supabaseId: "s1" }),
      cliente([clinica({ id: "z" })], { supabaseId: "s2" }),
      cliente([prueba()], { supabaseId: "s3" }),
    ],
    PRECIOS,
    AHORA,
  );
  const r = resumirClientes(filas);

  assert.equal(r.total, 3);
  assert.equal(r.reales, 2);
  assert.equal(r.pruebas, 1);
  assert.equal(r.multiClinica, 1);
  assert.equal(r.conApagada, 1);
  assert.equal(r.enAtencion, 1);
  assert.equal(r.clinicas, 3);
  // Tres clínicas activas a precio de lista PRO.
  assert.equal(r.mrrTotal, PRECIOS.PRO * 3);
});

// ── 6. Cupo de pacientes ───────────────────────────────────────────────────

test("el cupo del cliente suma sus sedes y respeta el ilimitado", () => {
  const conTope = valorarCliente(cliente([clinica(), clinica({ id: "x" })]), PRECIOS, AHORA);
  assert.equal(conTope.cupo.used, 240);
  assert.equal(conTope.cupo.max, 1000);

  const ilimitada = valorarCliente(
    cliente([
      clinica(),
      clinica({ id: "x", cupo: { used: 10, max: null, remaining: null, unlimited: true, canCreate: true } }),
    ]),
    PRECIOS,
    AHORA,
  );
  assert.equal(ilimitada.cupo.used, 130);
  assert.equal(ilimitada.cupo.max, null, "con una sede sin tope no hay tope que enseñar");
});

// ── 7. Cuánto trabaja el cliente ───────────────────────────────────────────

test("la tendencia del cliente suma el trabajo de todas sus sedes", () => {
  const fila = valorarCliente(cliente([clinica(), clinica({ id: "x" })]), PRECIOS, AHORA);
  // 60 citas + 30 facturas + 40 notas, por dos sedes.
  assert.equal(fila.tendencia.actual.total, 260);
  assert.equal(fila.tendencia.previo.total, 242);
  assert.equal(fila.tendencia.direccion, "sube");
  assert.equal(fila.tendencia.deltaPct, 7);
});

test("de cero a algo no es un porcentaje", () => {
  const nueva = clinica({
    citasVentanaPrevia: 0, facturasVentanaPrevia: 0, notasVentanaPrevia: 0,
  });
  const fila = valorarCliente(cliente([nueva]), PRECIOS, AHORA);
  assert.equal(fila.tendencia.direccion, "sube");
  assert.equal(fila.tendencia.deltaPct, null, "un +100% inventado sería mentira");
});

// ── 8. Archivada no es lo mismo que prueba ─────────────────────────────────

test("un cliente que archivó su única clínica NO es una cuenta de prueba", () => {
  // Pagó catorce meses y cerró: no tiene sedes vigentes, pero su historia no
  // se parece en nada a la de una cuenta que nunca estrenó.
  const fila = valorarCliente(
    cliente([clinica({ archivada: true, pagosRegistrados: 14, totalPagado: 24_066 })]),
    PRECIOS,
    AHORA,
  );
  assert.equal(fila.sinSedesVigentes, true);
  assert.equal(fila.vigentes.length, 0);
  assert.equal(fila.archivadas.length, 1);

  // Una cuenta de prueba de verdad sí tiene su sede vigente.
  const demo = valorarCliente(cliente([prueba()]), PRECIOS, AHORA);
  assert.equal(demo.sinSedesVigentes, false);
  assert.equal(demo.esReal, false);
  assert.equal(demo.estado, "prueba");
});

// ── 9. Los cortes de dinero, en el calendario de Mérida ────────────────────

test("un cobro de las 19:00 de Mérida cuenta HOY, no mañana", () => {
  // El fallo que reportó Rafael: el servidor (UTC) ya estaba en el día
  // siguiente mientras en Yucatán todavía eran las siete de la tarde.
  const ahora = new Date("2026-09-21T01:52:00.000Z");   // 20-sep 19:52 en Mérida
  const cobro = new Date("2026-09-21T01:00:00.000Z");   // 20-sep 19:00 en Mérida

  const r = repartirIngresos([{ monto: 1719, cuando: cobro }], ahora);
  assert.equal(r.hoy, 1719, "con el día del servidor esto caía en el 21 y hoy salía en 0");
  assert.equal(r.mes, 1719);
  assert.equal(r.anio, 1719);
  assert.equal(r.historico, 1719);
  assert.equal(r.cobros, 1);
});

test("un cobro de ayer no se cuenta en hoy, pero sí en el mes", () => {
  const ahora = new Date("2026-09-21T01:52:00.000Z");   // 20-sep 19:52 en Mérida
  const ayer  = new Date("2026-09-20T05:30:00.000Z");   // 19-sep 23:30 en Mérida
  const r = repartirIngresos([{ monto: 500, cuando: ayer }], ahora);
  assert.equal(r.hoy, 0);
  assert.equal(r.mes, 500);
});

test("el último día del mes a las 19:00 de Mérida sigue siendo de ESE mes", () => {
  const ahora = new Date("2026-10-01T15:00:00.000Z");   // 1-oct 09:00 en Mérida
  const cobro = new Date("2026-10-01T01:00:00.000Z");   // 30-sep 19:00 en Mérida
  const r = repartirIngresos([{ monto: 900, cuando: cobro }], ahora);
  assert.equal(r.mes, 0, "es de septiembre, no de octubre");
  assert.equal(r.anio, 900);
  // Y en la serie cae en el mes anterior al último.
  assert.equal(r.serie[r.serie.length - 2].value, 900);
  assert.equal(r.serie[r.serie.length - 1].value, 0);
});

test("la serie trae 12 meses y el último es el de hoy", () => {
  const ahora = new Date("2026-09-21T01:52:00.000Z");
  const r = repartirIngresos([], ahora);
  assert.equal(r.serie.length, 12);
  assert.equal(r.cobros, 0);
  assert.equal(r.historico, 0);
  // Septiembre de 2026 es el último cubo.
  assert.match(r.serie[r.serie.length - 1].label, /sep/i);
  assert.match(r.serie[0].label, /oct/i, "doce meses atrás es octubre");
});

test("un cobro sin fecha suma al histórico y no inventa un día", () => {
  const ahora = new Date("2026-09-21T01:52:00.000Z");
  const r = repartirIngresos([{ monto: 300, cuando: null }], ahora);
  assert.equal(r.historico, 300);
  assert.equal(r.hoy, 0);
  assert.equal(r.mes, 0);
  assert.equal(r.anio, 0);
});
