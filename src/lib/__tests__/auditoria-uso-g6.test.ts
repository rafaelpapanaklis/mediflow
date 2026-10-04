/**
 * Auditoría de uso, grupo G6 (ws1-t8, 4-oct-2026): admin, configuración,
 * textos, diseño y móvil. Una prueba por falla C-xx del CONSOLIDADO.
 *
 * Run: npm run test:auditoria-uso-g6
 *
 * Lo que es lógica se prueba con la función pura; lo que es cableado de
 * pantalla (qué prop se pasa, qué texto se pinta) leyendo el fuente, como el
 * resto de candados del repo (aquí no se renderizan componentes de cliente).
 * Todas fallan con el código de antes de ws1-t8.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { mensajeDeRebote, direccionSinDenegado } from "../auth/aviso-denegado";
import { ALL_PERMISSIONS } from "../auth/permissions";
import {
  AUDIT_ENTITY_OPTIONS, buildAuditWhere, entityLabel, entityOptionsFor, fieldLabel,
  fechaLegible, formatAuditFieldValue, normalizeChanges, resumenDeCambio, actionMeta,
} from "../admin/audit-core";
import { nombreComparable, procedimientoRepetido, textoRepetido } from "../procedures/duplicado";
import { marcadoresPara, DOCUMENT_MARKERS } from "../document-templates/markers";
import { agendaActiveDelAlta } from "../team/parche-miembro";
import { cargarInsightsDeVercel } from "../analytics/vercel-insights";
import { reservaTrasGuardar, reservaAlCambiarVisibilidad } from "../reserva-web/estado";
import { reservaWebAbierta, guardarReservaWebAbierta, olvidarSondaReservaWeb } from "../reserva-web/db";

const SRC = join(__dirname, "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const ES = JSON.parse(leer("i18n/dictionaries/es.json"));
const EN = JSON.parse(leer("i18n/dictionaries/en.json"));
const valor = (dic: any, ruta: string) => ruta.split(".").reduce((o, k) => (o ? o[k] : undefined), dic);

// ── C-109 · rebote por permisos ────────────────────────────────────────────
test("C-109: el rebote dice qué permiso falta y a quién pedirlo, sin la llave técnica", () => {
  const es = mensajeDeRebote("team.view", "es")!;
  assert.match(es, /«Ver equipo»/);
  assert.match(es, /dueño\/a/);
  assert.doesNotMatch(es, /team\.view/);
  assert.match(mensajeDeRebote("medicalRecord.edit", "en")!, /^You can't open that screen/);
  assert.equal(mensajeDeRebote("inventado.view"), null);
  assert.equal(mensajeDeRebote(null), null);
});

test("C-109: la dirección queda sin ?denied= y conserva lo demás", () => {
  assert.equal(direccionSinDenegado("/dashboard?denied=team.view"), "/dashboard");
  assert.equal(direccionSinDenegado("/dashboard?period=month&denied=settings.view#x"), "/dashboard?period=month#x");
  assert.equal(direccionSinDenegado("/dashboard?deniedx=1"), "/dashboard?deniedx=1");
});

test("C-109: el aviso está montado en el layout del panel y Analítica ya no dice «Solo admin.»", () => {
  assert.match(leer("app/dashboard/layout.tsx"), /<AvisoPermisoDenegado \/>/);
  for (const ruta of ["analytics.doctorsPage.adminOnly", "analytics.costs.adminOnly", "analytics.overviewPage.adminOnly"]) {
    assert.doesNotMatch(valor(ES, ruta), /^Solo (admin\.|los administradores)/, ruta);
    assert.match(valor(ES, ruta), /pídele acceso al dueño\/a/, ruta);
  }
});

// ── C-110 · «Dueño/a», nunca SUPER_ADMIN ───────────────────────────────────
test("C-110: el dueño es «Dueño/a» en Equipo, Servicios y Seguridad", () => {
  assert.equal(valor(ES, "settings.team.roleSuperAdmin"), "Dueño/a");
  assert.equal(valor(ES, "settings.client.roleSuperAdmin"), "Dueño/a");
  assert.equal(valor(EN, "settings.team.roleSuperAdmin"), "Owner");
  const ajustes = leer("app/dashboard/settings/settings-client.tsx");
  assert.doesNotMatch(ajustes, />\{initUser\.role\}</, "Seguridad pintaba el rol crudo");
  assert.doesNotMatch(ajustes, /val:initUser\.role \}/);
});

// ── C-111 · permisos sin códigos ni anglicismos ────────────────────────────
test("C-111: el modal de Permisos no enseña la llave interna", () => {
  for (const f of ["components/dashboard/team/permissions-modal.tsx", "components/dashboard/team/sabina-permissions-modal.tsx"]) {
    assert.doesNotMatch(leer(f), /^\s*\{key\}\s*$/m, `${f} pinta {key}`);
  }
  assert.doesNotMatch(leer("components/dashboard/team/permissions-modal.tsx"), /"Se distingue del default del rol:"/);
  assert.doesNotMatch(valor(ES, "settings.permissions.useRoleDefault"), /default/);
});

test("C-111: las etiquetas de permisos van en español", () => {
  for (const [llave, etiqueta] of Object.entries(ALL_PERMISSIONS)) {
    assert.doesNotMatch(etiqueta, /\b(inbox|threads|Analytics|landing|default)\b/, `${llave}: ${etiqueta}`);
  }
});

// ── C-112 · Servicios por profesional dice lo que hace ─────────────────────
test("C-112: Servicios no promete que gobierna la reserva web", () => {
  assert.doesNotMatch(valor(ES, "settings.client.servicesSubtitle"), /para que los pacientes elijan/);
  assert.match(valor(ES, "settings.client.servicesSubtitle"), /no limita qué servicios se pueden reservar/);
  assert.doesNotMatch(valor(ES, "settings.client.noServicesAssigned"), /al menos uno/);
});

// ── C-113 · dos «Mi perfil» ────────────────────────────────────────────────
test("C-113: Configuración → Mi perfil enlaza al completo y las dos especialidades se distinguen", () => {
  const ajustes = leer("app/dashboard/settings/settings-client.tsx");
  assert.ok((ajustes.match(/href="\/dashboard\/mi-perfil"/g) ?? []).length >= 2, "los dos caminos enlazan a /dashboard/mi-perfil");
  const textos = leer("lib/team/mis-datos-profesionales.ts");
  assert.doesNotMatch(textos, /especialidadEquipo: "Especialidad",/);
  assert.doesNotMatch(textos, /especialidadOficial: "Especialidad oficial",/);
});

// ── C-114 · clínica privada ────────────────────────────────────────────────
test("C-114: «Clínica privada» ya no dice que solo entra el equipo", () => {
  assert.doesNotMatch(valor(ES, "settings.client.privateClinicDesc"), /Solo tu equipo accede/);
});

// ── C-114 vuelta 2 · ocultar la clínica cierra la reserva web (decisión 10) ─
test("C-114: al ocultar la clínica se cierra la reserva; reabrirla es a propósito", () => {
  assert.equal(reservaTrasGuardar({ eraPublica: true, esPublica: false, abierta: true }), false, "ocultar cierra");
  assert.equal(reservaTrasGuardar({ eraPublica: false, esPublica: false, abierta: true }), true, "guardar otra cosa no la toca");
  assert.equal(reservaTrasGuardar({ eraPublica: false, esPublica: true, abierta: false }), false, "publicar no la reabre sola");
  assert.equal(reservaTrasGuardar({ eraPublica: true, esPublica: false, abierta: true, pedida: true }), true, "lo que pide la pantalla manda");
  assert.equal(reservaTrasGuardar({ eraPublica: true, esPublica: true, abierta: true, pedida: false }), false);
  assert.equal(reservaAlCambiarVisibilidad(false, true), false, "el interruptor de privada apaga el de reserva");
  assert.equal(reservaAlCambiarVisibilidad(true, false), false);
});

test("C-114: sin la columna la reserva sigue abierta y no se consulta de más", async () => {
  olvidarSondaReservaWeb();
  let consultas = 0;
  const db = { $queryRaw: async () => { consultas++; return [{ existe: false }]; }, $executeRaw: async () => { throw new Error("no debe escribir"); } };
  assert.equal(await reservaWebAbierta("c1", db), true);
  assert.equal(await reservaWebAbierta("c1", db), true);
  assert.equal(consultas, 1, "una sola pregunta a information_schema, ninguna a la columna");
  assert.equal(await guardarReservaWebAbierta("c1", false, db), false);
  olvidarSondaReservaWeb();
  const filas: unknown[] = [];
  const db2 = { $queryRaw: async (q: TemplateStringsArray) => (q.join("").includes("information_schema") ? [{ existe: true }] : [{ abierta: false }]), $executeRaw: async (...a: unknown[]) => { filas.push(a); return 1; } };
  assert.equal(await reservaWebAbierta("c1", db2), false);
  assert.equal(await guardarReservaWebAbierta("c1", true, db2), true);
  assert.equal(filas.length, 1);
  olvidarSondaReservaWeb();
});

test("C-114: la página de reservas y las tres APIs públicas respetan el cierre", () => {
  assert.match(leer("app/reservar/[slug]/page.tsx"), /if \(!\(await reservaWebAbierta\(clinic\.id\)\)\) \{\s*return <ReservaCerrada/);
  for (const f of ["app/api/public/book/route.ts", "app/api/public/booking-request/route.ts", "app/api/public/availability/route.ts"]) {
    assert.match(leer(f), /if \(!\(await reservaWebAbierta\(clinic\.id\)\)\) \{\s*return NextResponse\.json\(\{ error: MENSAJE_RESERVA_CERRADA\.es, reservaCerrada: true \}, \{ status: 403 \}\)/, f);
  }
  const ruta = leer("app/api/clinic/route.ts");
  assert.match(ruta, /reservaTrasGuardar\(\{\s*eraPublica: antes\?\.isPublic === true,/);
  assert.match(ruta, /texto: reservaDespues \? "Abrió la reserva web/);
  const sql = readFileSync(join(SRC, "..", "sql", "ws1-t8-reserva-web.sql"), "utf8");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "reservaWebAbierta" boolean NOT NULL DEFAULT true/);
  assert.doesNotMatch(sql, /\bUPDATE\b|\bDROP\b/);
});

// ── C-115 · Bitácora legible ───────────────────────────────────────────────
test("C-115: entidades con nombre y filtros de Gasto y de CFDI", () => {
  assert.equal(entityLabel("expense"), "Gasto");
  assert.equal(entityLabel("cash-register"), "Caja");
  assert.equal(entityLabel("grupo:cfdi"), "CFDI y datos fiscales");
  assert.ok((AUDIT_ENTITY_OPTIONS as readonly string[]).includes("expense"));
  assert.ok(entityOptionsFor({ ortodoncia: false }).includes("grupo:cfdi"));
  const w = buildAuditWhere({ clinicId: "c1", entityType: "grupo:cfdi" }) as any;
  assert.equal(w.clinicId, "c1");
  assert.equal(w.entityType, undefined);
  assert.deepEqual(w.AND[0].OR[0], { entityType: "cfdi" });
  assert.deepEqual(w.AND[0].OR[1], { changes: { path: ["_mov", "after", "texto"], string_contains: "CFDI" } });
  assert.equal(actionMeta("abrir-plan-de-pago").label, "Abrió un plan de pagos");
});

test("C-115: fechas y montos legibles (el gasto de $100 del 3-oct)", () => {
  assert.equal(fechaLegible("2026-10-03T06:00:00.000Z"), "3 oct 2026");
  assert.equal(fechaLegible("2026-10-03T17:12:00.000Z"), "3 oct 2026, 11:12");
  const ctx = { entityType: "expense" };
  assert.equal(formatAuditFieldValue("fecha", "2026-10-03T06:00:00.000Z", ctx), "3 oct 2026");
  assert.equal(formatAuditFieldValue("monto", 100, ctx), "$100");
  assert.equal(formatAuditFieldValue("monto", 2700.5, ctx), "$2,700.50");
  assert.equal(fieldLabel("categoria", "expense"), "Categoría");
  // El renglón del borrado: un objeto entero, campo por campo, no JSON.
  const borrado = formatAuditFieldValue("_x", { nota: "Error", fecha: "2026-10-03T06:00:00.000Z", monto: 100 }, ctx);
  assert.equal(borrado, "Nota: Error · Fecha: 3 oct 2026 · Monto: $100");
});

test("C-115: la línea de la lista es la frase que guardó el movimiento, y `_mov` no sale como campo", () => {
  const changes = { _mov: { before: null, after: { texto: "Corrigió el gasto «Insumos»: $2,500.00 → $2,700.00" } }, monto: { before: 2500, after: 2700 } };
  assert.equal(resumenDeCambio({ entityType: "expense", changes }), "Corrigió el gasto «Insumos»: $2,500.00 → $2,700.00");
  assert.deepEqual(normalizeChanges(changes).fields.map((f) => f.field), ["monto"]);
});

// ── C-116 · procedimientos repetidos ───────────────────────────────────────
test("C-116: un nombre ya usado (sin importar acentos ni mayúsculas) se reconoce como repetido", () => {
  const catalogo = [
    { id: "a", name: "Blanqueamiento", basePrice: 3500, isActive: false },
    { id: "b", name: "Blanqueamiento ", basePrice: 3000, isActive: true },
    { id: "c", name: "Implante dental", basePrice: 18000, isActive: true },
  ];
  assert.equal(nombreComparable("  IMPLANTE   Dentál "), "implante dental");
  assert.equal(procedimientoRepetido("blanqueamiento", catalogo)?.id, "b", "prefiere el activo");
  assert.equal(procedimientoRepetido("Implante Dental", catalogo, "c"), null, "el que se edita no es repetido de sí mismo");
  assert.equal(procedimientoRepetido("Resina", catalogo), null);
  assert.match(textoRepetido(catalogo[0], "$3,500").descripcion, /\(inactivo\)/);
  assert.match(leer("app/dashboard/procedures/procedures-client.tsx"), /procedimientoRepetido\(form\.name, procedures/);
});

// ── C-117 · Agenda de hoy a 390 px ─────────────────────────────────────────
test("C-117: la cita de Hoy pasa a dos renglones en columna estrecha y los iconos crecen al tacto", () => {
  assert.match(leer("components/dashboard/hoy-rediseno/fila-cita.tsx"), /\$\{s\.fila\} \$\{s\.filaCita\}/);
  const css = leer("components/dashboard/hoy-rediseno/hoy.module.css");
  assert.match(css, /@container hoy \(max-width: 560px\) \{\s*\.filaCita \{\s*flex-wrap: wrap;/);
  assert.match(css, /@media \(pointer: coarse\) \{\s*\.filaCita \.botonIcono \{\s*width: 40px;/);
});

// ── C-119 · saludo ─────────────────────────────────────────────────────────
test("C-119: Hoy del dueño saluda a la persona, no a la clínica", () => {
  assert.match(leer("components/dashboard/hoy-rediseno/hoy-admin.tsx"), /<Saludo nombreCompleto=\{user\.displayName\}/);
  assert.match(leer("components/dashboard/home/home-admin.tsx"), /userFullName=\{user\.displayName\}/);
});

// ── C-120 · Primeros pasos ─────────────────────────────────────────────────
test("C-120: «Primeros pasos» nombra el menú real", () => {
  assert.equal(valor(ES, "shell.onboardingSteps.whatsappDesc"), "En Administración → WhatsApp y recordatorios, conecta tu número");
  assert.equal(valor(ES, "shell.messages"), undefined); // el menú vive en otra llave; aquí solo el texto
});

// ── C-121 · acentos ────────────────────────────────────────────────────────
test("C-121: zonas horarias y textos con acentos", () => {
  const ajustes = leer("app/dashboard/settings/settings-client.tsx");
  for (const mal of ["Ciudad de Mexico", "Merida / Yucatan", "Sao Paulo", "Madrid - Espana"]) assert.ok(!ajustes.includes(mal), mal);
  assert.match(valor(ES, "settings.client.timezoneHelp"), /recarga la página\.$/);
  assert.doesNotMatch(leer("app/dashboard/settings/recall-section.tsx"), /Sólo/);
});

// ── C-122 · inglés suelto ──────────────────────────────────────────────────
test("C-122: sin «Powered by», «Performance», «Heatmap», «Plan CLINIC» ni modelos de IA", () => {
  assert.equal(valor(ES, "settings.client.cfdiPoweredByTitle"), "Facturación con Facturapi");
  assert.doesNotMatch(valor(ES, "home.admin.teamPerformanceTitle") ?? valor(ES, "home.teamPerformanceTitle") ?? "", /Performance/);
  assert.doesNotMatch(JSON.stringify(ES), /Claude (Haiku|Sonnet)|Heatmap de uso|Configurar cuenta - Recibir/);
  assert.equal(valor(ES, "shell.subscriptionTab.statusTrial"), "En prueba");
  const tarjeta = leer("components/dashboard/cfdi-usage-card.tsx");
  assert.doesNotMatch(tarjeta, /toLocaleDateString\(undefined/, "el mes salía en el idioma del navegador");
  assert.match(leer("app/dashboard/settings/settings-client.tsx"), /PLAN_MARKETING\[clinic\.plan/);
});

// ── C-123 · Plantillas ─────────────────────────────────────────────────────
test("C-123: la nota de evolución no ofrece marcadores de consentimiento", () => {
  const nota = marcadoresPara("NOTA_EVOLUCION").map((m) => m.token);
  assert.ok(!nota.includes("[NOMBRE_REPRESENTANTE]") && !nota.includes("[LUGAR]"));
  assert.ok(nota.includes("[NOMBRE_PACIENTE]"));
  assert.equal(marcadoresPara("CONSENTIMIENTO").length, DOCUMENT_MARKERS.length);
  assert.equal(valor(ES, "pages.plantillas.precargada"), "De fábrica");
  assert.match(leer("app/dashboard/plantillas/plantillas-indicaciones.tsx"), /Array\.from\(new Set\(h\.procedureIds/);
});

// ── C-124 · Equipo ─────────────────────────────────────────────────────────
test("C-124: Equipo liga etiquetas, cierra con Esc y dice cuántos inactivos", () => {
  const equipo = leer("app/dashboard/team/team-client.tsx");
  for (const id of ["miembro-nombre", "miembro-apellido", "miembro-correo", "miembro-telefono"]) {
    assert.match(equipo, new RegExp(`htmlFor="${id}"`), id);
    assert.match(equipo, new RegExp(`id="${id}"`), id);
  }
  assert.match(equipo, /e\.key !== "Escape"/);
  assert.match(equipo, /x\.incluyeInactivos\(team\.length - active\)/);
  assert.match(equipo, /x\.insigniaOrtodoncia/);
  assert.match(leer("components/dashboard/team/permissions-modal.tsx"), /e\.key === "Escape"/);
});

test("mejora G6: «Aparece en la agenda» también al agregar, con el default del rol si no viene", () => {
  assert.equal(agendaActiveDelAlta("ADMIN", true), true);
  assert.equal(agendaActiveDelAlta("ADMIN", undefined), false);
  assert.equal(agendaActiveDelAlta("DOCTOR", false), false);
  // Recepción no tiene casilla: manda la regla de siempre, diga lo que diga el cuerpo.
  assert.equal(agendaActiveDelAlta("RECEPTIONIST", false), agendaActiveDelAlta("RECEPTIONIST", undefined));
  assert.doesNotMatch(leer("app/dashboard/team/team-client.tsx"), /\{isEdit && puedeMarcarAtiende\(form\.role\)/);
});

// ── C-126 / C-127 · móvil y márgenes ───────────────────────────────────────
test("C-126 vuelta 2: controles de 40 px con el dedo en Equipo, ficha, caso de ortodoncia, Bitácora y Finanzas", () => {
  const casos: Array<[string, RegExp]> = [
    ["components/dashboard/equipo-rediseno/rediseno.module.css", /@media \(pointer: coarse\) \{[\s\S]*\.raiz :global\(\.btn-new\) \{\s*min-height: 40px;/],
    ["components/dashboard/pacientes-rediseno/rediseno.module.css", /@media \(pointer: coarse\) \{\s*\.tarjetaEnlace \{\s*min-height: 36px;/],
    ["components/specialties/orthodontics/redesign/orto.module.css", /@media \(pointer: coarse\) \{\s*\.segmentoBoton \{\s*height: 40px;/],
    ["components/dashboard/pequenas-rediseno/pequenas.module.css", /@media \(pointer: coarse\) \{[\s\S]*\.segmentoBoton \{\s*min-height: 40px;/],
    ["components/dashboard/finanzas-rediseno/finanzas.module.css", /@media \(pointer: coarse\) \{\s*\.segmento \{\s*min-height: 40px;/],
  ];
  for (const [f, re] of casos) assert.match(leer(f), re, f);
  assert.match(leer("app/dashboard/team/team-client.tsx"), /data-subir-foto/);
});

test("C-126 vuelta 2: en el celular las pestañas fijas de la ficha van en una fila deslizable", () => {
  assert.match(leer("components/dashboard/pacientes-rediseno/rediseno.module.css"), /@media \(max-width: 599\.98px\) \{\s*\.menuFijos \{\s*flex-wrap: nowrap;\s*overflow-x: auto;/);
});

test("C-126: el menú de Configuración va en fila desde 260 px (en el celular ya no es una columna de 10)", () => {
  assert.match(leer("components/dashboard/configuracion-rediseno/configuracion.module.css"), /@container navconfig \(min-width: 260px\)/);
});

test("C-127 vuelta 2: Analítica, Finanzas, Bitácora y las pantallas angostas en el mismo contenedor", () => {
  assert.match(leer("app/dashboard/analytics/layout.tsx"), /return <ContenedorPagina>\{children\}<\/ContenedorPagina>;/);
  const cont = leer("components/dashboard/contenedor-pagina/contenedor.module.css");
  for (const regla of ["max-width: 1400px;", "margin: 0 auto;", "padding: clamp(14px, 1.6vw, 28px);"]) assert.ok(cont.includes(regla), regla);
  for (const f of ["components/dashboard/finanzas-rediseno/finanzas.module.css", "components/dashboard/pequenas-rediseno/pequenas.module.css"]) {
    const css = leer(f); const raiz = css.slice(css.indexOf(".raiz {"), css.indexOf("}", css.indexOf(".raiz {")));
    assert.match(raiz, /max-width: 1400px;/, f);
    assert.match(raiz, /padding: clamp\(14px, 2vw, 24px\) clamp\(14px, 1\.6vw, 28px\)/, f);
  }
  assert.match(leer("components/dashboard/configuracion-rediseno/configuracion.module.css"), /\.raizEstrecha \{\s*max-width: 980px;\s*margin-left: max\(0px, calc\(\(100% - 1400px\) \/ 2\)\);/);
});

test("C-127: Plantillas usa el mismo contenedor que Equipo y Configuración", () => {
  const css = leer("app/dashboard/plantillas/plantillas.module.css");
  const page = css.slice(css.indexOf(".page {"), css.indexOf("}", css.indexOf(".page {")));
  const config = leer("components/dashboard/configuracion-rediseno/configuracion.module.css");
  const raiz = config.slice(config.indexOf(".raiz {"), config.indexOf("}", config.indexOf(".raiz {")));
  for (const regla of ["max-width: 1400px;", "margin: 0 auto;", "padding: clamp(14px, 1.6vw, 28px);"]) {
    assert.ok(raiz.includes(regla), `Configuración: ${regla}`);
    assert.ok(page.includes(regla), `Plantillas: ${regla}`);
  }
});

// ── C-129 · insights de Vercel fuera de Vercel ─────────────────────────────
test("C-129: los scripts /_vercel/* solo se cargan en Vercel", () => {
  assert.equal(cargarInsightsDeVercel({ VERCEL: "1", VERCEL_URL: "mediflow-abc.vercel.app" }), true);
  assert.equal(cargarInsightsDeVercel({}), false);
  // El .env de `vercel env pull` (panel de pruebas): VERCEL=1 pero sin dirección de despliegue.
  assert.equal(cargarInsightsDeVercel({ VERCEL: "1", VERCEL_URL: "" }), false);
  assert.match(leer("app/layout.tsx"), /\{cargarInsightsDeVercel\(\) && <Analytics \/>\}/);
  // El «▯» de «Sin tareas pendientes» era el 🎉 sin fuente de emoji.
  assert.doesNotMatch(leer("i18n/dictionaries/es.json"), /"noPendingTasks": "[^"]*🎉/);
});
