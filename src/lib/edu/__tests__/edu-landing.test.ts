// ═══════════════════════════════════════════════════════════════════════
// LANDING /instituciones — pruebas ESTÁTICAS (sin base de datos, sin
// navegador). Entran solas en `npm run test:edu`.
//
//   npx tsx --test src/lib/edu/__tests__/edu-landing.test.ts
//
// Esto es material que lee la dirección de una escuela ANTES de firmar un
// contrato, así que la landing no se vigila a ojo. Las reglas:
//
//   1. CADA PROMESA APUNTA A CÓDIGO QUE EXISTE. Si alguien borra o
//      renombra un módulo del vertical, la promesa que lo citaba deja de
//      pasar la prueba antes de que la página mienta.
//   2. UNA PROMESA SIN CÓDIGO TIENE QUE DECLARARSE. `contrato: true` es la
//      única puerta, y es para términos comerciales (el almacenamiento
//      incluido, la IA por contrato, el manager). Sin esa marca, una
//      promesa sin archivos es un fallo.
//   3. CERO PRECIOS. Ni un signo de pesos con cifra, ni una cantidad en
//      moneda, en ningún archivo de la landing ni en el copy.
//   4. VOCABULARIO. Se dice "estudiante" (nunca "alumno") y "especialidad"
//      (nunca "programa"); jamás "Ola N", que es lenguaje interno.
//   5. LO QUE NO SE PUEDE DECIR. La lista de
//      EDU_LANDING_PALABRAS_PROHIBIDAS —certificaciones que no existen,
//      facturación fiscal, infraestructura, presencia de personas, la
//      unidad radiológica que este producto no calcula— no aparece en
//      ningún archivo de la landing, ni siquiera en un comentario.
//   6. EL TELÉFONO DEL MANAGER VIVE EN UN SOLO SITIO. Si aparece escrito
//      a mano en un componente, falla.
//   7. LA LANDING NO IMPORTA EL PANEL. Ni prisma, ni "server-only", ni el
//      tema CSS del vertical: es una página pública y se sirve estática.
// ═══════════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  EDU_LANDING_ANCHORS,
  EDU_LANDING_COPY,
  EDU_LANDING_DINERO,
  EDU_LANDING_EXPEDIENTE,
  EDU_LANDING_FAQ,
  EDU_LANDING_FLUJO,
  EDU_LANDING_PADRON,
  EDU_LANDING_PALABRAS_PROHIBIDAS,
  EDU_LANDING_PATH,
  EDU_LANDING_PRECIO_PROHIBIDO,
  EDU_LANDING_PROBLEMAS,
  EDU_LANDING_ROLES,
  EDU_LANDING_SEDES,
  EDU_LANDING_SEO,
  EDU_LANDING_VOCABULARIO,
  EDU_LOGIN_PATH,
  EDU_MANAGER,
  EDU_PLAN_INCLUYE,
  eduManagerDisplayPhone,
  eduManagerWaHref,
  serializeEduJsonLd,
  type EduClaim,
} from "@/lib/edu/marketing";
import { EDU_RUTAS_NO_INDEXADAS, eduLandingUrl, eduStaticSitemapPaths } from "@/lib/edu/seo";

const RAIZ = join(__dirname, "..", "..", "..", "..");

/** Los archivos que forman la landing. */
const LANDING_DIRS = ["src/app/instituciones", "src/components/public/instituciones"];

/**
 * marketing.ts es donde VIVEN las listas de palabras prohibidas y de
 * vocabulario, así que en el barrido de archivos se salta a sí mismo (misma
 * solución que la landing de barberías). Su texto NO queda sin vigilar: la
 * prueba 4 recorre el copy exportado, que es todo lo que se pinta.
 */
const MARKETING = "src/lib/edu/marketing.ts";
const SEO = "src/lib/edu/seo.ts";

function recorrer(dir: string, out: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const p = join(dir, entrada);
    if (statSync(p).isDirectory()) recorrer(p, out);
    else out.push(p);
  }
  return out;
}

/** Rutas relativas al repo, con barras normales. */
function archivosLanding(): string[] {
  const out: string[] = [];
  for (const d of LANDING_DIRS) out.push(...recorrer(join(RAIZ, d)));
  out.push(join(RAIZ, MARKETING), join(RAIZ, SEO));
  return out.map((p) => p.slice(RAIZ.length + 1).replace(/\\/g, "/"));
}

