/**
 * «SABINA SABE DEL PANEL» (ws1-t4, 23-sep-2026): `estado_mercado_pago` y
 * `ayuda_del_panel`.
 *
 *   npm run test:sabina-sabe-del-panel
 *
 * Las tres preguntas que pidió el encargo, a nivel de herramienta:
 *  · de DATOS — «¿tengo conectado Mercado Pago? ¿cuánto pido?»: sale lo de SU
 *    clínica, lo mismo que pinta la pantalla, sin token y sin pacientes;
 *  · de AYUDA — «¿cómo configuro Mercado Pago?»: los pasos de UN tema, en el
 *    idioma del panel;
 *  · la que NO SABE — un tema que no está: la herramienta no tiene por dónde
 *    devolver pasos inventados (el enum es cerrado) y la descripción manda
 *    admitirlo. Que el MODELO lo admita lo cubre la prueba de punta a punta.
 *
 * Y lo de siempre del contrato: no cruza de clínica, sin permiso no lee ni una
 * fila, y no escribe (el doble no expone `create`/`update`).
 */

import "./preparar";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { estadoMercadoPago } from "../estado-mercado-pago";
import { ayudaDelPanel } from "../ayuda-del-panel";
import { correrHerramienta } from "../base";
import { TEMAS_AYUDA, TOPE_TEMA } from "../../ayuda-del-panel";
import { CL_SUR, adminNorte, adminSur, base, conPermisos, doctorNorte, recepcionNorte } from "./siembra";
import { TOKEN_FALSO, baseConMercadoPago, encenderPlataforma } from "./mp-siembra";
import type { SabinaCtx } from "../../tipos";

const correrMp = (ctx: SabinaCtx, params: unknown = {}) => correrHerramienta(estadoMercadoPago, ctx, params);
const correrAyuda = (ctx: SabinaCtx, params: unknown) => correrHerramienta(ayudaDelPanel, ctx, params);

let apagarPlataforma: () => void;
before(() => {
  apagarPlataforma = encenderPlataforma();
});
after(() => apagarPlataforma());

/* ══════════════════════════════════════════════════════════════════════
 * estado_mercado_pago — la pregunta de DATOS
 * ══════════════════════════════════════════════════════════════════════ */

test("pregunta de datos: conectada, anticipo encendido, cuánto y qué plazo — lo de SU clínica", async () => {
  const r = await correrMp(adminNorte(baseConMercadoPago()));
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;

  assert.equal(r.datos.noDisponible, null);
  assert.equal(r.datos.cuenta.conectada, true);
  assert.equal(r.datos.cuenta.apodo, "NORTE_MP");
  assert.equal(r.datos.cuenta.modoPruebas, false);
  assert.equal(r.datos.anticipo.activo, true);
  assert.equal(r.datos.anticipo.modo, "fixed");
  assert.equal(r.datos.anticipo.monto, 200);
  assert.equal(r.datos.anticipo.minutos, 45);
  assert.deepEqual(r.datos.recientes, { total: 3, porEstado: { PAID: 2, PENDING: 1 }, conAnomalias: 1 });

  assert.match(r.resumen, /Cuenta de Mercado Pago conectada \(«NORTE_MP», cobros@norte\.mx\)/);
  assert.match(r.resumen, /ENCENDIDO\. Se pide un monto fijo de \$200, y el paciente tiene 45 minutos para pagar/);
  assert.match(r.resumen, /2 pagados, 1 esperando pago/);
  assert.match(r.resumen, /1 anticipo tiene un pago con algo que revisar/);
});

test("🔴 no cruza de clínica: la del sur ve SU cuenta de pruebas y su 30 %, y un clinicId del modelo no cambia nada", async () => {
  const db = baseConMercadoPago();
  const sur = await correrMp(adminSur(db));
  assert.equal(sur.ok, true);
  if (!sur.ok) return;
  assert.equal(sur.datos.cuenta.apodo, "SUR_MP");
  assert.equal(sur.datos.anticipo.modo, "percent");
  assert.equal(sur.datos.anticipo.porcentaje, 30);
  assert.deepEqual(sur.datos.recientes.porEstado, { EXPIRED: 1 });
  assert.match(sur.resumen, /cuenta de PRUEBAS/);
  assert.match(sur.resumen, /el 30% del precio del servicio; si eso da menos de \$10, esa cita va sin anticipo \(si el servicio no tiene precio, \$150\)/);
  assert.doesNotMatch(sur.resumen, /NORTE_MP|cobros@norte/);

  // El modelo no manda clinicId; si lo mandara, zod lo descarta y manda la sesión.
  const norte = await correrMp(adminNorte(db), { clinicId: CL_SUR });
  assert.equal(norte.ok, true);
  if (!norte.ok) return;
  assert.equal(norte.datos.cuenta.apodo, "NORTE_MP");
  assert.doesNotMatch(norte.resumen, /SUR_MP|cobros@sur/);
});

