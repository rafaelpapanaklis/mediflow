// ws1-t10 — técnicas propias de cada clínica, y tres ajustes del alta del caso (plan de retención vacío,
// «Responsable del pago» con «El paciente» por defecto, fechas dd/mm/aaaa).
// Correr: npm run test:orto-tecnicas
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { TECNICAS_ORTO } from "../precios-por-tecnica";
import {
  faltanDeSiempre,
  idNuevoDeTecnica,
  nombreDeTecnica,
  ID_TECNICA_ACTUAL,
  nombrePropioAGuardar,
  normalizarTecnicas,
  opcionesDeEdicion,
  resolverTecnicas,
  restaurarDeSiempre,
  tecnicasActivas,
  tecnicasDeSiempre,
  validarTecnicas,
  type TecnicaClinica,
} from "../tecnicas-de-la-clinica";
import { cargarNombresDeTecnica } from "../tecnicas-de-la-clinica-db";
import { techniqueLabel } from "../consent-texts";
import {
  ETIQUETAS_MODO_RESPONSABLE,
  MIN_RETENCION,
  faltantesDelAlta,
  responsablePropuestoParaElAlta,
  type EstadoAlta,
} from "../alta-caso-formulario";
import { hoyISO, hoyMasAniosISO } from "../fechas-de-formulario";
import { EJEMPLO_DE_RETENCION } from "../retencion-ejemplo";

