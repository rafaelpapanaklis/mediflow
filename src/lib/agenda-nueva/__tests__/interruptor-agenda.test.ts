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
    /props\.agendaNueva\s*\?[\s\S]{0,200}<AgendaNueva\s*\/>[\s\S]{0,200}:\s*[\s\S]{0,200}<AgendaShell/,
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
  assert.ok(
    !/:global\s*\(/.test(cssNuevo),
    "un :global() en el CSS del rediseño puede pintar fuera de la agenda nueva",
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

  // `PENDING` es legacy y el tipo de la app ya no lo expone; si apareciera
  // cualquier OTRO estado sin pinta, es justo el fallo que hay que evitar.
  const reales = sinPinta.filter((e) => e !== "PENDING");
  assert.deepEqual(
    reales,
    [],
    `estados del enum sin pinta decidida en estados.ts: ${reales.join(", ")}`,
  );
});
