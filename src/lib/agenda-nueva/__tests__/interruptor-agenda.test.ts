/**
 * La red de seguridad del interruptor: con la bandera APAGADA, la agenda se
 * pinta exactamente como hoy.
 *
 * La garantía no es un parecido: es que la agenda nueva y la de siempre NO
 * comparten árbol de componentes. Si nada del rediseño se monta, nada del
 * rediseño puede cambiar un píxel de lo de antes. Esta suite vigila las tres
 * cosas que podrían romper esa garantía sin que nadie se entere:
 *
 *   1. que el rediseño siga colgando del interruptor por clínica y no de otra
 *      cosa (una variable de entorno, un `true` que alguien dejó puesto);
 *   2. que el camino de la bandera apagada siga montando el `AgendaShell` de
 *      siempre;
 *   3. que NADIE fuera de `agenda-nueva/` importe sus componentes — el día que
 *      un archivo compartido lo haga, el rediseño empieza a pintar en clínicas
 *      que lo tienen apagado.
 *
 * Es el mismo criterio con el que se vigila el menú de dos niveles.
 *
 * Run: npm run test:agenda-nueva-interruptor
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();

function leer(ruta: string): string {
  return readFileSync(join(RAIZ, ruta), "utf8");
}

const PAGE = "src/app/dashboard/agenda/page.tsx";
const CLIENT = "src/app/dashboard/agenda/agenda-page-client.tsx";

/* ── 1. De dónde sale el interruptor ───────────────────────────────────── */

test("la agenda nueva cuelga del interruptor POR CLÍNICA, no de otra cosa", () => {
  const page = leer(PAGE);
  assert.match(
    page,
    /import \{ menuDosNivelesEncendido \} from "@\/lib\/menu-dos-niveles\/interruptor"/,
    "page.tsx tiene que leer el interruptor de clinic_feature_flags",
  );
  assert.match(
    page,
    /menuDosNivelesEncendido\(clinic\.id\)/,
    "el clinicId sale de la sesión (clinic.id), nunca del cliente",
  );
  assert.match(page, /agendaNueva=\{agendaNueva\}/, "el resultado baja al cliente como prop");
});

test("el interruptor no se puede forzar desde el entorno ni queda cableado a true", () => {
  for (const ruta of [PAGE, CLIENT]) {
    const src = leer(ruta);
    assert.ok(
      !/process\.env\.\w*AGENDA\w*/i.test(src),
      `${ruta}: la agenda nueva no se enciende con una variable de entorno`,
    );
    assert.ok(
      !/agendaNueva\s*=\s*true/.test(src),
      `${ruta}: alguien dejó la agenda nueva encendida a mano`,
    );
  }
});

test("falla cerrado: sin clínica, sin tabla o con error, el interruptor da false", () => {
  // Lo garantiza `crearInterruptor`; aquí solo se comprueba que la agenda usa
  // ESE interruptor y no una lectura suya de la tabla por su cuenta.
  const page = leer(PAGE);
  assert.ok(
    !/clinicFeatureFlag/.test(page),
    "page.tsx no debe leer clinic_feature_flags a mano: para eso está el interruptor",
  );
});

/* ── 2. El camino de la bandera apagada ────────────────────────────────── */

