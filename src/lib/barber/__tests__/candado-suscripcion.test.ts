// ═══════════════════════════════════════════════════════════════════════
// EL CANDADO DE SUSCRIPCIÓN — la prueba que impide que la próxima pantalla
// del panel nazca gratis.
//
// EL BUG: una barbería en "pending_payment" aterrizaba en
// /barber/suscripcion con el MENÚ COMPLETO al lado. Un clic en Agenda,
// Clientes o Caja y estaba dentro, trabajando, sin haber pagado nunca. El
// candado vivía en dos pantallas sueltas (/barber, que es solo el router, y
// /barber/inicio) y las otras veinticuatro no lo tenían. Nadie lo notó
// porque NADA se rompe: cada pantalla renderiza perfecta, con datos reales.
//
// Por qué el candado no puede vivir en el layout del panel: ese layout
// envuelve TAMBIÉN a /barber/suscripcion y no sabe en qué ruta está
// (src/middleware.ts no cubre /barber → no hay header x-pathname que leer).
// Cortar ahí es un bucle infinito contra la pantalla donde se paga. Así que
// el candado es POR PÁGINA, y una regla por página solo se sostiene si algo
// la vigila. Eso es este archivo.
//
// Estas pruebas son ESTÁTICAS (leen el código fuente): no necesitan
// Postgres, ni navegador, ni sesión. Corren en medio segundo.
//
//   npx tsx --test src/lib/barber/__tests__/candado-suscripcion.test.ts
// ═══════════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(__dirname, "..", "..", "..", ".."); // → raíz del repo
const PANEL = join(RAIZ, "src", "app", "barber", "(panel)");

const HELPER = "src/lib/barber/paid-access.ts";
const LAYOUT = "src/app/barber/(panel)/layout.tsx";

/** El nombre exacto del candado. Si se renombra, esta prueba lo grita. */
const CANDADO = "requireBarberPaidAccess";
const MODULO_CANDADO = "@/lib/barber/paid-access";

// ── LAS ÚNICAS PANTALLAS EXENTAS, escritas a mano y con su porqué ───────
//
// Se enumeran AQUÍ, no se deducen: agregar una exención tiene que costar
// editar esta lista y explicar por qué, no simplemente "olvidar" la línea
// en la página nueva.
const EXENTAS: { ruta: string; porque: string }[] = [
  {
    ruta: "suscripcion",
    porque: "es la pantalla DONDE SE PAGA — bloquearla es un bucle infinito contra sí misma",
  },
  {
    ruta: "soporte",
    porque: "una barbería impaga tiene que poder pedir ayuda, igual que en el dental",
  },
];

const RUTAS_EXENTAS = new Set(EXENTAS.map((e) => `${e.ruta}/page.tsx`));

function leer(rel: string): string {
  return readFileSync(join(RAIZ, rel), "utf8");
}

/** Borra comentarios SIN mover líneas: la prosa menciona el nombre del candado. */
function sinComentarios(fuente: string): string {
  return fuente
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, antes: string) => antes + " ".repeat(m.length - antes.length));
}

/** Todas las page.tsx del grupo (panel), en ruta relativa al propio grupo. */
function paginasDelPanel(dir: string = PANEL, prefijo = ""): string[] {
  const out: string[] = [];
  for (const entrada of readdirSync(dir).sort()) {
    const abs = join(dir, entrada);
    const rel = prefijo ? `${prefijo}/${entrada}` : entrada;
    if (statSync(abs).isDirectory()) out.push(...paginasDelPanel(abs, rel));
    else if (entrada === "page.tsx") out.push(rel);
  }
  return out;
}

// ── 1. El módulo del candado existe y hace lo que dice ──────────────────

test("el candado vive en un módulo APARTE de gating.ts y manda a /barber/suscripcion", () => {
  assert.ok(existsSync(join(RAIZ, HELPER)), `falta ${HELPER}`);
  const fuente = sinComentarios(leer(HELPER));

  assert.match(
    fuente,
    new RegExp(`export async function ${CANDADO}\\b`),
    `${HELPER} ya no exporta ${CANDADO} — si lo renombraste, actualiza esta prueba y las 24 páginas`,
  );
  assert.match(
    fuente,
    /redirect\((BARBER_PAID_REDIRECT|"\/barber\/suscripcion")\)/,
    `${HELPER} tiene que redirigir a /barber/suscripcion`,
  );
  assert.ok(
    fuente.includes("isBarbershopSubscriptionActive"),
    `${HELPER} tiene que usar isBarbershopSubscriptionActive (la fuente ÚNICA del estado), no su propia lista de estados`,
  );
  assert.ok(
    fuente.includes("parentId"),
    `${HELPER} tiene que resolver la MATRIZ (parentId) como loadRootShop en gating.ts: quien paga es la raíz de la cadena`,
  );

  // Y NO puede haberse metido dentro de gating.ts: ese módulo lo importan
  // rutas de API, y un redirect() ahí lanza NEXT_REDIRECT dentro de un
  // endpoint — no redirige a nadie, revienta la petición.
  const gating = sinComentarios(leer("src/lib/barber/gating.ts"));
  assert.ok(
    !gating.includes("next/navigation"),
    "gating.ts importó next/navigation: lo usan rutas de API y un redirect() ahí lanza NEXT_REDIRECT dentro del endpoint",
  );
});

// ── 2. TODA página del panel llama al candado (salvo las exentas) ───────

