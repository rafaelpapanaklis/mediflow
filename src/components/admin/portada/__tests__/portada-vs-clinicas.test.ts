/**
 * La portada (/admin) y Clínicas (/admin/clinics) tienen que dar el MISMO
 * estado de la MISMA clínica.
 *
 * Run: npm run test:portada-vs-clinicas
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 * Cuando se hizo la portada, `@/lib/admin/salud-clinica` todavía no estaba en
 * el remoto, así que `atencion-core` se escribió con su propia derivación. Dos
 * capas contestando «¿esta clínica qué es?» acaban discrepando siempre, y el
 * operador que compara las dos pantallas no sabe a cuál creer. El 21-sep-2026
 * la portada pasó a consumir `evaluarSaludClinica`; esta prueba es el candado
 * que impide que vuelva a haber una segunda opinión.
 *
 * Qué comprueba, y en ese orden:
 *  1. Para una misma clínica, la entrada que arma la portada y la que arma
 *     Clínicas producen el MISMO veredicto — estado operativo, nivel de
 *     actividad y severidad. Doce escenarios, incluidos los tres que motivaron
 *     `salud-clinica` (trial vencido en uso, cuenta de pruebas, cobro fallido).
 *  2. Que `atencion-core` no vuelva a derivar la salud por su cuenta: se lee su
 *     código fuente y se exige que no llame a `getPlanStatus`, `isPlanExpired`,
 *     `isInTrial` ni `daysUntil`.
 *
 * El punto 2 mira CÓDIGO, no prosa: los comentarios de ese archivo citan esos
 * nombres para explicar el cambio, así que se quitan antes de mirar.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  evaluarSaludClinica,
  type EntradaSaludClinica,
} from "@/lib/admin/salud-clinica";
import { aEntradaSalud, saludDeFila, type FilaPortada, type ActividadClinica } from "../atencion-core";

const AHORA = new Date("2026-09-21T18:00:00.000Z");
const DIA = 86_400_000;
const haceDias = (n: number) => new Date(AHORA.getTime() - n * DIA);
const enDias   = (n: number) => new Date(AHORA.getTime() + n * DIA);
const act = (citas: number, facturas: number, notas: number): ActividadClinica =>
  ({ citas, facturas, notas });

/**
 * Los datos crudos de UNA clínica, tal y como salen de la base. De aquí se
 * derivan las DOS entradas —la de la portada y la de Clínicas— para que la
 * comparación sea de verdad sobre la misma clínica y no sobre dos fixtures
 * parecidos.
 */
interface Cruda {
  nombre: string;
  createdAt: Date;
  trialEndsAt: Date | null;
  subscriptionStatus: string | null;
  nextBillingDate: Date | null;
  pacientes: number;
  /** `_count.appointments` de la clínica: todas, futuras incluidas. */
  citasTotales: number;
  /** Citas con `startsAt <= ahora`. */
  citasPasadas: number;
  /** `_max(startsAt)` de las pasadas. Es lo que las dos pantallas consultan. */
  ultimaCitaPasada: Date | null;
  actividad: ActividadClinica;
  actividadPrevia: ActividadClinica;
  ultimoAcceso: Date | null;
  enLinea: boolean;
  pagosRegistrados: number;
}

/** Cómo arma la fila /admin/page.tsx. */
function comoLaPortada(c: Cruda): FilaPortada {
  return {
    id: "c1",
    nombre: c.nombre,
    plan: "PRO",
    createdAt: c.createdAt,
    trialEndsAt: c.trialEndsAt,
    subscriptionStatus: c.subscriptionStatus,
    nextBillingDate: c.nextBillingDate,
    archivedAt: null,
    pacientes: c.pacientes,
    citasTotales: c.citasTotales,
    ultimaCita: c.ultimaCitaPasada,
    actividad: c.actividad,
    actividadPrevia: c.actividadPrevia,
    ultimoAcceso: c.ultimoAcceso,
    enLinea: c.enLinea,
    cobrosFallidos: 0,
    montoPorCobrar: 0,
    algunaVezPago: c.pagosRegistrados > 0,
  };
}

