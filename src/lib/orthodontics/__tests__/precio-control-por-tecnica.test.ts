/**
 * ws1-t12 (ticket 3 de BEVADENT, 6b) — pago inicial y precio por control POR TÉCNICA.
 *
 * Run: npm run test:orto-precio-control
 *
 * El caso del ticket: en «Pago por control», un control de Damon se cobraba a $600 (el «Control de ortodoncia»
 * global del catálogo) en vez de $1,000. Ahora cada técnica tiene «pago inicial» y «precio por control», el caso
 * copia el de su técnica al abrirse y cada control se factura con él; sin precio en la técnica, cae al catálogo
 * como antes, y los casos que ya existían no cambian.
 *
 * Tres capas: lo puro (técnicas, elección del precio, alta, bot), la capa de base con un Prisma de mentira
 * (aislamiento por clínica, tolerancia a que falte la columna, casos existentes intactos) y el cableado de las
 * acciones (firma, alta, cambio de técnica, cobro, convenio) leído del código.
 */
import Module from "node:module";
import path from "node:path";
import { readFileSync } from "node:fs";
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

const RAIZ = path.resolve(__dirname, "../../../..");
const leer = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");
type Fila = Record<string, any>;

// ── Dobles: Prisma, catálogo, modo de cobro y lista de técnicas ─────────────
const CLINICA_A = "clinica_A";
const CLINICA_B = "clinica_B";

const TECNICAS_A = [
  { id: "METAL_BRACKETS", nombre: "Orto Essential (TD)", base: "METAL_BRACKETS", precio: null, pagoInicial: 5000, precioControl: 600, activa: true },
  { id: "t-damon", nombre: "Orto Elite (Damon Q2)", base: "SELF_LIGATING_METAL", precio: null, pagoInicial: 15000, precioControl: 1000, activa: true },
  { id: "t-clear", nombre: "Orto Clear (alineadores)", base: "CLEAR_ALIGNERS", precio: null, pagoInicial: null, precioControl: null, activa: true },
];

const base = {
  columna: true,
  /** id del caso → { clinicId, controlPriceMxn } */
  casos: new Map<string, { clinicId: string; controlPriceMxn: number | null }>(),
  catalogo: { [CLINICA_A]: { procedureId: "p-ctl", name: "Control de ortodoncia", basePrice: 600 } } as Record<string, { procedureId: string; name: string; basePrice: number } | null>,
  modos: new Map<string, string | null>(),
  tecnicas: { [CLINICA_A]: TECNICAS_A, [CLINICA_B]: [] } as Record<string, Fila[]>,
};
const registro = { consultas: [] as Array<{ sql: string; valores: unknown[] }>, sondas: 0 };

const prismaFalso = {
  $queryRaw: async (strings: TemplateStringsArray, ...valores: unknown[]) => {
    const sql = strings.join("?");
    registro.consultas.push({ sql, valores });
    if (/information_schema\.columns/.test(sql)) {
      registro.sondas++;
      return [{ existe: base.columna }];
    }
    if (/SELECT "controlPriceMxn"/.test(sql)) {
      if (!base.columna) throw Object.assign(new Error('column "controlPriceMxn" does not exist'), { code: "42703" });
      const [planId, clinicId] = valores as string[];
      const c = base.casos.get(planId);
      // Como Postgres: la fila solo sale si es de ESA clínica.
      return c && c.clinicId === clinicId ? [{ controlPriceMxn: c.controlPriceMxn === null ? null : String(c.controlPriceMxn) }] : [];
    }
    throw new Error(`consulta inesperada: ${sql}`);
  },
  $executeRaw: async (strings: TemplateStringsArray, ...valores: unknown[]) => {
    const sql = strings.join("?");
    registro.consultas.push({ sql, valores });
    if (!base.columna) throw new Error("no debería escribir sin la columna");
    const [precio, planId, clinicId] = valores as [number | null, string, string];
    const c = base.casos.get(planId);
    if (!c || c.clinicId !== clinicId) return 0;
    c.controlPriceMxn = precio;
    return 1;
  },
};

