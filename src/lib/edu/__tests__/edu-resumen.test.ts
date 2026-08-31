/**
 * OLA 12 — LA FICHA DEL PACIENTE Y MI AGENDA.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-resumen.test.ts
 *
 * Lo que se fija aquí, y por qué:
 *
 *  1. EL CONTRATO DEL RESUMEN POR ROL — la pantalla nueva cruza TRES
 *     recursos (citas, expediente, dinero) y el reparto no es simétrico:
 *     un ALUMNO ve sus citas y sus casos y NI UN PESO; CAJA ve citas y
 *     saldo completos y NADA clínico. Si alguien "unifica" los alcances
 *     del resumen, estas pruebas se ponen rojas.
 *
 *  2. LOS AVISOS — cuándo un caso se convierte en alerta (consentimiento
 *     faltante, caso sin docente, autorización pendiente) es lógica de
 *     producto con esquinas (una carta REVOCADA no cuenta como firmada) y
 *     se prueba con datos armados a mano.
 *
 *  3. EL TIPO DE UN ESTUDIO — las mallas dejan de caer en OTRO
 *     (MODELO_3D) y la ÚNICA corrección que se le acepta al cliente es
 *     radiografía↔foto sobre una imagen. Todo lo demás lo manda la
 *     extensión del path que compuso el servidor.
 *
 *  4. LOS CANDADOS DE FUENTE — igual que edu-auditoria.test.ts: un helper
 *     correcto que nadie llama es tan inseguro como uno equivocado, así
 *     que se LEE el código y se comprueba que la llamada esté puesta (el
 *     resumen usa los `where` del punto único; los desplegables de la
 *     ficha no viajan sin permiso — la lección del P1-4; la agenda de
 *     parrilla redirige a quien llega recortado).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  eduResumenAvisos,
  eduResumenCasoAbierto,
  eduResumenScopes,
  eduResumenVeClinico,
  eduResumenVeDinero,
  type EduResumenCasoInsumo,
} from "../resumen-core";
import { eduResolveStudyKind, eduStudyKindForExt } from "../estudios-core";
import { EDU_NAV_LABELS, EDU_STUDY_KINDS } from "../types";
import type { EduRole } from "../types";

function actor(role: EduRole, eduUserId = "u_1") {
  return { role, eduUserId };
}

const RAIZ = join(__dirname, "..", "..", "..", "..");

/** El archivo, sin comentarios: se juzga por lo que hace, no por lo que dice. */
function fuente(...tramos: string[]): string {
  return readFileSync(join(RAIZ, ...tramos), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
}

// ═════════════════════════════════════════════════════════════════════
// 1 · EL CONTRATO DEL RESUMEN POR ROL
// ═════════════════════════════════════════════════════════════════════

test("resumen · ALUMNO: sus citas y sus casos, y NI UN PESO", () => {
  const s = eduResumenScopes(actor("ALUMNO"));
  assert.equal(s.citas.kind, "own");
  assert.equal(s.clinico.kind, "own");
  assert.equal(s.dinero.kind, "none");
  assert.equal(eduResumenVeDinero(s), false, "el bloque de saldo NO se consulta para un alumno");
  assert.equal(eduResumenVeClinico(s), true);
});

test("resumen · DOCENTE: lo de sus alumnos vigentes, sin dinero", () => {
  const s = eduResumenScopes(actor("DOCENTE"));
  assert.equal(s.citas.kind, "supervised");
  assert.equal(s.clinico.kind, "supervised");
  assert.equal(s.dinero.kind, "none");
  assert.equal(eduResumenVeDinero(s), false);
  assert.equal(eduResumenVeClinico(s), true);
});

test("resumen · CAJA: citas y saldo completos, NADA clínico (ni avisos)", () => {
  const s = eduResumenScopes(actor("CAJA"));
  assert.equal(s.citas.kind, "all");
  assert.equal(s.clinico.kind, "none", "caja no abre expediente: sus casos no se consultan");
  assert.equal(s.dinero.kind, "all");
  assert.equal(eduResumenVeDinero(s), true);
  assert.equal(
    eduResumenVeClinico(s),
    false,
    "los tres avisos nacen de los casos: para caja no existen",
  );
});

test("resumen · DIRECCION: todo", () => {
  const s = eduResumenScopes(actor("DIRECCION"));
  assert.equal(s.citas.kind, "all");
  assert.equal(s.clinico.kind, "all");
  assert.equal(s.dinero.kind, "all");
  assert.equal(eduResumenVeDinero(s), true);
  assert.equal(eduResumenVeClinico(s), true);
});

test("resumen · un rol desconocido no ve nada — la opción segura", () => {
  const s = eduResumenScopes(actor("RECTOR" as EduRole));
  assert.equal(eduResumenVeDinero(s), false);
  assert.equal(eduResumenVeClinico(s), false);
  assert.equal(s.citas.kind, "none");
});

// ═════════════════════════════════════════════════════════════════════
// 2 · LOS AVISOS
// ═════════════════════════════════════════════════════════════════════

function caso(over: Partial<EduResumenCasoInsumo> = {}): EduResumenCasoInsumo {
  return {
    id: "caso_1",
    status: "IN_TREATMENT",
    programName: "Endodoncia",
    supervisorUserId: "u_doc",
    tieneTitularVigente: true,
    ...over,
  };
}

test("aviso · caso EN TRATAMIENTO sin carta firmada", () => {
  const avisos = eduResumenAvisos([caso()], [], {});
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].kind, "consentimiento");
  assert.match(avisos[0].text, /Endodoncia/);
});

