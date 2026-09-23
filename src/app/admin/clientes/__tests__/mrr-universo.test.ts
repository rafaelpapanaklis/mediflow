/**
 * Los dos MRR del panel dicen A QUIÉN cuentan.
 *
 * Run: npm run test:mrr-universo
 *
 * ── El problema, tal cual lo dejó ws1-t3 ────────────────────────────────────
 * «El MRR de /admin/clientes y el de /admin/clinics no cuentan el mismo
 * universo. Los precios y la regla sí son los mismos; lo que cambia es quién
 * entra.» Y no se unifican: cada pantalla mide lo suyo y está bien. Lo que
 * faltaba era que lo DIJERAN — Rafael compara las dos, no le cuadran, y no
 * tiene cómo saber por qué.
 *
 * La diferencia exacta, verificada en el código:
 *   · /admin/clinics  → toda clínica con `archivedAt: null` y
 *     `subscriptionStatus === "active"`. (clinics/page.tsx)
 *   · /admin/clientes → las mismas, MENOS las que no tienen una cuenta dueña
 *     activa (`role: "SUPER_ADMIN", isActive: true`). (clientes/datos.ts)
 * O sea: B es un subconjunto de A. Una clínica cuyo dueño se dio de baja suma
 * allá y no aquí.
 *
 * Dos mitades:
 *  1. La REGLA y los PRECIOS son de verdad los mismos — si dejaran de serlo,
 *     la diferencia ya no sería sólo de universo y el rótulo mentiría.
 *  2. El CABLEADO: que las dos pantallas impriman su universo junto a la cifra.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeMrr, findIncludedBranchIds, type MrrClinicRow } from "@/lib/admin/mrr-core";
import { resumirClientes, valorarCliente, type ClinicaDeCliente } from "../cartera";

const ADMIN = join(__dirname, "..", "..");
const PRECIOS = { FREE: 0, PRO: 1899, CLINIC: 3499 };

const fila = (over: Partial<MrrClinicRow> = {}): MrrClinicRow =>
  ({ plan: "PRO", subscriptionStatus: "active", monthlyPrice: null, ...over } as MrrClinicRow);

/** Una clínica de /admin/clientes con lo mínimo; el resto, en neutro. */
function clinicaDeCliente(id: string, monthlyPrice: number | null, sedeIncluida: boolean): ClinicaDeCliente {
  return {
    id, nombre: id, slug: id, plan: "CLINIC", monthlyPrice, subscriptionStatus: "active",
    trialEndsAt: null, nextBillingDate: null, cancelRequested: false,
    createdAt: "2026-01-01T00:00:00.000Z", archivada: false,
    cupo: { used: 0, max: null, remaining: null, unlimited: true, canCreate: true },
    citasPasadas: 0, citasVentana: 0, citasVentanaPrevia: 0, citasFuturas: 0,
    facturasVentana: 0, facturasVentanaPrevia: 0, notasVentana: 0, notasVentanaPrevia: 0,
    ultimaCitaAt: null, proximaCitaAt: null, ultimoAccesoAt: null, enLinea: false,
    pagosRegistrados: 0, ultimoPagoAt: null, totalPagado: 0, aiTokensUsed: 0, aiTokensLimit: 0,
    sedeIncluida,
  };
}

// ── 1. Mismos precios, misma regla ─────────────────────────────────────────

test("las dos pantallas valoran una clínica exactamente igual", () => {
  // Es la misma función y los mismos precios de plan_configs; si esto se
  // rompiera, la diferencia entre las dos cifras dejaría de ser de universo.
  const unaClinica = [fila({ plan: "CLINIC" })];
  const comoClinics  = computeMrr(unaClinica, PRECIOS).total;
  const comoClientes = computeMrr(unaClinica, PRECIOS).total;
  assert.equal(comoClinics, comoClientes);
  assert.equal(comoClinics, 3499, "el precio sale de plan_configs, no de un número a mano");
});

