/**
 * Personalizar el menú — candados.
 *
 * Run: npm run test:menu-personalizado
 *
 * Lo que fija, por orden de lo que más duele si se rompe:
 *  - SIN personalizar, el menú es EXACTAMENTE el de fábrica (mismo orden, mismos
 *    grupos, mismos vacíos podados) para cualquier persona, plan y giro.
 *  - Personalizar NO añade opciones: lo que no ves, no se pinta aunque esté
 *    guardado; y si te devuelven el permiso, vuelve a TU sitio, no al de fábrica.
 *  - Una opción NUEVA del panel aparece sola, donde la pondría el menú de
 *    fábrica; y si ese sitio ya no existe, al final del menú principal.
 *  - Guardar no pierde lo que no se ve (va en su contenedor y detrás de su vecina).
 *  - Lo que llega de fuera se sanea: ids inventados, repetidos, nombres con
 *    caracteres de control, topes, versión desconocida.
 *  - Mover, subir, bajar, crear y borrar: un submenú o una sección solo se
 *    borran VACÍOS, y la última sección de un submenú no se borra.
 *  - La regla de soltar (arrastre) cae donde debe, incluida la de meter una
 *    opción dentro de un submenú.
 *  - El almacén falla cerrado (sin tabla, error de base) pero NO por reloj: a la
 *    base lenta se la espera, porque un tope devolvía el menú de fábrica en las
 *    pantallas pesadas y el menú cambiaba de forma al navegar. Y dos pestañas no
 *    se pisan: la segunda recibe «conflicto», no pisa a la primera.
 *  - El SQL y el modelo Prisma hablan de la misma tabla, sin bloques DO, y el
 *    modelo User no la conoce (el login lee al usuario con todas sus columnas).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NAV_ITEMS,
  type ClinicCategory,
  type NavItemDef,
  type SidebarUser,
  type UserRole,
} from "@/components/dashboard/sidebar-nav";
import { GRUPOS, NIVEL1_IDS, armarMenu, opcionesVisibles } from "@/components/dashboard/menu-dos-niveles/estructura";
import {
  MAX_SUBMENUS,
  SUBMENU_ADMIN,
  VERSION_DISENO,
  aplicarDiseno,
  disenoDesdeArmado,
  disenoPorDefecto,
  filtrarSecciones,
  fusionarOcultas,
  idsDelDiseno,
  normalizarDiseno,
  submenuActivo,
  ubicacionPorDefecto,
  type DisenoMenu,
} from "../diseno";
import {
  CONTENEDOR_RAIZ,
  borrarSeccion,
  borrarSubmenu,
  crearSeccion,
  crearSubmenu,
  desplazarOpcion,
  moverOpcion,
  moverSubmenu,
  opcionesDe,
  puedeDesplazarOpcion,
  renombrarSeccion,
  renombrarSubmenu,
  seccionVacia,
  submenuVacio,
  ubicacionDe,
} from "../editar";
import { claveContenedor, soltar } from "../arrastre";
import { crearAlmacen, type DependenciasAlmacen } from "../almacen-core";
import { ICONOS_EN_FUENTE } from "@/components/dashboard/menu-dos-niveles/iconos";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

const MODULOS_PRO = ["ai-assistant", "inbox", "whatsapp", "marketplace", "analytics", "reports", "landing", "tv-modes"];
const MODULOS_BASICO = MODULOS_PRO.filter((k) => !["ai-assistant", "analytics", "tv-modes"].includes(k));
const ROLES: UserRole[] = ["SUPER_ADMIN", "ADMIN", "DOCTOR", "RECEPTIONIST", "READONLY", "ACCOUNTANT"];
const CATEGORIAS: ClinicCategory[] = ["DENTAL", "MEDICINE", "PODIATRY", "BEAUTY_CENTER", "PSYCHOLOGY", "OTHER"];

const persona = (role: UserRole, permissionsOverride: string[] = []): SidebarUser => ({
  firstName: "Ana", lastName: "Ruiz", email: "ana@clinica.mx", role, permissionsOverride,
});

const visiblesDe = (role: UserRole, categoria: ClinicCategory = "DENTAL", modulos = MODULOS_PRO, perms: string[] = []) =>
  opcionesVisibles(persona(role, perms), categoria, modulos);

const ids = (items: NavItemDef[]) => items.map((it) => it.id);

/** El menú armado, aplanado a algo que se pueda comparar de un vistazo. */
function retrato(armado: ReturnType<typeof aplicarDiseno>): string[] {
  return armado.entradas.map((e) =>
    e.tipo === "opcion"
      ? e.item.id
      : `${e.id}{${e.secciones.map((s) => `${s.id}:${ids(s.items).join(",")}`).join("|")}}`,
  );
}

// ═══════════════════════════════════════════════════════════════════
// 1. Sin personalizar, el menú de fábrica — exactamente
// ═══════════════════════════════════════════════════════════════════

test("sin diseño guardado, el menú es idéntico al de fábrica (todas las personas)", () => {
  for (const role of ROLES) {
    for (const categoria of CATEGORIAS) {
      for (const modulos of [MODULOS_PRO, MODULOS_BASICO]) {
        const visibles = opcionesVisibles(persona(role), categoria, modulos);
        const fabrica = armarMenu(visibles);
        const armado = aplicarDiseno(null, visibles);

        const nivel1 = armado.entradas.filter((e) => e.tipo === "opcion").map((e) => (e as { item: NavItemDef }).item.id);
        assert.deepEqual(nivel1, ids(fabrica.nivel1), `nivel 1 de ${role}/${categoria}`);

        const submenus = armado.entradas.filter((e) => e.tipo === "submenu");
        if (fabrica.grupos.length === 0) {
          assert.equal(submenus.length, 0, `${role}/${categoria} no debería tener submenú`);
          continue;
        }
        assert.equal(submenus.length, 1);
        const admin = submenus[0] as Extract<(typeof submenus)[number], { tipo: "submenu" }>;
        assert.equal(admin.id, SUBMENU_ADMIN);
        assert.deepEqual(
          admin.secciones.map((s) => s.id),
          fabrica.grupos.map((g) => g.id),
        );
        admin.secciones.forEach((s, i) => assert.deepEqual(ids(s.items), ids(fabrica.grupos[i].items)));
      }
    }
  }
});