/** Cómo arma la entrada /admin/clinics (clinics-client.tsx, `saludPorId`). */
function comoClinicas(c: Cruda): EntradaSaludClinica {
  return {
    id: "c1",
    createdAt: c.createdAt,
    subscriptionStatus: c.subscriptionStatus,
    trialEndsAt: c.trialEndsAt,
    nextBillingDate: c.nextBillingDate,
    cancelRequested: false,
    pacientes: c.pacientes,
    citasPasadas: c.citasPasadas,
    citasVentana: c.actividad.citas,
    facturasVentana: c.actividad.facturas,
    notasVentana: c.actividad.notas,
    citasVentanaPrevia: c.actividadPrevia.citas,
    facturasVentanaPrevia: c.actividadPrevia.facturas,
    notasVentanaPrevia: c.actividadPrevia.notas,
    ultimaCitaAt: c.ultimaCitaPasada,
    ultimoAccesoAt: c.ultimoAcceso,
    enLinea: c.enLinea,
    pagosRegistrados: c.pagosRegistrados,
  };
}

const BASE: Cruda = {
  nombre: "Base",
  createdAt: haceDias(400),
  trialEndsAt: enDias(20),
  subscriptionStatus: "active",
  nextBillingDate: enDias(20),
  pacientes: 120,
  citasTotales: 900,
  citasPasadas: 890,
  ultimaCitaPasada: haceDias(1),
  actividad: act(40, 3, 5),
  actividadPrevia: act(38, 2, 4),
  ultimoAcceso: haceDias(1),
  enLinea: false,
  pagosRegistrados: 12,
};
const con = (over: Partial<Cruda>): Cruda => ({ ...BASE, ...over });

/** Los doce escenarios. Los tres primeros son los que motivaron salud-clinica. */
const CASOS: Cruda[] = [
  con({ nombre: "al corriente y trabajando" }),
  con({
    nombre: "Dientitos Felices — trial vencido y SIGUE agendando",
    subscriptionStatus: "trialing",
    trialEndsAt: haceDias(75),
    pagosRegistrados: 0,
  }),
  con({
    nombre: "cuenta de pruebas vacía",
    pacientes: 0, citasTotales: 0, citasPasadas: 0, ultimaCitaPasada: null,
    actividad: act(0, 0, 0), actividadPrevia: act(0, 0, 0),
    ultimoAcceso: null, pagosRegistrados: 0,
  }),
  con({ nombre: "cobro fallido", subscriptionStatus: "past_due" }),
  con({ nombre: "cobro fallido con el periodo ya terminado", subscriptionStatus: "past_due", trialEndsAt: haceDias(9) }),
  con({
    nombre: "Menta Dental — figura activa y lleva 58 días sin una cita",
    ultimaCitaPasada: haceDias(58), actividad: act(0, 0, 0), ultimoAcceso: haceDias(40),
  }),
  con({
    nombre: "enfriándose: 31 días sin cita",
    ultimaCitaPasada: haceDias(31), actividad: act(0, 0, 0),
  }),
  con({
    nombre: "vencida de verdad y usándola",
    subscriptionStatus: "cancelled", trialEndsAt: haceDias(40),
  }),
  con({
    nombre: "pago pendiente con periodo por delante",
    subscriptionStatus: "pending_payment", trialEndsAt: enDias(25),
    pagosRegistrados: 0, pacientes: 6,
  }),
  con({ nombre: "trial que vence pasado mañana", subscriptionStatus: null, trialEndsAt: enDias(2), pagosRegistrados: 0 }),
  con({
    nombre: "recién dada de alta, sin estrenar (dentro de la gracia)",
    createdAt: haceDias(3), pacientes: 3, citasTotales: 0, citasPasadas: 0,
    ultimaCitaPasada: null, actividad: act(0, 0, 0), actividadPrevia: act(0, 0, 0),
    subscriptionStatus: null, pagosRegistrados: 0,
  }),
  con({
    nombre: "de alta hace meses y nunca agendó",
    pacientes: 4, citasTotales: 0, citasPasadas: 0, ultimaCitaPasada: null,
    actividad: act(0, 0, 0), actividadPrevia: act(0, 0, 0),
  }),
];

// ── 1. El MISMO veredicto ──────────────────────────────────────────────────

for (const caso of CASOS) {
  test(`mismo estado en las dos pantallas — ${caso.nombre}`, () => {
    const dePortada  = saludDeFila(comoLaPortada(caso), AHORA);
    const deClinicas = evaluarSaludClinica(comoClinicas(caso), AHORA);

    assert.equal(dePortada.estadoOperativo, deClinicas.estadoOperativo, "estado operativo");
    assert.equal(dePortada.actividad.nivel, deClinicas.actividad.nivel, "nivel de actividad");
    assert.equal(dePortada.severidadMaxima, deClinicas.severidadMaxima, "severidad");
    assert.equal(dePortada.esPrueba, deClinicas.esPrueba, "cuenta de prueba");
    assert.equal(dePortada.plan.kind, deClinicas.plan.kind, "estado de plan (el del gate)");
    assert.deepEqual(
      dePortada.riesgos.map((r) => r.clave),
      deClinicas.riesgos.map((r) => r.clave),
      "los mismos riesgos y en el mismo orden",
    );
    assert.equal(dePortada.actividad.diasSinCita, deClinicas.actividad.diasSinCita, "días sin cita");
  });
}