test("aviso · la carta FIRMADA y viva lo apaga", () => {
  const avisos = eduResumenAvisos(
    [caso()],
    [{ caseId: "caso_1", signedAt: new Date("2026-08-01"), revokedAt: null }],
    {},
  );
  assert.equal(avisos.length, 0);
});

test("aviso · una carta REVOCADA no cuenta como firmada", () => {
  // Pintar como cubierto algo que el paciente retiró es cómo alguien acaba
  // tratando a quien dijo que no (Ola 3B). El aviso VUELVE.
  const avisos = eduResumenAvisos(
    [caso()],
    [
      {
        caseId: "caso_1",
        signedAt: new Date("2026-08-01"),
        revokedAt: new Date("2026-08-15"),
      },
    ],
    {},
  );
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].kind, "consentimiento");
});

test("aviso · la carta firmada de OTRO caso no cubre a éste", () => {
  const avisos = eduResumenAvisos(
    [caso()],
    [{ caseId: "caso_OTRO", signedAt: new Date("2026-08-01"), revokedAt: null }],
    {},
  );
  assert.equal(avisos.length, 1);
});

test("aviso · un caso ASIGNADO (sin empezar) todavía no debe carta", () => {
  const avisos = eduResumenAvisos([caso({ status: "ASSIGNED" })], [], {});
  assert.equal(avisos.length, 0);
});

test("aviso · caso sin responsable Y sin titular vigente = sin docente que responda", () => {
  const avisos = eduResumenAvisos(
    [caso({ status: "ASSIGNED", supervisorUserId: null, tieneTitularVigente: false })],
    [],
    {},
  );
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].kind, "docente");
});

test("aviso · con titular VIGENTE no se avisa aunque la columna esté vacía", () => {
  // El titular ES quien responde (Ola 1A): avisar aquí sería ruido en cada
  // caso abierto desde el tamizaje.
  const avisos = eduResumenAvisos(
    [caso({ status: "ASSIGNED", supervisorUserId: null, tieneTitularVigente: true })],
    [],
    {},
  );
  assert.equal(avisos.length, 0);
});

test("aviso · un caso CERRADO no avisa de nada", () => {
  assert.equal(eduResumenCasoAbierto("COMPLETED"), false);
  assert.equal(eduResumenCasoAbierto("TRANSFERRED"), false);
  assert.equal(eduResumenCasoAbierto("ABANDONED"), false);
  assert.equal(eduResumenCasoAbierto("IN_TREATMENT"), true);
  const avisos = eduResumenAvisos(
    [caso({ status: "COMPLETED", supervisorUserId: null, tieneTitularVigente: false })],
    [],
    {},
  );
  // COMPLETED tampoco dispara el de consentimiento: solo IN_TREATMENT.
  assert.equal(avisos.length, 0);
});