function leer(rel: string): string {
  return readFileSync(join(RAIZ, rel), "utf8");
}

/** Todas las promesas de la página, de un solo lugar. */
function todasLasPromesas(): EduClaim[] {
  return [
    ...EDU_LANDING_FLUJO,
    ...EDU_LANDING_EXPEDIENTE.items,
    ...EDU_LANDING_DINERO.items,
    ...EDU_LANDING_SEDES.items,
    EDU_LANDING_PADRON,
  ];
}

/** Todas las cadenas VISIBLES de la página, aplanadas. */
function todoElTexto(): string[] {
  const out: string[] = [];
  const meter = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) for (const x of v) meter(x);
    else if (v && typeof v === "object") for (const x of Object.values(v)) meter(x);
  };
  meter(EDU_LANDING_COPY);
  meter(EDU_LANDING_PROBLEMAS);
  meter(EDU_LANDING_SEO);
  for (const c of todasLasPromesas()) meter([c.titulo, c.cuerpo]);
  for (const r of EDU_LANDING_ROLES) meter([r.rol, r.ve, r.noVe]);
  for (const p of EDU_PLAN_INCLUYE) meter(p.texto);
  for (const f of EDU_LANDING_FAQ) meter([f.q, f.a]);
  return out;
}

// ── 1. Cada promesa apunta a código que existe ─────────────────────────

test("landing: todo archivo citado por una promesa EXISTE en el repo", () => {
  const culpables: string[] = [];
  for (const c of todasLasPromesas()) {
    for (const f of c.verifiedIn) {
      if (!existsSync(join(RAIZ, f))) culpables.push(`${c.key} → ${f}`);
    }
  }
  assert.deepEqual(culpables, [], `promesas que citan archivos inexistentes: ${culpables.join("; ")}`);
});

test("plan y preguntas: todo archivo citado EXISTE en el repo", () => {
  const culpables: string[] = [];
  for (const p of EDU_PLAN_INCLUYE) {
    for (const f of p.verifiedIn) if (!existsSync(join(RAIZ, f))) culpables.push(`plan.${p.key} → ${f}`);
  }
  for (const q of EDU_LANDING_FAQ) {
    for (const f of q.verifiedIn) if (!existsSync(join(RAIZ, f))) culpables.push(`faq.${q.key} → ${f}`);
  }
  for (const r of EDU_LANDING_ROLES) {
    for (const f of r.verifiedIn) if (!existsSync(join(RAIZ, f))) culpables.push(`rol.${r.key} → ${f}`);
  }
  assert.deepEqual(culpables, [], culpables.join("; "));
});

// ── 2. Una promesa sin código se DECLARA ───────────────────────────────

test("landing: ninguna promesa se queda sin archivos y sin declararse de contrato", () => {
  const sueltas: string[] = [];
  for (const c of todasLasPromesas()) {
    if (c.verifiedIn.length === 0 && !c.contrato) sueltas.push(`promesa "${c.key}"`);
  }
  for (const p of EDU_PLAN_INCLUYE) {
    if (p.verifiedIn.length === 0 && !p.contrato) sueltas.push(`plan "${p.key}"`);
  }
  for (const q of EDU_LANDING_FAQ) {
    if (q.verifiedIn.length === 0 && !q.contrato) sueltas.push(`pregunta "${q.key}"`);
  }
  assert.deepEqual(
    sueltas,
    [],
    `esto promete algo que no apunta a código ni se declara término de contrato: ${sueltas.join("; ")}`,
  );
});

test("landing: lo declarado de contrato es EXACTAMENTE lo que Rafael fijó", () => {
  // El almacenamiento incluido, la IA por contrato, el manager y cómo se
  // contrata. Si mañana aparece un cuarto renglón de plan sin código, esta
  // lista lo hace visible en vez de dejarlo pasar como "es comercial".
  const delPlan = EDU_PLAN_INCLUYE.filter((p) => p.contrato).map((p) => p.key);
  assert.deepEqual(delPlan.sort(), ["almacenamiento", "ia", "manager"]);
  const delFaq = EDU_LANDING_FAQ.filter((q) => q.contrato).map((q) => q.key);
  assert.deepEqual(delFaq, ["contratacion"]);
  // Y ninguna promesa de función puede escaparse por esa puerta.
  assert.deepEqual(todasLasPromesas().filter((c) => c.contrato).map((c) => c.key), []);
});