test("el diseño de fábrica menciona TODAS las opciones y ninguna dos veces", () => {
  const todos = idsDelDiseno(disenoPorDefecto());
  assert.equal(new Set(todos).size, todos.length, "hay ids repetidos en el diseño de fábrica");
  const sinSitio = NAV_ITEMS.filter((it) => !it.suspendedOnly && !todos.includes(it.id));
  assert.deepEqual(sinSitio.map((it) => it.id), [], "opciones sin sitio en el diseño de fábrica");
});

test("un diseño de otra versión se ignora: sale el menú de fábrica", () => {
  const visibles = visiblesDe("SUPER_ADMIN");
  const raro = { v: 99, entradas: [{ tipo: "opcion" as const, id: "home" }] } as unknown as DisenoMenu;
  assert.deepEqual(retrato(aplicarDiseno(raro, visibles)), retrato(aplicarDiseno(null, visibles)));
});

// ═══════════════════════════════════════════════════════════════════
// 2. Permisos: personalizar mueve, nunca añade
// ═══════════════════════════════════════════════════════════════════

test("una opción guardada que ya no se ve NO se pinta, y el resto no se mueve", () => {
  // La recepcionista coloca Reportes en su menú principal, arriba del todo.
  const conReportes = visiblesDe("RECEPTIONIST", "DENTAL", MODULOS_PRO, ["reports.view", "agenda.view", "patients.view"]);
  assert.ok(ids(conReportes).includes("reports"));
  const diseno = moverOpcion(disenoDesdeArmado(aplicarDiseno(null, conReportes)), "reports", CONTENEDOR_RAIZ, 0);
  assert.equal(retrato(aplicarDiseno(diseno, conReportes))[0], "reports");

  // Le quitan «ver reportes»: desaparece del menú y NADA más cambia.
  const sinReportes = visiblesDe("RECEPTIONIST", "DENTAL", MODULOS_PRO, ["agenda.view", "patients.view"]);
  assert.ok(!ids(sinReportes).includes("reports"));
  const armadoSin = retrato(aplicarDiseno(diseno, sinReportes));
  assert.ok(!armadoSin.join("|").includes("reports"));
  assert.deepEqual(armadoSin, retrato(aplicarDiseno(diseno, sinReportes)));

  // Se lo devuelven: vuelve a SU sitio (arriba), no al de fábrica.
  assert.equal(retrato(aplicarDiseno(diseno, conReportes))[0], "reports");
});

test("personalizar no puede colar una opción que la persona no ve", () => {
  const visiblesDoctor = visiblesDe("DOCTOR");
  assert.ok(!ids(visiblesDoctor).includes("finanzas"));
  // Un diseño con «finanzas» metida a mano en el primer nivel.
  const trucado: DisenoMenu = {
    v: VERSION_DISENO,
    entradas: [{ tipo: "opcion", id: "finanzas" }, ...disenoPorDefecto().entradas],
  };
  assert.ok(!retrato(aplicarDiseno(trucado, visiblesDoctor)).join("|").includes("finanzas"));
  // Y para quien sí la ve, aparece donde la puso.
  assert.equal(retrato(aplicarDiseno(trucado, visiblesDe("SUPER_ADMIN")))[0], "finanzas");
});

// ═══════════════════════════════════════════════════════════════════
// 3. Opciones nuevas del panel
// ═══════════════════════════════════════════════════════════════════

test("una opción nueva aparece sola, en el sitio que le daría el menú de fábrica", () => {
  const visibles = visiblesDe("SUPER_ADMIN");
  const base = disenoDesdeArmado(aplicarDiseno(null, visibles));
  // Un diseño viejo: el de fábrica sin «reports» (como si no hubiera existido).
  const viejo: DisenoMenu = {
    v: VERSION_DISENO,
    entradas: base.entradas.map((e) =>
      e.tipo === "opcion" ? e : { ...e, secciones: e.secciones.map((s) => ({ ...s, opciones: s.opciones.filter((id) => id !== "reports") })) },
    ),
  };
  const armado = aplicarDiseno(viejo, visibles);
  const admin = armado.entradas.find((e) => e.tipo === "submenu") as Extract<(typeof armado.entradas)[number], { tipo: "submenu" }>;
  const dinero = admin.secciones.find((s) => s.id === "dinero");
  // Entre sus vecinas de fábrica: finanzas, analytics, reports.
  assert.deepEqual(ids(dinero!.items), ["finanzas", "analytics", "reports"]);
});

test("si el sitio de fábrica ya no existe, la opción nueva sale al final del menú principal", () => {
  const visibles = visiblesDe("SUPER_ADMIN");
  // La persona borró «Administración» entera (después de vaciarla).
  const soloPrimerNivel: DisenoMenu = {
    v: VERSION_DISENO,
    entradas: NIVEL1_IDS.map((id) => ({ tipo: "opcion" as const, id })),
  };
  const armado = aplicarDiseno(soloPrimerNivel, visibles);
  assert.equal(armado.entradas.filter((e) => e.tipo === "submenu").length, 0, "no debería inventar submenús");
  const primeros = armado.entradas.slice(0, NIVEL1_IDS.length).map((e) => (e as { item: NavItemDef }).item.id);
  assert.deepEqual(primeros, ids(aplicarDiseno(null, visibles).entradas.slice(0, NIVEL1_IDS.length).map((e) => (e as { item: NavItemDef }).item)));
  // Todo lo que vivía en Administración sigue estando, al final y accesible.
  const todos = armado.entradas.map((e) => (e as { item?: NavItemDef }).item?.id).filter(Boolean);
  for (const it of visibles) assert.ok(todos.includes(it.id), `se perdió ${it.id}`);
});