test("aviso · autorizaciones pendientes: se suman y el texto concuerda en número", () => {
  const dos = eduResumenAvisos(
    [caso({ status: "ASSIGNED" }), caso({ id: "caso_2", status: "ASSIGNED" })],
    [],
    { caso_1: 1, caso_2: 1 },
  );
  assert.equal(dos.length, 1);
  assert.equal(dos[0].kind, "autorizacion");
  assert.match(dos[0].text, /2 autorizaciones/);

  const una = eduResumenAvisos([caso({ status: "ASSIGNED" })], [], { caso_1: 1 });
  assert.match(una[0].text, /1 autorización\b/);

  const cero = eduResumenAvisos([caso({ status: "ASSIGNED" })], [], {});
  assert.equal(cero.length, 0);
});

test("aviso · las pendientes de un caso que NO llegó (fuera de alcance) no se cuentan", () => {
  // La función solo suma sobre los casos que recibió — que ya venían
  // recortados por eduCaseScopeWhere. Un id suelto en el mapa no cuenta.
  const avisos = eduResumenAvisos([caso({ status: "ASSIGNED" })], [], { caso_ajeno: 5 });
  assert.equal(avisos.length, 0);
});

// ═════════════════════════════════════════════════════════════════════
// 3 · EL TIPO DE UN ESTUDIO (MODELO_3D y la corrección radiografía↔foto)
// ═════════════════════════════════════════════════════════════════════

test("estudios · las mallas dejan de caer en OTRO", () => {
  assert.equal(eduStudyKindForExt("stl"), "MODELO_3D");
  assert.equal(eduStudyKindForExt("ply"), "MODELO_3D");
  assert.equal(eduStudyKindForExt("obj"), "MODELO_3D");
  // Y lo demás sigue igual: nada se re-clasificó por accidente.
  assert.equal(eduStudyKindForExt("zip"), "TOMOGRAFIA");
  assert.equal(eduStudyKindForExt("dcm"), "TOMOGRAFIA");
  assert.equal(eduStudyKindForExt("pdf"), "PDF");
  assert.equal(eduStudyKindForExt("jpg"), "RADIOGRAFIA");
  assert.ok(EDU_STUDY_KINDS.includes("MODELO_3D"), "el espejo del enum debe conocer MODELO_3D");
});

test("estudios · la ÚNICA corrección del cliente es radiografía↔foto sobre una imagen", () => {
  assert.equal(eduResolveStudyKind("jpg", "FOTO"), "FOTO");
  assert.equal(eduResolveStudyKind("png", "RADIOGRAFIA"), "RADIOGRAFIA");
  // Un valor incompatible o basura se IGNORA y gana la extensión: rebotar
  // la subida entera por un radio mal tocado castigaría a quien ya esperó.
  assert.equal(eduResolveStudyKind("jpg", "TOMOGRAFIA"), "RADIOGRAFIA");
  assert.equal(eduResolveStudyKind("jpg", 42), "RADIOGRAFIA");
  assert.equal(eduResolveStudyKind("jpg", undefined), "RADIOGRAFIA");
  // Sobre lo que NO es imagen, el cliente no manda nada:
  assert.equal(eduResolveStudyKind("zip", "FOTO"), "TOMOGRAFIA");
  assert.equal(eduResolveStudyKind("stl", "FOTO"), "MODELO_3D");
  assert.equal(eduResolveStudyKind("pdf", "RADIOGRAFIA"), "PDF");
});

// ═════════════════════════════════════════════════════════════════════
// 4 · CANDADOS DE FUENTE — que la llamada esté PUESTA
// ═════════════════════════════════════════════════════════════════════