// ── 3. Cero precios ────────────────────────────────────────────────────

test("landing: ningún archivo trae una cifra de dinero", () => {
  const culpables: string[] = [];
  for (const rel of archivosLanding()) {
    const m = leer(rel).match(EDU_LANDING_PRECIO_PROHIBIDO);
    if (m) culpables.push(`${rel}: "${m[0]}"`);
  }
  assert.deepEqual(culpables, [], `la landing NO lleva precios: ${culpables.join("; ")}`);
});

test("copy: ningún texto visible trae una cifra de dinero", () => {
  const culpables = todoElTexto().filter((s) => EDU_LANDING_PRECIO_PROHIBIDO.test(s));
  assert.deepEqual(culpables, [], culpables.join(" | "));
});

// ── 4. Vocabulario y palabras prohibidas ───────────────────────────────

test("landing: ningún archivo dice lo que este producto no puede sostener", () => {
  const culpables: string[] = [];
  for (const rel of archivosLanding()) {
    if (rel === MARKETING) continue; // aquí VIVE la lista
    const fuente = leer(rel);
    for (const { patron } of EDU_LANDING_PALABRAS_PROHIBIDAS) {
      const m = fuente.match(patron);
      if (m) culpables.push(`${rel}: "${m[0]}"`);
    }
    for (const { patron, enLugarDe } of EDU_LANDING_VOCABULARIO) {
      const m = fuente.match(patron);
      if (m) culpables.push(`${rel}: "${m[0]}" (se dice "${enLugarDe}")`);
    }
  }
  assert.deepEqual(culpables, [], culpables.join("; "));
});

test("copy: el texto visible respeta el vocabulario y las prohibiciones", () => {
  const culpables: string[] = [];
  for (const s of todoElTexto()) {
    for (const { patron } of EDU_LANDING_PALABRAS_PROHIBIDAS) {
      const m = s.match(patron);
      if (m) culpables.push(`"${m[0]}" en: ${s.slice(0, 70)}…`);
    }
    for (const { patron, enLugarDe } of EDU_LANDING_VOCABULARIO) {
      const m = s.match(patron);
      if (m) culpables.push(`"${m[0]}" (se dice "${enLugarDe}") en: ${s.slice(0, 70)}…`);
    }
  }
  assert.deepEqual(culpables, [], culpables.join("; "));
});

test("copy: la página habla de tú y dice estudiante", () => {
  const texto = todoElTexto().join(" ").toLowerCase();
  assert.ok(texto.includes("estudiante"), "la página tiene que hablar de estudiantes");
  assert.ok(texto.includes("especialidad"), "la página tiene que hablar de especialidades");
  // "usted" no se usa en ningún sitio del producto.
  assert.ok(!/\busted(es)?\b/.test(texto), "el trato es de tú");
});

// ── 5. El teléfono del manager vive en UN solo sitio ───────────────────

test("landing: el número del manager no está escrito a mano en ningún componente", () => {
  const culpables: string[] = [];
  for (const rel of archivosLanding()) {
    if (rel === MARKETING) continue;
    const fuente = leer(rel);
    if (fuente.includes(EDU_MANAGER.numeroE164)) culpables.push(`${rel}: E.164 a mano`);
    // También la versión "bonita", por si alguien la teclea en la letra chica.
    if (fuente.includes(eduManagerDisplayPhone())) culpables.push(`${rel}: teléfono a mano`);
  }
  assert.deepEqual(culpables, [], culpables.join("; "));
});

test("manager: el enlace de WhatsApp sigue la convención del repo", () => {
  const href = eduManagerWaHref();
  // wa.me + E.164 SIN "+", texto pre-escrito codificado.
  assert.ok(href.startsWith(`https://wa.me/${EDU_MANAGER.numeroE164}?text=`), href);
  assert.ok(!href.includes("+52"), "el número de wa.me va sin el signo de más");
  const texto = decodeURIComponent(href.split("?text=")[1]);
  assert.equal(texto, EDU_MANAGER.textoPrevio);
  assert.ok(texto.includes("<escuela>"), "el hueco para el nombre de la escuela se queda a la vista");
});