test("con la bandera apagada se monta el AgendaShell de SIEMPRE", () => {
  const client = leer(CLIENT);
  // El ternario tiene que tener a AgendaShell en la rama del `else`.
  assert.match(
    client,
    /props\.agendaNueva\s*\?[\s\S]{0,300}<AgendaNueva[\s\S]{0,200}:\s*[\s\S]{0,200}<AgendaShell/,
    "el ternario del interruptor cambió de forma: revisa que apagado siga dando AgendaShell",
  );
  assert.match(client, /function AgendaShell\(/, "AgendaShell sigue existiendo");
});

test("las dos agendas cuelgan del MISMO proveedor de datos", () => {
  const client = leer(CLIENT);
  // Un solo <AgendaProvider>: si alguien duplicara el proveedor, las dos
  // agendas tendrían estados distintos y el interruptor dejaría de ser un
  // cambio de pintura para pasar a ser un cambio de comportamiento.
  const proveedores = client.match(/<AgendaProvider/g) ?? [];
  assert.equal(proveedores.length, 1, "tiene que haber exactamente un AgendaProvider");
});

/* ── 3. Nadie más monta el rediseño ────────────────────────────────────── */

function archivosFuenteBajo(dir: string): string[] {
  const salida: string[] = [];
  const recorrer = (d: string) => {
    for (const nombre of readdirSync(join(RAIZ, d))) {
      const rel = `${d}/${nombre}`;
      if (nombre === "node_modules" || nombre === ".next") continue;
      if (statSync(join(RAIZ, rel)).isDirectory()) {
        recorrer(rel);
      } else if (/\.(ts|tsx)$/.test(nombre)) {
        salida.push(rel);
      }
    }
  };
  recorrer(dir);
  return salida;
}

test("solo agenda-page-client importa la agenda nueva", () => {
  const permitidos = new Set([CLIENT]);
  const infractores: string[] = [];

  for (const ruta of archivosFuenteBajo("src")) {
    // Los propios archivos del rediseño se importan entre sí, claro.
    if (ruta.startsWith("src/components/dashboard/agenda-nueva/")) continue;
    if (ruta.startsWith("src/lib/agenda-nueva/")) continue;
    if (permitidos.has(ruta)) continue;

    const src = readFileSync(join(RAIZ, ruta), "utf8");
    if (/from ["']@\/components\/dashboard\/agenda-nueva\//.test(src)) {
      infractores.push(ruta);
    }
  }

  assert.deepEqual(
    infractores,
    [],
    `estos archivos montan la agenda nueva fuera del interruptor:\n  ${infractores.join("\n  ")}`,
  );
});

test("el rediseño no toca el CSS de la agenda de siempre", () => {
  const cssNuevo = leer("src/components/dashboard/agenda-nueva/agenda-nueva.module.css");
  // Es un módulo CSS propio: sus clases van con hash y no pueden alcanzar a
  // las del módulo antiguo. Lo único que sí escaparía es un selector global.
  //
  // La ÚNICA forma permitida es `:global(.dark) .clase`: la clase que pone
  // theme-toggle.tsx en <html> para el modo oscuro, y SIEMPRE seguida de una
  // clase local (con hash) de este módulo, que es lo que la ancla a la agenda
  // nueva. Es lo mismo que hace el menú (`:global(.dark) .tokens`). Un
  // `:global(.dark)` suelto, o un `:global(otra-cosa)`, sigue prohibido.
  const sinComentarios = cssNuevo.replace(/\/\*[\s\S]*?\*\//g, "");
  const globales = [...sinComentarios.matchAll(/:global\s*\(([^)]*)\)\s*([^\s,{]*)/g)];
  const fueraDeLugar = globales
    .filter((m) => m[1].trim() !== ".dark" || !/^\.[a-zA-Z]/.test(m[2]))
    .map((m) => m[0]);
  assert.deepEqual(
    fueraDeLugar,
    [],
    "un :global() en el CSS del rediseño puede pintar fuera de la agenda nueva; solo vale `:global(.dark) .claseLocal`",
  );
  // Ni reglas sobre elementos desnudos a nivel raíz del archivo.
  assert.ok(
    !/^(body|html|\*)\s*\{/m.test(cssNuevo),
    "el CSS del rediseño no puede tocar body/html/*",
  );
});

/* ── 4. Los nueve estados, de punta a punta ────────────────────────────── */

test("el mapa de pintas cubre los nueve estados del enum de Prisma", () => {
  const schema = leer("prisma/schema.prisma");
  const bloque = /enum AppointmentStatus \{([^}]*)\}/.exec(schema);
  assert.ok(bloque, "no se encontró el enum AppointmentStatus en el schema");

  const delSchema = bloque[1]!
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, "").trim())
    .filter((l) => /^[A-Z_]+$/.test(l));

  const estados = leer("src/lib/agenda-nueva/estados.ts");
  const sinPinta = delSchema.filter((e) => !new RegExp(`^\\s{2}${e}:`, "m").test(estados));

  // `PENDING` es legacy y el TIPO de la app no lo expone, así que no puede
  // estar en el `Record`. Pero existe en la base y es el valor por defecto de
  // la columna, así que tiene que estar cubierto por el normalizador — si no,
  // una sola fila así tumba la vista (lo encontró el revisor).
  const reales = sinPinta.filter((e) => e !== "PENDING");
  assert.deepEqual(
    reales,
    [],
    `estados del enum sin pinta decidida en estados.ts: ${reales.join(", ")}`,
  );

  if (delSchema.includes("PENDING")) {
    assert.match(
      estados,
      /export function estadoNormalizado/,
      "PENDING está en el enum: hace falta el normalizador que lo lleve a SCHEDULED",
    );
    assert.match(
      estados,
      /export function pintaDeEstado/,
      "PENDING está en el enum: hace falta pintaDeEstado para no indexar el mapa a pelo",
    );
  }
});

/**
 * Todos los archivos del rediseño, SIN la lista a mano.
 *
 * Se recorren las dos carpetas enteras a propósito: así las vistas Semana y
 * Mes de ws1-t2 quedan cubiertas por estas redes en cuanto se integren, sin
 * que nadie tenga que acordarse de añadirlas aquí. Una red que hay que
 * actualizar a mano es una red que un día se queda corta.
 */
function archivosDelRediseno(): string[] {
  return [
    ...archivosFuenteBajo("src/lib/agenda-nueva"),
    ...archivosFuenteBajo("src/components/dashboard/agenda-nueva"),
  ].filter((r) => !r.includes("/__tests__/") && !r.endsWith("/estados.ts"));
}

test("nadie indexa PINTA_POR_ESTADO a pelo: para eso está pintaDeEstado", () => {
  // Indexar el mapa directamente con un estado que venga de la base es
  // exactamente lo que hacía que una fila `PENDING` dejara la pinta en
  // `undefined` y tumbara el render entero.
  const infractores = archivosDelRediseno().filter((r) => /PINTA_POR_ESTADO\s*\[/.test(leer(r)));
  assert.deepEqual(
    infractores,
    [],
    `usa pintaDeEstado(...) en vez de PINTA_POR_ESTADO[...] en:\n  ${infractores.join("\n  ")}`,
  );
});

test("nadie compara estados de cita con cadenas sueltas", () => {
  // `status === "SCHEDULED"` deja fuera al `PENDING` legacy, que es
  // exactamente una cita sin confirmar: la nota «N sin confirmar» del Mes
  // decía cero con cinco dentro. Para eso están `esSinConfirmar`,
  // `citaContada` y `citaViva`, que normalizan primero.
  const literales = /\.\s*status\s*[!=]==\s*["'](SCHEDULED|CANCELLED|NO_SHOW|PENDING)["']/;
  const infractores = archivosDelRediseno().filter((r) => literales.test(leer(r)));
  assert.deepEqual(
    infractores,
    [],
    `compara .status con una cadena; usa los predicados de estados.ts en:\n  ${infractores.join("\n  ")}`,
  );
});

/* ── 5. La bandera no puede cambiar el resultado FISCAL ────────────────── */

test("el régimen fiscal de la clínica llega hasta el cobro de la agenda nueva", () => {
  // El fallo que encontró el revisor: el panel nuevo cableaba
  // `clinicTaxMode={null}`, y con `null` el cobro resuelve «exento». Una
  // clínica con IVA timbraba su CFDI sin desglose SOLO por tener la bandera
  // encendida — una diferencia fiscal producida por un interruptor de diseño.
  const client = leer(CLIENT);
  assert.match(
    client,
    /<AgendaNueva[^>]*clinicTaxMode=\{props\.clinicTaxMode\}/,
    "AgendaNueva tiene que recibir el clinicTaxMode que ya calcula el servidor",
  );

  const panel = leer("src/components/dashboard/agenda-nueva/panel-cita.tsx");
  assert.ok(
    !/clinicTaxMode=\{null\}/.test(panel),
    "el panel no puede cablear clinicTaxMode a null: timbraría exento",
  );
  assert.match(
    panel,
    /clinicTaxMode=\{clinicTaxMode\}/,
    "el modal de cobro tiene que recibir el régimen de la clínica",
  );
  // Y sin valor por defecto: un `= null` lo devolvería al mismo sitio.
  assert.ok(
    !/clinicTaxMode\s*=\s*null/.test(panel),
    "clinicTaxMode no puede tener null por defecto",
  );
});

test("las dos agendas reciben el MISMO régimen fiscal", () => {
  // Las dos ramas del interruptor salen del mismo `props.clinicTaxMode`, así
  // que el CFDI no puede depender de qué agenda esté encendida.
  const client = leer(CLIENT);
  const usos = client.match(/clinicTaxMode=\{props\.clinicTaxMode\}/g) ?? [];
  assert.equal(usos.length, 2, "una por rama del interruptor: agenda nueva y AgendaShell");
});

test("el rol de quien mira baja hasta el panel", () => {
  // Sin rol, `possibleTransitions` solo filtra por la forma de la máquina de
  // estados y ofrece botones que el servidor rechaza con 403.
  const page = leer(PAGE);
  assert.match(page, /userRole=\{user\.role\}/, "el rol sale de la sesión");
  const panel = leer("src/components/dashboard/agenda-nueva/panel-cita.tsx");
  assert.match(
    panel,
    /possibleTransitions\(\s*estadoNormalizado\(dto\.status\),\s*\{\s*role: userRole/,
    "possibleTransitions tiene que recibir el rol",
  );
});