test("candado · el resumen consulta con los where del punto único y las puertas puras", () => {
  const src = fuente("src", "lib", "edu", "resumen.ts");
  for (const llamada of [
    "eduResumenScopes(",
    "eduResumenVeDinero(",
    "eduResumenVeClinico(",
    "eduAppointmentScopeWhere(",
    "eduCaseScopeWhere(",
    "eduChargeScopeWhere(",
  ]) {
    assert.ok(src.includes(llamada), `resumen.ts debe llamar a ${llamada}`);
  }
});

test("candado · la página del resumen respeta el PERMISO además del alcance", () => {
  const src = fuente("src", "app", "instituto", "(panel)", "pacientes", "[id]", "page.tsx");
  assert.ok(src.includes('hasEduPermission(permUser, "casos.view")'));
  assert.ok(src.includes('hasEduPermission(permUser, "caja.view")'));
});

test("candado · los desplegables de la ficha NO viajan sin permiso (lección del P1-4)", () => {
  const src = fuente("src", "app", "instituto", "(panel)", "pacientes", "[id]", "layout.tsx");
  assert.ok(
    src.includes("canAgendar || canAbrirCaso ? listEduStudentOptions"),
    "el padrón de alumnos solo viaja a quien puede agendar o abrir caso",
  );
  assert.ok(
    src.includes("canAgendar && sede ? listEduChairOptions"),
    "los sillones solo viajan a quien puede agendar",
  );
  assert.ok(
    src.includes("canAgendar ? listEduSupervisorOptions"),
    "los docentes solo viajan a quien puede agendar",
  );
});

test("candado · la parrilla por sillón manda a /mi-dia a quien llega recortado", () => {
  const src = fuente("src", "app", "instituto", "(panel)", "agenda", "page.tsx");
  assert.ok(
    src.includes('scope.kind === "own" || scope.kind === "supervised"') &&
      src.includes('redirect("/instituto/mi-dia")'),
    "la agenda de recepción no es la pantalla de un alumno ni de un docente",
  );
});

test("candado · /instituto manda al ALUMNO a su agenda, no a Inicio", () => {
  const src = fuente("src", "app", "instituto", "page.tsx");
  assert.ok(src.includes('ctx.role === "ALUMNO"') && src.includes('redirect("/instituto/mi-dia")'));
});

test("candado · el menú reparte Agenda / Mi agenda por ALCANCE", () => {
  const src = fuente("src", "app", "instituto", "(panel)", "layout.tsx");
  assert.ok(src.includes('item.key === "agenda" && apptScope.kind !== "all"'));
  assert.ok(src.includes('item.key === "mi-dia" && apptScope.kind === "all"'));
});

test("candado · el item se llama «Mi agenda» (la ruta /mi-dia no se renombra)", () => {
  assert.equal(EDU_NAV_LABELS["mi-dia"], "Mi agenda");
});

test("candado · /confirm decide el kind con eduResolveStudyKind (no con el cliente)", () => {
  const src = fuente("src", "lib", "edu", "estudios.ts");
  assert.ok(src.includes("eduResolveStudyKind("), "confirmEduStudyUpload debe pasar por el resolutor");
  assert.ok(
    !src.includes("eduStudyKindForExt("),
    "el kind del confirm ya no sale del mapeo crudo: el resolutor lo envuelve",
  );
});

test("candado · el visor de mallas NO recibe patientId/fileId del dental", () => {
  // Sin esas dos props, `canPersist` es false y el PATCH a
  // /api/patients/**/models-3d/** es INALCANZABLE desde el instituto.
  const src = fuente("src", "components", "edu", "estudios", "modelo-3d-viewer.tsx");
  assert.ok(src.includes("<Model3DViewer url={url} format={format} />"));
  assert.ok(!src.includes("patientId="), "pasarle patientId re-conectaría el PATCH del dental");
});

test("candado · el contenedor CBCT propio no llama a rutas del dental", () => {
  const src = fuente("src", "components", "edu", "estudios", "cbct-viewer.tsx");
  assert.ok(!src.includes("/api/patients/"), "el contenedor no puede hablar con el dental");
  assert.ok(
    src.includes("keepDominantSeries(") && src.includes("sortSlicesForVolume("),
    "la matemática de geometría se IMPORTA del dental, no se reescribe",
  );
});