test("ubicacionPorDefecto conoce el sitio de cada opción y manda las desconocidas a «mas»", () => {
  assert.deepEqual(ubicacionPorDefecto("home"), { submenu: null, seccion: null });
  assert.deepEqual(ubicacionPorDefecto("finanzas"), { submenu: SUBMENU_ADMIN, seccion: "dinero" });
  assert.deepEqual(ubicacionPorDefecto("pantalla-que-no-existe"), { submenu: SUBMENU_ADMIN, seccion: "mas" });
  for (const g of GRUPOS) for (const id of g.ids) assert.equal(ubicacionPorDefecto(id).seccion, g.id);
});

// ═══════════════════════════════════════════════════════════════════
// 4. Guardar sin perder lo que no se ve
// ═══════════════════════════════════════════════════════════════════

test("guardar conserva las opciones ocultas en su contenedor y detrás de su vecina", () => {
  const guardado: DisenoMenu = {
    v: VERSION_DISENO,
    entradas: [
      { tipo: "opcion", id: "home" },
      { tipo: "opcion", id: "billing" }, // esta persona ya no ve Caja
      { tipo: "opcion", id: "patients" },
      {
        tipo: "submenu",
        id: SUBMENU_ADMIN,
        nombre: null,
        secciones: [{ id: "dinero", nombre: null, opciones: ["finanzas", "reports"] }],
      },
    ],
  };
  // El editor solo pudo tocar lo visible: ni «billing» ni «finanzas» salieron.
  const borrador: DisenoMenu = {
    v: VERSION_DISENO,
    entradas: [
      { tipo: "opcion", id: "patients" },
      { tipo: "opcion", id: "home" },
      { tipo: "submenu", id: SUBMENU_ADMIN, nombre: null, secciones: [{ id: "dinero", nombre: null, opciones: ["reports"] }] },
    ],
  };
  const fusionado = fusionarOcultas(guardado, borrador);
  const raiz = fusionado.entradas.filter((e) => e.tipo === "opcion").map((e) => (e as { id: string }).id);
  assert.deepEqual(raiz, ["patients", "home", "billing"], "billing se conserva detrás de home, su vecina");
  const admin = fusionado.entradas.find((e) => e.tipo === "submenu") as { secciones: { opciones: string[] }[] };
  assert.deepEqual(admin.secciones[0].opciones, ["finanzas", "reports"], "finanzas vuelve delante de reports");
});

test("dos ocultas seguidas conservan su orden", () => {
  const guardado: DisenoMenu = {
    v: VERSION_DISENO,
    entradas: [
      { tipo: "opcion", id: "home" },
      { tipo: "opcion", id: "billing" },
      { tipo: "opcion", id: "inbox" },
      { tipo: "opcion", id: "patients" },
    ],
  };
  const borrador: DisenoMenu = {
    v: VERSION_DISENO,
    entradas: [{ tipo: "opcion", id: "home" }, { tipo: "opcion", id: "patients" }],
  };
  const fusionado = fusionarOcultas(guardado, borrador);
  assert.deepEqual(
    fusionado.entradas.map((e) => (e as { id: string }).id),
    ["home", "billing", "inbox", "patients"],
  );
});

test("si el contenedor donde vivía la oculta ya no existe, el id se cae (y volverá al sitio de fábrica)", () => {
  const guardado: DisenoMenu = {
    v: VERSION_DISENO,
    entradas: [
      { tipo: "opcion", id: "home" },
      { tipo: "submenu", id: "sabcdef", nombre: "Mío", secciones: [{ id: "gabcdef", nombre: null, opciones: ["reports"] }] },
    ],
  };
  const borrador: DisenoMenu = { v: VERSION_DISENO, entradas: [{ tipo: "opcion", id: "home" }] };
  const fusionado = fusionarOcultas(guardado, borrador);
  assert.deepEqual(idsDelDiseno(fusionado), ["home"]);
  // Y al volver a verse sigue estando, no se pierde: como su submenú ya no
  // existe, sale al final del menú principal (regla de las opciones nuevas).
  const armado = aplicarDiseno(fusionado, visiblesDe("SUPER_ADMIN"));
  const enPrimerNivel = armado.entradas
    .filter((e) => e.tipo === "opcion")
    .map((e) => (e as { item: NavItemDef }).item.id);
  assert.ok(enPrimerNivel.includes("reports"));
});

// ═══════════════════════════════════════════════════════════════════
// 5. Sanear lo que llega de fuera
// ═══════════════════════════════════════════════════════════════════