test("accesibilidad: el nombre del botón corto CONTIENE su texto visible", () => {
  // Lo pilló Lighthouse (label-content-name-mismatch) y es un fallo real:
  // quien navega por voz dice lo que VE. Si el nombre accesible no contiene
  // esas palabras, el control no responde. El botón corto de la barra es el
  // único con etiqueta propia, y tiene que empezar por lo que se lee.
  const { ctaCorto, ctaCortoAria } = EDU_LANDING_COPY.nav;
  assert.ok(
    ctaCortoAria.toLowerCase().includes(ctaCorto.toLowerCase()),
    `"${ctaCortoAria}" tiene que contener "${ctaCorto}"`,
  );
  // Y de los cuatro botones de WhatsApp de la página, SOLO ése lleva
  // etiqueta: los otros tres dicen "Contactar a mi manager por WhatsApp",
  // que ya es un nombre. Se cuentan las etiquetas de VERDAD, mirando dentro
  // de cada `<WhatsappManagerCta …>` y no el archivo entero (la portada
  // también pone un `aria` en la escena 3D, que es otra cosa).
  const conEtiqueta: string[] = [];
  let total = 0;
  for (const rel of archivosLanding()) {
    if (!rel.endsWith(".tsx")) continue;
    for (const uso of leer(rel).match(/<WhatsappManagerCta[\s\S]*?\/>/g) ?? []) {
      total++;
      if (/\baria=/.test(uso)) conEtiqueta.push(rel);
    }
  }
  // Cinco usos para CUATRO botones: la barra pinta los dos rótulos —el
  // largo y el corto— y el CSS enseña uno u otro según el ancho.
  assert.equal(total, 5, "barra (largo y corto), portada, plan y cierre");
  assert.deepEqual(conEtiqueta, ["src/components/public/instituciones/nav.tsx"]);
});

test("manager: el teléfono legible se DERIVA del E.164", () => {
  assert.equal(eduManagerDisplayPhone(), "+52 999 260 2093");
  // Y los dígitos son exactamente los mismos, sin uno de más ni de menos.
  assert.equal(eduManagerDisplayPhone().replace(/\D/g, ""), EDU_MANAGER.numeroE164);
});

// ── 6. La landing no arrastra el panel ─────────────────────────────────

