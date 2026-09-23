/**
 * Menú de dos niveles — candados.
 *
 * Run: npm run test:menu-dos-niveles
 *
 * Lo que fija:
 *  - Ninguna opción del menú de siempre se queda sin sitio en el nuevo, y
 *    ninguna aparece dos veces.
 *  - Para cualquier persona, el menú nuevo enseña EXACTAMENTE las mismas
 *    opciones que el de siempre (mismo filtro), solo repartidas en dos niveles.
 *  - Los conteos del inventario del menú (PAQUETE-MENU.md, medidos sobre main):
 *    dueño 23, administrador 23, doctor 9, recepción 10, solo lectura 15; con
 *    plan Básico 20/20/8/9/14. Si el filtro cambiara al moverlo, esto falla.
 *    (Desde entonces se sumaron Plantillas y, en ws1-t5, Saldo IA —solo
 *    dueño y administrador, `adminOnly` + `whatsapp.view`—; los números de
 *    abajo son los de hoy.)
 *  - Todo ícono que usa el menú está dentro de la fuente recortada (si no, se
 *    vería la palabra «point_of_sale» en vez del dibujo).
 *  - El interruptor falla cerrado: sin tabla, sin fila o con error sin respuesta
 *    previa → menú de siempre; sin tabla no toca la fila; guarda la respuesta un
 *    minuto. Con la base lenta ESPERA (sin tope): el menú no cambia al navegar.
 *  - El SQL y el modelo Prisma hablan de la misma tabla, y el modelo Clinic no
 *    la conoce (el login lee la clínica con todas sus columnas).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NAV_ITEMS,
  type ClinicCategory,
  type SidebarUser,
  type UserRole,
} from "@/components/dashboard/sidebar-nav";
import {
  GRUPOS,
  ICONOS_CHROME,
  ICONO_DE,
  NIVEL1_IDS,
  armarMenu,
  etiquetaDeRuta,
  filtrarGrupos,
  normalizar,
  opcionesSuspendida,
  opcionesVisibles,
  segundoNivelActivo,
} from "../estructura";
import { ICONOS_EN_FUENTE } from "../iconos";
import { crearInterruptor, FLAG_MENU_DOS_NIVELES } from "@/lib/menu-dos-niveles/interruptor-core";

const RAIZ = join(__dirname, "..", "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

// Espejo de FALLBACK_PLAN_CONFIG / sql/plan_configs.sql (lo mismo que usó el inventario).
const MODULOS_PRO = ["ai-assistant", "inbox", "whatsapp", "marketplace", "analytics", "reports", "landing", "tv-modes"];
const MODULOS_BASICO = MODULOS_PRO.filter((k) => !["ai-assistant", "analytics", "tv-modes"].includes(k));
const ROLES: UserRole[] = ["SUPER_ADMIN", "ADMIN", "DOCTOR", "RECEPTIONIST", "READONLY", "ACCOUNTANT"];
const CATEGORIAS: ClinicCategory[] = [
  "DENTAL", "MEDICINE", "NUTRITION", "PSYCHOLOGY", "DERMATOLOGY", "AESTHETIC_MEDICINE", "HAIR_RESTORATION",
  "BEAUTY_CENTER", "BROW_LASH", "HAIR_SALON", "MASSAGE", "SPA", "LASER_HAIR_REMOVAL", "NAIL_SALON",
  "PHYSIOTHERAPY", "PODIATRY", "ALTERNATIVE_MEDICINE", "OTHER",
];

const persona = (role: UserRole, permissionsOverride: string[] = []): SidebarUser => ({
  firstName: "Ejemplo", lastName: "Prueba", email: "e@x.mx", role, permissionsOverride,
});

const idsDe = (menu: ReturnType<typeof armarMenu>) => [
  ...menu.nivel1.map((it) => it.id),
  ...menu.grupos.flatMap((g) => g.items.map((it) => it.id)),
];

// ── Ninguna opción se pierde ─────────────────────────────────────────

test("cada opción del menú de siempre tiene UN sitio en el nuevo (Facturación va aparte, en suspensión)", () => {
  const colocados = [...NIVEL1_IDS, ...GRUPOS.flatMap((g) => g.ids)];
  const repetidos = colocados.filter((id, i) => colocados.indexOf(id) !== i);
  assert.deepEqual(repetidos, [], "ninguna opción en dos sitios");

  const esperados = NAV_ITEMS.filter((it) => !it.suspendedOnly).map((it) => it.id).sort();
  assert.deepEqual([...colocados].sort(), esperados, "mismas opciones que NAV_ITEMS, ni una más ni una menos");

  assert.deepEqual(opcionesSuspendida().map((it) => it.id), ["facturacion", "soporte"]);
});

test("para cualquier persona, rol, plan y giro: el menú nuevo enseña lo mismo que el de siempre", () => {
  const overrides: string[][] = [[], ["today.view"], ["agenda.view", "billing.view", "settings.view", "team.view"]];
  const modulos = [MODULOS_PRO, MODULOS_BASICO, []];
  let casos = 0;
  for (const role of ROLES) for (const cat of CATEGORIAS) for (const mods of modulos) for (const ov of overrides) {
    const visibles = opcionesVisibles(persona(role, ov), cat, mods);
    const ids = idsDe(armarMenu(visibles));
    assert.equal(new Set(ids).size, ids.length, `sin duplicados (${role}/${cat})`);
    assert.deepEqual([...ids].sort(), visibles.map((it) => it.id).sort(), `mismas opciones (${role}/${cat}/${ov.join(",")})`);
    casos++;
  }
  assert.ok(casos > 900);
});

test("un grupo que se queda sin opciones no aparece", () => {
  const menu = armarMenu(opcionesVisibles(persona("DOCTOR"), "DENTAL", MODULOS_PRO));
  for (const g of menu.grupos) assert.ok(g.items.length > 0, g.id);
  assert.ok(!menu.grupos.some((g) => g.id === "dinero"), "el doctor no ve Finanzas/Analítica/Reportes");
});

test("una opción nueva que alguien olvide colocar no se pierde: cae en «Más»", () => {
  const huerfana = { ...NAV_ITEMS[0], id: "opcion-nueva-sin-sitio" };
  const menu = armarMenu([...opcionesVisibles(persona("SUPER_ADMIN"), "DENTAL", MODULOS_PRO), huerfana]);
  const mas = menu.grupos.find((g) => g.id === "mas");
  assert.ok(mas?.items.some((it) => it.id === "opcion-nueva-sin-sitio"));
});

// ── Los números del inventario (medidos sobre main) ──────────────────

test("conteos por tipo de usuario — clínica dental, plan Profesional o en prueba", () => {
  const cuenta = (role: UserRole, mods: string[]) => opcionesVisibles(persona(role), "DENTAL", mods).length;
  assert.deepEqual(
    ROLES.slice(0, 5).map((r) => cuenta(r, MODULOS_PRO)),
    [25, 25, 10, 10, 15],
    "Profesional: dueño, administrador, doctor, recepción, solo lectura",
  );
  assert.deepEqual(
    ROLES.slice(0, 5).map((r) => cuenta(r, MODULOS_BASICO)),
    [22, 22, 9, 9, 14],
    "Básico",
  );
});

test("dueño, plan Profesional: dónde acaba cada una de las 25 opciones", () => {
  const menu = armarMenu(opcionesVisibles(persona("SUPER_ADMIN"), "DENTAL", MODULOS_PRO));
  assert.deepEqual(menu.nivel1.map((it) => it.id), ["home", "appointments", "patients", "inbox", "billing", "sabina"]);
  assert.deepEqual(
    menu.grupos.map((g) => [g.id, g.items.map((it) => it.id)]),
    [
      // Saldo IA debajo de Analítica (ws1-t5).
      ["dinero", ["finanzas", "analytics", "saldo-ia", "reports"]],
      ["clinica", ["team", "resources", "inventory", "procedures", "plantillas", "clinic-layout"]],
      ["pacientes", ["landing", "resenas", "tv-modes", "messages"]],
      ["sistema", ["settings", "auditoria", "soporte"]],
      ["mas", ["ai", "marketplace"]],
    ],
  );
  assert.equal(idsDe(menu).length, 25);
});

// ── Saldo IA (ws1-t5) ────────────────────────────────────────────────

test("Saldo IA: en Dinero, debajo de Analítica, y con el permiso de su pantalla", () => {
  const saldo = NAV_ITEMS.find((it) => it.id === "saldo-ia");
  assert.ok(saldo, "existe en NAV_ITEMS");
  assert.equal(saldo!.href, "/dashboard/whatsapp/bot/saldo");
  // La pantalla exige whatsapp.view; el menú pide LO MISMO para no rebotar.
  assert.equal(saldo!.permission, "whatsapp.view");
  assert.equal(saldo!.adminOnly, true, "es dinero: como Finanzas y Analítica");
  assert.equal(saldo!.moduleKey, undefined, "Sabina es core y gasta este saldo: no se gatea por módulo");

  // Dueño y administrador lo ven; recepción, doctor y solo lectura no.
  const ve = (role: UserRole, ov: string[] = []) =>
    opcionesVisibles(persona(role, ov), "DENTAL", MODULOS_PRO).some((it) => it.id === "saldo-ia");
  assert.equal(ve("SUPER_ADMIN"), true);
  assert.equal(ve("ADMIN"), true);
  assert.equal(ve("RECEPTIONIST"), false, "recepción tiene whatsapp.view pero no es admin");
  assert.equal(ve("DOCTOR"), false);
  assert.equal(ve("READONLY"), false);
  // Un administrador al que le quitaron WhatsApp tampoco lo ve (rebotaría).
  assert.equal(ve("ADMIN", ["today.view", "analytics.view"]), false);

  // Y con el plan Básico (sin módulo analytics) sigue debajo de Finanzas.
  const basico = armarMenu(opcionesVisibles(persona("SUPER_ADMIN"), "DENTAL", MODULOS_BASICO));
  assert.deepEqual(basico.grupos.find((g) => g.id === "dinero")!.items.map((it) => it.id), ["finanzas", "saldo-ia", "reports"]);
});

test("doctor, plan Profesional: primer nivel sin «WhatsApp y recordatorios» y segundo nivel con lo suyo", () => {
  const menu = armarMenu(opcionesVisibles(persona("DOCTOR"), "DENTAL", MODULOS_PRO));
  assert.deepEqual(menu.nivel1.map((it) => it.id), ["home", "appointments", "patients", "inbox", "billing", "sabina"]);
  assert.deepEqual(menu.grupos.map((g) => [g.id, g.items.map((it) => it.id)]), [
    // Plantillas (WS1-T1): las escribe el doctor, así que es lo único de «clinica» que ve.
    ["clinica", ["plantillas"]],
    ["sistema", ["soporte"]],
    ["mas", ["ai", "marketplace"]],
  ]);
});

// ── Íconos ───────────────────────────────────────────────────────────

test("la lista de íconos de la fuente está ordenada y sin repetidos (así se pide a Google)", () => {
  const lista = [...ICONOS_EN_FUENTE];
  assert.deepEqual(lista, [...lista].sort());
  assert.equal(new Set(lista).size, lista.length);
});

test("todo ícono que usa el menú existe en la fuente recortada", () => {
  const fuente = new Set<string>(ICONOS_EN_FUENTE);
  for (const it of NAV_ITEMS) {
    assert.ok(ICONO_DE[it.id], `la opción ${it.id} tiene ícono`);
    assert.ok(fuente.has(ICONO_DE[it.id]), `«${ICONO_DE[it.id]}» (${it.id}) está en la fuente`);
  }
  for (const n of ICONOS_CHROME) assert.ok(fuente.has(n), `«${n}» está en la fuente`);

  // Y los que se escriben directamente en el JSX: nombre="x" o nombre={a ? "x" : "y"}.
  for (const archivo of ["menu-dos-niveles.tsx", "topbar-dos-niveles.tsx"]) {
    const src = leer(`src/components/dashboard/menu-dos-niveles/${archivo}`);
    const usados = new Set<string>();
    for (const m of src.matchAll(/nombre=(?:"([a-z0-9_]+)"|\{([^}]*)\})/g)) {
      if (m[1]) usados.add(m[1]);
      if (m[2]) for (const q of m[2].matchAll(/"([a-z0-9_]+)"/g)) usados.add(q[1]);
    }
    assert.ok(usados.size > 0, archivo);
    for (const n of usados) assert.ok(fuente.has(n), `«${n}» (${archivo}) está en la fuente`);
  }
});

// ── Textos ───────────────────────────────────────────────────────────

test("cada opción, grupo y rol tiene su texto en español e inglés", () => {
  for (const lang of ["es", "en"]) {
    const dict = JSON.parse(leer(`src/i18n/dictionaries/${lang}.json`)).menuDosNiveles;
    assert.ok(dict, `${lang}: bloque menuDosNiveles`);
    for (const it of NAV_ITEMS) assert.equal(typeof dict.nav[it.id], "string", `${lang}: nav.${it.id}`);
    for (const g of GRUPOS) assert.equal(typeof dict.grupo[g.id], "string", `${lang}: grupo.${g.id}`);
    for (const r of ["owner", "admin", "doctor", "receptionist", "readonly", "accountant"]) {
      assert.equal(typeof dict.rol[r], "string", `${lang}: rol.${r}`);
    }
  }
  const es = JSON.parse(leer("src/i18n/dictionaries/es.json")).menuDosNiveles;
  assert.equal(es.nav.sabina, "Sabina", "ya no sale «sidebar.nav.sabina»");
  assert.equal(es.nav.inbox, "Mensajes");
  assert.equal(es.nav.messages, "WhatsApp y recordatorios");
  assert.equal(es.nav.analytics, "Analítica");
  assert.doesNotMatch(es.cajaSinAcceso, /plan/i, "Caja no es cosa del plan");
});

// ── Buscador, migas y activo ─────────────────────────────────────────

test("buscador del segundo nivel: sin acentos, sin mayúsculas, esconde grupos vacíos", () => {
  const { grupos } = armarMenu(opcionesVisibles(persona("SUPER_ADMIN"), "DENTAL", MODULOS_PRO));
  const es = JSON.parse(leer("src/i18n/dictionaries/es.json")).menuDosNiveles.nav as Record<string, string>;
  const etiqueta = (id: string) => es[id];
  assert.equal(normalizar("  AnalÍtica "), "analitica");
  assert.deepEqual(
    filtrarGrupos(grupos, "analitica", etiqueta).map((g) => [g.id, g.items.map((it) => it.id)]),
    [["dinero", ["analytics"]]],
  );
  assert.deepEqual(filtrarGrupos(grupos, "   ", etiqueta), grupos);
  assert.deepEqual(filtrarGrupos(grupos, "zzz", etiqueta), []);
  assert.deepEqual(
    filtrarGrupos(grupos, "whatsapp", etiqueta).flatMap((g) => g.items.map((it) => it.id)),
    ["messages"],
  );
});

test("migas: la opción que coincide más largo; si no es opción, la barra de siempre; si no, nada", () => {
  const mapa = { "/dashboard": "shell.topbar.routeHoy", "/dashboard/xrays": "shell.topbar.routeRadiografias" };
  assert.deepEqual(etiquetaDeRuta("/dashboard", mapa), { tipo: "opcion", id: "home" });
  assert.deepEqual(etiquetaDeRuta("/dashboard/sabina", mapa), { tipo: "opcion", id: "sabina" });
  assert.deepEqual(etiquetaDeRuta("/dashboard/patients/ckxyz123", mapa), { tipo: "opcion", id: "patients" });
  assert.deepEqual(etiquetaDeRuta("/dashboard/settings/sucursales", mapa), { tipo: "opcion", id: "settings" });
  assert.deepEqual(etiquetaDeRuta("/dashboard/xrays/abc", mapa), { tipo: "clave", clave: "shell.topbar.routeRadiografias" });
  assert.equal(etiquetaDeRuta("/dashboard/pantalla-que-no-existe", mapa), null);
  assert.equal(etiquetaDeRuta("/dashboard/marketplace", mapa), null, "Marketplace no navega: no es miga");
});

test("«Administración» se marca activa solo en pantallas del segundo nivel", () => {
  const { grupos } = armarMenu(opcionesVisibles(persona("SUPER_ADMIN"), "DENTAL", MODULOS_PRO));
  assert.equal(segundoNivelActivo("/dashboard/finanzas", grupos), true);
  assert.equal(segundoNivelActivo("/dashboard/settings/sucursales", grupos), true);
  assert.equal(segundoNivelActivo("/dashboard", grupos), false);
  assert.equal(segundoNivelActivo("/dashboard/caja", grupos), false);
  assert.equal(segundoNivelActivo("/dashboard/marketplace", grupos), false);
});

// ── Interruptor ──────────────────────────────────────────────────────

/** Interruptor con base de mentira: cuenta consultas y deja mover el reloj. */
function interruptorDePrueba(opts: {
  tabla?: boolean | (() => Promise<boolean>);
  fila?: (id: string) => Promise<{ enabled: boolean } | null>;
} = {}) {
  const cuenta = { tabla: 0, filas: [] as string[] };
  let reloj = 1_000_000;
  const encendido = crearInterruptor({
    tablaExiste: async () => {
      cuenta.tabla++;
      return typeof opts.tabla === "function" ? opts.tabla() : opts.tabla ?? true;
    },
    leer: async (id) => {
      cuenta.filas.push(id);
      return opts.fila ? opts.fila(id) : { enabled: id === "clinica-altabrisa" };
    },
    ahora: () => reloj,
    ttlMs: 60_000,
  });
  return { encendido, cuenta, avanzar: (ms: number) => { reloj += ms; } };
}