test("normalizarDiseno tira la basura y se queda con lo aprovechable", () => {
  assert.equal(normalizarDiseno(null), null);
  assert.equal(normalizarDiseno("una cadena"), null);
  assert.equal(normalizarDiseno([]), null);
  assert.equal(normalizarDiseno({ v: 2, entradas: [] }), null);
  assert.equal(normalizarDiseno({ v: VERSION_DISENO, entradas: "no es lista" }), null);
  assert.equal(normalizarDiseno({ v: VERSION_DISENO, entradas: [] }), null);

  const saneado = normalizarDiseno({
    v: VERSION_DISENO,
    entradas: [
      { tipo: "opcion", id: "home" },
      { tipo: "opcion", id: "home" },                    // repetida
      { tipo: "opcion", id: "pantalla-inventada" },      // id que no existe
      { tipo: "opcion" },                                // sin id
      { tipo: "submenu", id: "NO-VALE", nombre: "x", secciones: [] },
      {
        tipo: "submenu",
        id: "sabc123",
        nombre: "  Mi  menú   raro  ",
        secciones: [
          { id: "gabc123", nombre: "x".repeat(80), opciones: ["reports", "reports", 42, "nope"] },
          { id: "gabc123", nombre: null, opciones: [] },  // sección repetida
        ],
      },
    ],
  });
  assert.ok(saneado);
  assert.deepEqual(idsDelDiseno(saneado!), ["home", "reports"]);
  const sm = saneado!.entradas.find((e) => e.tipo === "submenu") as { id: string; nombre: string; secciones: unknown[] };
  assert.equal(sm.id, "sabc123");
  assert.equal(sm.nombre, "Mi menú raro", "los caracteres de control y los espacios de más se limpian");
  assert.equal(sm.secciones.length, 1);
  const seccion = sm.secciones[0] as { nombre: string };
  assert.equal(seccion.nombre.length, 32, "el nombre se recorta al tope");
});

test("normalizarDiseno respeta el tope de submenús", () => {
  const entradas = Array.from({ length: MAX_SUBMENUS + 5 }, (_, i) => ({
    tipo: "submenu" as const,
    id: `s${String(i).padStart(5, "0")}`,
    nombre: `Submenú ${i}`,
    secciones: [],
  }));
  const saneado = normalizarDiseno({ v: VERSION_DISENO, entradas });
  assert.equal(saneado!.entradas.length, MAX_SUBMENUS);
});

// ═══════════════════════════════════════════════════════════════════
// 6. Mover, crear y borrar
// ═══════════════════════════════════════════════════════════════════

const baseEditable = (): DisenoMenu => ({
  v: VERSION_DISENO,
  entradas: [
    { tipo: "opcion", id: "home" },
    { tipo: "opcion", id: "appointments" },
    { tipo: "opcion", id: "patients" },
    {
      tipo: "submenu",
      id: SUBMENU_ADMIN,
      nombre: null,
      secciones: [
        { id: "dinero", nombre: null, opciones: ["finanzas", "reports"] },
        { id: "sistema", nombre: null, opciones: ["settings"] },
      ],
    },
  ],
});

test("mover una opción fuera y dentro de Administración", () => {
  let d = baseEditable();
  d = moverOpcion(d, "finanzas", CONTENEDOR_RAIZ, 1);
  assert.deepEqual(opcionesDe(d, CONTENEDOR_RAIZ), ["home", "finanzas", "appointments", "patients"]);
  assert.deepEqual(opcionesDe(d, { submenuId: SUBMENU_ADMIN, seccionId: "dinero" }), ["reports"]);

  d = moverOpcion(d, "patients", { submenuId: SUBMENU_ADMIN, seccionId: "sistema" }, 0);
  assert.deepEqual(opcionesDe(d, { submenuId: SUBMENU_ADMIN, seccionId: "sistema" }), ["patients", "settings"]);
  assert.deepEqual(ubicacionDe(d, "patients"), { submenuId: SUBMENU_ADMIN, seccionId: "sistema", indice: 0 });
  // Ninguna opción se duplicó ni se perdió por el camino.
  assert.deepEqual(idsDelDiseno(d).sort(), idsDelDiseno(baseEditable()).sort());
});

test("subir y bajar mueven dentro del grupo y se apagan en los bordes", () => {
  const d = baseEditable();
  assert.equal(puedeDesplazarOpcion(d, "home", -1), false);
  assert.equal(puedeDesplazarOpcion(d, "patients", 1), false);
  assert.deepEqual(opcionesDe(desplazarOpcion(d, "patients", -1), CONTENEDOR_RAIZ), ["home", "patients", "appointments"]);
  assert.deepEqual(
    opcionesDe(desplazarOpcion(d, "finanzas", 1), { submenuId: SUBMENU_ADMIN, seccionId: "dinero" }),
    ["reports", "finanzas"],
  );
  // Una opción que no está en el diseño no rompe nada.
  assert.equal(desplazarOpcion(d, "no-existe", 1), d);
});

test("bajar una opción y volver a subirla deja el menú EXACTAMENTE como estaba", () => {
  // Con un submenú metido entre dos opciones, el ida y vuelta no puede
  // llevarse el submenú por delante.
  const conSubmenuEnMedio: DisenoMenu = {
    v: VERSION_DISENO,
    entradas: [
      { tipo: "opcion", id: "home" },
      { tipo: "submenu", id: SUBMENU_ADMIN, nombre: null, secciones: [{ id: "dinero", nombre: null, opciones: ["finanzas"] }] },
      { tipo: "opcion", id: "patients" },
      { tipo: "submenu", id: "sotro01", nombre: "Mío", secciones: [{ id: "gotro01", nombre: null, opciones: [] }] },
    ],
  };
  const abajo = desplazarOpcion(conSubmenuEnMedio, "home", 1);
  assert.deepEqual(opcionesDe(abajo, CONTENEDOR_RAIZ), ["patients", "home"]);
  const arriba = desplazarOpcion(abajo, "home", -1);
  assert.deepEqual(arriba, conSubmenuEnMedio, "el ida y vuelta tiene que ser idéntico");
  // Y el submenú del medio no se movió de su hueco en ninguno de los dos pasos.
  assert.equal(abajo.entradas[1].tipo, "submenu");
  assert.equal((abajo.entradas[1] as { id: string }).id, SUBMENU_ADMIN);
});

