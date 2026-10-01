/**
 * M6 + B7 (auditoría de seguridad del 30-sep-2026) — permisos de rol en lo clínico.
 *
 * Run: npm run test:guardia-clinica
 *
 * El fallo: varias rutas y acciones del expediente comprobaban la CLÍNICA (y la
 * visibilidad del paciente) pero no el PERMISO de rol. Recepción y solo lectura
 * leían y escribían el periodontograma, los diagnósticos CIE-10 y el odontograma,
 * exportaban el PDF del módulo, subían o borraban fotos clínicas y creaban
 * enlaces públicos del expediente; y las listas de roles fijas
 * (["SUPER_ADMIN","ADMIN","DOCTOR"]) no veían el permiso que el dueño le quitó a
 * mano a un doctor. B7: la agenda, las citas y el buscador de pacientes tampoco
 * respetaban el permiso quitado.
 *
 * Qué fija:
 *   1 · El GUARDIA (src/lib/auth/guardia-clinica.ts): matriz rol × modo, y el
 *       override por persona manda.
 *   2 · INVENTARIO: recorre las carpetas clínicas de src/app/api y
 *       src/app/actions y FALLA si un handler HTTP o una server action no llega
 *       al guardia (directamente o por un ayudante que llega a él). Una ruta
 *       clínica nueva sin guardia rompe esta prueba. Las excepciones van con su
 *       porqué, una por una.
 *   3 · B7: las tres lecturas piden su permiso antes de consultar.
 *
 * Sin base de datos: lee los fuentes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import {
  denyIfNotClinical,
  permisosClinicosFaltantes,
  puedeClinico,
} from "../guardia-clinica";
import { ROLE_DEFAULT_PERMISSIONS } from "../permissions";

const SRC = join(__dirname, "..", "..", "..");             // src/
const rel = (p: string) => relative(join(SRC, ".."), p).split("\\").join("/");

// ─────────────────────────── 1 · El guardia ───────────────────────────

const u = (role: string, permissionsOverride: string[] = []) => ({ role, permissionsOverride });

test("guardia: con los defaults, dueño/admin/doctor ven y editan; recepción y solo lectura no", () => {
  for (const r of ["SUPER_ADMIN", "ADMIN", "DOCTOR"]) {
    assert.equal(puedeClinico(u(r), "ver"), true, `${r} ver`);
    assert.equal(puedeClinico(u(r), "editar"), true, `${r} editar`);
  }
  for (const r of ["RECEPTIONIST", "READONLY"]) {
    assert.equal(puedeClinico(u(r), "ver"), false, `${r} ver`);
    assert.equal(puedeClinico(u(r), "editar"), false, `${r} editar`);
  }
});

test("guardia: el permiso QUITADO a mano manda sobre el rol (B7)", () => {
  // Un doctor al que el dueño le dejó todo menos el expediente.
  const sinExpediente = ROLE_DEFAULT_PERMISSIONS.DOCTOR.filter((k) => !k.startsWith("medicalRecord."));
  assert.equal(puedeClinico(u("DOCTOR", sinExpediente), "ver"), false);
  assert.equal(puedeClinico(u("DOCTOR", sinExpediente), "editar"), false);
  // Solo «ver»: lee pero no escribe.
  const soloVer = [...sinExpediente, "medicalRecord.view"];
  assert.equal(puedeClinico(u("DOCTOR", soloVer), "ver"), true);
  assert.equal(puedeClinico(u("DOCTOR", soloVer), "editar"), false);
  // Y al revés: una recepcionista a la que se le CONCEDIÓ el expediente.
  const recepConExpediente = [...ROLE_DEFAULT_PERMISSIONS.RECEPTIONIST, "medicalRecord.view"];
  assert.equal(puedeClinico(u("RECEPTIONIST", recepConExpediente), "ver"), true);
});

test("guardia: `ademas` se exige en AND y sin usuario se niega todo", () => {
  assert.deepEqual(permisosClinicosFaltantes(u("DOCTOR"), "editar", ["patients.create"]), []);
  assert.deepEqual(permisosClinicosFaltantes(u("DOCTOR"), "editar", ["billing.refund"]), ["billing.refund"]);
  assert.deepEqual(permisosClinicosFaltantes(null, "ver"), ["medicalRecord.view"]);
  assert.equal(puedeClinico(undefined, "ver"), false);
});

test("guardia: denyIfNotClinical contesta 403 con mensaje legible y la llave", async () => {
  assert.equal(denyIfNotClinical(u("DOCTOR"), "ver"), null);
  const res = denyIfNotClinical(u("RECEPTIONIST"), "editar");
  assert.ok(res);
  assert.equal(res!.status, 403);
  const body = await res!.json();
  assert.equal(body.permiso, "medicalRecord.edit");
  assert.match(body.error, /No tienes permiso/);
});

// ─────────────────────────── 2 · Inventario ───────────────────────────

/** Carpetas cuyo contenido ES expediente clínico. */
const API_CLINICO = [
  "clinical", "clinical-notes", "medical-records", "records", "odontogram", "periodontal",
  "periodontics", "endodontics", "implants", "pediatrics", "orthodontics", "body-map",
  "consult", "formulas", "homeopatia", "patient-documents", "referrals",
  "import/odontogram", "import/clinical-notes", "import/ortho-cases", "import/treatment-notes",
  "patients/[id]/export-cda", "patients/[id]/migrated-ortho-cases", "patients/[id]/timeline",
];
const ACTIONS_CLINICO = [
  "clinical-shared", "endodontics", "implants", "orthodontics", "pediatrics", "periodontics", "specialties",
];

