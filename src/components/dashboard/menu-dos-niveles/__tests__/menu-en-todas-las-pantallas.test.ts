/**
 * Menú de dos niveles — el MISMO menú en TODAS las pantallas del panel.
 *
 * Run: npm run test:menu-en-todas-las-pantallas
 *
 * El fallo que esto vigila (15-sep-2026, Local Altabrisa): con el interruptor
 * encendido, Configuración salía con el menú viejo y otras pantallas con el
 * nuevo, así que el menú cambiaba de forma al navegar. No había dos layouts: el
 * interruptor tenía un tope de 1,5 s y, como todas las consultas de una carga
 * van en fila por una sola conexión, en las pantallas pesadas perdía contra el
 * reloj y pintaba el menú de siempre.
 *
 * Lo que fija, para que no vuelva:
 *  1. El interruptor ESPERA a la base, tarde lo que tarde (reloj simulado: si
 *     alguien vuelve a poner un tope con setTimeout, esto falla).
 *  2. El layout de /dashboard es el ÚNICO sitio que pinta un menú del panel
 *     dental (el viejo o el nuevo). Una pantalla, layout anidado o ruta fuera de
 *     /dashboard que monte su propio <Sidebar>, <Topbar>, <MenuDosNiveles> o
 *     <TopbarDosNiveles> se saltaría el interruptor: falla.
 *  3. Dentro de ese layout, la elección del menú y la de la barra superior
 *     cuelgan de la MISMA variable, y esa variable sale del interruptor con la
 *     clínica de la sesión. Nada de elegir por ruta.
 *  4. Las únicas pantallas de /dashboard que salen SIN menú son las barreras
 *     previas al panel (2FA y cambio forzado de contraseña), igual que hoy. Si
 *     alguien añade otro `return` temprano en el layout, falla.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { crearInterruptor } from "@/lib/menu-dos-niveles/interruptor-core";

const RAIZ = join(__dirname, "..", "..", "..", "..", "..");
const LAYOUT = "src/app/dashboard/layout.tsx";

// ── 1. El interruptor no decide por reloj ────────────────────────────

test("interruptor: con la base lentísima (30 s de fila) una clínica encendida sigue viendo el menú nuevo", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const encendido = crearInterruptor({
    tablaExiste: () => new Promise((r) => setTimeout(() => r(true), 5_000)),
    leer: () => new Promise((r) => setTimeout(() => r({ enabled: true }), 30_000)),
  });
  let respuesta: boolean | "pendiente" = "pendiente";
  const carga = encendido("clinica-altabrisa").then((v) => { respuesta = v; });

  // Avanza el reloj de segundo en segundo. Cualquier tope interno de hasta 60 s
  // hecho con setTimeout salta ANTES que la base y devolvería `false`.
  for (let s = 0; s < 60 && respuesta === "pendiente"; s++) {
    await new Promise((r) => setImmediate(r));
    t.mock.timers.tick(1_000);
  }
  await carga;
  assert.equal(respuesta, true, "el menú no puede depender de cuánto tarda la base en contestar");
});

test("interruptor: cien cargas de pantallas distintas con la base a destiempo dan todas la misma respuesta", async () => {
  let n = 0;
  const encendido = crearInterruptor({
    tablaExiste: async () => true,
    // Cada lectura tarda distinto (0–40 ms): unas pantallas «ligeras» y otras «pesadas».
    leer: () => new Promise((r) => setTimeout(() => r({ enabled: true }), (n++ * 7) % 41)),
    ttlMs: 0, // sin caché: cada carga consulta, como la primera carga de cada pantalla
  });
  const respuestas = await Promise.all(Array.from({ length: 100 }, () => encendido("clinica-altabrisa")));
  assert.deepEqual(new Set(respuestas), new Set([true]));
});

// ── 2. Nadie más pinta un menú del panel ─────────────────────────────

const COMPONENTES_MENU: Record<string, string[]> = {
  "src/components/dashboard/sidebar": ["Sidebar"],
  "src/components/dashboard/topbar": ["Topbar"],
  "src/components/dashboard/menu-dos-niveles/menu-dos-niveles": ["MenuDosNiveles"],
  "src/components/dashboard/menu-dos-niveles/topbar-dos-niveles": ["TopbarDosNiveles"],
};

function archivosFuente(dir: string, out: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) {
      if (nombre === "node_modules" || nombre === "__tests__") continue;
      archivosFuente(ruta, out);
    } else if (/\.(ts|tsx)$/.test(nombre) && !/\.test\.tsx?$/.test(nombre)) {
      out.push(ruta);
    }
  }
  return out;
}

const aPosix = (p: string) => p.split(sep).join("/");

/** Módulo importado, normalizado a ruta del repo sin extensión (o null si es un paquete). */
function moduloDelRepo(desde: string, especificador: string): string | null {
  let ruta: string;
  if (especificador.startsWith("@/")) ruta = "src/" + especificador.slice(2);
  else if (especificador.startsWith(".")) ruta = aPosix(relative(RAIZ, join(desde, "..", especificador)));
  else return null;
  return ruta.replace(/\.(tsx?|jsx?)$/, "").replace(/\/index$/, "");
}