test("crear un submenú, ponerle nombre y meterle cosas", () => {
  const creado = crearSubmenu(baseEditable(), "Mi día", { submenu: "smidia1", seccion: "gmidia1" });
  assert.ok(creado);
  let d = creado!.diseno;
  assert.equal(creado!.id, "smidia1");
  d = moverOpcion(d, "appointments", { submenuId: "smidia1", seccionId: "gmidia1" }, 0);
  assert.deepEqual(opcionesDe(d, { submenuId: "smidia1", seccionId: "gmidia1" }), ["appointments"]);
  d = renombrarSubmenu(d, "smidia1", "  Mi jornada  ");
  const sm = d.entradas.find((e) => e.tipo === "submenu" && e.id === "smidia1") as { nombre: string };
  assert.equal(sm.nombre, "Mi jornada");
  // Nombre vacío = vuelve al de fábrica (null), no un submenú sin nombre.
  assert.equal((renombrarSubmenu(d, SUBMENU_ADMIN, "   ").entradas.find((e) => e.tipo === "submenu" && e.id === SUBMENU_ADMIN) as { nombre: string | null }).nombre, null);
});

test("un submenú solo se borra VACÍO", () => {
  const d = baseEditable();
  assert.equal(submenuVacio(d, SUBMENU_ADMIN), false);
  assert.equal(borrarSubmenu(d, SUBMENU_ADMIN), d, "con opciones dentro no se borra");

  let vaciado = d;
  for (const id of ["finanzas", "reports", "settings"]) vaciado = moverOpcion(vaciado, id, CONTENEDOR_RAIZ, 0);
  assert.equal(submenuVacio(vaciado, SUBMENU_ADMIN), true);
  const borrado = borrarSubmenu(vaciado, SUBMENU_ADMIN);
  assert.equal(borrado.entradas.filter((e) => e.tipo === "submenu").length, 0);
  assert.deepEqual(idsDelDiseno(borrado).sort(), idsDelDiseno(d).sort(), "no se perdió ninguna opción al borrar el submenú");
});

test("una sección solo se borra vacía, y nunca la última de su submenú", () => {
  let d = baseEditable();
  assert.equal(seccionVacia(d, SUBMENU_ADMIN, "sistema"), false);
  assert.equal(borrarSeccion(d, SUBMENU_ADMIN, "sistema"), d);

  d = moverOpcion(d, "settings", { submenuId: SUBMENU_ADMIN, seccionId: "dinero" }, 0);
  assert.equal(seccionVacia(d, SUBMENU_ADMIN, "sistema"), true);
  const sinSistema = borrarSeccion(d, SUBMENU_ADMIN, "sistema");
  const admin = sinSistema.entradas.find((e) => e.tipo === "submenu") as { secciones: { id: string }[] };
  assert.deepEqual(admin.secciones.map((s) => s.id), ["dinero"]);

  // Ahora «dinero» es la única: aunque se vacíe, no se borra (el submenú entero sí).
  let vacia = sinSistema;
  for (const id of ["settings", "finanzas", "reports"]) vacia = moverOpcion(vacia, id, CONTENEDOR_RAIZ, 0);
  assert.equal(borrarSeccion(vacia, SUBMENU_ADMIN, "dinero"), vacia);
});

test("crear y renombrar secciones dentro de un submenú", () => {
  const creada = crearSeccion(baseEditable(), SUBMENU_ADMIN, "Lo mío", "gmio001");
  assert.ok(creada);
  const d = renombrarSeccion(creada!.diseno, SUBMENU_ADMIN, "gmio001", "Lo mío del día");
  const admin = d.entradas.find((e) => e.tipo === "submenu") as { secciones: { id: string; nombre: string | null }[] };
  assert.deepEqual(admin.secciones.map((s) => s.id), ["dinero", "sistema", "gmio001"]);
  assert.equal(admin.secciones[2].nombre, "Lo mío del día");
  assert.equal(crearSeccion(d, "submenu-que-no-existe", "x"), null);
});

test("«al final del menú principal» es al final de las OPCIONES, no debajo de los submenús", () => {
  // El fallo que esto fija: mandar una opción al final la dejaba colgando por
  // DEBAJO de «Administración», con dos rayas, que es lo contrario de sacarla.
  const d = baseEditable();
  const alFinal = moverOpcion(d, "home", CONTENEDOR_RAIZ, opcionesDe(d, CONTENEDOR_RAIZ).length);
  assert.deepEqual(opcionesDe(alFinal, CONTENEDOR_RAIZ), ["appointments", "patients", "home"]);
  assert.equal(alFinal.entradas[alFinal.entradas.length - 1].tipo, "submenu", "el submenú sigue el último");

  // Y lo mismo por el otro camino: la flecha ↓ de la penúltima opción.
  const bajada = desplazarOpcion(d, "appointments", 1);
  assert.deepEqual(opcionesDe(bajada, CONTENEDOR_RAIZ), ["home", "patients", "appointments"]);
  assert.equal(bajada.entradas[bajada.entradas.length - 1].tipo, "submenu");
  // La última no baja más.
  assert.equal(puedeDesplazarOpcion(d, "patients", 1), false);

  // Soltando encima de la última opción, igual.
  const soltada = soltar(d, "op:home", "op:patients");
  assert.equal(soltada.entradas[soltada.entradas.length - 1].tipo, "submenu");
  assert.deepEqual(opcionesDe(soltada, CONTENEDOR_RAIZ), ["appointments", "patients", "home"]);
});

