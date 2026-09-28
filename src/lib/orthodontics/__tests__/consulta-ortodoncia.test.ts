/**
 * «Nueva consulta» de tipo Ortodoncia y las plantillas de nota de la hoja de
 * control (Rafael, 28-sep-2026).
 *
 * Run: npx tsx --test src/lib/orthodontics/__tests__/consulta-ortodoncia.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HUECO,
  aplicarPlantillaAlControl,
  debeAbrirLaHoja,
  destinoDeConsultaOrto,
  huecosPorLlenar,
  rellenarMarcadores,
  type ContextoDeControl,
} from "../consulta-ortodoncia";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");
const sinComentarios = (c: string) => c.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

// Las plantillas viven junto a su sembrador, que importa Prisma: aquí se leen
// del archivo para no necesitar base de datos.
const SEMILLA = leer("src/lib/clinical-shared/evolution-templates/seed-orthodontics.ts");
const PLANTILLAS = Array.from(
  SEMILLA.matchAll(/name: "([^"]+)",[\s\S]*?soap: \{\s*S: "([^"]*)",\s*O: "([^"]*)",\s*A: "([^"]*)",\s*P: "([^"]*)",/g),
  (m) => ({ nombre: m[1], soap: { S: m[2], O: m[3], A: m[4], P: m[5] } }),
);

const CONTEXTO: ContextoDeControl = {
  mes: 4,
  duracionMeses: 18,
  fase: "Alineación y nivelación",
  arcoActual: "NiTi .014",
  arcoNuevo: "NiTi .016",
};
const VACIA = { s: "", o: "", a: "", p: "" };

// ── A dónde lleva elegir «Ortodoncia» ────────────────────────────────────

test("caso activo: se abre su hoja de control", () => {
  assert.equal(destinoDeConsultaOrto({ vista: "completa", tienePlan: true, estado: "en-tratamiento" }), "hoja-de-control");
  assert.equal(destinoDeConsultaOrto({ vista: "completa", tienePlan: true, estado: "retencion" }), "hoja-de-control");
});

test("nunca tuvo caso: se ofrece «Abrir caso de ortodoncia»", () => {
  assert.equal(destinoDeConsultaOrto({ vista: "solo-abrir-caso", tienePlan: false, estado: null }), "abrir-caso");
  const limpia = leer("src/components/specialties/orthodontics/redesign/OrtodonciaSinCaso.tsx");
  assert.match(limpia, /Abrir caso de ortodoncia/);
  assert.match(limpia, /La consulta de ortodoncia se registra en la hoja de control de su caso\./);
  // Se OFRECE: llegar desde Nueva consulta no abre el asistente por su cuenta.
  const efecto = limpia.slice(limpia.indexOf("if (!vieneDeNuevaConsulta) return;"), limpia.indexOf("}, [vieneDeNuevaConsulta]);"));
  assert.doesNotMatch(efecto, /setAltaAbierta/);
});

test("con historial pero sin caso en marcha: se enseña su pestaña, sin abrir hoja", () => {
  assert.equal(destinoDeConsultaOrto({ vista: "completa", tienePlan: false, estado: "no-iniciado" }), "ver-caso", "solo valoración");
  assert.equal(destinoDeConsultaOrto({ vista: "completa", tienePlan: true, estado: "completado" }), "ver-caso", "caso terminado");
  assert.equal(destinoDeConsultaOrto({ vista: "completa", tienePlan: true, estado: "no-iniciado" }), "ver-caso");
  assert.equal(debeAbrirLaHoja({ tienePlan: false, estado: "en-tratamiento" }), false, "sin plan no hay hoja");
  assert.equal(destinoDeConsultaOrto({ vista: "oculta", tienePlan: true, estado: "en-tratamiento" }), null, "sin módulo no hay «Ortodoncia»");
});

test("la hoja que se abre es la de «Registrar control», y el aviso se apaga", () => {
  const ficha = sinComentarios(leer("src/components/specialties/orthodontics/redesign/OrthodonticsRedesignClient.tsx"));
  assert.match(ficha, /const casoActivo = debeAbrirLaHoja\(\{ tienePlan: Boolean\(t\.treatmentPlanId\), estado: t\.status \}\);/);
  // Ronda 6 (ws1-t8, hallazgo 6): «Nueva consulta → Ortodoncia» ya no abre el
  // cajón en blanco directo — pasa por `abrirRegistrarControl`, que resuelve
  // la cita de control de HOY (mismo cargador que la Agenda) antes de abrir.
  assert.match(ficha, /if \(casoActivo\) void abrirRegistrarControl\(\);\s*onControlAbierto\?\.\(\);/);
  assert.match(ficha, /const abrirRegistrarControl = useCallback\(async \(\) => \{/);
  assert.match(ficha, /getTreatmentCardContextForPatient\(t\.treatmentPlanId\)/);
  // El mismo cajón que abre el botón «Registrar control» de la cabecera —
  // UNA sola función, no un setDrawer directo repetido por cada botón.
  assert.match(ficha, /onStartControl=\{\s*t\.status !== "no-iniciado" \? abrirRegistrarControl : undefined/);
  assert.equal(
    (ficha.match(/<DrawerTreatmentCard\b/g) ?? []).length,
    4,
    "reabrir una hoja guardada, continuar la de hoy, nueva con cita, y el respaldo sin cita ligada — nada más",
  );
});

// ── Las seis plantillas ──────────────────────────────────────────────────

test("las seis plantillas de ortodoncia existen, con sus cuatro campos", () => {
  assert.deepEqual(
    PLANTILLAS.map((p) => p.nombre),
    ["Cementado de brackets", "Activación de arco", "Control mensual general", "Cambio de alineador", "Retiro de brackets", "Entrega de retenedor"],
  );
  for (const p of PLANTILLAS) for (const c of ["S", "O", "A", "P"] as const) assert.ok(p.soap[c].length > 20, `${p.nombre} · ${c}`);
});

test("están conectadas a la hoja de control, con el selector que ya existía", () => {
  const hoja = sinComentarios(leer("src/components/specialties/orthodontics/redesign/drawers/DrawerTreatmentCard.tsx"));
  assert.match(hoja, /import \{ EvolutionTemplatePicker \} from "@\/components\/clinical-shared\/EvolutionTemplatePicker";/);
  assert.match(hoja, /<EvolutionTemplatePicker\s+module="orthodontics"\s+ensureDefaults\s+onApply=\{\(plantilla\) => aplicarPlantilla\(plantilla\.soapTemplate\)\}/);
  // Solo mientras la hoja se puede editar: una hoja firmada no se toca.
  assert.match(hoja, /\{!isReadOnly \? \(\s*<span className=\{orto\.plantillas\}>/);
  // `ensureDefaults` es lo que siembra las seis la primera vez, en la clínica de la sesión.
  const accion = leer("src/app/actions/clinical-shared/evolution-templates.ts");
  assert.match(accion, /await ensureOrthoDefaults\(\{ clinicId: ctx\.clinicId, createdBy: ctx\.userId \}\);/);
  assert.match(accion, /where: \{\s*clinicId: ctx\.clinicId,\s*module: parsed\.data\.module,/);
  // Un fallo al listar no tumba la hoja.
  const selector = leer("src/components/clinical-shared/EvolutionTemplatePicker.tsx");
  assert.match(selector, /\} catch \{[\s\S]{0,260}setError\("No se pudieron cargar las plantillas\."\);/);
});

test("ninguna plantilla deja un marcador {{así}} en la nota del paciente", () => {
  for (const p of PLANTILLAS) {
    for (const contexto of [CONTEXTO, { mes: null, duracionMeses: null, fase: null, arcoActual: null, arcoNuevo: null }]) {
      const nota = aplicarPlantillaAlControl(VACIA, p.soap, contexto);
      for (const campo of [nota.s, nota.o, nota.a, nota.p]) {
        assert.doesNotMatch(campo, /\{\{|\}\}/, p.nombre);
        assert.ok(campo.length > 20, p.nombre);
      }
    }
  }
});

test("lo que la hoja sabe se rellena; lo que no, queda como hueco a la vista", () => {
  const control = PLANTILLAS.find((p) => p.nombre === "Control mensual general")!;
  const nota = aplicarPlantillaAlControl(VACIA, control.soap, CONTEXTO);
  assert.match(nota.a, /Mes 4 de 18\. Fase actual: Alineación y nivelación\./);
  assert.match(nota.s, new RegExp(`refiere ${HUECO}\\.`), "lo que refiere el paciente lo escribe el doctor");

  const activacion = PLANTILLAS.find((p) => p.nombre === "Activación de arco")!;
  assert.match(aplicarPlantillaAlControl(VACIA, activacion.soap, CONTEXTO).p, /^Cambio a arco NiTi \.016\./);
  assert.match(aplicarPlantillaAlControl(VACIA, activacion.soap, { ...CONTEXTO, arcoNuevo: null }).p, /^Cambio a arco ____\./);

  assert.equal(rellenarMarcadores("Mes {{ monthInTreatment }} · {{noExiste}}", CONTEXTO), "Mes 4 · ____");
  assert.equal(rellenarMarcadores("Sin marcadores.", CONTEXTO), "Sin marcadores.");
  assert.equal(rellenarMarcadores("{{currentPhase}}", { ...CONTEXTO, fase: "   " }), HUECO, "un dato en blanco también es un hueco");
});

test("aplicar una plantilla NO pisa lo que el doctor ya escribió", () => {
  const escrita = { s: "Refiere molestia en el 24.", o: "", a: "", p: "Revisar en 2 semanas.  " };
  const nota = aplicarPlantillaAlControl(escrita, PLANTILLAS[2].soap, CONTEXTO);
  assert.ok(nota.s.startsWith("Refiere molestia en el 24.\n\nControl mensual rutinario."));
  assert.ok(nota.p.startsWith("Revisar en 2 semanas.\n\nContinuar con plan establecido."));
  assert.ok(nota.o.startsWith("Aparatología íntegra."), "un campo vacío recibe la plantilla tal cual");
});

test("se cuentan los huecos que quedan por llenar", () => {
  assert.equal(huecosPorLlenar(VACIA), 0);
  assert.equal(huecosPorLlenar({ s: "a ____ b", o: "____ y ____", a: "nada", p: "" }), 3);
  const hoja = leer("src/components/specialties/orthodontics/redesign/drawers/DrawerTreatmentCard.tsx");
  assert.match(hoja, /const huecos = huecosPorLlenar\(state\.soap\);/);
  // Desde la ficha la hoja sabe cuánto dura el caso: «Mes 4 de 18», sin hueco.
  assert.match(hoja, /duracionMeses: props\.defaultsForNew\?\.monthTotal \?\? null,/);
  const ficha = leer("src/components/specialties/orthodontics/redesign/OrthodonticsRedesignClient.tsx");
  assert.match(ficha, /monthTotal: t\.monthTotal > 0 \? t\.monthTotal : null,/);
  // Fila 12: los huecos pueden venir de la plantilla o de la nota precargada.
  assert.match(hoja, /Queda 1 hueco \(____\) por llenar\./);
});
