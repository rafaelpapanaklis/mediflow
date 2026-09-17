/**
 * CANDADOS DE «BLOQUES SIN VESTIR» (ws1-t5, hallazgos 14 y 21).
 *
 * Run: npx tsx --test src/components/dashboard/bloques-rediseno/__tests__/bloques-rediseno.test.ts
 *
 * Se prueba leyendo el código fuente, como `hoy-rediseno.test.ts`: lo que se
 * vigila es CABLEADO —que la carpeta nueva no invente tokens ni letra de
 * máquina, que cada bloque entre a la ropa nueva SOLO con `rediseno`, que el
 * camino viejo siga escrito tal cual, que los textos y destinos sean los
 * mismos—, y eso se ve en el archivo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..", "..");           // src/
const CARPETA = join(SRC, "components", "dashboard", "bloques-rediseno");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const archivosNuevos = readdirSync(CARPETA)
  .filter((f) => /\.(tsx?|css)$/.test(f))
  .map((f) => ({ nombre: f, texto: readFileSync(join(CARPETA, f), "utf8") }));

const css = archivosNuevos.find((a) => a.nombre === "bloques.module.css")!.texto;

// ═══════════════════════════════════════════════════════════════════════════
// Instrument Sans en el 100 %: ni una letra de máquina en la carpeta nueva
// ═══════════════════════════════════════════════════════════════════════════
// La palabra prohibida se arma en trozos para que un grep sobre la carpeta
// (el gate de cierre: «cero letra de máquina») no se tope con este archivo.
const LETRA_DE_MAQUINA = new RegExp(["font-", "mono", "|", "ui-", "mono", "space", "|", "mono", "space"].join(""));

test("sin letra de máquina en la carpeta del rediseño", () => {
  assert.ok(archivosNuevos.length >= 6, "faltan archivos en la carpeta del rediseño");
  for (const a of archivosNuevos) {
    assert.ok(
      !LETRA_DE_MAQUINA.test(a.texto),
      `${a.nombre} usa letra de máquina; las cifras van con tabular-nums sobre Instrument Sans`,
    );
  }
  assert.match(css, /font-variant-numeric:\s*tabular-nums/, "las cifras se alinean con tabular-nums");
});

// ═══════════════════════════════════════════════════════════════════════════
// Sin tokens nuevos: la hoja solo LEE los del menú (--m2-*) y los de globals
// ═══════════════════════════════════════════════════════════════════════════
test("bloques.module.css no declara ninguna variable CSS propia", () => {
  const declaraciones = css.match(/^\s*--[a-z0-9-]+\s*:/gim) ?? [];
  assert.deepEqual(declaraciones, [], `declara tokens propios: ${declaraciones.join(", ")}`);
  assert.match(css, /var\(--m2-/, "lee los tokens del menú");
});

test("todo hex de la carpeta es un respaldo DENTRO de un var(), nunca un color suelto", () => {
  for (const a of archivosNuevos) {
    const sueltos = a.texto
      .split("\n")
      .filter((l) => /#[0-9a-f]{6}\b/i.test(l) && !/var\(--/.test(l));
    assert.deepEqual(sueltos, [], `${a.nombre}: colores a mano: ${sueltos.join(" | ")}`);
  }
  // Y en los .tsx ni siquiera eso: el color vive en la hoja.
  for (const a of archivosNuevos.filter((x) => x.nombre.endsWith(".tsx"))) {
    assert.ok(!/#[0-9a-f]{6}\b/i.test(a.texto), `${a.nombre} lleva un hex`);
    assert.ok(!/rgba?\(/.test(a.texto), `${a.nombre} lleva un rgba a mano`);
  }
});

test("la carpeta nueva es ropa: sin fetch, sin librerías de UI, y no toca clases.ts", () => {
  for (const a of archivosNuevos) {
    assert.ok(!/fetch\(/.test(a.texto), `${a.nombre} hace un fetch propio: la lógica vive en el componente de siempre`);
    assert.ok(!/@radix-ui|@headlessui|@mui|antd|chakra/.test(a.texto), `${a.nombre} mete una librería de UI`);
  }
  const clases = leer("components/dashboard/menu-dos-niveles/clases.ts");
  assert.match(clases, /export const CLASES_MENU = \[s\.tokens, instrumentSans\.variable, materialSymbols\.variable\]\.join\(" "\);/, "clases.ts es compartido: no se toca");
  // Las piezas que viven fuera de una raíz montan CLASES_MENU ellas mismas.
  const salidas = leer("components/dashboard/bloques-rediseno/salidas.tsx");
  assert.match(salidas, /from "@\/components\/dashboard\/menu-dos-niveles\/clases"/, "salidas.tsx importa clases.ts del menú");
  assert.equal((salidas.match(/\$\{CLASES_MENU\}/g) ?? []).length, 3, "las tres salidas montan CLASES_MENU");
});

// ═══════════════════════════════════════════════════════════════════════════
// Hoy: el aviso de cupo de IA y el checklist entran a la ropa nueva con la
// bandera de la página, y conservan su camino de siempre
// ═══════════════════════════════════════════════════════════════════════════
test("page.tsx baja la bandera al aviso de IA y al checklist, y los sigue montando primero", () => {
  const page = leer("app/dashboard/page.tsx");
  assert.match(page, /<AiQuotaBanner rediseno=\{rediseno\} \/>/, "el aviso de IA no recibe la bandera");
  assert.match(page, /<OnboardingChecklist completed=\{onboardingCompleted\} clinicId=\{clinic\.id\} rediseno=\{rediseno\} \/>/, "el checklist no recibe la bandera");
  // Son lo primero que se ve cada mañana: van ANTES del conmutador admin/doctor.
  assert.ok(page.indexOf("<AiQuotaBanner") < page.indexOf("<OnboardingChecklist"), "el aviso va antes del checklist");
  assert.ok(page.indexOf("<OnboardingChecklist") < page.indexOf("<HomeClientSwitch"), "el checklist va antes del contenido");
  // La bandera sigue siendo la compartida, leída una vez por vista.
  assert.match(page, /from "@\/lib\/menu-dos-niveles\/interruptor"/, "usa el interruptor compartido");
  assert.equal((page.match(/menuDosNivelesEncendido\(clinic\.id\)/g) ?? []).length, 4, "una lectura por vista");
});

test("el checklist conserva su camino de siempre y solo entra al nuevo con rediseno", () => {
  const src = leer("components/dashboard/onboarding-checklist.tsx");
  assert.match(src, /rediseno = false/, "la bandera no cae en false por defecto");
  assert.match(src, /if \(rediseno\) \{\s*return \(\s*<ChecklistRediseno/, "el rediseño no está detrás de la bandera");
  // El camino viejo, tal cual.
  assert.match(src, /<div className="mb-6 bg-card border border-border rounded-2xl overflow-hidden shadow-sm">/, "el camino viejo ya no está");
  assert.match(src, /<span className="text-base">🚀<\/span>/, "el camino viejo cambió");
  // El estado y el descarte por clínica siguen en el componente de siempre.
  assert.match(src, /localStorage\.setItem\(`onboarding-dismissed-\$\{clinicId\}`, "1"\)/, "el descarte por clínica cambió");

  const nuevo = leer("components/dashboard/bloques-rediseno/checklist.tsx");
  assert.match(nuevo, /from "@\/components\/dashboard\/onboarding-steps"/, "la vista nueva lee los MISMOS pasos (STEPS)");
  for (const clave of ["shell.onboardingChecklist.title", "shell.onboardingChecklist.completedCount", "shell.onboarding.${paso.id}Label", "shell.onboarding.${paso.id}Desc"]) {
    assert.ok(nuevo.includes(clave), `la vista nueva perdió el texto ${clave}`);
  }
  // Con la bandera, la agenda es la nueva (hallazgo 2): el paso «Agenda una
  // cita» manda a /dashboard/agenda; la lista STEPS (que lee la home de
  // siempre) no se toca.
  assert.match(nuevo, /const AGENDA_VIEJA = "\/dashboard\/appointments";/, "la vista nueva no reconoce la agenda vieja");
  assert.match(nuevo, /const AGENDA_NUEVA = "\/dashboard\/agenda";/, "la vista nueva no manda a la agenda nueva");
  assert.match(nuevo, /href=\{destinoConBandera\(paso\.href\)\}/, "los pasos no pasan por destinoConBandera");
  const steps = leer("components/dashboard/onboarding-steps.ts");
  assert.ok(steps.includes('href: "/dashboard/appointments"'), "STEPS cambió: la home de siempre manda a la agenda de siempre");
});

test("el aviso de cupo de IA conserva su camino de siempre y solo entra al nuevo con rediseno", () => {
  const src = leer("components/dashboard/ai-quota-banner.tsx");
  assert.match(src, /rediseno = false/, "la bandera no cae en false por defecto");
  assert.match(src, /if \(rediseno\) \{\s*return <AvisoCupoIaRediseno agotado=\{isFull\} porcentaje=\{percent\} onDescartar=\{dismiss\} \/>;/, "el rediseño no está detrás de la bandera");
  // Todo lo que decide si se pinta va ANTES de la bandera: los dos caminos
  // salen en los mismos casos.
  const bandera = src.indexOf("if (rediseno) {");
  for (const guarda of ["if (!hydrated || !usage) return null;", "if (!usage.isAdmin) return null;", "if (percent < WARN_AT) return null;", "if (isDismissed) return null;"]) {
    const i = src.indexOf(guarda);
    assert.ok(i > -1 && i < bandera, `la guarda «${guarda}» no está antes de la bandera`);
  }
  // El camino viejo, tal cual.
  assert.match(src, /const accent = isFull \? "var\(--danger\)" : "var\(--warning\)";/, "el camino viejo ya no está");
  assert.match(src, /className="flex flex-wrap items-start gap-3 mb-4"/, "el camino viejo cambió");
  // El asistente de IA lo monta SIN bandera, igual que hoy.
  const asistente = leer("app/dashboard/ai-assistant/ai-assistant-client.tsx");
  assert.match(asistente, /<AiQuotaBanner usage=\{quota\} \/>/, "el asistente cambió cómo monta el aviso");

  const nuevo = leer("components/dashboard/bloques-rediseno/aviso-cupo-ia.tsx");
  assert.ok(nuevo.includes('href="/dashboard/settings?tab=ia"'), "la vista nueva perdió el destino del CTA");
  for (const clave of ["shell.aiQuotaBanner.fullTitle", "shell.aiQuotaBanner.warnTitle", "shell.aiQuotaBanner.fullBody", "shell.aiQuotaBanner.warnBody", "shell.aiQuotaBanner.cta", "shell.aiQuotaBanner.dismiss"]) {
    assert.ok(nuevo.includes(`"${clave}"`), `la vista nueva perdió el texto ${clave}`);
  }
  assert.match(nuevo, /role=\{agotado \? "alert" : "status"\}/, "el rol accesible cambió");
});

// ═══════════════════════════════════════════════════════════════════════════
// La gráfica de ingresos: con la bandera lee los --m2-*, sin ella los
// literales de siempre; la tarjeta nueva de Hoy se la pide encendida
// ═══════════════════════════════════════════════════════════════════════════
test("la gráfica de ingresos viste tooltip, ejes y trazo solo con rediseno", () => {
  const src = leer("components/dashboard/revenue-area-chart.tsx");
  assert.match(src, /rediseno = false/, "la bandera no cae en false por defecto");
  assert.match(src, /const c = rediseno \? COLORES\.rediseno : COLORES\.clasico;/, "no elige los colores con la bandera");
  // El camino viejo: exactamente los valores que llevaba escritos.
  const clasico = src.slice(src.indexOf("clasico: {"), src.indexOf("rediseno: {"));
  for (const v of ['tinta: "var(--brand)"', 'rejilla: "var(--border-soft)"', 'eje: "var(--text-4)"', 'fondo: "var(--bg-elev)"', 'borde: "var(--border-soft)"', 'texto: "var(--text-1)"', 'texto3: "var(--text-3)"', 'sombra: "var(--shadow-2)"']) {
    assert.ok(clasico.includes(v), `el camino viejo perdió ${v}`);
  }
  // El gradiente de siempre sigue escrito con su hex literal (tres paradas)
  // y el nuevo es OTRO gradiente que solo existe con la bandera.
  assert.equal((src.match(/stopColor="#[0-9a-f]{6}"/g) ?? []).length, 3, "el gradiente de siempre cambió");
  assert.match(src, /const rellenoId = rediseno \? `\$\{gradientId\}-m2` : gradientId;/, "el relleno no elige el gradiente con la bandera");
  assert.match(src, /\{rediseno && \(\s*<linearGradient id=\{rellenoId\}[\s\S]*?stopColor=\{c\.tinta\}/, "el gradiente nuevo no lee el violeta del menú");
  assert.match(src, /fill=\{`url\(#\$\{rellenoId\}\)`\}/, "el área no rellena con el gradiente elegido");
  // El tooltip viejo, literal.
  assert.match(src, /\} : \{\s*background: "var\(--bg-elev\)",\s*border: "1px solid var\(--border-soft\)",\s*borderRadius: 10,\s*fontSize: 12,\s*color: "var\(--text-1\)",\s*boxShadow: "var\(--shadow-2\)",\s*padding: "8px 10px",\s*\}\}/, "el tooltip de siempre cambió");
  // El nuevo solo lee tokens del menú.
  const nuevo = src.slice(src.indexOf("rediseno: {"), src.indexOf("} as const;"));
  assert.ok(!/var\(--(brand|text|bg|border|shadow)/.test(nuevo), "el camino nuevo lee tokens viejos");
  assert.ok(!/#[0-9a-f]{6}/i.test(nuevo), "el camino nuevo lleva un hex");
  // Hoy (rediseño) la monta encendida; la home de siempre, sin la prop.
  const tarjeta = leer("components/dashboard/hoy-rediseno/tarjeta-ingresos.tsx");
  assert.match(tarjeta, /<GraficaIngresos data=\{datos\.series\} rediseno \/>/, "la tarjeta nueva de Hoy no enciende la gráfica");
  const vieja = leer("components/dashboard/home/parts/revenue-trend-card.tsx");
  assert.ok(!/rediseno/.test(vieja), "la home de siempre no debe saber de la bandera");
});

// ═══════════════════════════════════════════════════════════════════════════
// Suscripción: el camino viejo sigue escrito; el nuevo dice lo mismo y hace
// lo mismo (mismas claves i18n, mismas funciones), incluido «Cancelar suscripción»
// ═══════════════════════════════════════════════════════════════════════════
test("settings-client baja la bandera a Suscripción solo desde su camino nuevo", () => {
  const src = leer("app/dashboard/settings/settings-client.tsx");
  assert.equal((src.match(/<SubscriptionTab clinic=\{clinic\} rediseno \/>/g) ?? []).length, 1, "el rediseño no enciende la pestaña");
  assert.equal((src.match(/<SubscriptionTab clinic=\{clinic\} \/>/g) ?? []).length, 1, "el camino viejo cambió cómo monta la pestaña");
  assert.ok(src.indexOf("<SubscriptionTab clinic={clinic} rediseno />") < src.indexOf("<SubscriptionTab clinic={clinic} />"), "el orden de los dos caminos cambió");
});

test("la pestaña Suscripción conserva su camino de siempre y arma el modelo del nuevo con las mismas funciones", () => {
  const src = leer("components/dashboard/subscription-tab.tsx");
  assert.match(src, /rediseno = false/, "la bandera no cae en false por defecto");
  const bandera = src.indexOf("if (rediseno) {");
  const viejo = src.indexOf('<div className="space-y-5 max-w-3xl">');
  assert.ok(bandera > -1 && viejo > bandera, "el rediseño no está delante del camino viejo");
  const nuevo = src.slice(bandera, viejo);
  // Las mismas funciones, ni una nueva.
  for (const fn of ["openConfirm", "applyPlanChange", "handleRequestCancel", "setPaymentModalOpen(true)", "setCancelOpen(true)", "setCancelOpen(false)", "setConfirmPlan(null)", 'router.push("/dashboard/suspended")', "renderConfirmBody(ROPA_DESGLOSE)", "cfdiBullet(plan)", "paypalLinkFor(currentPlanId)"]) {
    assert.ok(nuevo.includes(fn), `el rediseño no cablea ${fn}`);
  }
  assert.ok(!/fetch\(/.test(nuevo), "el rediseño hace un fetch propio");
  // El camino viejo, tal cual: la sección de estado, el modal a mano y sus botones.
  const resto = src.slice(viejo);
  assert.match(resto, /className="bg-card border border-border rounded-2xl p-6"/, "las secciones de siempre cambiaron");
  assert.match(resto, /<button type="button" onClick=\{handleRequestCancel\} disabled=\{cancelling\} className="btn-new btn-new--danger">/, "el botón «Sí, cancelar» de siempre cambió");
  assert.match(resto, /background: "rgba\(0,0,0,0\.7\)", backdropFilter: "blur\(4px\)",/, "el velo de siempre cambió");
  // Las mismas claves i18n en los dos caminos (el nuevo vive en dos archivos).
  const vista = leer("components/dashboard/bloques-rediseno/suscripcion.tsx");
  const clavesViejas = new Set([...resto.matchAll(/"(shell\.subscriptionTab\.[a-zA-Z]+)"/g)].map((m) => m[1]));
  assert.ok(clavesViejas.size > 30, `se esperaban muchas claves, hay ${clavesViejas.size}`);
  const faltan = [...clavesViejas].filter((k) => !vista.includes(`"${k}"`) && !nuevo.includes(`"${k}"`));
  assert.deepEqual(faltan, [], `el rediseño perdió los textos: ${faltan.join(", ")}`);
  // «Cancelar suscripción»: mismo disparador, misma frase, mismo botón final.
  assert.match(vista, /onClick=\{m\.onPedirCancelar\}>\s*\{t\("shell\.subscriptionTab\.cancelSubscription"\)\}/, "el botón «Cancelar suscripción» ya no abre lo mismo");
  assert.match(vista, /onClick=\{m\.onConfirmarCancelar\} disabled=\{m\.cancelando\}/, "el «Sí, cancelar» nuevo no dispara la misma función");
  assert.match(vista, /cancelModalBodyStart"\)\}\{" "\}\s*<strong>\{m\.finPrueba && m\.formatFecha\(m\.finPrueba\)\}<\/strong>\{t\("shell\.subscriptionTab\.cancelModalBodyEnd"\)\}/, "la frase del modal de cancelación cambió");
  assert.match(nuevo, /onConfirmarCancelar: handleRequestCancel,/, "onConfirmarCancelar no es handleRequestCancel");
  // El desglose del cobro: con ropa lleva clases, sin ella sus style de siempre.
  assert.match(src, /function renderConfirmBody\(ropa\?: RopaDesglose\)/, "renderConfirmBody no acepta la ropa");
  assert.match(src, /ropa \? \{ className: ropa\[pieza\] \} : \{ style: clasico \}/, "vestir() ya no conserva el style de siempre");
  assert.match(src, /vestir\(\{ display: "inline-flex", alignItems: "center", gap: 8 \}, "cargando"\)/, "el spinner de siempre perdió su style");
});

test("la tarjeta CFDI conserva su camino de siempre y el nuevo usa las mismas claves", () => {
  const src = leer("components/dashboard/cfdi-usage-card.tsx");
  assert.match(src, /rediseno = false/, "la bandera no cae en false por defecto");
  assert.match(src, /if \(rediseno\) \{\s*return <CfdiRediseno m=\{data \? modeloCfdi\(data, t\) : null\} \/>;/, "el rediseño no está detrás de la bandera");
  assert.match(src, /className="bg-card border border-border rounded-2xl p-6"/, "el camino viejo ya no está");
  assert.match(src, /fetch\("\/api\/cfdi\/usage"\)/, "la petición cambió");
  const viejo = src.slice(src.indexOf("function CfdiBody("));
  const modelo = src.slice(src.indexOf("function modeloCfdi("), src.indexOf("function CfdiBody("));
  const claves = new Set([...viejo.matchAll(/"(shell\.subscriptionTab\.[a-zA-Z]+)"/g)].map((m) => m[1]));
  const vista = leer("components/dashboard/bloques-rediseno/cfdi.tsx");
  const faltan = [...claves].filter((k) => !modelo.includes(`"${k}"`) && !vista.includes(`"${k}"`));
  assert.deepEqual(faltan, [], `el rediseño perdió los textos: ${faltan.join(", ")}`);
  assert.ok(viejo.includes("`shell.subscriptionTab.${collectKey}`") && modelo.includes("`shell.subscriptionTab.${collectKey}`"), "la nota de cobro cambió de clave");
});

// ═══════════════════════════════════════════════════════════════════════════
// Salidas (hallazgo 21): un umbral en el idioma nuevo, y las pantallas
// viejas intactas
// ═══════════════════════════════════════════════════════════════════════════
test("Ortodoncia: la banda solo con rediseno, el ancho no salta, y el módulo no se toca", () => {
  const src = leer("app/dashboard/patients/[id]/patient-detail-client.tsx");
  assert.match(src, /const outerMaxWidth = isOrthoTab && !rediseno \? 1920 : 1760;/, "el ancho de siempre (1920 en Ortodoncia) ya no se conserva sin bandera");
  assert.match(src, /\{tab === "ortodoncia" && orthoRedesignVM && rediseno && \(\s*<SalidaOrtodoncia titulo=\{t\("patients\.tabs\.ortodoncia"\)\} paciente=\{fullName\} \/>\s*\)\}/, "la banda no está detrás de la bandera");
  // El módulo se monta igual que siempre, justo debajo.
  assert.match(src, /\{tab === "ortodoncia" && orthoRedesignVM && \(\s*<OrthodonticsRedesignClient/, "el módulo de Ortodoncia cambió cómo se monta");
  // Ni un archivo del módulo importa la carpeta nueva.
  const modulo = leer("components/specialties/orthodontics/redesign/OrthodonticsRedesignClient.tsx");
  assert.ok(!/bloques-rediseno|rediseno=/.test(modulo), "el módulo de Ortodoncia no debe saber del rediseño");
});

test("Mi Clínica 3D: la página lee la bandera en su Promise.all y solo viste espera y aviso", () => {
  const page = leer("app/dashboard/clinic-layout/3d/page.tsx");
  assert.match(page, /from "@\/lib\/menu-dos-niveles\/interruptor"/, "usa el interruptor compartido, no uno propio");
  assert.equal((page.match(/menuDosNivelesEncendido\(user\.clinicId\)/g) ?? []).length, 1, "una sola lectura, con el clinicId de la sesión");
  assert.match(page, /Promise\.all\(\[[\s\S]*menuDosNivelesEncendido\(user\.clinicId\),?[\s\S]*\]\)/, "la lectura va en el Promise.all, no en cascada");
  assert.match(page, /rediseno=\{rediseno\}/, "no baja la bandera al montaje");
  assert.match(page, /if \(rediseno\) \{\s*return \(\s*<Error3D/, "el aviso nuevo no está detrás de la bandera");
  // El aviso de siempre, tal cual, y con los mismos destinos.
  assert.match(page, /<h1 className="text-lg font-semibold text-gray-900">Mi Clínica 3D no está disponible<\/h1>/, "el aviso de siempre cambió");
  for (const d of ['"/dashboard/clinic-layout/3d"', '"/dashboard/clinic-layout"']) {
    assert.equal((page.match(new RegExp(d.replace(/[/]/g, "\\/"), "g")) ?? []).length, 2, `el destino ${d} no está en los dos caminos`);
  }
  const mount = leer("app/dashboard/clinic-layout/3d/Clinic3DMount.tsx");
  assert.match(mount, /rediseno = false/, "la bandera no cae en false por defecto");
  assert.match(mount, /return rediseno \? <Clinic3DClientVestido \{\.\.\.props\} \/> : <Clinic3DClient \{\.\.\.props\} \/>;/, "el montaje no elige con la bandera");
  // Los dos montajes cargan el MISMO visor; el visor no recibe la bandera.
  assert.equal((mount.match(/import\("@\/components\/clinic-3d\/Clinic3DClient"\)/g) ?? []).length, 2, "los dos caminos no cargan el mismo visor");
  assert.match(mount, /className="flex min-h-\[70vh\] items-center justify-center bg-\[#[0-9a-f]{6}\] text-white\/70"/, "la espera de siempre cambió");
  const visor = leer("components/clinic-3d/Clinic3DClient.tsx");
  assert.ok(!/rediseno|bloques-rediseno/.test(visor), "el visor 3D no debe saber del rediseño");
  const hud = leer("components/clinic-3d/Clinic3DHud.tsx");
  assert.ok(!/rediseno|bloques-rediseno/.test(hud), "el HUD del 3D no debe saber del rediseño");
});

// ═══════════════════════════════════════════════════════════════════════════
// Toda clave i18n que usa la carpeta nueva existe en los dos diccionarios
// ═══════════════════════════════════════════════════════════════════════════
test("todas las claves t(\"…\") de la carpeta nueva existen en es.json y en en.json", () => {
  const es = JSON.parse(leer("i18n/dictionaries/es.json")) as Record<string, unknown>;
  const en = JSON.parse(leer("i18n/dictionaries/en.json")) as Record<string, unknown>;
  const existe = (dict: Record<string, unknown>, clave: string): boolean => {
    let nodo: unknown = dict;
    for (const parte of clave.split(".")) {
      if (!nodo || typeof nodo !== "object" || !(parte in (nodo as object))) return false;
      nodo = (nodo as Record<string, unknown>)[parte];
    }
    if (nodo && typeof nodo === "object") {
      const formas = nodo as Record<string, unknown>;
      return typeof formas.one === "string" && typeof formas.other === "string";
    }
    return typeof nodo === "string";
  };
  const claves = new Set<string>();
  for (const a of archivosNuevos) {
    for (const m of a.texto.matchAll(/\bt\(\s*"([a-zA-Z0-9_.]+)"/g)) claves.add(m[1]);
    for (const m of a.texto.matchAll(/labelKey:\s*"([a-zA-Z0-9_.]+)"/g)) claves.add(m[1]);
  }
  // Y las que la ficha le pasa a la banda de Ortodoncia.
  claves.add("patients.tabs.ortodoncia");
  assert.ok(claves.size > 40, `se esperaban decenas de claves, hay ${claves.size}`);
  const faltan = [...claves].filter((k) => !existe(es, k) || !existe(en, k));
  assert.deepEqual(faltan, [], `claves sin traducción: ${faltan.join(", ")}`);
});