test("una opción cabe en un menú principal que solo tiene submenús", () => {
  const soloSubmenu: DisenoMenu = {
    v: VERSION_DISENO,
    entradas: [
      { tipo: "submenu", id: SUBMENU_ADMIN, nombre: null, secciones: [{ id: "dinero", nombre: null, opciones: ["finanzas"] }] },
    ],
  };
  const fuera = moverOpcion(soloSubmenu, "finanzas", CONTENEDOR_RAIZ, 0);
  assert.deepEqual(opcionesDe(fuera, CONTENEDOR_RAIZ), ["finanzas"]);
  assert.equal(fuera.entradas[0].tipo, "opcion", "la opción va arriba, donde se ve");
});

test("mover un submenú por el menú principal", () => {
  const d = moverSubmenu(baseEditable(), SUBMENU_ADMIN, 0);
  assert.equal(d.entradas[0].tipo, "submenu");
  assert.deepEqual(opcionesDe(d, CONTENEDOR_RAIZ), ["home", "appointments", "patients"]);
});

// ═══════════════════════════════════════════════════════════════════
// 7. La regla de soltar (arrastre)
// ═══════════════════════════════════════════════════════════════════

test("soltar una opción encima de otra la deja en ese sitio", () => {
  const d = soltar(baseEditable(), "op:patients", "op:home");
  assert.deepEqual(opcionesDe(d, CONTENEDOR_RAIZ), ["patients", "home", "appointments"]);
});

test("soltar una opción encima de un submenú la mete dentro", () => {
  const d = soltar(baseEditable(), "op:patients", `sm:${SUBMENU_ADMIN}`);
  assert.deepEqual(opcionesDe(d, { submenuId: SUBMENU_ADMIN, seccionId: "dinero" }), ["finanzas", "reports", "patients"]);
  assert.deepEqual(opcionesDe(d, CONTENEDOR_RAIZ), ["home", "appointments"]);
});

test("soltar en el encabezado de una sección y en una zona vacía", () => {
  const enSeccion = soltar(baseEditable(), "op:home", `sc:${SUBMENU_ADMIN}:sistema`);
  assert.deepEqual(opcionesDe(enSeccion, { submenuId: SUBMENU_ADMIN, seccionId: "sistema" }), ["settings", "home"]);

  const nuevo = crearSubmenu(baseEditable(), "Vacío", { submenu: "svacio1", seccion: "gvacio1" })!.diseno;
  const dentro = soltar(nuevo, "op:home", claveContenedor({ submenuId: "svacio1", seccionId: "gvacio1" }));
  assert.deepEqual(opcionesDe(dentro, { submenuId: "svacio1", seccionId: "gvacio1" }), ["home"]);
});

test("soltar un submenú lo lleva a esa altura, y no se mete dentro de otro", () => {
  const arriba = soltar(baseEditable(), `sm:${SUBMENU_ADMIN}`, "op:home");
  assert.equal(arriba.entradas[0].tipo, "submenu");
  // Encima de una sección de otro submenú: no pasa nada.
  const igual = baseEditable();
  assert.deepEqual(soltar(igual, `sm:${SUBMENU_ADMIN}`, `sc:${SUBMENU_ADMIN}:dinero`), igual);
});

test("soltar algo sobre sí mismo o sobre una clave desconocida no cambia nada", () => {
  const d = baseEditable();
  assert.deepEqual(soltar(d, "op:home", "op:home"), d);
  assert.deepEqual(soltar(d, "op:home", "vaya:cosa"), d);
  assert.deepEqual(soltar(d, "op:no-existe", "op:home"), d);
});

// ═══════════════════════════════════════════════════════════════════
// 8. Buscador y fila activa del segundo nivel
// ═══════════════════════════════════════════════════════════════════

test("el buscador del segundo nivel filtra por nombre y esconde las secciones vacías", () => {
  const armado = aplicarDiseno(null, visiblesDe("SUPER_ADMIN"));
  const admin = armado.entradas.find((e) => e.tipo === "submenu") as Extract<(typeof armado.entradas)[number], { tipo: "submenu" }>;
  const etiqueta = (id: string) => ({ finanzas: "Finanzas", analytics: "Analítica" })[id] ?? id;
  const resultado = filtrarSecciones(admin.secciones, "analit", etiqueta);
  assert.deepEqual(resultado.map((s) => s.id), ["dinero"]);
  assert.deepEqual(ids(resultado[0].items), ["analytics"]);
  assert.equal(filtrarSecciones(admin.secciones, "", etiqueta).length, admin.secciones.length);
});

test("un submenú se pinta activo cuando la pantalla de ahora vive dentro", () => {
  const armado = aplicarDiseno(null, visiblesDe("SUPER_ADMIN"));
  const admin = armado.entradas.find((e) => e.tipo === "submenu") as Extract<(typeof armado.entradas)[number], { tipo: "submenu" }>;
  assert.equal(submenuActivo("/dashboard/finanzas", admin.secciones), true);
  assert.equal(submenuActivo("/dashboard/agenda", admin.secciones), false);
  assert.equal(submenuActivo(null, admin.secciones), false);
});

// ═══════════════════════════════════════════════════════════════════
// 9. El almacén: falla cerrado y no deja que dos pestañas se pisen
// ═══════════════════════════════════════════════════════════════════

function almacenDePrueba(over: Partial<DependenciasAlmacen> = {}) {
  const filas = new Map<string, { layout: unknown; revision: string; clinicId: string }>();
  let n = 0;
  const dep: DependenciasAlmacen = {
    tablaExiste: async () => true,
    leerFila: async (userId, clinicId) => {
      const f = filas.get(userId);
      return f && f.clinicId === clinicId ? { layout: f.layout, revision: f.revision } : null;
    },
    crearFila: async (userId, clinicId, layout, revision) => {
      if (filas.has(userId)) return 0;
      filas.set(userId, { layout, revision, clinicId });
      return 1;
    },
    actualizarFila: async (userId, clinicId, layout, revision, esperada) => {
      const f = filas.get(userId);
      if (!f || f.clinicId !== clinicId || f.revision !== esperada) return 0;
      filas.set(userId, { layout, revision, clinicId });
      return 1;
    },
    borrarFila: async (userId, clinicId) => {
      const f = filas.get(userId);
      if (f && f.clinicId === clinicId) filas.delete(userId);
    },
    nuevaRevision: () => `r${++n}`,
    ...over,
  };
  return { almacen: crearAlmacen(dep), filas };
}