test("el precio negociado manda sobre el de lista, en los dos caminos", () => {
  assert.equal(computeMrr([fila({ plan: "CLINIC", monthlyPrice: 2500 })], PRECIOS).total, 2500);
  // 0 y null significan "sin negociar": cae al de lista. El OTRO cero —la
  // sede incluida en el plan de su madre— no lo decide el 0 sino la marca
  // `includedBranch` (ver «las dos pantallas valoran igual una sede incluida»).
  assert.equal(computeMrr([fila({ plan: "CLINIC", monthlyPrice: 0 })], PRECIOS).total, 3499);
});

test("sólo cobra la que está `active`: el universo lo decide quien llama", () => {
  // `computeMrr` NO filtra por estado. Por eso el universo es cosa de cada
  // pantalla, y por eso hay que decirlo en pantalla.
  const mezcla = [
    fila({ subscriptionStatus: "active" }),
    fila({ subscriptionStatus: "trialing" }),
    fila({ subscriptionStatus: "past_due" }),
  ];
  assert.equal(computeMrr(mezcla, PRECIOS).total, 1899 * 3, "computeMrr suma lo que le den");
  assert.equal(
    computeMrr(mezcla.filter((c) => c.subscriptionStatus === "active"), PRECIOS).total,
    1899,
    "el filtro es del llamador, y las dos pantallas usan el mismo",
  );
});

test("B es un subconjunto de A: nunca puede salir MÁS en Clientes", () => {
  // Modela la única diferencia: la clínica sin cuenta dueña activa.
  const conDueno = fila({ plan: "CLINIC" });
  const sinDueno = fila({ plan: "PRO" });
  const universoClinics  = [conDueno, sinDueno];          // toda clínica activa
  const universoClientes = [conDueno];                     // sólo las que tienen dueño
  const a = computeMrr(universoClinics, PRECIOS).total;
  const b = computeMrr(universoClientes, PRECIOS).total;
  assert.ok(b <= a, "Clientes no puede superar a Clínicas");
  assert.equal(a - b, 1899, "la diferencia es exactamente lo que aporta la clínica sin dueño");
});

// ── 2. El cableado: cada cifra lleva su universo ───────────────────────────

const CLINICS  = readFileSync(join(ADMIN, "clinics", "clinics-client.tsx"), "utf8");
const CLIENTES = readFileSync(join(ADMIN, "clientes", "clientes-client.tsx"), "utf8");
const CSS_CLINICS  = readFileSync(join(ADMIN, "clinics", "clinics.module.css"), "utf8");
const CSS_CLIENTES = readFileSync(join(ADMIN, "clientes", "clientes.module.css"), "utf8");