/**
 * Familias clínicas que se gobiernan con su PROPIA llave y que la clínica
 * reparte aparte a propósito (recepción sube placas y prepara consentimientos;
 * las recetas tienen prescription.*). No entran al inventario:
 *   · /api/xrays, /api/before-after, /api/patients/[id]/models-3d — xrays.view / xrays.upload
 *     (borrar sí pide medicalRecord.edit, y ya pasa por el guardia).
 *   · /api/prescriptions — prescription.view / prescription.create.
 *   · /api/consent — consents.view / create / revoke.
 *   · /api/patients/[id]/expediente-pdf — medicalRecord.export.
 * Excepciones dentro de las carpetas clínicas, con su porqué:
 */
const EXCEPCIONES: Record<string, string> = {
  "src/app/actions/clinical-shared/share-links.ts#resolvePublicShareToken":
    "lo resuelve la página pública /share/p/[token] con un token aleatorio de 32 bytes; no hay sesión que revisar",
  "src/app/actions/orthodontics/alineadores/logElasticsComplianceFromPortal.ts#logElasticsComplianceFromPortal":
    "la usa el PACIENTE desde su portal (getOrthoPatientPortalContext); no es personal de la clínica",
  "src/app/actions/orthodontics/alineadores/submitMonitoringPhoto.ts#submitMonitoringPhoto":
    "la usa el PACIENTE desde su portal (getOrthoPatientPortalContext)",
  "src/app/actions/orthodontics/agendarRevisionRetencion.ts#agendarRevisionRetencion":
    "agenda una cita: agenda.create (la usa recepción)",
  "src/app/actions/orthodontics/agendarProximoControlDesdeCard.ts#agendarProximoControlDesdeCard":
    "agenda el próximo control: agenda.create",
  "src/app/actions/orthodontics/getTreatmentPlanIdForAppointment.ts#getTreatmentPlanIdForAppointment":
    "solo devuelve el id del caso de una cita y qué botones ve la persona (banderas canClinical/canBilling); no lee expediente",
  "src/app/actions/orthodontics/hoy/resumenDeHoy.ts#resumenOrtodonciaDeHoy":
    "resumen de agenda y cobro para «Hoy»: specialties.orthodontics + billing.view, sin datos clínicos",
  "src/app/actions/orthodontics/recepcion/listarMensualidadesPorCobrar.ts#listarMensualidadesPorCobrar":
    "cobranza de recepción: billing.view / billing.charge",
  "src/app/actions/orthodontics/whatsapp/avisarProximoControlAlPaciente.ts#avisarProximoControlAlPaciente":
    "aviso de fecha de cita por WhatsApp: whatsapp.send",
  "src/app/actions/orthodontics/whatsapp/sendControlInstructions.ts#sendControlInstructions":
    "plantilla de indicaciones por WhatsApp: whatsapp.send",
  "src/app/actions/orthodontics/whatsapp/sendMensualidadReminder.ts#sendMensualidadReminder":
    "recordatorio de pago: whatsapp.send",
  "src/app/actions/orthodontics/imagen/boltonAnalysis.ts#limpiarAnchos":
    "función pura de validación de números (sin sesión ni base); no lee ni escribe nada",
};