test("🔴 ni el token ni los nombres de pacientes viajan a la conversación", async () => {
  const r = await correrMp(adminNorte(baseConMercadoPago()));
  assert.equal(r.ok, true);
  const todo = JSON.stringify(r);
  assert.ok(!todo.includes(TOKEN_FALSO), "salió el token");
  assert.ok(!todo.includes("123456789"), "salió el id de la cuenta");
  for (const nombre of ["Ana", "Beto", "Carla", "Perez", "Munoz", "Gomez"]) {
    assert.ok(!todo.includes(nombre), `salió el paciente ${nombre}`);
  }
});

test("🔴 sin `settings.edit` (la key de la pantalla) → sin_permiso, sin leer ni una fila", async () => {
  for (const hacer of [recepcionNorte, doctorNorte]) {
    const db = baseConMercadoPago();
    const r = await correrMp(hacer(db));
    assert.equal(r.ok, false);
    assert.equal((r as any).motivo, "sin_permiso");
    assert.equal((r as any).permiso, "settings.edit");
    assert.equal(db.contador.llamadas.length, 0, "leyó la base sin permiso");
  }
  // Con la key puesta a mano, una recepcionista sí puede (como en la pantalla).
  const r = await correrMp(conPermisos(baseConMercadoPago(), ["settings.edit"]));
  assert.equal(r.ok, true);
});

test("sin cuenta conectada NO es «sin datos»: lo dice, y el anticipo sale apagado", async () => {
  const r = await correrMp(adminNorte(base())); // la siembra de siempre: sin fila de MP
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.cuenta.conectada, false);
  assert.equal(r.datos.anticipo.activo, false);
  assert.match(r.resumen, /Sin cuenta de Mercado Pago conectada/);
  assert.match(r.resumen, /APAGADO; sin cuenta conectada no se puede pedir/);
  assert.match(r.resumen, /Todavía no se ha pedido ningún anticipo/);
});

test("si DaleControl aún no activa Mercado Pago, lo dice y no da el anticipo por encendido (igual que la pantalla)", async () => {
  apagarPlataforma();
  try {
    const r = await correrMp(adminNorte(baseConMercadoPago()));
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.datos.noDisponible, "plataforma");
    assert.equal(r.datos.anticipo.activo, false);
    assert.match(r.resumen, /DaleControl todavía no activa los cobros con Mercado Pago \(no depende de la clínica\)/);
    // Los nombres de las variables de entorno no le sirven a una clínica: no van.
    assert.doesNotMatch(r.resumen, /MERCADOPAGO_|DATA_ENCRYPTION_KEY/);
  } finally {
    apagarPlataforma = encenderPlataforma();
  }
});

test("🔴 solo lee: el doble no tiene métodos de escritura y solo se consultaron las dos tablas de la pantalla", async () => {
  const db = baseConMercadoPago();
  await correrMp(adminNorte(db));
  const modelos = [...new Set(db.contador.llamadas.map((l) => `${l.modelo}.${l.op}`))].sort();
  assert.deepEqual(modelos, ["appointmentDeposit.findMany", "clinicMercadoPago.findUnique"]);
  assert.equal(typeof (db.clinicMercadoPago as any).update, "undefined");
  assert.equal(typeof (db.clinicMercadoPago as any).upsert, "undefined");
});

/* ══════════════════════════════════════════════════════════════════════
 * ayuda_del_panel — la pregunta de AYUDA y la que no sabe
 * ══════════════════════════════════════════════════════════════════════ */

test("pregunta de ayuda: «¿cómo configuro Mercado Pago?» → los pasos de ESE tema, y nada más", async () => {
  const db = base();
  const r = await correrAyuda(recepcionNorte(db), { tema: "mercado_pago" });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  assert.equal(r.datos.idioma, "es");
  assert.match(r.resumen, /Configuración → pestaña Integraciones → tarjeta «Anticipos por WhatsApp \(Mercado Pago\)»/);
  assert.match(r.resumen, /«Conectar con Mercado Pago»/);
  assert.match(r.resumen, /No añadas pasos que no estén en este texto/);
  // Solo viaja un tema: nada de bloqueos ni de importar en esta respuesta.
  assert.doesNotMatch(r.resumen, /Crear bloqueo|Importar mi clínica/);
  // No lee la base.
  assert.equal(db.contador.llamadas.length, 0);
});

