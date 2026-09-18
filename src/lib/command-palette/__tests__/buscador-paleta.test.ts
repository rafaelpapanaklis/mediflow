/**
 * EL BUSCADOR DEL TOPBAR (la paleta de comandos) — ws1-t2.
 *
 * Run: npm run test:buscador-paleta
 *
 * Rafael: «si lo abro y escribo "c" me manda a otro lado, no busca pacientes».
 * Tres causas, y las tres se vigilan aquí:
 *
 *  1. La paleta trataba C/N/I/T/S con el input vacío como ATAJOS (Nueva cita…)
 *     y la primera letra siempre cae con el input vacío → «c» cerraba la
 *     paleta y abría «Nueva cita».
 *  2. El API exigía 2 letras: «c» devolvía vacío.
 *  3. El API comparaba la cadena ENTERA contra nombre o apellido: «Ana Pérez»
 *     no encontraba a nadie.
 *
 * Dos clases de prueba, como en patient-search-core.test.ts: lógica pura
 * sobre terminos-busqueda.ts, y guardas sobre el CÓDIGO FUENTE de la paleta,
 * la ruta y los topbars (lo que se vigila es cableado y no se puede montar
 * sin navegador ni base). Con el código anterior al arreglo fallan.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LARGO_MINIMO_BUSQUEDA,
  terminosBusqueda,
  condicionesCitas,
  condicionesFacturas,
  condicionesPacientesRespaldo,
} from "../terminos-busqueda";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const PALETA = "components/dashboard/command-palette.tsx";
const RUTA = "app/api/dashboard/search/route.ts";
const ATAJOS = "lib/command-palette/shortcuts.ts";
const BARRA_VIEJA = "components/dashboard/topbar.tsx";
const BARRA_NUEVA = "components/dashboard/menu-dos-niveles/topbar-dos-niveles.tsx";

// ═══════════════════════════════════════════════════════════════════════════
// 1 · Con la paleta abierta, una letra BUSCA: no hay atajos de una tecla dentro
// ═══════════════════════════════════════════════════════════════════════════
test("la paleta no trata letras sueltas como atajos con el input vacío", () => {
  const paleta = leer(PALETA);
  assert.ok(!paleta.includes("shortcutMap"), "sigue el mapa c/n/i/t → acción dentro de handleKeyDown");
  assert.ok(!/query\.trim\(\) === ""\s*&&\s*!e\.metaKey/.test(paleta), "sigue la rama «input vacío → atajo»");
  assert.ok(!paleta.includes('it.id === "active:soap"'), "la S sigue disparando la nota SOAP desde el input");
  assert.ok(!paleta.includes("pressShortcuts"), "el pie sigue diciendo «o presiona C/N/I/T», que ya no es verdad");
  // Si el foco se fue a la lista, la letra vuelve al input en vez de perderse.
  assert.match(paleta, /e\.key\.length === 1[\s\S]{0,200}inputRef\.current\?\.focus\(\)/, "una letra con el foco fuera del input no vuelve al input");
});

test("los atajos de una letra siguen vivos con la paleta CERRADA y apagados con ella abierta", () => {
  const atajos = leer(ATAJOS);
  assert.match(atajos, /export function useCreateShortcuts/, "useCreateShortcuts desapareció");
  assert.match(atajos, /export function useGoToShortcuts/, "useGoToShortcuts desapareció");
  assert.match(atajos, /if \(isTypingContext\(\)\) return;/, "los atajos globales ya no respetan un input con foco");
  for (const barra of [BARRA_VIEJA, BARRA_NUEVA]) {
    const src = leer(barra);
    assert.match(src, /const modalsClosed = !paletteOpen && !shortcutsOpen;/, `${barra}: modalsClosed cambió`);
    assert.match(src, /useGoToShortcuts\(\{ enabled: modalsClosed/, `${barra}: G+letra ya no se apaga con la paleta abierta`);
    assert.match(src, /useCreateShortcuts\(\{\s*enabled: modalsClosed/, `${barra}: C/N/I/T ya no se apagan con la paleta abierta`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · Una sola letra ya busca
// ═══════════════════════════════════════════════════════════════════════════
test("el API acepta una sola letra", () => {
  assert.equal(LARGO_MINIMO_BUSQUEDA, 1);
  const ruta = leer(RUTA);
  assert.ok(!ruta.includes("q.length < 2"), "la ruta sigue exigiendo 2 letras: «c» devuelve vacío");
  assert.match(ruta, /q\.length < LARGO_MINIMO_BUSQUEDA/, "la ruta no usa el mínimo compartido");
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 · Un nombre completo encuentra al paciente (y sus citas y facturas)
// ═══════════════════════════════════════════════════════════════════════════
test("terminosBusqueda parte por espacios y nunca deja términos vacíos", () => {
  assert.deepEqual(terminosBusqueda("  Ana   Pérez "), ["Ana", "Pérez"]);
  assert.deepEqual(terminosBusqueda("c"), ["c"]);
  assert.deepEqual(terminosBusqueda("MF-0072"), ["MF-0072"]);
  assert.deepEqual(terminosBusqueda("   "), []);
  assert.deepEqual(terminosBusqueda(null), []);
});

test("citas: cada término es un AND y dentro va el OR de nombre/apellido del paciente", () => {
  const conds = condicionesCitas(["Ana", "Pérez"]);
  assert.equal(conds.length, 2, "un AND por término");
  assert.deepEqual(conds[0], {
    OR: [
      { patient: { firstName: { contains: "Ana", mode: "insensitive" } } },
      { patient: { lastName: { contains: "Ana", mode: "insensitive" } } },
    ],
  });
  assert.deepEqual(conds[1], {
    OR: [
      { patient: { firstName: { contains: "Pérez", mode: "insensitive" } } },
      { patient: { lastName: { contains: "Pérez", mode: "insensitive" } } },
    ],
  });
});

test("facturas: cada término casa en el folio o en el paciente; los campos son los de siempre", () => {
  const [c] = condicionesFacturas(["72"]);
  assert.deepEqual(c, {
    OR: [
      { invoiceNumber: { contains: "72", mode: "insensitive" } },
      { patient: { firstName: { contains: "72", mode: "insensitive" } } },
      { patient: { lastName: { contains: "72", mode: "insensitive" } } },
    ],
  });
  assert.equal(condicionesFacturas(["Ana", "Pérez"]).length, 2);
});

test("pacientes (respaldo): los mismos cinco campos que la ruta miraba antes", () => {
  const [c] = condicionesPacientesRespaldo(["P0042"]);
  const campos = c.OR!.map((o) => Object.keys(o)[0]).sort();
  assert.deepEqual(campos, ["email", "firstName", "lastName", "patientNumber", "phone"]);
  assert.equal(condicionesPacientesRespaldo(["Ana", "Pérez"]).length, 2);
});

test("la ruta parte la búsqueda en términos y busca pacientes con el criterio compartido", () => {
  const ruta = leer(RUTA);
  assert.match(ruta, /const terminos = terminosBusqueda\(q\)/, "la ruta no parte la búsqueda");
  assert.match(ruta, /condicionesCitas\(terminos\)/, "las citas siguen comparando la cadena entera");
  assert.match(ruta, /condicionesFacturas\(terminos\)/, "las facturas siguen comparando la cadena entera");
  assert.match(ruta, /findPatientIdsBySearch\(\{\s*clinicIds: \[ctx\.clinicId\]/, "los pacientes no usan la búsqueda normalizada (sin acentos, teléfono limpio)");
  assert.match(ruta, /condicionesPacientesRespaldo\(terminos\)/, "sin respaldo si la consulta normalizada falla");
  assert.ok(!ruta.includes("{ firstName: ci }"), "sigue el `firstName contains <cadena entera>`");
  // Los permisos no se mueven: clinicId de la sesión y visibilidad por paciente en AND.
  assert.match(ruta, /patientVisibilityAnd\(viewer\)/);
  assert.match(ruta, /relatedPatientVisibilityAnd\(viewer\)/);
  assert.equal((ruta.match(/clinicId: ctx\.clinicId/g) ?? []).length, 5, "alguna consulta perdió su clinicId");
  assert.ok(!ruta.includes("searchParams.get(\"clinicId\")"), "el clinicId nunca sale del cliente");
});