const SRC = join(__dirname, "..", "..", "..");
const RAIZ = join(SRC, "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

// ── Siembra, agregar / editar / quitar, restaurar ────────────────────────────

test("siembra: sin lista guardada salen las 7 de siempre, con sus precios de techniquePrices y activas", () => {
  const l = resolverTecnicas(null, { METAL_BRACKETS: 25000, CLEAR_ALIGNERS: 48000 });
  assert.equal(l.length, 7);
  assert.deepEqual(l.map((t) => t.id), TECNICAS_ORTO.map((t) => t.key));
  assert.ok(l.every((t) => t.activa && t.base === t.id));
  assert.equal(l.find((t) => t.id === "METAL_BRACKETS")!.precio, 25000);
  assert.equal(l.find((t) => t.id === "HYBRID")!.precio, null);
  assert.equal(l.find((t) => t.id === "CLEAR_ALIGNERS")!.nombre, "Alineadores transparentes");
  // basura o columna vacía = sin lista
  assert.equal(resolverTecnicas("x", {}).length, 7);
  assert.equal(resolverTecnicas({}, {}).length, 7);
});

test("agregar y editar: una técnica propia lleva id estable, nombre, tipo base y precio; lo inválido se descarta", () => {
  const base = tecnicasDeSiempre();
  const id = idNuevoDeTecnica(base, 0.5);
  assert.match(id, /^t-[0-9a-z]{6}$/);
  const propia = { id, nombre: "  Brackets   de zafiro ", base: "CERAMIC_BRACKETS", precio: "38,500", activa: true };
  const lista = normalizarTecnicas([...base, propia, { id: "x", nombre: "", base: "HYBRID" }, { id: "y", nombre: "Rara", base: "NOEXISTE" }, { id, nombre: "Repetida", base: "HYBRID" }])!;
  assert.equal(lista.length, 8);
  const z = lista.find((t) => t.id === id)!;
  assert.deepEqual(z, { id, nombre: "Brackets de zafiro", base: "CERAMIC_BRACKETS", precio: 38500, activa: true });
  // editar nombre y precio de una de siempre no cambia su id ni su tipo base
  const editada = normalizarTecnicas(base.map((t) => (t.id === "METAL_BRACKETS" ? { ...t, nombre: "Metálicos Damon", precio: 29000 } : t)))!;
  const m = editada.find((t) => t.id === "METAL_BRACKETS")!;
  assert.deepEqual([m.id, m.base, m.nombre, m.precio], ["METAL_BRACKETS", "METAL_BRACKETS", "Metálicos Damon", 29000]);
  // el id nuevo no choca con uno usado
  assert.notEqual(idNuevoDeTecnica([{ ...z, id: "t-000000" }] as TecnicaClinica[], 0), "t-000000");
});

test("validar: nombre obligatorio, sin repetidos y precio legible", () => {
  assert.equal(validarTecnicas([{ nombre: "Ortopedia", precio: null }, { nombre: "Zafiro", precio: "1,500.50" }]), null);
  assert.match(validarTecnicas([{ nombre: "  ", precio: null }])!, /nombre/);
  assert.match(validarTecnicas([{ nombre: "Ortopedia", precio: null }, { nombre: "ortopedia", precio: null }])!, /repetida/);
  assert.match(validarTecnicas([{ nombre: "Ortopedia", precio: "abc" }])!, /precio/);
});

test("quitar = activa:false: no se ofrece en casos nuevos pero sigue en la lista (nada se borra)", () => {
  const lista = tecnicasDeSiempre().map((t) => (t.id === "LINGUAL_BRACKETS" ? { ...t, activa: false } : t));
  assert.equal(lista.length, 7);
  assert.equal(tecnicasActivas(lista).length, 6);
  assert.ok(!tecnicasActivas(lista).some((t) => t.id === "LINGUAL_BRACKETS"));
  // se guarda y se lee de vuelta con activa:false
  assert.equal(normalizarTecnicas(lista)!.find((t) => t.id === "LINGUAL_BRACKETS")!.activa, false);
  // también se pueden quitar las 7
  assert.equal(tecnicasActivas(lista.map((t) => ({ ...t, activa: false }))).length, 0);
});

test("restaurar las de siempre: reactiva y devuelve el nombre, conserva precios y técnicas propias", () => {
  const propia: TecnicaClinica = { id: "t-abc123", nombre: "Ortopedia", base: "HYBRID", precio: 9000, activa: true };
  const lista: TecnicaClinica[] = [
    ...tecnicasDeSiempre({ METAL_BRACKETS: 25000 }).map((t) =>
      t.id === "METAL_BRACKETS" ? { ...t, nombre: "Otro nombre", activa: false } : t.id === "HYBRID" ? { ...t, activa: false } : t,
    ),
    propia,
  ];
  assert.equal(faltanDeSiempre(lista), true);
  const r = restaurarDeSiempre(lista);
  assert.equal(faltanDeSiempre(r), false);
  assert.equal(r.length, 8);
  const m = r.find((t) => t.id === "METAL_BRACKETS")!;
  assert.deepEqual([m.nombre, m.activa, m.precio], ["Brackets metálicos", true, 25000]);
  assert.deepEqual(r.find((t) => t.id === "t-abc123"), propia);
  // sin cambios en las de siempre: no hay nada que restaurar
  assert.equal(faltanDeSiempre(tecnicasDeSiempre()), false);
  // si faltaba del todo (lista guardada sin ella), también vuelve
  assert.equal(restaurarDeSiempre([propia]).length, 8);
});

// ── El caso: tipo base + nombre, y el caso viejo con técnica quitada ─────────

test("caso con técnica propia: guarda tipo base (enum) + nombre; con el nombre de siempre no guarda nombre", () => {
  const zafiro: TecnicaClinica = { id: "t-1", nombre: "Brackets de zafiro", base: "CERAMIC_BRACKETS", precio: 38500, activa: true };
  assert.equal(nombrePropioAGuardar(zafiro), "Brackets de zafiro");
  assert.equal(zafiro.base, "CERAMIC_BRACKETS"); // lo que va a la columna `technique`
  assert.equal(nombrePropioAGuardar(tecnicasDeSiempre()[0]), null);
  assert.equal(nombrePropioAGuardar(null), null);

  const cajon = sinComentarios(leer("components/specialties/orthodontics/redesign/drawers/DrawerNewCase.tsx"));
  assert.match(cajon, /technique: tecnica\?\.base/);
  assert.match(cajon, /techniqueLabel: nombrePropioAGuardar\(tecnica\)/);
  assert.match(cajon, /tecnicas\.map\(\(x\) => \(\{ v: x\.id, l: x\.nombre \}\)\)/);
  assert.match(cajon, /costoAProponer\(/);
  assert.match(cajon, /tecnica\?\.precio/);
  const wizard = sinComentarios(leer("components/specialties/orthodontics/plan/TreatmentPlanWizard.tsx"));
  assert.match(wizard, /techniqueLabel: nombrePropioAGuardar\(tecnica\)/);
  assert.match(wizard, /getCaseIntakeOptions\(/);

  const crear = leer("app/actions/orthodontics/createTreatmentPlan.ts");
  assert.match(crear, /technique: parsed\.data\.technique,/);
  assert.match(crear, /guardarNombreDeTecnicaDelCaso\(ctx\.clinicId, created\.id, parsed\.data\.techniqueLabel\)/);
  assert.match(leer("lib/validation/orthodontics.ts"), /techniqueLabel: z\.string\(\)\.max\(80\)/);
});

test("técnica quitada: no se ofrece, pero el caso viejo la muestra por su nombre en todas las salidas", () => {
  const lista: TecnicaClinica[] = [
    { id: "t-1", nombre: "Brackets de zafiro", base: "CERAMIC_BRACKETS", precio: null, activa: false },
    ...tecnicasDeSiempre(),
  ];
  assert.ok(!tecnicasActivas(lista).some((t) => t.id === "t-1"));
  // el caso ya guardó su nombre: no depende de la lista
  assert.equal(nombreDeTecnica("CERAMIC_BRACKETS", "Brackets de zafiro"), "Brackets de zafiro");
  assert.equal(nombreDeTecnica("CERAMIC_BRACKETS", "Brackets de zafiro", "Brackets cerámicos"), "Brackets de zafiro");
  // consentimientos, PDF y facturas: `techniqueLabel` con el nombre propio
  assert.equal(techniqueLabel("CERAMIC_BRACKETS", "Brackets de zafiro"), "Brackets de zafiro");
  assert.equal(techniqueLabel("CERAMIC_BRACKETS", null), "brackets cerámicos (estéticos)");
  // sin nombre propio (caso anterior a esto): el de siempre de cada pantalla
  assert.equal(nombreDeTecnica("METAL_BRACKETS", null, "Brackets metálicos"), "Brackets metálicos");
  assert.equal(nombreDeTecnica("METAL_BRACKETS", "  ", undefined), "Brackets metálicos");
  assert.equal(nombreDeTecnica(null, null), "—");

  const lee = (rel: string, re: RegExp) => assert.match(leer(rel), re, rel);
  lee("lib/orthodontics/redesign/adapter.ts", /nombreDeTecnica\(plan\.technique, args\.techniqueLabel/);
  lee("lib/orthodontics/redesign/loader.ts", /cargarNombreDeTecnica\(input\.clinicId, planId\)/);
  lee("lib/sabina/tools/orto-motor.ts", /cargarNombreDeTecnica\(clinicId, plan\.id, db as unknown as LectorRaw\)/);
  lee("lib/orthodontics/pacientes-modulo.ts", /nombreDeTecnica\(clinico\.technique, clinico\.techniqueLabel/);
  lee("lib/orthodontics/pacientes-modulo-db.ts", /cargarNombresDeTecnica\(clinicId, planIds\)/);
  lee("lib/orthodontics/expediente-ortodoncia-db.ts", /nombres\.get\(p\.id\)/);
  lee("lib/orthodontics/pdf-templates/treatment-plan.tsx", /techniqueLabel\(data\.plan\.technique as never, data\.plan\.techniqueName\)/);
  // el convenio de pago (ws1-t4 lo rehízo) arma su renglón «Técnica» con el mismo lector del nombre propio
  lee("app/actions/orthodontics/exportFinancialAgreementPdf.ts", /cargarNombreDeTecnica\(/);
  lee("lib/orthodontics/pdf-templates/referral-progress-letter.tsx", /data\.plan\.techniqueName/);
  lee("app/api/orthodontics/treatment-plans/[id]/progress-report-pdf/route.tsx", /cargarNombreDeTecnica\(ctx\.clinicId, plan\.id\)/);
  lee("app/api/orthodontics/treatment-plans/[id]/discharge-letter-pdf/route.tsx", /cargarNombreDeTecnica\(ctx\.clinicId, plan\.id\)/);
  lee("lib/orthodontics/cobro/borrador-factura.ts", /techniqueLabel\(caso\.technique, caso\.techniqueName\)/);
  lee("lib/orthodontics/precarga-hoja-control.ts", /techniqueLabel\(d\.technique, d\.techniqueName\)/);
});

test("cambiar el tipo base de un caso limpia su nombre propio (ya no le corresponde); un `updateTreatmentPlan` no manda techniqueLabel a Prisma", () => {
  const upd = leer("app/actions/orthodontics/updateTreatmentPlan.ts");
  assert.match(upd, /newResponsibleGuardian, techniqueLabel, \.\.\.rest \} = parsed\.data/);
  assert.match(upd, /guardarNombreDeTecnicaDelCaso\(ctx\.clinicId, updated\.id, null\)/);
  assert.match(leer("app/actions/orthodontics/updateOrthoAppliances.ts"), /data\.technique !== before\.technique/);
});

// ── Tolerancia: la columna aún no existe ─────────────────────────────────────

test("sin la columna techniqueLabel (SQL sin pegar) los casos muestran el nombre de su tipo base; nunca lanza", async () => {
  const consultas: string[] = [];
  const sinColumna = { $queryRaw: async (q: { sql?: string; strings?: string[] }) => { consultas.push(String(q.sql ?? q.strings?.join(" "))); return [{ existe: false }]; } };
  const r = await cargarNombresDeTecnica("c1", ["p1", "p2"], sinColumna);
  assert.equal(r.size, 0);
  assert.equal(consultas.length, 1); // solo la sonda: no consulta la columna que no existe
  assert.match(consultas[0], /information_schema/);

  const conColumna = {
    $queryRaw: async (q: { values?: unknown[] }) =>
      q.values && q.values.includes("c1")
        ? [{ id: "p1", techniqueLabel: "  Brackets de zafiro " }, { id: "p2", techniqueLabel: null }]
        : [{ existe: true }],
  };
  const ok = await cargarNombresDeTecnica("c1", ["p1", "p2", "p1"], conColumna);
  assert.deepEqual([...ok], [["p1", "Brackets de zafiro"]]);

  const rota = { $queryRaw: async () => { throw Object.assign(new Error("P2022"), { code: "P2022" }); } };
  assert.equal((await cargarNombresDeTecnica("c1", ["p1"], rota)).size, 0);
  // sin clínica o sin ids: ni consulta
  assert.equal((await cargarNombresDeTecnica("", ["p1"], rota)).size, 0);
  assert.equal((await cargarNombresDeTecnica("c1", [], rota)).size, 0);

  const db = leer("lib/orthodontics/tecnicas-de-la-clinica-db.ts");
  assert.match(db, /if \(!clinicId\) return \{ tecnicas: resolverTecnicas\(null, precios\)/);
  assert.match(db, /const columnaLista = await columnaDeListaExiste\(\);\n  if \(!columnaLista\) return \{ tecnicas: resolverTecnicas\(null, precios\)/);
  assert.match(db, /WHERE "clinicId" = \$\{clinicId\}/);
  assert.match(db, /WHERE "id" = \$\{planId\} AND "clinicId" = \$\{clinicId\}/);
});

test("el SQL es plano, idempotente y aditivo; ninguna de las dos columnas está en schema.prisma", () => {
  const sql = readFileSync(join(RAIZ, "sql", "ortodoncia-tecnicas-propias.sql"), "utf8");
  const lineas = sql.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--"));
  assert.deepEqual(lineas, [
    'ALTER TABLE "orthodontics_clinic_settings" ADD COLUMN IF NOT EXISTS "techniqueList" JSONB;',
    'ALTER TABLE "orthodontic_treatment_plans" ADD COLUMN IF NOT EXISTS "techniqueLabel" TEXT;',
  ]);
  assert.doesNotMatch(sql, /\bDO\b\s*\$|DROP TABLE|DROP COLUMN/i);
  const schema = readFileSync(join(RAIZ, "prisma", "schema.prisma"), "utf8");
  assert.doesNotMatch(schema, /techniqueList|techniqueLabel/);
});

test("guardar la lista exige el permiso de Configuración y usa la clínica de la sesión", () => {
  const a = leer("app/actions/orthodontics/guardarTecnicasDeLaClinica.ts");
  assert.match(a, /getOrthoConfigActionContext\(\)/);
  assert.match(a, /guardarEnBase\(ctx\.clinicId, ctx\.userId, tecnicas\)/);
  assert.doesNotMatch(a.replace(/\/\/.*$/gm, ""), /input\.clinicId|clinicId:\s*input/);
  const ui = leer("components/specialties/orthodontics/configuracion/TecnicasYPrecios.tsx");
  assert.match(ui, /titulo="Técnicas y precios"/);
  assert.match(ui, /Agregar técnica/);
  assert.match(ui, /Restaurar las de siempre/);
  assert.match(ui, /¿Quitar «/); // confirmación
});

// ── Plan de retención: nace vacío ────────────────────────────────────────────

test("plan de retención: el alta nace VACÍO (los dos formularios); el ejemplo es solo placeholder y el mínimo sigue en 20", () => {
  const cajon = sinComentarios(leer("components/specialties/orthodontics/redesign/drawers/DrawerNewCase.tsx"));
  const wizard = sinComentarios(leer("components/specialties/orthodontics/plan/TreatmentPlanWizard.tsx"));
  for (const [nombre, codigo] of [["DrawerNewCase", cajon], ["TreatmentPlanWizard", wizard]] as const) {
    assert.match(codigo, /\[retention, setRetention\] = useState\(""\)/, nombre);
    assert.doesNotMatch(codigo, /DEFAULT_RETENTION/, nombre);
    assert.doesNotMatch(codigo, /Retenedor fijo lingual/, nombre);
    assert.match(codigo, /placeholder=\{`Ejemplo: \$\{EJEMPLO_DE_RETENCION\}`\}/, nombre);
  }
  assert.ok(EJEMPLO_DE_RETENCION.length > MIN_RETENCION);
  assert.equal(MIN_RETENCION, 20);
  assert.match(leer("lib/validation/orthodontics.ts"), /retentionPlanText: z\.string\(\)\.min\(20\)/);
  // vacío no deja abrir el caso, y dice por qué
  const estado: EstadoAlta = { necesitaDiagnostico: false, enObservacion: false, resumen: "", proximaRevision: "", retencion: "", costoTotal: "30000", modoResponsable: "none", tutorElegidoId: "", tutorNombre: "", tutorTelefono: "" };
  assert.deepEqual(faltantesDelAlta(estado), [`el plan de retención (lleva 0 de ${MIN_RETENCION} caracteres)`]);
  assert.deepEqual(faltantesDelAlta({ ...estado, retencion: EJEMPLO_DE_RETENCION }), []);
});

// ── Responsable del pago ─────────────────────────────────────────────────────

test("«Responsable del pago»: El paciente (por defecto) / Otra persona ya registrada / Otra persona nueva; sin «Sin definir»", () => {
  assert.deepEqual(ETIQUETAS_MODO_RESPONSABLE, { none: "El paciente", existing: "Otra persona ya registrada", new: "Otra persona nueva" });
  const cajon = sinComentarios(leer("components/specialties/orthodontics/redesign/drawers/DrawerNewCase.tsx"));
  assert.doesNotMatch(cajon, /Sin definir/);
  assert.match(cajon, /useState<ModoResponsable>\("none"\)/);
  for (const k of ["none", "existing", "new"]) assert.match(cajon, new RegExp(`ETIQUETAS_MODO_RESPONSABLE\\.${k}`));
  // «El paciente» viaja como si no hubiera responsable (null): lo mismo que hoy tratan cobro, Cobranza, factura y portal
  assert.match(cajon, /responsibleGuardianId: guardianMode === "existing" \? responsibleGuardianId \|\| null : null/);
  assert.match(leer("lib/orthodontics/responsable-fiscal-db.ts"), /responsibleGuardianId \?\? null/);
  assert.match(leer("lib/orthodontics/tablero-data.ts"), /responsibleGuardianId: \{ not: null \}/);
});

test("responsable propuesto: el paciente; solo si es menor y ya tiene tutor, ese tutor (el legal principal primero)", () => {
  assert.deepEqual(responsablePropuestoParaElAlta({ esMenor: false, tutores: [{ id: "g1" }] }), { modo: "none", tutorId: "" });
  assert.deepEqual(responsablePropuestoParaElAlta({ esMenor: true, tutores: [] }), { modo: "none", tutorId: "" });
  assert.deepEqual(responsablePropuestoParaElAlta({ esMenor: true, tutores: [{ id: "g1" }] }), { modo: "existing", tutorId: "g1" });
  assert.deepEqual(
    responsablePropuestoParaElAlta({ esMenor: true, tutores: [{ id: "g1", principal: false, esResponsableLegal: false }, { id: "g2", principal: false, esResponsableLegal: true }, { id: "g3", principal: true, esResponsableLegal: true }] }),
    { modo: "existing", tutorId: "g3" },
  );
  const opciones = leer("app/actions/orthodontics/getCaseIntakeOptions.ts");
  assert.match(opciones, /isMinor\(patient\.data\.dob\)/);
  assert.match(opciones, /columnsExist\.responsibleGuardianId/);
  const cajon = leer("components/specialties/orthodontics/redesign/drawers/DrawerNewCase.tsx");
  assert.match(cajon, /setGuardianMode\(res\.data\.responsablePropuesto\.modo\)/);
  assert.match(cajon, /setResponsibleGuardianId\(res\.data\.responsablePropuesto\.tutorId\)/);
});

// ── Fechas dd/mm/aaaa ────────────────────────────────────────────────────────

function archivos(dir: string, sal: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) archivos(p, sal);
    else if (/\.tsx$/.test(n) && !p.includes("__tests__")) sal.push(p);
  }
  return sal;
}

test("ninguna fecha del módulo de Ortodoncia usa <input type=date> ni datetime-local (dd/mm/aaaa con DateField)", () => {
  const sueltos: string[] = [];
  for (const dir of ["components/specialties/orthodontics", "app/dashboard/orthodontics"]) {
    for (const f of archivos(join(SRC, dir))) {
      if (/type=["']date(time-local)?["']/.test(sinComentarios(readFileSync(f, "utf8")))) sueltos.push(f.replace(SRC, "src"));
    }
  }
  assert.deepEqual(sueltos, []);
  for (const rel of [
    "components/specialties/orthodontics/redesign/drawers/DrawerNewCase.tsx",
    "components/specialties/orthodontics/redesign/drawers/DrawerCaseSettings.tsx",
    "components/specialties/orthodontics/redesign/drawers/DrawerPromesaDePago.tsx",
    "components/specialties/orthodontics/alineadores/AlineadoresPanel.tsx",
    "components/specialties/orthodontics/redesign/drawers/DrawerTreatmentCard.tsx",
  ]) assert.match(leer(rel), /<DateField|<DateTimeField/, rel);
  assert.match(leer("components/specialties/orthodontics/redesign/sections/SectionRetention.tsx"), /<DateTimeField/);
  // el alta guarda ISO igual que antes
  assert.match(leer("components/ui/date-field.tsx"), /dd\/mm\/aaaa/);
  assert.match(leer("components/ui/date-time-field.tsx"), /`\$\{f\}T\$\{h\}`/);
});

test("límites del calendario: hoy en zona local y hoy + N años, en ISO", () => {
  const d = new Date(2026, 8, 29, 23, 30); // 29-sep-2026 23:30 hora local
  assert.equal(hoyISO(d), "2026-09-29");
  assert.equal(hoyMasAniosISO(5, d), "2031-09-29");
});

// ── «Cambiar aparatología» y el asistente viejo (respuestas del gerente) ─────

test("Cambiar aparatología: ofrece las ACTIVAS de la clínica y la actual del caso aunque esté quitada", () => {
  const zafiro: TecnicaClinica = { id: "t-1", nombre: "Brackets de zafiro", base: "CERAMIC_BRACKETS", precio: null, activa: true };
  const activas = tecnicasActivas([...tecnicasDeSiempre().map((t) => (t.id === "LINGUAL_BRACKETS" ? { ...t, activa: false } : t)), zafiro]);
  // caso con técnica propia vigente: viene seleccionada, sin duplicarla
  let r = opcionesDeEdicion(activas, { base: "CERAMIC_BRACKETS", label: "Brackets de zafiro", nombreVisible: "Brackets de zafiro" });
  assert.equal(r.seleccionadaId, "t-1");
  assert.equal(r.opciones.length, 7); // 6 de siempre activas + la propia
  assert.ok(!r.opciones.some((o) => o.base === "LINGUAL_BRACKETS"));
  // caso de antes (sin nombre propio) con una de siempre activa: se selecciona la de siempre
  r = opcionesDeEdicion(activas, { base: "METAL_BRACKETS", label: null, nombreVisible: "Brackets metálicos" });
  assert.equal(r.seleccionadaId, "METAL_BRACKETS");
  // la actual quitada (lingual) no se pierde: sale arriba, seleccionada, con su tipo base
  r = opcionesDeEdicion(activas, { base: "LINGUAL_BRACKETS", label: null, nombreVisible: "Brackets linguales" });
  assert.equal(r.seleccionadaId, ID_TECNICA_ACTUAL);
  assert.deepEqual(r.opciones[0], { id: ID_TECNICA_ACTUAL, nombre: "Brackets linguales (actual)", base: "LINGUAL_BRACKETS" });
  // una propia que luego quitaron
  r = opcionesDeEdicion(activas.filter((t) => t.id !== "t-1"), { base: "CERAMIC_BRACKETS", label: "Brackets de zafiro", nombreVisible: "Brackets de zafiro" });
  assert.equal(r.seleccionadaId, ID_TECNICA_ACTUAL);
  assert.equal(r.opciones[0].nombre, "Brackets de zafiro (actual)");
  assert.equal(r.opciones[0].base, "CERAMIC_BRACKETS");
});

test("Cambiar aparatología guarda tipo base + nombre igual que el alta", () => {
  const cajon = sinComentarios(leer("components/specialties/orthodontics/redesign/drawers/DrawerEditPrescription.tsx"));
  assert.doesNotMatch(cajon, /TECHNIQUES\b/);
  assert.match(cajon, /listarTecnicasActivasDeLaClinica\(\)/);
  assert.match(cajon, /technique: elegida\?\.base \?\? c\.technique/);
  assert.match(cajon, /nombrePropioAGuardar\(activas\.find/);
  assert.match(cajon, /elegida\?\.id === ID_TECNICA_ACTUAL \? \(c\.techniqueLabel \?\? null\)/);
  const accion = sinComentarios(leer("app/actions/orthodontics/updateOrthoAppliances.ts"));
  assert.match(accion, /techniqueLabel: z\.string\(\)\.max\(80\)\.nullable\(\)\.optional\(\)/);
  assert.match(accion, /const \{ treatmentPlanId, techniqueLabel, \.\.\.rest \} = data/); // no va a Prisma
  assert.match(accion, /guardarNombreDeTecnicaDelCaso\(ctx\.clinicId, treatmentPlanId, techniqueLabel\)/);
  const lista = sinComentarios(leer("app/actions/orthodontics/listarTecnicasDeLaClinica.ts"));
  assert.match(lista, /getOrthoActionContext\(\{ write: false \}\)/);
  assert.match(lista, /leerTecnicasDeLaClinica\(ctx\.clinicId\)/);
  assert.match(leer("lib/orthodontics/redesign/adapter.ts"), /techniqueLabel: plan \? \(args\.techniqueLabel \?\? null\) : null/);
});

test("asistente viejo: sin costo escrito en el código; propone el precio de la técnica (vacío si no hay) y no deja seguir sin costo", () => {
  const w = sinComentarios(leer("components/specialties/orthodontics/plan/TreatmentPlanWizard.tsx"));
  assert.doesNotMatch(w, /45000|45_000/);
  assert.match(w, /\[totalCost, setTotalCost\] = useState\(""\)/);
  assert.match(w, /costoAProponer\(\{[^}]*precio: tecnica\?\.precio \?\? null/);
  assert.match(w, /tecnica !== null && costo !== null/);
  assert.match(w, /totalCostMxn: costo as number/);
});