test("la ayuda sale en el idioma del panel: con la clínica en inglés, los botones en inglés", async () => {
  const ctx = { ...adminNorte(base()), idioma: "en" as const };
  const r = await correrAyuda(ctx, { tema: "bloquear_agenda" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.idioma, "en");
  assert.match(r.resumen, /Settings → "Hours & blocks" tab/);
  assert.match(r.resumen, /"Create block"/);
  // Los pasos van UNA vez (en el resumen): `datos` y `resumen` viajan juntos al modelo.
  assert.deepEqual(r.datos, { tema: "bloquear_agenda", idioma: "en" });
  assert.match(r.resumen, /El panel de esta clínica está en inglés/);
});

test("🔴 la que NO sabe: un tema que no está no devuelve pasos — el enum es cerrado y lo dice", async () => {
  for (const tema of ["timbrar_cfdi", "configurar_stripe", "", "mercado pago"]) {
    const r = await correrAyuda(adminNorte(base()), { tema });
    assert.equal(r.ok, false, tema);
    assert.equal((r as any).motivo, "error");
    assert.match((r as any).detalle, /parametros_invalidos: tema/);
    // Ni un trozo de ningún tema se cuela en el error.
    for (const t of TEMAS_AYUDA) assert.ok(!(r as any).detalle.includes(t.texto.es.slice(0, 40)), `${tema} → ${t.id}`);
  }
  // Y la descripción que ve el modelo manda admitirlo en vez de inventar.
  assert.match(ayudaDelPanel.descripcion, /NO inventes pasos, botones ni pantallas: di que no tienes esa guía/);
});

test("la descripción nombra TODOS los temas, y cada tema lleva sus dos idiomas dentro del tope", () => {
  for (const t of TEMAS_AYUDA) {
    assert.ok(ayudaDelPanel.descripcion.includes(t.id), `la descripción no nombra ${t.id}`);
    for (const idioma of ["es", "en"] as const) {
      const texto = t.texto[idioma];
      assert.ok(texto.trim().length > 100, `${t.id}/${idioma} vacío`);
      assert.ok(texto.length <= TOPE_TEMA, `${t.id}/${idioma}: ${texto.length} caracteres (tope ${TOPE_TEMA})`);
    }
  }
  // La descripción se paga en CADA pregunta (va en el catálogo): que no engorde.
  // Medido el 23-sep-2026 con ocho temas: ~1 000 caracteres.
  assert.ok(ayudaDelPanel.descripcion.length <= 1200, `${ayudaDelPanel.descripcion.length} caracteres`);
});

/* ── Que las etiquetas existan de verdad en la pantalla ────────────────── */

const RAIZ = join(__dirname, "../../../../..");

function textoDe(ruta: string): string {
  return readFileSync(join(RAIZ, ruta), "utf8");
}

function archivosBajo(dir: string): string[] {
  const out: string[] = [];
  for (const nombre of readdirSync(join(RAIZ, dir))) {
    const rel = join(dir, nombre);
    if (statSync(join(RAIZ, rel)).isDirectory()) {
      if (nombre !== "__tests__") out.push(...archivosBajo(rel));
    } else if (/\.(tsx?|json)$/.test(nombre)) out.push(rel);
  }
  return out;
}

/**
 * Lo entrecomillado que NO es una etiqueta de pantalla: ejemplos y frases.
 * Si añades una entrada, que sea porque de verdad no es un botón ni un rótulo.
 */
const NO_SON_ETIQUETAS = new Set([
  "Ortodoncia 24 meses", // ejemplo de renglón que escribe el usuario
  "Orthodontics 24 months",
  "quién me debe", // cómo lo llama la guía del ticket, no un botón
  "who owes me",
  "Editar configuración", // la descripción del permiso (también en la ayuda en inglés): abajo se comprueba aparte
]);

test("🔴 cada botón o rótulo que cita la ayuda existe en el diccionario o en el JSX de su pantalla", () => {
  // Lo que ve el usuario sale de aquí: los dos diccionarios y las pantallas sin i18n
  // (Anticipos, la tarjeta de Integraciones y los perfiles del importador).
  const corpus = {
    es: [
      textoDe("src/i18n/dictionaries/es.json"),
      ...archivosBajo("src/app/dashboard/settings").map(textoDe),
      ...archivosBajo("src/lib/import/profiles").map(textoDe),
    ].join("\n"),
    en: [
      textoDe("src/i18n/dictionaries/en.json"),
      // Pantallas que solo existen en español: la ayuda en inglés las cita tal cual.
      textoDe("src/app/dashboard/settings/anticipos/anticipos-client.tsx"),
      textoDe("src/app/dashboard/settings/settings-client.tsx"),
      ...archivosBajo("src/lib/import/profiles").map(textoDe),
    ].join("\n"),
  };
  const citas = {
    es: /«([^»]+)»/g,
    en: /"([^"]+)"/g,
  };
  const faltan: string[] = [];
  for (const t of TEMAS_AYUDA) {
    for (const idioma of ["es", "en"] as const) {
      for (const m of t.texto[idioma].matchAll(citas[idioma])) {
        const etiqueta = m[1].trim();
        if (NO_SON_ETIQUETAS.has(etiqueta)) continue;
        // «Aplicar N festivos» / "Apply N holidays" son plurales con {count}.
        const buscada = etiqueta.replace(/^(Aplicar|Apply) N /, "$1 {count} ");
        if (!corpus[idioma].includes(buscada)) faltan.push(`${t.id}/${idioma}: «${etiqueta}»`);
      }
    }
  }
  assert.deepEqual(faltan, [], "la ayuda cita etiquetas que no están en pantalla");

  // El permiso que nombra la ayuda de Mercado Pago es el de la pantalla.
  assert.match(textoDe("src/lib/auth/permissions.ts"), /"settings\.edit":\s+"Editar configuración/);
});