const dobles = new Map<string, unknown>([
  [path.join(RAIZ, "src/lib/prisma.ts"), { prisma: prismaFalso, default: prismaFalso }],
  [path.join(RAIZ, "src/lib/orthodontics/catalog-procedures.ts"), {
    buscarPrecioControlOrto: async (clinicId: string) => base.catalogo[clinicId] ?? null,
  }],
  [path.join(RAIZ, "src/lib/orthodontics/billing-mode-db.ts"), {
    cargarModoDeCobro: async (_clinicId: string, planId: string) => base.modos.get(planId) ?? null,
  }],
  [path.join(RAIZ, "src/lib/orthodontics/tecnicas-de-la-clinica-db.ts"), {
    leerTecnicasDeLaClinica: async (clinicId: string) => ({ tecnicas: base.tecnicas[clinicId] ?? [], columnaLista: true, editada: true }),
  }],
]);
const M = Module as unknown as {
  _load: (req: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (req: string, parent: unknown, isMain: boolean) => string;
};
const cargaOriginal = M._load;
M._load = function (req, parent, isMain) {
  if (req === "server-only") return {};
  let resuelto: string | null = null;
  try { resuelto = M._resolveFilename(req, parent, isMain); } catch { resuelto = null; }
  if (resuelto && dobles.has(resuelto)) return dobles.get(resuelto);
  return cargaOriginal.call(this, req, parent, isMain);
};

let tec: typeof import("../tecnicas-de-la-clinica");
let puro: typeof import("../precio-control-del-caso");
let db: typeof import("../precio-control-del-caso-db");
let bot: typeof import("../../whatsapp/bot/precios-core");
before(async () => {
  tec = await import("../tecnicas-de-la-clinica");
  puro = await import("../precio-control-del-caso");
  db = await import("../precio-control-del-caso-db");
  bot = await import("../../whatsapp/bot/precios-core");
});

beforeEach(() => {
  base.columna = true;
  base.casos = new Map([
    ["caso-damon-nuevo", { clinicId: CLINICA_A, controlPriceMxn: 1000 }],
    ["caso-viejo", { clinicId: CLINICA_A, controlPriceMxn: null }],
    ["caso-b", { clinicId: CLINICA_B, controlPriceMxn: 4321 }],
  ]);
  base.modos = new Map([["caso-damon-nuevo", "PAGO_POR_CONTROL"], ["caso-viejo", "PAGO_POR_CONTROL"], ["caso-plazos", "PRECIO_TOTAL"]]);
  base.casos.set("caso-plazos", { clinicId: CLINICA_A, controlPriceMxn: null });
  registro.consultas.length = 0;
  registro.sondas = 0;
  db._olvidarSondaPrecioControl();
});

// ── 1. La técnica guarda sus tres precios ───────────────────────────────────

test("técnica: guarda pago inicial y precio por control; una lista de antes los trae vacíos", () => {
  const [t] = tec.normalizarTecnicas([{ id: "t-a", nombre: "Orto Elite", base: "SELF_LIGATING_METAL", precio: "", pagoInicial: "$15,000", precioControl: 1000, activa: true }])!;
  assert.equal(t!.pagoInicial, 15000);
  assert.equal(t!.precioControl, 1000);
  assert.equal(t!.precio, null);
  const [vieja] = tec.normalizarTecnicas([{ id: "t-b", nombre: "Zafiro", base: "CERAMIC_BRACKETS", precio: 12000, activa: true }])!;
  assert.deepEqual([vieja!.precio, vieja!.pagoInicial, vieja!.precioControl], [12000, null, null]);
  for (const t7 of tec.tecnicasDeSiempre()) assert.deepEqual([t7.pagoInicial, t7.precioControl], [null, null]);
});

test("técnica: «Restaurar las de siempre» conserva el inicial y el control", () => {
  const lista = tec.normalizarTecnicas([{ id: "METAL_BRACKETS", nombre: "TD", base: "METAL_BRACKETS", precio: null, pagoInicial: 5000, precioControl: 600, activa: false }])!;
  const td = tec.restaurarDeSiempre(lista).find((x) => x.id === "METAL_BRACKETS")!;
  assert.deepEqual([td.pagoInicial, td.precioControl, td.activa], [5000, 600, true]);
});

test("técnica: un precio por control o inicial inválido no se guarda (y dice cuál)", () => {
  assert.match(tec.validarTecnicas([{ nombre: "Damon", precio: null, pagoInicial: 15000, precioControl: "mil" }])!, /precio por control de «Damon»/);
  assert.match(tec.validarTecnicas([{ nombre: "Damon", precio: null, pagoInicial: -5, precioControl: 1000 }])!, /pago inicial de «Damon»/);
  assert.equal(tec.validarTecnicas([{ nombre: "Damon", precio: "", pagoInicial: "15000", precioControl: "1,000" }]), null);
});

test("técnica del caso: por tipo base y nombre propio; la de nombre estándar sin nombre propio; ninguna si la renombraron", () => {
  const lista = tec.normalizarTecnicas([
    ...TECNICAS_A,
    { id: "CERAMIC_BRACKETS", nombre: "Brackets estéticos (cerámicos)", base: "CERAMIC_BRACKETS", precio: 20000, pagoInicial: 8000, precioControl: 800, activa: true },
  ])!;
  assert.equal(tec.tecnicaDelCaso(lista, { base: "SELF_LIGATING_METAL", label: "Orto Elite (Damon Q2)" })?.precioControl, 1000);
  assert.equal(tec.tecnicaDelCaso(lista, { base: "CERAMIC_BRACKETS", label: null })?.precioControl, 800);
  assert.equal(tec.tecnicaDelCaso(lista, { base: "SELF_LIGATING_METAL", label: "Nombre que ya no existe" }), null);
  assert.equal(tec.tecnicaDelCaso(lista, { base: null, label: "Orto Elite (Damon Q2)" }), null);
});

test("técnica del caso: una técnica QUITADA sigue dando su precio al caso que la usa", () => {
  const lista = tec.normalizarTecnicas([{ ...TECNICAS_A[1], activa: false }])!;
  assert.equal(tec.tecnicaDelCaso(lista, { base: "SELF_LIGATING_METAL", label: "Orto Elite (Damon Q2)" })?.precioControl, 1000);
});

test("aviso de Configuración: en «Pago por control», las técnicas con solo «precio total» se señalan", () => {
  const filas = [
    { nombre: "Vieja", activa: true, precio: "5000", pagoInicial: "", precioControl: "" },
    { nombre: "Nueva", activa: true, precio: "", pagoInicial: "5000", precioControl: "600" },
    { nombre: "Quitada", activa: false, precio: "9000", pagoInicial: "", precioControl: "" },
    { nombre: "Sin nada", activa: true, precio: "", pagoInicial: "", precioControl: "" },
  ];
  assert.deepEqual(tec.soloConPrecioTotal(filas), ["Vieja"]);
});

// ── 2. Con qué se cobra cada control ────────────────────────────────────────

test("el control de Damon se cobra a $1,000 (su técnica), no a los $600 del catálogo", () => {
  const p = puro.elegirPrecioDeControl(1000, { name: "Control de ortodoncia", basePrice: 600 });
  assert.deepEqual(p, { precio: 1000, nombre: "Control de ortodoncia", origen: "caso" });
});

test("sin precio en el caso (técnica sin precio, o caso de antes) cae al catálogo como hoy", () => {
  assert.deepEqual(puro.elegirPrecioDeControl(null, { name: "Ajuste mensual", basePrice: 600 }), { precio: 600, nombre: "Ajuste mensual", origen: "catalogo" });
  assert.equal(puro.elegirPrecioDeControl(null, null), null);
  // Con precio propio y sin control en el catálogo, se cobra igual con el nombre de siempre.
  assert.deepEqual(puro.elegirPrecioDeControl(800, null), { precio: 800, nombre: "Control de ortodoncia", origen: "caso" });
  // Un 0 o basura no es precio del caso.
  assert.equal(puro.elegirPrecioDeControl(0, { name: "Control", basePrice: 600 })?.origen, "catalogo");
});

test("alta: la colocación y el control se proponen con los de la técnica; sin ellos, con el catálogo", () => {
  const cat = { colocacion: 3000, control: 600 };
  assert.deepEqual(puro.preciosDeLaTecnicaParaElAlta(TECNICAS_A[1], cat), { colocacion: 15000, colocacionDeLaTecnica: true, control: 1000, controlDeLaTecnica: true });
  assert.deepEqual(puro.preciosDeLaTecnicaParaElAlta(TECNICAS_A[2], cat), { colocacion: 3000, colocacionDeLaTecnica: false, control: 600, controlDeLaTecnica: false });
  assert.deepEqual(puro.preciosDeLaTecnicaParaElAlta(null, { colocacion: null, control: null }), { colocacion: null, colocacionDeLaTecnica: false, control: null, controlDeLaTecnica: false });
});

test("cambio de técnica: solo cuenta si cambia el tipo o el nombre propio (guardar la aparatología no)", () => {
  assert.equal(puro.cambioLaTecnica({ base: "METAL_BRACKETS", label: null }, { base: "METAL_BRACKETS", label: null }), false);
  assert.equal(puro.cambioLaTecnica({ base: "METAL_BRACKETS", label: "TD" }, { base: "METAL_BRACKETS", label: " TD " }), false);
  assert.equal(puro.cambioLaTecnica({ base: "METAL_BRACKETS", label: "TD" }, { base: "METAL_BRACKETS", label: "Omco" }), true);
  assert.equal(puro.cambioLaTecnica({ base: "METAL_BRACKETS", label: null }, { base: "SELF_LIGATING_METAL", label: null }), true);
});

// ── 3. Capa de base (Prisma de mentira) ─────────────────────────────────────

test("base: el control de un caso con precio propio sale de su caso; el de un caso viejo, del catálogo", async () => {
  assert.deepEqual(await db.precioDeControlDelCaso(CLINICA_A, "caso-damon-nuevo"), { precio: 1000, nombre: "Control de ortodoncia", origen: "caso" });
  assert.deepEqual(await db.precioDeControlDelCaso(CLINICA_A, "caso-viejo"), { precio: 600, nombre: "Control de ortodoncia", origen: "catalogo" });
});

test("base: aislamiento — el caso de OTRA clínica no presta su precio, y sin clínica no se consulta", async () => {
  // caso-b es de la clínica B: leído desde la A no existe → catálogo de la A.
  assert.equal((await db.precioDeControlDelCaso(CLINICA_A, "caso-b"))?.precio, 600);
  const lecturas = registro.consultas.filter((c) => /SELECT "controlPriceMxn"/.test(c.sql));
  assert.ok(lecturas.length > 0 && lecturas.every((c) => c.valores.includes(CLINICA_A)), "cada lectura lleva el clinicId de la sesión");
  registro.consultas.length = 0;
  assert.equal(await db.leerPrecioControlDelCaso("", "caso-damon-nuevo"), null);
  assert.equal(await db.precioDeControlDelCaso("", "caso-damon-nuevo"), null);
  assert.equal(registro.consultas.length, 0);
});

test("base: sin el SQL pegado nada falla — todo se cobra con el catálogo, no se consulta la columna y se pregunta una vez", async () => {
  base.columna = false;
  for (let i = 0; i < 5; i++) assert.equal((await db.precioDeControlDelCaso(CLINICA_A, "caso-damon-nuevo"))?.origen, "catalogo");
  assert.equal(registro.consultas.filter((c) => /controlPriceMxn"\s+FROM|SET "controlPriceMxn"/.test(c.sql)).length, 0);
  assert.equal(registro.sondas, 1);
  assert.equal(await db.guardarPrecioControlDelCaso(CLINICA_A, "caso-viejo", 900), false);
  assert.deepEqual(await db.fijarPrecioControlSegunTecnica({ clinicId: CLINICA_A, planId: "caso-viejo", base: "SELF_LIGATING_METAL", label: "Orto Elite (Damon Q2)" }), { cambio: false, antes: null, despues: null });
});

test("base: al ABRIR un caso por control copia el precio de su técnica; en «Precio total» no copia nada", async () => {
  base.casos.set("caso-nuevo", { clinicId: CLINICA_A, controlPriceMxn: null });
  const r = await db.fijarPrecioControlSegunTecnica({ clinicId: CLINICA_A, planId: "caso-nuevo", base: "SELF_LIGATING_METAL", label: "Orto Elite (Damon Q2)", billingMode: "PAGO_POR_CONTROL", nuevo: true });
  assert.deepEqual(r, { cambio: true, antes: null, despues: 1000 });
  assert.equal(base.casos.get("caso-nuevo")!.controlPriceMxn, 1000);

  base.casos.set("caso-nuevo-plazos", { clinicId: CLINICA_A, controlPriceMxn: null });
  const p = await db.fijarPrecioControlSegunTecnica({ clinicId: CLINICA_A, planId: "caso-nuevo-plazos", base: "SELF_LIGATING_METAL", label: "Orto Elite (Damon Q2)", billingMode: "PRECIO_TOTAL", nuevo: true });
  assert.equal(p.cambio, false);
  assert.equal(base.casos.get("caso-nuevo-plazos")!.controlPriceMxn, null);
});

test("base: una técnica sin precio por control deja el caso sin precio propio (cae al catálogo)", async () => {
  base.casos.set("caso-clear", { clinicId: CLINICA_A, controlPriceMxn: null });
  const r = await db.fijarPrecioControlSegunTecnica({ clinicId: CLINICA_A, planId: "caso-clear", base: "CLEAR_ALIGNERS", label: "Orto Clear (alineadores)", billingMode: "PAGO_POR_CONTROL", nuevo: true });
  assert.equal(r.cambio, false);
  assert.equal((await db.precioDeControlDelCaso(CLINICA_A, "caso-clear"))?.origen, "catalogo");
});

test("base: cambiar la técnica de un caso le pone el precio de la nueva (o lo quita si la nueva no tiene)", async () => {
  // Caso viejo (sin precio) pasa a Damon: sus próximos controles, a $1,000.
  assert.deepEqual(await db.fijarPrecioControlSegunTecnica({ clinicId: CLINICA_A, planId: "caso-viejo", base: "SELF_LIGATING_METAL", label: "Orto Elite (Damon Q2)" }), { cambio: true, antes: null, despues: 1000 });
  // Damon pasa a alineadores sin precio por control: vuelve al catálogo.
  assert.deepEqual(await db.fijarPrecioControlSegunTecnica({ clinicId: CLINICA_A, planId: "caso-damon-nuevo", base: "CLEAR_ALIGNERS", label: "Orto Clear (alineadores)" }), { cambio: true, antes: 1000, despues: null });
  assert.equal((await db.precioDeControlDelCaso(CLINICA_A, "caso-damon-nuevo"))?.precio, 600);
  // Un caso de OTRA clínica no se escribe desde la A.
  await db.fijarPrecioControlSegunTecnica({ clinicId: CLINICA_A, planId: "caso-b", base: "SELF_LIGATING_METAL", label: "Orto Elite (Damon Q2)", billingMode: "PAGO_POR_CONTROL" });
  assert.equal(base.casos.get("caso-b")!.controlPriceMxn, 4321);
});

// ── 4. El cableado (leído del código) ───────────────────────────────────────

const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("firma de la hoja: factura cada control con el precio DEL CASO (ya no con el global del catálogo)", () => {
  const src = sinComentarios(leer("src/app/actions/orthodontics/signTreatmentCard.ts"));
  assert.match(src, /precioDeControlDelCaso\(plan\.clinicId, plan\.id\)/);
  assert.doesNotMatch(src, /buscarPrecioControlOrto/);
  assert.match(src, /lineItems: \[\{ description: precio\.nombre, unitPrice: precio\.precio, quantity: 1 \}\]/);
});

test("alta: copia el precio de la técnica al caso (nuevo) y estima con los precios de la técnica", () => {
  const src = sinComentarios(leer("src/app/actions/orthodontics/createTreatmentPlan.ts"));
  assert.match(src, /fijarPrecioControlSegunTecnica\(\{[\s\S]{0,260}billingMode: billingModeDelCaso,[\s\S]{0,40}nuevo: true/);
  assert.match(src, /preciosDeLaTecnicaParaElAlta\(/);
});

test("cambio de técnica (aparatología y plan): re-fija el precio solo si la técnica cambió de verdad", () => {
  for (const f of ["src/app/actions/orthodontics/updateOrthoAppliances.ts", "src/app/actions/orthodontics/updateTreatmentPlan.ts"]) {
    const src = sinComentarios(leer(f));
    assert.match(src, /cambioLaTecnica\([\s\S]{0,200}fijarPrecioControlSegunTecnica\(/, f);
    assert.match(src, /precioPorControl: precioControl\.despues/, `${f}: el cambio queda en la bitácora`);
  }
});

test("Cobro y convenio PDF muestran el precio por control del caso", () => {
  for (const f of ["src/app/actions/orthodontics/cobro/cargarPanelDeCobro.ts", "src/app/actions/orthodontics/exportFinancialAgreementPdf.ts"]) {
    const src = sinComentarios(leer(f));
    assert.match(src, /precioDeControlDelCaso\(ctx\.clinicId, /, f);
    assert.doesNotMatch(src, /buscarPrecioControlOrto/, f);
  }
});

test("SQL a mano, aditivo e idempotente; la columna NO se declara en schema.prisma", () => {
  const sql = leer("sql/ws1-t12-precio-control-por-caso.sql");
  assert.match(sql, /ALTER TABLE "orthodontic_treatment_plans" ADD COLUMN IF NOT EXISTS "controlPriceMxn" NUMERIC\(10, 2\);/);
  assert.doesNotMatch(sql, /\bUPDATE\b|\bDELETE\b/, "no toca casos existentes");
  assert.doesNotMatch(leer("prisma/schema.prisma"), /controlPriceMxn/);
});

test("Configuración: guardar valida y anota en la bitácora el inicial y el control; la pantalla respeta settings.edit", () => {
  const accion = leer("src/app/actions/orthodontics/guardarTecnicasDeLaClinica.ts");
  assert.match(accion, /getOrthoConfigActionContext\(\)/);
  assert.match(accion, /pagoInicial: t\.pagoInicial, precioControl: t\.precioControl/);
  const pagina = leer("src/app/dashboard/orthodontics/configuracion/page.tsx");
  assert.match(pagina, /puedeEditar=\{hasPermission\([\s\S]{0,120}"settings\.edit"\)\}/);
  const ui = leer("src/components/specialties/orthodontics/configuracion/TecnicasYPrecios.tsx");
  assert.match(ui, /disabled=\{!puedeEditar\}/);
  assert.doesNotMatch(ui, /#[0-9a-fA-F]{3,6}\b/, "sin hex");
  const css = leer("src/components/specialties/orthodontics/configuracion/tecnicas-y-precios.module.css");
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,6}\b/, "sin hex");
});

test("textos es/en: las dos versiones tienen las mismas claves", async () => {
  // El módulo de textos importa el proveedor de idioma (React): se lee el archivo y se comparan las claves.
  const src = leer("src/components/specialties/orthodontics/configuracion/textos-tecnicas-y-precios.ts");
  const bloque = (nombre: string) => src.slice(src.indexOf(`const ${nombre}`), src.indexOf("};\n", src.indexOf(`const ${nombre}`)));
  const claves = (t: string) => [...t.matchAll(/^\s{2,4}(\w+):/gm)].map((m) => m[1]).sort();
  assert.deepEqual(claves(bloque("en")), claves(bloque("es")));
});

// ── 5. El bot dice inicial + por control ────────────────────────────────────

test("bot: la técnica con inicial y control los dice por separado (no un solo precio, no «mensualidades»)", () => {
  const p = bot.preciosDelTurno(
    {
      darPreciosProcedimientos: false,
      darPreciosOrtodoncia: true,
      tieneOrtodoncia: true,
      procedimientos: [],
      tecnicas: [
        { nombre: "Orto Elite (Damon Q2)", precio: null, pagoInicial: 15000, precioControl: 1000 },
        { nombre: "Orto Pure (zafiro)", precio: 30000, pagoInicial: 12000, precioControl: 800 },
        { nombre: "Brackets metálicos", precio: 18000 },
        { nombre: "Orto Clear (alineadores)", precio: null, pagoInicial: null, precioControl: null },
      ],
      puedeAgendar: true,
    },
    "¿cuánto cuestan los brackets?",
    { agenda: "__AGENDA__", handoff: "__HANDOFF__" },
  );
  assert.match(p.coincidencias, /- Orto Elite \(Damon Q2\): pago inicial \$15,000 MXN y \$1,000 MXN por cada control/);
  assert.match(p.coincidencias, /- Orto Pure \(zafiro\): pago inicial \$12,000 MXN y \$800 MXN por cada control; o precio total del tratamiento a plazos \$30,000 MXN/);
  assert.match(p.coincidencias, /- Brackets metálicos: \$18,000 MXN/);
  assert.doesNotMatch(p.coincidencias, /Orto Clear/, "sin ningún precio no se menciona");
  assert.match(p.reglas, /no los llames mensualidades/);
});

test("bot: una clínica sin inicial/control dice lo mismo que antes (sin la regla nueva)", () => {
  const p = bot.preciosDelTurno(
    { darPreciosProcedimientos: false, darPreciosOrtodoncia: true, tieneOrtodoncia: true, procedimientos: [], tecnicas: [{ nombre: "Brackets metálicos", precio: 18000 }], puedeAgendar: true },
    "ortodoncia",
    { agenda: "__AGENDA__", handoff: "__HANDOFF__" },
  );
  assert.match(p.coincidencias, /- Brackets metálicos: \$18,000 MXN$/m);
  assert.doesNotMatch(p.reglas, /por cada control/);
});

test("bot: precios-bot pasa al prompt el inicial y el control de cada técnica", () => {
  const src = leer("src/lib/whatsapp/bot/precios-bot.ts");
  assert.match(src, /pagoInicial: t\.pagoInicial, precioControl: t\.precioControl/);
});