/**
 * Familias de ortodoncia con LLAVE PROPIA, que el inventario reconoce aparte
 * para no confundirlas con el guardia clínico:
 *   · COBRO (plan de pagos, mensualidades, convenio): billing.* — recepción cobra
 *     sin ver el expediente (decisión de Rafael). getOrthoBillingActionContext.
 *   · CONFIGURACIÓN de la clínica (técnicas, precios, catálogo, tipos de cita):
 *     settings.view / settings.edit. getOrthoConfigActionContext.
 */
const AYUDANTES_DE_COBRO = ["getOrthoBillingActionContext", "getOrthoConfigActionContext"];

/** Llaves de primer nivel del guardia (src/lib/auth/guardia-clinica.ts). */
const PRIMITIVAS = ["denyIfNotClinical", "puedeClinico", "permisosClinicosFaltantes"];

/**
 * Forma EQUIVALENTE que ya usaban las rutas bien protegidas (notas clínicas,
 * expediente, radiografías…): `denyIfMissingPermission(x, "medicalRecord.view|edit")`.
 * Es la misma comprobación que hace el guardia (hasPermission con el override por
 * persona) y otras pruebas (EQ-07, endpoint-gates) fijan ese texto literal, así que
 * no se reescribió: cuenta como guardia. Lo nuevo usa guardia-clinica.
 */