function parsear(ruta: string) {
  return ts.createSourceFile(ruta, readFileSync(ruta, "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
}

test("solo el layout de /dashboard monta un menú del panel (ninguna pantalla pinta el suyo)", () => {
  const infractores: string[] = [];
  for (const archivo of archivosFuente(join(RAIZ, "src"))) {
    const rel = aPosix(relative(RAIZ, archivo));
    if (rel === LAYOUT) continue;
    const fuente = parsear(archivo);
    const visitar = (nodo: ts.Node) => {
      // import { Sidebar } from "@/components/dashboard/sidebar"  (los `import type` no pintan nada)
      if (ts.isImportDeclaration(nodo) && ts.isStringLiteral(nodo.moduleSpecifier)) {
        const modulo = moduloDelRepo(archivo, nodo.moduleSpecifier.text);
        const vigilados = modulo ? COMPONENTES_MENU[modulo] : undefined;
        const clausula = nodo.importClause;
        if (vigilados && clausula && !clausula.isTypeOnly) {
          if (clausula.name) infractores.push(`${rel}: import por defecto de ${modulo}`);
          const nombrados = clausula.namedBindings;
          if (nombrados && ts.isNamespaceImport(nombrados)) infractores.push(`${rel}: import * de ${modulo}`);
          if (nombrados && ts.isNamedImports(nombrados)) {
            for (const el of nombrados.elements) {
              const original = (el.propertyName ?? el.name).text;
              if (!el.isTypeOnly && vigilados.includes(original)) infractores.push(`${rel}: importa ${original}`);
            }
          }
        }
      }
      // import("@/components/dashboard/sidebar") / next/dynamic
      if (
        ts.isCallExpression(nodo) &&
        nodo.expression.kind === ts.SyntaxKind.ImportKeyword &&
        nodo.arguments[0] && ts.isStringLiteral(nodo.arguments[0])
      ) {
        const modulo = moduloDelRepo(archivo, nodo.arguments[0].text);
        if (modulo && COMPONENTES_MENU[modulo]) infractores.push(`${rel}: import() dinámico de ${modulo}`);
      }
      ts.forEachChild(nodo, visitar);
    };
    visitar(fuente);
  }
  assert.deepEqual(
    infractores,
    [],
    "Estas pantallas montan un menú por su cuenta y se saltarían el interruptor (menú que cambia al navegar). " +
      "El menú cuelga SOLO de src/app/dashboard/layout.tsx.",
  );
});

// ── 3 y 4. Dentro del layout ─────────────────────────────────────────

function funcionDelLayout() {
  const fuente = parsear(join(RAIZ, LAYOUT));
  const fn = fuente.statements.find(
    (s): s is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(s) &&
      !!s.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword),
  );
  assert.ok(fn?.body, "el layout de /dashboard exporta por defecto una función");
  return { fuente, fn: fn! };
}

/** Recorre el cuerpo SIN entrar en funciones anidadas (sus return no son del layout). */
function recorrer(nodo: ts.Node, fn: (n: ts.Node) => void) {
  fn(nodo);
  ts.forEachChild(nodo, (hijo) => {
    if (ts.isFunctionLike(hijo)) return;
    recorrer(hijo, fn);
  });
}

const nombreEtiqueta = (n: ts.Node): string | null =>
  ts.isJsxSelfClosingElement(n) ? n.tagName.getText() : ts.isJsxElement(n) ? n.openingElement.tagName.getText() : null;

const quitarParentesis = (n: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(n) ? quitarParentesis(n.expression) : n;

test("el layout: las únicas pantallas sin menú son las barreras de 2FA y de cambio de contraseña", () => {
  const { fn } = funcionDelLayout();
  const returns: ts.ReturnStatement[] = [];
  recorrer(fn.body!, (n) => { if (ts.isReturnStatement(n)) returns.push(n); });
  assert.ok(returns.length >= 1);

  const tempranos = returns.slice(0, -1);
  const permitidas = new Set(["isTwoFaRoute", "isPasswordChangeRoute"]);
  for (const r of tempranos) {
    const devuelve = r.expression?.getText();
    const si = r.parent && ts.isIfStatement(r.parent) ? r.parent : null;
    const condicion = si?.expression.getText() ?? "(sin if)";
    assert.equal(
      devuelve,
      "minimalShell",
      `return temprano en el layout que no es la barrera mínima: «${r.getText()}». Una pantalla así sale sin el menú.`,
    );
    assert.ok(
      permitidas.has(condicion),
      `el layout sale sin menú para «${condicion}». Solo 2FA y el cambio forzado de contraseña pueden (son barreras previas al panel).`,
    );
  }
  assert.deepEqual(
    new Set(tempranos.map((r) => (r.parent as ts.IfStatement).expression.getText())),
    permitidas,
  );
});

test("el layout: menú y barra superior eligen con la MISMA variable, y esa variable es el interruptor de la clínica de la sesión", () => {
  const { fn } = funcionDelLayout();

  // Cada «x ? <A/> : <B/>» del JSX, con A/B alguno de los componentes del menú.
  const elecciones: { condicion: string; si: string | null; no: string | null }[] = [];
  const sueltos: string[] = [];
  recorrer(fn.body!, (n) => {
    if (ts.isConditionalExpression(n)) {
      const si = nombreEtiqueta(quitarParentesis(n.whenTrue));
      const no = nombreEtiqueta(quitarParentesis(n.whenFalse));
      if ([si, no].some((x) => x && ["Sidebar", "Topbar", "MenuDosNiveles", "TopbarDosNiveles"].includes(x))) {
        elecciones.push({ condicion: n.condition.getText(), si, no });
      }
    }
    const etiqueta = nombreEtiqueta(n);
    if (etiqueta && ["Sidebar", "Topbar", "MenuDosNiveles", "TopbarDosNiveles"].includes(etiqueta)) sueltos.push(etiqueta);
  });

  assert.deepEqual(
    elecciones.map(({ si, no }) => [si, no]),
    [["MenuDosNiveles", "Sidebar"], ["TopbarDosNiveles", "Topbar"]],
    "el layout pinta el menú y la barra superior con un único «encendido ? nuevo : de siempre» cada uno",
  );
  assert.deepEqual(sueltos.sort(), ["MenuDosNiveles", "Sidebar", "Topbar", "TopbarDosNiveles"], "cada componente, una sola vez");
  const variable = elecciones[0].condicion;
  assert.equal(elecciones[1].condicion, variable, "la barra superior y el menú no pueden elegir por separado");
  assert.match(variable, /^[A-Za-z_$][\w$]*$/, "la elección es una variable, no una expresión (nada de rutas)");

  // Esa variable es un const que sale del interruptor con clinic.id, y nadie la toca después.
  let origen: string | null = null;
  let reasignada = false;
  recorrer(fn.body!, (n) => {
    if (ts.isVariableDeclaration(n) && ts.isArrayBindingPattern(n.name) && n.initializer) {
      const idx = n.name.elements.findIndex((e) => ts.isBindingElement(e) && e.name.getText() === variable);
      if (idx >= 0) {
        const lista = n.parent;
        assert.ok(ts.isVariableDeclarationList(lista) && (lista.flags & ts.NodeFlags.Const), `${variable} es const`);
        let init = n.initializer;
        if (ts.isAwaitExpression(init)) init = init.expression;
        assert.ok(ts.isCallExpression(init) && init.expression.getText() === "Promise.all", "sale del Promise.all del layout");
        const arr = init.arguments[0];
        assert.ok(arr && ts.isArrayLiteralExpression(arr));
        origen = arr.elements[idx]?.getText() ?? null;
      }
    }
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === variable) {
      origen = n.initializer?.getText() ?? null;
    }
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      n.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      n.left.getText() === variable
    ) {
      reasignada = true;
    }
  });
  assert.equal(origen, "menuDosNivelesEncendido(clinic.id)", "la elección sale del interruptor con la clínica de la sesión");
  assert.equal(reasignada, false, `${variable} no se reasigna`);

  const clinica = readFileSync(join(RAIZ, LAYOUT), "utf8");
  assert.match(clinica, /const clinic = user\.clinic;/, "clinic es la de getCurrentUser (sesión), no del cliente");
});