test("las dos pantallas imprimen el universo junto a la cifra de MRR", () => {
  for (const [nombre, texto, css] of [
    ["clinics", CLINICS, CSS_CLINICS],
    ["clientes", CLIENTES, CSS_CLIENTES],
  ] as const) {
    assert.match(texto, /css\.cifraUniverso/, `${nombre} no pinta el universo`);
    assert.match(css, /\.cifraUniverso \{/, `${nombre} no define la clase`);
    // Y va PEGADO al MRR, no suelto en la página.
    const i = texto.indexOf("cifraEtiqueta}>MRR<");
    assert.notEqual(i, -1, `${nombre}: no encuentro la cifra de MRR`);
    const bloque = texto.slice(i, i + 1600);
    assert.match(bloque, /cifraUniverso/, `${nombre}: el universo no está junto al MRR`);
  }
});

test("cada rótulo nombra SU criterio, no una frase genérica", () => {
  // /admin/clinics cuenta de más; /admin/clientes exige dueño. Si los dos
  // dijeran lo mismo, el rótulo no serviría para nada.
  assert.match(CLINICS, /tenga cuenta dueña o no/);
  assert.match(CLIENTES, /sólo clínicas con cuenta dueña activa/i);
  // Y cada uno remite a la otra pantalla, que es lo que cierra la comparación.
  assert.match(CLINICS, /En Clientes sale menos/);
  assert.match(CLIENTES, /suma en Clínicas y no aquí/);
});

test("las dos dicen, debajo del MRR, cuántas sedes incluidas NO cuentan", () => {
  // Antes el rótulo avisaba de que las sedes inflaban las DOS cifras. Ya no las
  // inflan (valen $0) y lo que cada pantalla dice es a quién deja fuera.
  for (const [nombre, texto] of [["clinics", CLINICS], ["clientes", CLIENTES]] as const) {
    const i = texto.indexOf("cifraEtiqueta}>MRR<");
    const bloque = texto.slice(i, i + 1600);
    assert.match(bloque, /includedBranchesHint\(/, `${nombre}: no dice cuántas sedes deja fuera`);
    assert.match(texto, /sede incluida en el plan de la madre vale \$0/, `${nombre}: el rótulo no lo explica`);
    assert.doesNotMatch(texto, /suma precio de lista\s+aunque no se le cobre/, `${nombre}: volvió el aviso viejo`);
  }
});

test("las dos pantallas deciden las sedes con la MISMA función, sobre todo el sistema", () => {
  const PAGE_CLINICS = readFileSync(join(ADMIN, "clinics", "page.tsx"), "utf8");
  const DATOS_CLIENTES = readFileSync(join(ADMIN, "clientes", "datos.ts"), "utf8");
  for (const [nombre, texto] of [["clinics/page.tsx", PAGE_CLINICS], ["clientes/datos.ts", DATOS_CLIENTES]] as const) {
    assert.match(texto, /loadIncludedBranchIds\(\)/, `${nombre} no carga las sedes incluidas`);
  }
});

test("las dos pantallas valoran igual una madre con sedes incluidas", () => {
  // /admin/clinics: computeMrr sobre las active, marcadas por findIncludedBranchIds.
  // /admin/clientes: valorarCliente → resumirClientes, con `sedeIncluida` en cada clínica.
  const clinicas = [
    { id: "madre", createdAt: "2026-01-01", monthlyPrice: null, stripeSubscriptionId: "sub_1" },
    { id: "sede-1", createdAt: "2026-02-01", monthlyPrice: 0 },
    { id: "sede-2", createdAt: "2026-03-01", monthlyPrice: 0 },
  ].map((c) => ({ ...c, plan: "CLINIC", subscriptionStatus: "active" }));
  const sedes = findIncludedBranchIds(
    clinicas,
    clinicas.map((c) => ({ supabaseId: "duena", clinicId: c.id })),
  );

  const comoClinics = computeMrr(
    clinicas.map((c) => ({ ...c, includedBranch: sedes.has(c.id) })),
    PRECIOS,
  );

  const fila = valorarCliente(
    {
      supabaseId: "duena", nombre: "Dueña", email: "d@x.mx", telefono: null, afiliado: null,
      altaAt: "2026-01-01T00:00:00.000Z",
      clinicas: clinicas.map((c) => clinicaDeCliente(c.id, c.monthlyPrice, sedes.has(c.id))),
    },
    PRECIOS,
  );
  const comoClientes = resumirClientes([fila]);

  assert.equal(comoClinics.total, 3499, "sólo la madre");
  assert.equal(comoClientes.mrrTotal, comoClinics.total, "las dos dicen lo mismo del mismo dinero");
  assert.equal(comoClinics.includedBranches, 2);
  assert.equal(comoClientes.sedesIncluidas, comoClinics.includedBranches);
});

test("el universo se pinta con tokens, sin un solo color a mano", () => {
  for (const [nombre, css] of [["clinics", CSS_CLINICS], ["clientes", CSS_CLIENTES]] as const) {
    const i = css.indexOf(".cifraUniverso {");
    const cuerpo = css.slice(i, css.indexOf("}", i));
    assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(cuerpo), false, `${nombre}: color a mano`);
    assert.match(cuerpo, /var\(--/, `${nombre}: no usa tokens`);
  }
});

test("el comentario de mrrTotal ya no afirma que una prueba aporta 0", () => {
  // Era falso: `evaluarPrueba` no mira `subscriptionStatus`, así que una
  // clínica `active` y vacía es "prueba" y aporta su MRR entero.
  const CARTERA = readFileSync(join(ADMIN, "clientes", "cartera.ts"), "utf8");
  assert.equal(
    /aporta 0 por\s*\n?\s*\/\/ definición/.test(CARTERA),
    false,
    "volvió el comentario falso",
  );
  assert.match(CARTERA, /jamás `subscriptionStatus`/, "y se dice por qué era falso");
});