test("el veredicto de la portada es el de salud-clinica, no una copia parecida", () => {
  // Si alguien reintrodujera una derivación propia, lo más probable es que
  // acertara el caso fácil y fallara el raro. Este es el raro: `trialing` con
  // el periodo terminado hace meses. El gate la deja entrar ("al corriente") y
  // comercialmente nunca ha pagado.
  const trialVencido = con({
    subscriptionStatus: "trialing", trialEndsAt: haceDias(75), pagosRegistrados: 0,
  });
  const s = saludDeFila(comoLaPortada(trialVencido), AHORA);
  assert.equal(s.plan.kind, "active", "para el gate entra al panel");
  assert.equal(s.estadoOperativo, "trial-vencido", "comercialmente no es un cliente al corriente");
  assert.equal(s.riesgos[0]?.clave, "trial-vencido-usando");
});

test("aEntradaSalud traduce el tercer estado de algunaVezPago del lado seguro", () => {
  // `null` = la agregación del histórico no pudo correr. Si se tradujera a 0
  // pagos, salud-clinica declararía cuenta de prueba a una clínica de verdad y
  // la portada la escondería detrás de un timeout.
  const vacia = comoLaPortada(con({
    pacientes: 0, citasTotales: 0, citasPasadas: 0, ultimaCitaPasada: null,
    actividad: act(0, 0, 0), actividadPrevia: act(0, 0, 0), ultimoAcceso: null,
    pagosRegistrados: 0,
  }));
  assert.equal(aEntradaSalud(vacia).pagosRegistrados, 0, "false = no pagó");
  assert.equal(saludDeFila(vacia, AHORA).esPrueba, true);

  const noSeSabe = { ...vacia, algunaVezPago: null };
  assert.equal(aEntradaSalud(noSeSabe).pagosRegistrados, 1, "null NO puede leerse como 'no pagó'");
  assert.equal(saludDeFila(noSeSabe, AHORA).esPrueba, false, "no se esconde una clínica por un timeout");
});

// ── 2. El candado: nada de una segunda derivación ──────────────────────────

const FUENTE = readFileSync(join(__dirname, "..", "atencion-core.ts"), "utf8");
/** Sin comentarios: este archivo explica el cambio citando los nombres. */
const CODIGO = FUENTE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

test("atencion-core consume salud-clinica", () => {
  assert.match(CODIGO, /from "@\/lib\/admin\/salud-clinica"/);
  assert.match(CODIGO, /evaluarSaludClinica\(/, "tiene que llamarlo, no sólo importarlo");
});

test("atencion-core ya no deriva el estado del plan por su cuenta", () => {
  for (const prohibida of ["getPlanStatus", "isPlanExpired", "isInTrial", "daysUntil"]) {
    assert.equal(
      new RegExp(`\\b${prohibida}\\s*\\(`).test(CODIGO),
      false,
      `${prohibida} vuelve a derivar el estado aquí: eso es salud-clinica`,
    );
  }
});

test("los umbrales compartidos se re-exportan de salud-clinica, no se copian", () => {
  // Un `= 30` escrito a mano aquí se desincroniza el día que alguien mueva el
  // umbral allí, y los rótulos («sin citas desde hace 60 días») empiezan a
  // mentir sin que nada falle.
  assert.match(CODIGO, /DIAS_ACTIVIDAD = DIAS_VENTANA_ACTIVIDAD/);
  assert.match(CODIGO, /DIAS_APAGADA = DIAS_ENFRIANDOSE/);
  assert.match(CODIGO, /DIAS_APAGADA_GRAVE = DIAS_APAGADA_SALUD/);
  assert.match(CODIGO, /MINUTOS_EN_LINEA = MINUTOS_EN_LINEA_SALUD/);
});

test("la portada pide la última cita PASADA, igual que Clínicas", () => {
  // Con la más reciente futura incluida, las dos pantallas alimentaban el mismo
  // cálculo con entradas distintas y daban estados distintos.
  const PORTADA = readFileSync(join(__dirname, "..", "..", "..", "..", "app", "admin", "page.tsx"), "utf8");
  assert.match(PORTADA, /where: \{ startsAt: \{ lte: now \} \}, _max: \{ startsAt: true \}/);
});