test("landing: no importa prisma, server-only ni el tema CSS del panel", () => {
  const culpables: string[] = [];
  for (const rel of archivosLanding()) {
    const fuente = leer(rel);
    if (/from\s+["']@\/lib\/prisma["']/.test(fuente)) culpables.push(`${rel}: prisma`);
    if (/import\s+["']server-only["']/.test(fuente)) culpables.push(`${rel}: server-only`);
    if (/edu-theme\.css/.test(fuente) && !rel.endsWith(".css")) culpables.push(`${rel}: edu-theme.css`);
    // Nada del panel del vertical ni de otros verticales.
    if (/@\/components\/edu\//.test(fuente)) culpables.push(`${rel}: componente del panel`);
    if (/@\/lib\/(barber|realty)\//.test(fuente)) culpables.push(`${rel}: otro vertical`);
  }
  assert.deepEqual(culpables, [], culpables.join("; "));
});

/**
 * Los selectores del CSS, de verdad: se quitan los comentarios y se
 * recorre el archivo llevando la cuenta de las llaves, así que un valor
 * partido en varias líneas (un degradado, una transición) no se confunde
 * con un selector — que es exactamente lo que hacía una comprobación
 * línea a línea, y por eso ésta no lo es.
 *
 * Devuelve los selectores de nivel superior y los que viven dentro de una
 * arroba (@container, @media), que son los que de verdad pueden escaparse
 * del scope. Lo de dentro de @keyframes (`from`, `to`, `40%`) no son
 * selectores y no cuentan.
 */
function selectoresCss(css: string): string[] {
  const limpio = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const fuera: string[] = [];
  const pila: Array<{ arroba: boolean; nombre: string }> = [];
  let buf = "";
  for (const ch of limpio) {
    if (ch === "{") {
      const prelude = buf.trim().replace(/\s+/g, " ");
      buf = "";
      const arroba = prelude.startsWith("@");
      const padre = pila[pila.length - 1];
      const enArroba = Boolean(padre?.arroba);
      const enKeyframes = /^@(-\w+-)?keyframes\b/.test(padre?.nombre ?? "");
      if (!arroba && !enKeyframes && (pila.length === 0 || enArroba)) fuera.push(prelude);
      pila.push({ arroba, nombre: prelude });
    } else if (ch === "}") {
      pila.pop();
      buf = "";
    } else if (ch === ";") {
      buf = "";
    } else {
      buf += ch;
    }
  }
  return fuera;
}

test("landing: el CSS cuelga entero de .dcei", () => {
  const css = leer("src/components/public/instituciones/instituciones.css");
  const selectores = selectoresCss(css);
  assert.ok(selectores.length > 60, `se esperaban muchos selectores, salieron ${selectores.length}`);
  const sueltos: string[] = [];
  for (const sel of selectores) {
    for (const parte of sel.split(",")) {
      const t = parte.trim();
      if (t && !t.startsWith(".dcei")) sueltos.push(t);
    }
  }
  assert.deepEqual(sueltos, [], `selectores fuera de .dcei: ${sueltos.join(" | ")}`);
});

// ── 7. Rutas, anclas y SEO ─────────────────────────────────────────────

test("rutas: la landing y el login del vertical son los acordados", () => {
  assert.equal(EDU_LANDING_PATH, "/instituciones");
  assert.equal(EDU_LOGIN_PATH, "/instituto/login");
  assert.ok(existsSync(join(RAIZ, "src/app/instituciones/page.tsx")));
  assert.ok(existsSync(join(RAIZ, "src/app/instituto/login/page.tsx")), "el login del vertical existe");
});

test("sitemap: solo entra la landing, y con la URL absoluta correcta", () => {
  const rutas = eduStaticSitemapPaths();
  assert.deepEqual(rutas.map((r) => r.path), [EDU_LANDING_PATH]);
  assert.ok(rutas.every((r) => r.priority > 0 && r.priority <= 1));
  assert.ok(eduLandingUrl().endsWith(EDU_LANDING_PATH));
  // Y ninguna ruta del panel se cuela.
  assert.ok(!rutas.some((r) => r.path.startsWith("/instituto/")));
  assert.ok(EDU_RUTAS_NO_INDEXADAS.length >= 3);
});

test("sitemap compartido: el bloque del vertical está sumado al return", () => {
  const s = leer("src/app/sitemap.ts");
  assert.ok(s.includes('from "@/lib/edu/seo"'), "el sitemap importa el registro del vertical");
  assert.ok(s.includes("...eduStaticEntries"), "y lo suma al arreglo que devuelve");
});

test("anclas: las que usa el nav son las que existen en la página", () => {
  const usadas = Object.values(EDU_LANDING_ANCHORS);
  assert.equal(new Set(usadas).size, usadas.length, "no puede haber dos anclas iguales");
  const secciones = leer("src/components/public/instituciones/secciones.tsx");
  const plan = leer("src/components/public/instituciones/plan.tsx");
  const fuente = secciones + plan;
  for (const a of usadas) {
    assert.ok(
      fuente.includes(`EDU_LANDING_ANCHORS.${Object.entries(EDU_LANDING_ANCHORS).find(([, v]) => v === a)?.[0]}`),
      `el ancla "${a}" no se pinta en ninguna sección`,
    );
  }
});

test("SEO: título, descripción y palabras clave están completos", () => {
  assert.ok(EDU_LANDING_SEO.title.length > 30 && EDU_LANDING_SEO.title.length <= 75);
  assert.ok(
    EDU_LANDING_SEO.description.length > 90 && EDU_LANDING_SEO.description.length <= 160,
    `la descripción mide ${EDU_LANDING_SEO.description.length}; Google corta cerca de 155`,
  );
  assert.ok(EDU_LANDING_SEO.keywords.length >= 5);
  // La palabra clave objetivo, tal cual.
  assert.ok(
    EDU_LANDING_SEO.keywords.includes("software para clínica universitaria de odontología"),
  );
});

test("H1 único: solo la portada pinta un h1", () => {
  const culpables: string[] = [];
  for (const rel of archivosLanding()) {
    if (!rel.endsWith(".tsx")) continue;
    const veces = (leer(rel).match(/<h1[\s>]/g) ?? []).length;
    if (veces > 0 && rel !== "src/components/public/instituciones/hero.tsx") {
      culpables.push(`${rel}: ${veces}`);
    }
    if (rel === "src/components/public/instituciones/hero.tsx" && veces !== 1) {
      culpables.push(`hero.tsx pinta ${veces} h1`);
    }
  }
  assert.deepEqual(culpables, [], culpables.join("; "));
});

test("JSON-LD: se serializa sin poder cerrar la etiqueta script", () => {
  const s = serializeEduJsonLd({ a: "</script><img onerror=1>" });
  assert.ok(!s.includes("</script>"));
  assert.ok(s.includes("\\u003c/script"));
});

// ── 8. Coherencia interna del contenido ────────────────────────────────

test("contenido: hay lo que la página promete tener", () => {
  assert.equal(EDU_LANDING_PROBLEMAS.length, 3, "tres dolores, ni uno más");
  assert.equal(EDU_LANDING_FLUJO.length, 5, "agenda → valoración → caso → firma → cobro");
  assert.equal(EDU_LANDING_ROLES.length, 4, "Dirección, Docente, Estudiante y Caja");
  assert.deepEqual(
    EDU_LANDING_ROLES.map((r) => r.rol),
    ["Dirección", "Docente", "Estudiante", "Caja"],
  );
  assert.ok(EDU_LANDING_FAQ.length >= 8 && EDU_LANDING_FAQ.length <= 10);
  assert.ok(EDU_PLAN_INCLUYE.length >= 8);
});

test("contenido: ninguna llave repetida y ningún texto vacío", () => {
  const listas: Array<[string, string[]]> = [
    ["promesas", todasLasPromesas().map((c) => c.key)],
    ["problemas", EDU_LANDING_PROBLEMAS.map((p) => p.key)],
    ["roles", EDU_LANDING_ROLES.map((r) => r.key)],
    ["plan", EDU_PLAN_INCLUYE.map((p) => p.key)],
    ["faq", EDU_LANDING_FAQ.map((q) => q.key)],
  ];
  for (const [nombre, llaves] of listas) {
    assert.equal(new Set(llaves).size, llaves.length, `llaves repetidas en ${nombre}`);
  }
  const vacios = todoElTexto().filter((s) => s.trim().length === 0);
  assert.deepEqual(vacios, [], "hay texto vacío en el copy");
});

test("plan: la letra chica dice cómo se cobra, sin decir cuánto", () => {
  const chica = EDU_LANDING_COPY.plan.letraChica;
  assert.ok(/licencia anual/i.test(chica), chica);
  assert.ok(/cotizaci/i.test(chica), chica);
  assert.ok(!EDU_LANDING_PRECIO_PROHIBIDO.test(chica));
});

test("escenas 3D: las tres tienen respaldo estático y ninguna pide un archivo pesado", () => {
  const estaticos = leer("src/components/public/instituciones/estaticos.tsx");
  for (const nombre of ["ArcadaEstatica", "VolumenEstatica", "ClinicaEstatica"]) {
    assert.ok(estaticos.includes(`export function ${nombre}`), `falta el respaldo ${nombre}`);
  }
  // La clínica isométrica reusa la retícula del producto, no una propia.
  assert.ok(estaticos.includes('from "@/lib/floor-plan/iso"'));
  // Y nada de la landing carga un binario: todo es procedural o SVG en línea.
  for (const rel of archivosLanding()) {
    const fuente = leer(rel);
    assert.ok(
      !/\.(glb|gltf|fbx|obj|hdr|exr)["')]/.test(fuente),
      `${rel} carga un modelo o un mapa de entorno; las escenas son procedurales`,
    );
  }
});

test("escenas 3D: la puerta respeta el movimiento reducido y cae con gracia", () => {
  const gate = leer("src/components/public/instituciones/escena-gate.tsx");
  assert.ok(gate.includes("prefers-reduced-motion"), "sin esto, se anima a quien pidió que no");
  assert.ok(gate.includes("IntersectionObserver"), "solo se descarga lo que se va a ver");
  assert.ok(gate.includes("webgl"), "hay que comprobar que exista WebGL");
  assert.ok(gate.includes("saveData"), "con ahorro de datos no se descarga three");
  assert.ok(gate.includes("onFail"), "si falla, vuelve el dibujo estático");
  // El CSS tiene que apagar TODO el movimiento con la preferencia puesta.
  const css = leer("src/components/public/instituciones/instituciones.css");
  assert.ok(css.includes("@media (prefers-reduced-motion: reduce)"));
});