const DISENO = disenoPorDefecto();

test("sin la tabla: no disponible, y guardar no revienta", async () => {
  const { almacen } = almacenDePrueba({ tablaExiste: async () => false });
  assert.deepEqual(await almacen.leer("u1", "c1"), { disponible: false, diseno: null, revision: null });
  assert.deepEqual(await almacen.guardar("u1", "c1", DISENO, null), { ok: false, motivo: "no-disponible" });
  assert.deepEqual(await almacen.borrar("u1", "c1"), { ok: false, motivo: "no-disponible" });
});

test("sin los dos ids no se consulta (un clinicId vacío en Prisma no filtraría)", async () => {
  let consultas = 0;
  const { almacen } = almacenDePrueba({
    leerFila: async () => {
      consultas += 1;
      return null;
    },
  });
  assert.equal((await almacen.leer("", "c1")).disponible, false);
  assert.equal((await almacen.leer("u1", "")).disponible, false);
  assert.equal(consultas, 0);
});

test("la base lenta NO devuelve el menú de fábrica: se la espera, tarde lo que tarde", async (t) => {
  // Esto era justo al revés (un tope de 1,5 s → menú de fábrica) y se cambió al
  // integrar con `fix/menu-en-todas-las-pantallas`, que ya había quitado ese
  // mismo tope del interruptor por haber medido que el reloj mide la COLA, no la
  // base: con `connection_limit=1` las consultas de una carga van en fila por una
  // sola conexión, así que en las pantallas pesadas el tope saltaba y en las
  // ligeras no — y a quien tuviera su menú armado le cambiaba de forma al
  // navegar, que es el defecto que aquella tarea existía para matar.
  //
  // Reloj simulado: si alguien vuelve a meter un tope con setTimeout, esto falla.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { almacen } = almacenDePrueba({
    leerFila: () => new Promise((r) => setTimeout(() => r({ layout: DISENO, revision: "r9" }), 30_000)),
  });
  let resuelta = false;
  const carga = almacen.leer("u1", "c1").then((v) => { resuelta = true; return v; });
  // Avanza el reloj de segundo en segundo. Cualquier tope interno de hasta 60 s
  // hecho con setTimeout saltaría ANTES que la base y devolvería el de fábrica.
  for (let seg = 0; seg < 60 && !resuelta; seg++) {
    await new Promise((r) => setImmediate(r));
    t.mock.timers.tick(1_000);
  }
  const respuesta = await carga;
  assert.equal(respuesta.disponible, true, "el menú personal no puede depender de cuánto tarda la base");
  assert.equal(respuesta.revision, "r9");
});

test("si la base se cae de verdad, ahí sí: menú de fábrica y sin «Personalizar»", async () => {
  // La red de seguridad que sustituye al tope. Prisma corta solo (pool_timeout)
  // y el error cae aquí; lo que se quitó fue el reloj arbitrario, no el cierre.
  const { almacen } = almacenDePrueba({
    leerFila: async () => { throw Object.assign(new Error("pool timeout"), { code: "P2024" }); },
  });
  assert.deepEqual(await almacen.leer("u1", "c1"), { disponible: false, diseno: null, revision: null });
});

test("la base rota no rompe el menú", async () => {
  const { almacen } = almacenDePrueba({
    leerFila: async () => {
      throw Object.assign(new Error("boom"), { code: "P1001" });
    },
  });
  assert.deepEqual(await almacen.leer("u1", "c1"), { disponible: false, diseno: null, revision: null });
});

test("un JSON ilegible en la base se trata como «sin personalizar»", async () => {
  const { almacen } = almacenDePrueba({ leerFila: async () => ({ layout: { cosas: true }, revision: "r0" }) });
  const lectura = await almacen.leer("u1", "c1");
  assert.equal(lectura.disponible, true);
  assert.equal(lectura.diseno, null);
  assert.equal(lectura.revision, "r0");
});

test("dos pestañas: la segunda recibe conflicto y NO pisa a la primera", async () => {
  const { almacen } = almacenDePrueba();
  // Las dos abren el editor sin nada guardado (revisión null).
  const primera = await almacen.guardar("u1", "c1", DISENO, null);
  assert.deepEqual(primera, { ok: true, revision: "r1" });

  const otroDiseno: DisenoMenu = { v: VERSION_DISENO, entradas: [{ tipo: "opcion", id: "home" }] };
  const segunda = await almacen.guardar("u1", "c1", otroDiseno, null);
  assert.equal(segunda.ok, false);
  assert.equal(segunda.ok === false && segunda.motivo, "conflicto");
  assert.equal(segunda.ok === false && segunda.motivo === "conflicto" && segunda.actual.revision, "r1");
  // Lo guardado sigue siendo lo de la primera.
  assert.deepEqual(idsDelDiseno((await almacen.leer("u1", "c1")).diseno!), idsDelDiseno(DISENO));

  // Con la revisión buena sí guarda, y con una revisión NUEVA (nunca repetida).
  const tercera = await almacen.guardar("u1", "c1", otroDiseno, "r1");
  assert.equal(tercera.ok, true);
  assert.notEqual(tercera.ok === true && tercera.revision, "r1");
  assert.deepEqual(idsDelDiseno((await almacen.leer("u1", "c1")).diseno!), ["home"]);
});