async function sinAvisos<T>(fn: (avisos: unknown[]) => Promise<T>): Promise<T> {
  const avisos: unknown[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => { avisos.push(a); };
  try { return await fn(avisos); } finally { console.warn = warn; }
}

// 17-sep-2026 — EL REDISEÑO PASÓ A SER EL PANEL POR DEFECTO, así que la fila ya
// no enciende: APAGA. Lo que sigue midiendo lo mismo es el lado que no cambió —
// la fila de una clínica solo afecta a esa clínica. Los cuatro casos del nuevo
// contrato (sin fila · fila true · fila false · apagador global) viven en
// src/lib/menu-dos-niveles/__tests__/rediseno-por-defecto.test.ts.
test("interruptor: solo apaga una fila enabled=false de ESA clínica", async () => {
  const { encendido, cuenta } = interruptorDePrueba();
  assert.equal(await encendido("clinica-altabrisa"), true);
  assert.equal(await encendido("otra-clinica"), false, "su fila dice enabled=false");
  assert.deepEqual(cuenta.filas, ["clinica-altabrisa", "otra-clinica"]);

  const apagado = interruptorDePrueba({ fila: async () => ({ enabled: false }) });
  assert.equal(await apagado.encendido("clinica-altabrisa"), false);
  const sinFila = interruptorDePrueba({ fila: async () => null });
  assert.equal(await sinFila.encendido("clinica-altabrisa"), true, "sin fila, el panel por defecto");
});

test("interruptor: sin clínica no consulta nada (clinicId undefined no filtra en Prisma)", async () => {
  const { encendido, cuenta } = interruptorDePrueba();
  // Lo que vigila esto es que NO se consulte; la respuesta es la de por defecto.
  for (const id of [undefined, null, "", "   "]) assert.equal(await encendido(id), true);
  assert.equal(cuenta.tabla, 0);
  assert.deepEqual(cuenta.filas, []);
});

test("interruptor: sin la tabla (SQL sin aplicar) nunca lee la fila, así Prisma no ensucia el log", async () => {
  const { encendido, cuenta, avanzar } = interruptorDePrueba({ tabla: false });
  await sinAvisos(async (avisos) => {
    for (let i = 0; i < 5; i++) assert.equal(await encendido(`c${i}`), true);
    assert.deepEqual(cuenta.filas, []);
    assert.equal(cuenta.tabla, 1, "se pregunta una vez y se recuerda un minuto");
    avanzar(60_000);
    await encendido("c-nueva");
    assert.equal(cuenta.tabla, 2, "pasado el minuto vuelve a mirar (por si ya se aplicó el SQL)");
    assert.equal(avisos.length, 0, "que falte la tabla es lo normal antes del SQL: sin ruido");
  });
});

test("interruptor: una respuesta por clínica por minuto", async () => {
  const { encendido, cuenta, avanzar } = interruptorDePrueba();
  for (let i = 0; i < 10; i++) assert.equal(await encendido("clinica-altabrisa"), true);
  assert.equal(cuenta.filas.length, 1);
  avanzar(59_999);
  await encendido("clinica-altabrisa");
  assert.equal(cuenta.filas.length, 1);
  avanzar(1);
  await encendido("clinica-altabrisa");
  assert.equal(cuenta.filas.length, 2, "apagarlo en la base se nota en menos de un minuto");
});

test("interruptor: base caída sin respuesta previa → el panel por defecto, sin lanzar, y reintenta a los 10 s", async () => {
  await sinAvisos(async (avisos) => {
    let falla = true;
    const caida = interruptorDePrueba({
      fila: async () => { if (falla) throw Object.assign(new Error("x"), { code: "P1001" }); return { enabled: true }; },
    });
    // Un fallo de la base no apaga a nadie: sin respuesta previa vale el defecto.
    assert.equal(await caida.encendido("clinica-altabrisa"), true);
    falla = false;
    assert.equal(await caida.encendido("clinica-altabrisa"), true, "durante la pausa no insiste contra la base");
    assert.equal(caida.cuenta.filas.length, 1);
    caida.avanzar(10_000);
    assert.equal(await caida.encendido("clinica-altabrisa"), true, "pasada la pausa, reintenta");
    assert.equal(caida.cuenta.filas.length, 2, "el reintento sí va a la base (la respuesta ya no lo delata)");

    const tablaRota = interruptorDePrueba({ tabla: async () => { throw new Error("pooler"); } });
    assert.equal(await tablaRota.encendido("c1"), true);
    tablaRota.avanzar(10_000);
    await tablaRota.encendido("c1");
    assert.equal(tablaRota.cuenta.tabla, 2, "un fallo al mirar la tabla no se recuerda como «no hay tabla»");
    assert.equal(avisos.length, 3);
  });
});

test("interruptor: un fallo suelto de la base NO cambia el menú de una clínica que ya se sabía encendida", async () => {
  await sinAvisos(async () => {
    let falla = false;
    const { encendido, cuenta, avanzar } = interruptorDePrueba({
      fila: async () => { if (falla) throw Object.assign(new Error("pool"), { code: "P2024" }); return { enabled: true }; },
    });
    assert.equal(await encendido("clinica-altabrisa"), true);
    avanzar(60_000);
    falla = true;
    assert.equal(await encendido("clinica-altabrisa"), true, "la base falla: se mantiene la última respuesta buena");
    assert.equal(await encendido("clinica-altabrisa"), true, "y durante la pausa también");
    assert.equal(cuenta.filas.length, 2, "durante la pausa no insiste contra la base");
    avanzar(10_000);
    falla = false;
    assert.equal(await encendido("clinica-altabrisa"), true);
    assert.equal(cuenta.filas.length, 3);
  });
});

test("interruptor: apagarlo sí se nota aunque luego la base falle (la última respuesta buena es «apagado»)", async () => {
  await sinAvisos(async () => {
    let fila: { enabled: boolean } | "falla" = { enabled: true };
    const { encendido, avanzar } = interruptorDePrueba({
      fila: async () => { if (fila === "falla") throw new Error("x"); return fila; },
    });
    assert.equal(await encendido("clinica-altabrisa"), true);
    fila = { enabled: false };
    avanzar(60_000);
    assert.equal(await encendido("clinica-altabrisa"), false);
    fila = "falla";
    avanzar(60_000);
    assert.equal(await encendido("clinica-altabrisa"), false);
  });
});

test("interruptor: cargas simultáneas de la misma clínica comparten una consulta", async () => {
  let soltar: (v: { enabled: boolean }) => void = () => {};
  const { encendido, cuenta } = interruptorDePrueba({
    fila: () => new Promise((resolve) => { soltar = resolve; }),
  });
  const tres = [encendido("clinica-altabrisa"), encendido("clinica-altabrisa"), encendido("clinica-altabrisa")];
  await new Promise((r) => setTimeout(r, 10));
  soltar({ enabled: true });
  assert.deepEqual(await Promise.all(tres), [true, true, true]);
  assert.equal(cuenta.filas.length, 1);
});

// ── SQL ⇄ Prisma ─────────────────────────────────────────────────────

test("el SQL es aditivo y habla de la misma tabla y columnas que el modelo Prisma", () => {
  const sql = leer("sql/menu-dos-niveles.sql");
  const sinComentarios = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.match(sinComentarios, /CREATE TABLE IF NOT EXISTS "clinic_feature_flags"/);
  // (ON DELETE CASCADE de la llave foránea sí vale: no borra nada al correr.)
  assert.doesNotMatch(sinComentarios, /^\s*(DROP|TRUNCATE)\b|DELETE\s+FROM|UPDATE\s+"(?!clinic_feature_flags)|ALTER TABLE "(clinics|users)"/im);
  assert.match(sinComentarios, /lower\(btrim\("name"\)\) = 'local altabrisa'/, "encendido solo por nombre exacto");
  assert.doesNotMatch(sinComentarios, /DO UPDATE/, "re-correr el SQL no reenciende lo que se apagó");
  assert.ok(sinComentarios.includes(`'${FLAG_MENU_DOS_NIVELES}'`));
  for (const col of ["clinicId", "flag", "enabled", "createdAt"]) assert.ok(sinComentarios.includes(`"${col}"`), col);

  const schema = leer("prisma/schema.prisma");
  const modelo = schema.match(/model ClinicFeatureFlag \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(modelo, /@@map\("clinic_feature_flags"\)/);
  assert.match(modelo, /@@id\(\[clinicId, flag\]\)/);
  for (const col of ["clinicId", "flag", "enabled", "createdAt"]) assert.match(modelo, new RegExp(`\\n\\s+${col}\\s`), col);

  const clinica = schema.match(/model Clinic \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(clinica.length > 0);
  assert.doesNotMatch(clinica, /ClinicFeatureFlag/, "Clinic no conoce la tabla: el login no depende de ella");
});