test("cada page.tsx del panel llama al candado, salvo las dos exentas", () => {
  const paginas = paginasDelPanel();

  // Red de seguridad del propio recorrido: si alguien mueve la carpeta y
  // aquí dejan de salir páginas, la prueba pasaría en verde sin comprobar
  // NADA — que es exactamente el modo de fallar que estamos previniendo.
  assert.ok(
    paginas.length >= 20,
    `solo se encontraron ${paginas.length} páginas bajo (panel) — el recorrido se quedó ciego`,
  );

  const sinCandado: string[] = [];
  const sinImport: string[] = [];

  for (const rel of paginas) {
    if (RUTAS_EXENTAS.has(rel)) continue;
    const fuente = sinComentarios(leer(`src/app/barber/(panel)/${rel}`));
    if (!new RegExp(`await\\s+${CANDADO}\\s*\\(`).test(fuente)) sinCandado.push(rel);
    else if (!fuente.includes(MODULO_CANDADO)) sinImport.push(rel);
  }

  assert.deepEqual(
    sinCandado,
    [],
    `estas pantallas del panel se abren SIN PAGAR. Pon \`await ${CANDADO}(ctx);\` justo después ` +
      `del guard de sesión (import desde "${MODULO_CANDADO}"), o añádelas a EXENTAS con su porqué: ` +
      sinCandado.join(", "),
  );
  assert.deepEqual(
    sinImport,
    [],
    `llaman a ${CANDADO} pero no lo importan de "${MODULO_CANDADO}": ${sinImport.join(", ")}`,
  );
});

test("el candado corre ANTES de cargar datos, no después", () => {
  // Comprobar sólo "la llamada existe" deja pasar el bug de verdad: llamarla
  // al final, cuando la pantalla ya leyó la agenda, la caja y los clientes
  // de una barbería que no ha pagado. Dentro del componente, los dos
  // primeros await tienen que ser la sesión y el candado.
  const tarde: string[] = [];
  for (const rel of paginasDelPanel()) {
    if (RUTAS_EXENTAS.has(rel)) continue;
    const fuente = sinComentarios(leer(`src/app/barber/(panel)/${rel}`));
    const i = fuente.indexOf("export default async function");
    const cuerpo = i === -1 ? fuente : fuente.slice(i);
    // Array.from y no spread: el tsconfig del repo no fija `target` (TS2802).
    const awaits = Array.from(cuerpo.matchAll(/await\s+([A-Za-z_$][\w$.]*)/g)).map((m) => m[1]);
    if (awaits[0] !== "getBarberContext" || awaits[1] !== CANDADO) {
      tarde.push(`${rel} (await: ${awaits.slice(0, 3).join(" → ") || "ninguno"})`);
    }
  }
  assert.deepEqual(
    tarde,
    [],
    `el candado tiene que ser el segundo await del componente, justo después de getBarberContext: ${tarde.join(", ")}`,
  );
});

// ── 3. Las exentas siguen existiendo — y siguen siendo exentas por algo ──

test("las dos exentas existen y suscripcion NO se bloquea a sí misma", () => {
  for (const { ruta, porque } of EXENTAS) {
    const rel = `src/app/barber/(panel)/${ruta}/page.tsx`;
    assert.ok(
      existsSync(join(RAIZ, rel)),
      `la exención "${ruta}" (${porque}) apunta a una página que ya no existe — limpia la lista EXENTAS`,
    );
  }

  // Ésta es dura: si alguien cablea el candado en la pantalla de pago, la
  // barbería impaga entra en un bucle de redirecciones y NO PUEDE PAGAR.
  const suscripcion = sinComentarios(leer("src/app/barber/(panel)/suscripcion/page.tsx"));
  assert.ok(
    !suscripcion.includes(CANDADO),
    "/barber/suscripcion llama al candado: eso es un bucle infinito contra la pantalla donde se paga",
  );
});

// ── 4. El menú tampoco miente cuando no se ha pagado ────────────────────

test("el layout del panel recorta el menú con barberNavItemsWhileUnpaid", () => {
  const layout = sinComentarios(leer(LAYOUT));

  assert.ok(
    layout.includes("barberNavItemsWhileUnpaid"),
    `${LAYOUT} tiene que recortar el menú con barberNavItemsWhileUnpaid (helper YA probado de plan-shared), ` +
      "no escribir otro filtro",
  );
  assert.ok(
    layout.includes("hasBarberPaidAccess"),
    `${LAYOUT} tiene que preguntar por hasBarberPaidAccess — la MISMA regla que corta las páginas`,
  );

  // El recorte va ANTES del filtro de plan/permiso: si fuera después, un
  // empleado sin billing.manage vería el menú VACÍO y sin una sola pista.
  const iRecorte = layout.indexOf("barberNavItemsWhileUnpaid");
  const iPermiso = layout.indexOf("hasBarberPermission(permUser");
  assert.ok(
    iRecorte !== -1 && iPermiso !== -1 && iRecorte < iPermiso,
    `${LAYOUT}: el recorte por impago va ANTES del filtro de permiso/feature`,
  );
  assert.match(
    layout,
    /item\.key === "suscripcion"/,
    `${LAYOUT} tiene que dejar ver Suscripción aunque el rol no tenga billing.manage: si no, la barbería ` +
      "impaga ve un menú vacío y ni siquiera sabe que le falta pagar",
  );

  // Y el layout NO puede cortar: envuelve también a /barber/suscripcion.
  assert.ok(
    !layout.includes("/barber/suscripcion"),
    `${LAYOUT} redirige a /barber/suscripcion: envuelve TAMBIÉN a esa pantalla y no sabe en qué ruta está ` +
      "(el middleware no cubre /barber) → bucle infinito",
  );
});