const FORMA_EQUIVALENTE = /denyIfMissingPermission\([^)]*["']medicalRecord\.(view|edit)["']\)/;

/** Archivos con ayudantes que, a su vez, deben llegar al guardia. */
const AYUDANTES = [
  "lib/clinical-shared/auth/guard.ts",
  "lib/odontogram/api-auth.ts",
  "lib/orthodontics/permiso-expediente.ts",
  "lib/orthodontics/pdf/guarda-del-caso.ts",
  "app/actions/endodontics/_helpers.ts",
  "app/actions/periodontics/_helpers.ts",
  "app/actions/implants/_helpers.ts",
  "app/actions/orthodontics/_helpers.ts",
  "app/actions/pediatrics/_helpers.ts",
  "app/actions/orthodontics/imagen/_context.ts",
  "app/api/patient-documents/_lib/http.ts",
];

/** Ayudantes que el inventario DEBE reconocer como guardados (si alguno deja de serlo, falla). */
const AYUDANTES_ESPERADOS = [
  "guardPatient", "sinPermisoClinico", "puedeEscribirOdontograma", "puedeLeerOdontograma",
  "puedeVerExpediente", "guardaDelPdfDelCaso", "getEndoActionContext", "getPerioActionContext",
  "getImplantActionContext", "getOrthoActionContext", "getOrthoPlanActionContext",
  "requirePediatricsPermission", "loadPatientForPediatrics", "getOrthoImagingContext", "entrar",
];

function recorrer(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "__tests__" ? [] : recorrer(p);
    return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

/** Funciones de primer nivel de un archivo: nombre, cuerpo y si se exporta. */
function funciones(src: string): Array<{ nombre: string; cuerpo: string; exportada: boolean }> {
  const re = /^(export\s+)?(?:async\s+)?function\s+(\w+)|^(export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(/gm;
  const marcas: Array<{ i: number; nombre: string; exportada: boolean }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    marcas.push({ i: m.index, nombre: m[2] ?? m[4], exportada: !!(m[1] ?? m[3]) });
  }
  return marcas.map((mk, k) => ({
    nombre: mk.nombre,
    exportada: mk.exportada,
    cuerpo: src.slice(mk.i, k + 1 < marcas.length ? marcas[k + 1].i : src.length),
  }));
}

const archivosApi = API_CLINICO.flatMap((d) =>
  recorrer(join(SRC, "app", "api", d)).filter((f) => /[\\/]route\.tsx?$/.test(f)),
);
const archivosActions = ACTIONS_CLINICO.flatMap((d) => recorrer(join(SRC, "app", "actions", d)))
  .filter((f) => /^\s*["']use server["']/.test(readFileSync(f, "utf8")));
const archivosAyudantes = AYUDANTES.map((a) => join(SRC, a));

/** Todas las funciones conocidas → cuerpo, para resolver delegaciones. */
const tabla = new Map<string, string>();
for (const f of [...archivosAyudantes, ...archivosApi, ...archivosActions, ...recorrer(join(SRC, "app", "actions"))]) {
  for (const fn of funciones(readFileSync(f, "utf8"))) {
    const previo = tabla.get(fn.nombre);
    tabla.set(fn.nombre, previo ? previo + "\n" + fn.cuerpo : fn.cuerpo);
  }
}

/** Punto fijo: guardada = su cuerpo llama a una primitiva o a otra guardada. */
const guardadas = new Set<string>();
for (let cambio = true; cambio; ) {
  cambio = false;
  for (const [nombre, cuerpo] of Array.from(tabla.entries())) {
    if (guardadas.has(nombre)) continue;
    const llamadas = cuerpo.slice(cuerpo.indexOf("{")); // sin la firma
    const llega = FORMA_EQUIVALENTE.test(llamadas) || [...PRIMITIVAS, ...Array.from(guardadas)].some((g) =>
      g !== nombre && new RegExp(`\\b${g}\\s*\\(`).test(llamadas),
    );
    if (llega) { guardadas.add(nombre); cambio = true; }
  }
}

/** ¿Pasa por el ayudante de cobro (billing.*), directamente o vía una función que lo llama? */
function deCobro(cuerpo: string): boolean {
  const directos = AYUDANTES_DE_COBRO.some((a) => new RegExp(`\\b${a}\\s*\\(`).test(cuerpo));
  if (directos) return true;
  return Array.from(tabla.entries()).some(([nombre, c]) =>
    AYUDANTES_DE_COBRO.some((a) => new RegExp(`\\b${a}\\s*\\(`).test(c)) &&
    new RegExp(`\\b${nombre}\\s*\\(`).test(cuerpo.slice(cuerpo.indexOf("{"))),
  );
}

test("inventario: los ayudantes de cada módulo llegan al guardia compartido", () => {
  const faltan = AYUDANTES_ESPERADOS.filter((a) => !guardadas.has(a));
  assert.deepEqual(faltan, [], `estos ayudantes ya no llegan a guardia-clinica: ${faltan.join(", ")}`);
});

test("inventario: hay suficientes rutas y acciones clínicas (la prueba no se quedó ciega)", () => {
  assert.ok(archivosApi.length >= 50, `solo ${archivosApi.length} rutas clínicas: ¿se movió una carpeta?`);
  assert.ok(archivosActions.length >= 120, `solo ${archivosActions.length} archivos de acciones`);
});

test("inventario: TODO handler HTTP de una ruta clínica pasa por el guardia", () => {
  const sinGuardia: string[] = [];
  for (const f of archivosApi) {
    for (const fn of funciones(readFileSync(f, "utf8"))) {
      if (!fn.exportada || !/^(GET|POST|PUT|PATCH|DELETE)$/.test(fn.nombre)) continue;
      const id = `${rel(f)}#${fn.nombre}`;
      if (EXCEPCIONES[id]) continue;
      const llamadas = fn.cuerpo.slice(fn.cuerpo.indexOf("{"));
      const ok = FORMA_EQUIVALENTE.test(llamadas) ||
        [...PRIMITIVAS, ...Array.from(guardadas)].some((g) => new RegExp(`\\b${g}\\s*\\(`).test(llamadas));
      if (!ok && !deCobro(llamadas)) sinGuardia.push(id);
    }
  }
  assert.deepEqual(sinGuardia, [], `rutas clínicas sin permiso de rol:\n  ${sinGuardia.join("\n  ")}`);
});

test("inventario: TODA server action exportada de un módulo clínico pasa por el guardia", () => {
  const sinGuardia: string[] = [];
  for (const f of archivosActions) {
    for (const fn of funciones(readFileSync(f, "utf8"))) {
      if (!fn.exportada) continue;
      const id = `${rel(f)}#${fn.nombre}`;
      if (EXCEPCIONES[id]) continue;
      if (!guardadas.has(fn.nombre) && !deCobro(fn.cuerpo)) sinGuardia.push(id);
    }
  }
  assert.deepEqual(sinGuardia, [], `acciones clínicas sin permiso de rol:\n  ${sinGuardia.join("\n  ")}`);
});

test("inventario: ninguna excepción apunta a algo que ya no existe", () => {
  for (const id of Object.keys(EXCEPCIONES)) {
    const [archivo, nombre] = id.split("#");
    const p = join(SRC, "..", archivo);
    assert.ok(existsSync(p), `excepción huérfana: ${archivo}`);
    assert.match(readFileSync(p, "utf8"), new RegExp(`function\\s+${nombre}\\b`), `excepción huérfana: ${id}`);
  }
});

test("inventario: ninguna ruta clínica decide por una lista de roles fija", () => {
  const conLista: string[] = [];
  for (const f of archivosApi) {
    const src = readFileSync(f, "utf8");
    if (/\[\s*"(SUPER_ADMIN|ADMIN|DOCTOR)"\s*,\s*"(SUPER_ADMIN|ADMIN|DOCTOR)"[^\]]*\]\.includes\(/.test(src)) conLista.push(rel(f));
  }
  assert.deepEqual(conLista, [], "una lista de roles no ve el permiso quitado a mano; usar guardia-clinica");
});

test("buildTreatmentCardContext ya no se exporta desde un archivo \"use server\" (acción sin sesión)", () => {
  for (const f of recorrer(join(SRC, "app", "actions"))) {
    const src = readFileSync(f, "utf8");
    if (!/^\s*["']use server["']/.test(src)) continue;
    assert.doesNotMatch(src, /export\s+async\s+function\s+buildTreatmentCardContext\b/, rel(f));
  }
});

// ─────────────────────────── 3 · B7 ───────────────────────────

const B7: Array<{ archivo: string; llave: RegExp }> = [
  { archivo: "app/api/agenda/range/route.ts", llave: /denyIfMissingPermission\(session\.user, "agenda\.view"\)/ },
  { archivo: "app/api/appointments/route.ts", llave: /denyIfMissingPermission\(session\.user, "agenda\.view"\)/ },
  { archivo: "app/api/patients/search/route.ts", llave: /denyIfMissingAnyPermission\(session\.user, \["patients\.view", "agenda\.create"\]\)/ },
];

for (const { archivo, llave } of B7) {
  test(`B7: ${archivo} GET pide su permiso ANTES de consultar`, () => {
    const src = readFileSync(join(SRC, archivo), "utf8");
    const get = funciones(src).find((f) => f.nombre === "GET" && f.exportada);
    assert.ok(get, "sin GET");
    const i = get!.cuerpo.search(llave);
    assert.ok(i > 0, "el GET no pide el permiso");
    const j = get!.cuerpo.search(/prisma\.|findPatientIdsBySearch\(|loadAgenda|listAppointments|\bfetch\w*\(/);
    assert.ok(j === -1 || i < j, "el permiso se pide DESPUÉS de leer la base");
  });
}