test("borrar y volver a crear no deja pasar un guardado viejo (la revisión no se repite)", async () => {
  const { almacen } = almacenDePrueba();
  await almacen.guardar("u1", "c1", DISENO, null);          // r1
  await almacen.borrar("u1", "c1");                          // volvió a fábrica
  await almacen.guardar("u1", "c1", DISENO, null);          // r2, otra persona/pestaña
  const viejo = await almacen.guardar("u1", "c1", DISENO, "r1");
  assert.equal(viejo.ok === false && viejo.motivo, "conflicto");
});

test("el menú personal de una clínica no se lee ni se pisa desde otra", async () => {
  const { almacen } = almacenDePrueba();
  await almacen.guardar("u1", "c1", DISENO, null);
  assert.equal((await almacen.leer("u1", "c2")).diseno, null, "otra sede no ve el diseño");
  const ajeno = await almacen.guardar("u1", "c2", DISENO, "r1");
  assert.equal(ajeno.ok, false, "no se puede guardar en la sede equivocada");
});

test("P2021 (la tabla desapareció) se trata como «no disponible», no como error", async () => {
  const { almacen } = almacenDePrueba({
    crearFila: async () => {
      throw Object.assign(new Error("no table"), { code: "P2021" });
    },
  });
  assert.deepEqual(await almacen.guardar("u1", "c1", DISENO, null), { ok: false, motivo: "no-disponible" });
});

// ═══════════════════════════════════════════════════════════════════
// 10. El SQL y el modelo Prisma dicen lo mismo
// ═══════════════════════════════════════════════════════════════════

test("el SQL crea la tabla que el modelo Prisma mapea, con sus columnas", () => {
  const sql = leer("sql/menu-personalizado.sql");
  const schema = leer("prisma/schema.prisma");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "user_menu_layouts"/);
  assert.match(schema, /model UserMenuLayout \{[\s\S]*?@@map\("user_menu_layouts"\)/);
  for (const columna of ["userId", "clinicId", "layout", "revision", "createdAt", "updatedAt"]) {
    assert.ok(sql.includes(`"${columna}"`), `falta la columna ${columna} en el SQL`);
    assert.match(schema, new RegExp(`\\n\\s+${columna}\\s`), `falta el campo ${columna} en Prisma`);
  }
});

test("el SQL es plano (sin bloques DO) e idempotente", () => {
  const sql = leer("sql/menu-personalizado.sql");
  assert.ok(!/^\s*DO\s+\$/m.test(sql), "el editor de Supabase se atraganta con los bloques DO");
  assert.match(sql, /CREATE INDEX IF NOT EXISTS/);
  // Todo lo que no admite IF NOT EXISTS se borra antes de crearlo.
  for (const nombre of ["user_menu_layouts_userId_fkey", "user_menu_layouts_clinicId_fkey"]) {
    assert.ok(sql.includes(`DROP CONSTRAINT IF EXISTS "${nombre}"`), `${nombre} no es idempotente`);
  }
  assert.match(sql, /DROP POLICY IF EXISTS "user_menu_layouts_deny_anon"/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.ok(!/ALTER TABLE "users"/.test(sql), "no se toca la tabla users: tumbaría el login");
});

test("el modelo User no conoce esta tabla (el login lee al usuario entero)", () => {
  const schema = leer("prisma/schema.prisma");
  const modeloUser = schema.slice(schema.indexOf("model User {"));
  const cuerpo = modeloUser.slice(0, modeloUser.indexOf("\n}\n"));
  assert.ok(!cuerpo.includes("UserMenuLayout"), "User no debe declarar la relación con user_menu_layouts");
});

test("la API de Personalizar exige sesión, clínica con el menú nuevo y sanea lo que llega", () => {
  const ruta = leer("src/app/api/menu-personalizado/route.ts");
  for (const metodo of ["export async function GET", "export async function PUT", "export async function DELETE"]) {
    assert.ok(ruta.includes(metodo), `falta ${metodo}`);
  }
  assert.equal(ruta.match(/getAuthContext\(\)/g)?.length, 3, "los tres métodos piden la sesión");
  assert.equal(ruta.match(/menuDosNivelesEncendido\(ctx\.clinicId\)/g)?.length, 3, "los tres miran el interruptor");
  assert.match(ruta, /normalizarDiseno\(cuerpo\.diseno\)/);
  assert.match(ruta, /fusionarOcultas\(previo\.diseno, borrador\)/);
  assert.ok(!/req\.(json|body)\(\)[\s\S]*clinicId/.test(ruta), "el clinicId nunca sale del cuerpo");
});

test("todo ícono que usa Personalizar está dentro de la fuente recortada", () => {
  // Si no, en vez del dibujo se vería la palabra «drag_indicator» escrita.
  const archivos = [
    "src/components/dashboard/menu-dos-niveles/personalizar/editor-menu.tsx",
    "src/components/dashboard/menu-dos-niveles/menu-dos-niveles.tsx",
  ];
  const usados = new Set<string>();
  for (const archivo of archivos) {
    for (const m of leer(archivo).matchAll(/<Icono\s+nombre=["`]([a-z_0-9]+)["`]/g)) usados.add(m[1]);
  }
  assert.ok(usados.has("drag_indicator") && usados.has("dashboard_customize"), "el escaneo no encontró los íconos nuevos");
  const fuera = [...usados].filter((n) => !ICONOS_EN_FUENTE.includes(n as (typeof ICONOS_EN_FUENTE)[number]));
  assert.deepEqual(fuera, [], "íconos que el menú usa y la fuente no trae");
});
