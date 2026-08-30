/**
 * DaleControl INSTITUCIONAL — Ola 3B · el CONSENTIMIENTO INFORMADO.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-consentimientos.test.ts
 *
 * (No hay `npm run test:edu-consentimientos`: package.json es un archivo
 * del producto dental y esta ola no lo toca.)
 *
 * Todo aquí corre SIN base de datos, contra los módulos puros. Lo que fija:
 *  1. el ESTADO derivado y su orden (revocado gana sobre firmado);
 *  2. el TEXTO CANÓNICO del hash — NFC, CRLF y la versión dentro;
 *  3. la carta: que nombra al alumno, su especialidad y al docente ANTES
 *     que nada;
 *  4. el token: forma válida, y que un token con `../` no pasa;
 *  5. 🔴 la asimetría de VISIBILIDAD que hace posible la ola: caja ve
 *     consentimientos (recurso "patients") y NO ve expediente ("cases");
 *  6. los cuatro permisos nuevos y quién los tiene.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EDU_CONSENT_ESTADO_LABELS,
  EDU_CONSENT_ESTADO_TAGS,
  EDU_CONSENT_HASH_VERSION,
  EDU_CONSENT_INTEGRIDAD_LABELS,
  EDU_CONSENT_TTL_DAYS,
  eduConsentCanonicalText,
  eduConsentEstado,
  eduConsentPublicPath,
  eduConsentSePuedeFirmar,
  eduConsentSePuedeRevocar,
  eduConsentSignaturePath,
  eduConsentTemplateExists,
  eduConsentTemplates,
  eduConsentText,
  eduConsentTexto,
  eduConsentTokenIsValid,
  eduNormalizeConsentText,
  parseEduConsentFirmante,
  type EduConsentEstado,
} from "../consentimientos-core";
import { eduClinicalScope } from "../expediente-core";
import { eduVisibility } from "../visibility";
import {
  EDU_ALL_PERMISSIONS,
  EDU_PERMISSION_GROUPS,
  EDU_ROLE_DEFAULTS,
  hasEduPermission,
  type EduPermissionKey,
} from "../permissions";
import { EDU_ROLES } from "../types";

const AHORA = new Date("2026-09-01T12:00:00.000Z");
const FUTURO = new Date("2026-09-20T12:00:00.000Z");
const PASADO = new Date("2026-08-01T12:00:00.000Z");

// ─────────────────────────────────────────────────────────────────────
// 1 · El estado, derivado
// ─────────────────────────────────────────────────────────────────────

test("pendiente: sin firma, sin revocación y con liga viva", () => {
  const e = eduConsentEstado({ signedAt: null, revokedAt: null, expiresAt: FUTURO }, AHORA);
  assert.equal(e, "PENDIENTE");
  assert.equal(eduConsentSePuedeFirmar({ signedAt: null, revokedAt: null, expiresAt: FUTURO }, AHORA), true);
});

test("vencido: sin firma y con la liga caducada", () => {
  assert.equal(
    eduConsentEstado({ signedAt: null, revokedAt: null, expiresAt: PASADO }, AHORA),
    "VENCIDO",
  );
  assert.equal(
    eduConsentSePuedeFirmar({ signedAt: null, revokedAt: null, expiresAt: PASADO }, AHORA),
    false,
  );
});

test("🔴 firmado GANA a vencido: lo que caduca es la posibilidad de firmar, no la firma", () => {
  // Si esto se invirtiera, un paciente que abre su carta un mes después
  // vería "Liga vencida" sobre un documento que él firmó — y creería que
  // su consentimiento desapareció.
  assert.equal(
    eduConsentEstado({ signedAt: PASADO, revokedAt: null, expiresAt: PASADO }, AHORA),
    "FIRMADO",
  );
});

test("🔴 revocado GANA a firmado: el paciente se retractó", () => {
  // Es LA comprobación de la ola. Si un consentimiento revocado se pintara
  // como "Firmado", alguien podría meterse a la boca de una persona que
  // dijo que no.
  assert.equal(
    eduConsentEstado({ signedAt: PASADO, revokedAt: AHORA, expiresAt: FUTURO }, AHORA),
    "REVOCADO",
  );
  // Y también gana a "pendiente" y a "vencido".
  assert.equal(
    eduConsentEstado({ signedAt: null, revokedAt: AHORA, expiresAt: FUTURO }, AHORA),
    "REVOCADO",
  );
  assert.equal(
    eduConsentEstado({ signedAt: null, revokedAt: AHORA, expiresAt: PASADO }, AHORA),
    "REVOCADO",
  );
});

test("un consentimiento revocado NO se puede firmar", () => {
  assert.equal(
    eduConsentSePuedeFirmar({ signedAt: null, revokedAt: AHORA, expiresAt: FUTURO }, AHORA),
    false,
  );
});

test("se puede revocar lo pendiente, lo firmado y lo vencido; nunca dos veces", () => {
  assert.equal(eduConsentSePuedeRevocar({ revokedAt: null }), true);
  assert.equal(eduConsentSePuedeRevocar({ revokedAt: AHORA }), false);
});

test("un objeto basura cae en VENCIDO, no en PENDIENTE (la opción segura)", () => {
  assert.equal(eduConsentEstado(null as never, AHORA), "VENCIDO");
  assert.equal(
    eduConsentEstado({ signedAt: null, revokedAt: null, expiresAt: "no-es-fecha" }, AHORA),
    "VENCIDO",
  );
});

test("los cuatro estados tienen etiqueta en español y píldora (la UI no pinta el enum)", () => {
  const estados: EduConsentEstado[] = ["PENDIENTE", "FIRMADO", "REVOCADO", "VENCIDO"];
  for (const e of estados) {
    assert.ok(EDU_CONSENT_ESTADO_LABELS[e], `falta etiqueta de ${e}`);
    assert.ok(EDU_CONSENT_ESTADO_TAGS[e], `falta píldora de ${e}`);
    assert.notEqual(EDU_CONSENT_ESTADO_LABELS[e], e, `${e} se pinta con su propio enum`);
  }
});

// ─────────────────────────────────────────────────────────────────────
// 2 · El texto canónico y su hash
// ─────────────────────────────────────────────────────────────────────

test("🔴 NFC: la misma 'í' compuesta y descompuesta da el MISMO texto canónico", () => {
  // En español la "í" se guarda como UN carácter (U+00ED) o como DOS
  // (i + U+0301) según el sistema del teclado: macOS produce una forma y
  // Windows/iOS la otra. Sin normalizar, copiar y pegar la carta sin
  // cambiar una palabra cambiaría el hash y la firma se "vencería" sola.
  // Las dos cadenas de abajo se LEEN igual y tienen bytes distintos: la
  // primera trae ó/ú de un solo carácter (U+00F3, U+00FA) y la segunda
  // vocal + acento combinante (U+0301). El primer assert lo comprueba, para
  // que un editor que las normalizara al guardar no deje la prueba hueca.
  const compuesta = "extracción quirúrgica";
  const descompuesta = "extracción quirúrgica";
  assert.notEqual(compuesta, descompuesta, "las dos cadenas deben tener bytes distintos");
  assert.equal(eduNormalizeConsentText(compuesta), eduNormalizeConsentText(descompuesta));
  assert.equal(
    eduConsentCanonicalText({ procedure: compuesta, content: "x" }),
    eduConsentCanonicalText({ procedure: descompuesta, content: "x" }),
  );
});

test("🔴 CRLF: el mismo párrafo escrito en Windows y en Mac da el mismo canónico", () => {
  assert.equal(
    eduNormalizeConsentText("uno\r\ndos\r\ntres"),
    eduNormalizeConsentText("uno\ndos\ntres"),
  );
  assert.equal(eduNormalizeConsentText("uno\rdos"), "uno\ndos");
});

test("el trim es de EXTREMOS: los espacios interiores y las mayúsculas se respetan", () => {
  // Ahí sí hay contenido: "no extraer" y "NO EXTRAER" no son la misma
  // instrucción en un documento que alguien va a firmar.
  assert.equal(eduNormalizeConsentText("  hola  "), "hola");
  assert.equal(eduNormalizeConsentText("no  extraer"), "no  extraer");
  assert.equal(eduNormalizeConsentText("NO EXTRAER"), "NO EXTRAER");
  assert.notEqual(eduNormalizeConsentText("no extraer"), eduNormalizeConsentText("NO EXTRAER"));
});

test("🔴 la VERSIÓN de la receta va DENTRO del texto canónico", () => {
  // Cambiar cómo se arma este texto sin cambiar la versión es cómo se
  // llega a que unas firmas validen y otras no, sin patrón visible.
  const t = eduConsentCanonicalText({ procedure: "Endodoncia", content: "texto" });
  assert.ok(t.startsWith(EDU_CONSENT_HASH_VERSION), `el canónico no empieza por la versión: ${t}`);
});

test("el canónico lleva el NOMBRE de cada campo y no es un JSON.stringify", () => {
  // El orden de las claves de un objeto de JS depende de cómo se
  // construyó: dos lecturas de la MISMA fila pueden dar dos JSON.
  const t = eduConsentCanonicalText({ procedure: "Endodoncia", content: "cuerpo" });
  assert.ok(t.includes("procedimiento: Endodoncia"));
  assert.ok(t.includes("texto:"));
  assert.equal(t.includes("{"), false, "el canónico no debe ser JSON");
});

test("🔴 cambiar UNA palabra del texto cambia el canónico (es lo que detecta la alteración)", () => {
  // De esta propiedad depende la comprobación de integridad que hace
  // `getEduConsentPublic`: recalcula la huella al leer y la compara con la
  // que se guardó al emitir. Si el canónico no cambiara con el texto, esa
  // comprobación diría "todo bien" sobre una carta modificada.
  const a = eduConsentCanonicalText({ procedure: "Endodoncia", content: "Se extraerá la pieza 36." });
  const b = eduConsentCanonicalText({ procedure: "Endodoncia", content: "Se extraerá la pieza 37." });
  assert.notEqual(a, b);
  // Y NO cambia con lo que no es contenido (saltos de Windows, forma NFD).
  // Se arma con String.fromCharCode y no con un escape para que este
  // archivo no dependa de como el editor guarde los saltos.
  const conCrlf = "Se extraerá la pieza 36." + String.fromCharCode(13, 10);
  const c = eduConsentCanonicalText({ procedure: "Endodoncia", content: conCrlf });
  assert.equal(a, c);
});

test("los tres veredictos de integridad tienen un texto que se puede leer", () => {
  for (const k of ["ok", "alterado", "sin_hash"] as const) {
    const t = EDU_CONSENT_INTEGRIDAD_LABELS[k];
    assert.ok(t && t.length > 20, `falta el texto de integridad "${k}"`);
  }
  // "sin_hash" NO puede pintarse como si todo estuviera bien: de una carta
  // sin huella no se puede afirmar nada, y decirlo es más honesto que un
  // check verde.
  assert.notEqual(EDU_CONSENT_INTEGRIDAD_LABELS.sin_hash, EDU_CONSENT_INTEGRIDAD_LABELS.ok);
});

test("dos campos que se intercambian NO producen el mismo canónico", () => {
  // Sin el nombre del campo dentro, ("a","b") y ("b","a") colisionarían.
  const a = eduConsentCanonicalText({ procedure: "A", content: "B" });
  const b = eduConsentCanonicalText({ procedure: "B", content: "A" });
  assert.notEqual(a, b);
});

// ─────────────────────────────────────────────────────────────────────
// 3 · La carta
// ─────────────────────────────────────────────────────────────────────

const CARTA_BASE = {
  procedureKey: "atencion-general",
  procedure: "",
  institutionName: "Instituto de Especialidades Odontológicas",
  institutionCity: "Puebla",
  timezone: "America/Mexico_City",
  patientName: "María Hernández",
  patientAge: 34,
  patientFolio: "P-014",
  studentName: "Sofía Ibarra",
  studentMatricula: "A-014",
  programName: "Endodoncia",
  supervisorName: "Dr. Luis Ortega",
};

test("🔴 la carta nombra al ALUMNO, su especialidad y al DOCENTE, y lo hace ANTES que nada", () => {
  const texto = eduConsentTexto(CARTA_BASE);
  const iAlumno = texto.indexOf("Sofía Ibarra");
  const iDocente = texto.indexOf("Dr. Luis Ortega");
  const iRiesgos = texto.indexOf("RIESGOS");

  assert.ok(iAlumno >= 0, "la carta no nombra al alumno");
  assert.ok(iDocente >= 0, "la carta no nombra al docente responsable");
  assert.ok(texto.includes("A-014"), "la carta no lleva la matrícula");
  assert.ok(texto.includes("Endodoncia"), "la carta no dice la especialidad");
  // El dato que más le importa a quien firma en una clínica de enseñanza
  // no puede estar detrás del bloque de firmas.
  assert.ok(iAlumno < iRiesgos, "el bloque de la escuela tiene que ir antes del cuerpo");
  assert.ok(texto.indexOf("QUIÉN TE VA A ATENDER") < iRiesgos);
});

test("la carta hereda el cuerpo NOM-004 del catálogo compartido (no lo reescribe)", () => {
  const texto = eduConsentTexto(CARTA_BASE);
  // Estas secciones vienen de src/lib/consent/templates.ts, que se IMPORTA.
  for (const trozo of ["ALTERNATIVAS", "REVOCACIÓN", "FIRMAS", "NOM-004"]) {
    assert.ok(texto.includes(trozo), `la carta perdió la sección "${trozo}"`);
  }
  assert.ok(texto.includes("María Hernández"), "no interpoló el nombre del paciente");
  assert.ok(texto.includes("P-014"), "no interpoló el folio");
});

test("el título no sale dos veces (se le quita el del generador del dental)", () => {
  const texto = eduConsentTexto(CARTA_BASE);
  const veces = texto.split("CARTA DE CONSENTIMIENTO INFORMADO").length - 1;
  assert.equal(veces, 1, `el título aparece ${veces} veces`);
});

test("con representante legal, la carta lo dice (NOM-004 10.1.1.3)", () => {
  const texto = eduConsentTexto({
    ...CARTA_BASE,
    signerName: "Juan Hernández",
    signerRelation: "padre",
  });
  assert.ok(texto.includes("Juan Hernández"));
  assert.ok(texto.includes("padre"));
  assert.ok(texto.includes("Representante legal"));
});

test("sin docente asignado, la carta NO inventa un nombre", () => {
  const texto = eduConsentTexto({ ...CARTA_BASE, supervisorName: null });
  assert.equal(texto.includes("Dr. Luis Ortega"), false);
  assert.ok(texto.includes("bajo la supervisión de un docente del instituto"));
});

test("el catálogo de plantillas trae la carta general y varias más", () => {
  const t = eduConsentTemplates();
  assert.ok(t.length >= 5, `solo hay ${t.length} plantillas`);
  assert.ok(eduConsentTemplateExists("atencion-general"));
  assert.equal(eduConsentTemplateExists("no-existe-esta-clave"), false);
  assert.equal(eduConsentTemplateExists(null), false);
  assert.equal(eduConsentTemplateExists(""), false);
});

// ─────────────────────────────────────────────────────────────────────
// 4 · El token y los paths
// ─────────────────────────────────────────────────────────────────────

test("el token acepta base64url y rechaza cualquier otra cosa", () => {
  assert.equal(eduConsentTokenIsValid("abcDEF012_-abcDEF012_-abc"), true);
  assert.equal(eduConsentTokenIsValid("corto"), false, "20 caracteres mínimo");
  assert.equal(eduConsentTokenIsValid("a".repeat(65)), false, "64 máximo");
  assert.equal(eduConsentTokenIsValid("aaaaaaaaaaaaaaaaaaaa/../etc"), false, "no admite barras");
  assert.equal(eduConsentTokenIsValid("aaaaaaaaaaaaaaaaaaaa'--"), false, "no admite comillas");
  assert.equal(eduConsentTokenIsValid(null), false);
  assert.equal(eduConsentTokenIsValid(12345), false);
});

test("🔴 el path de una firma empieza por el institutionId (el bucket se parte por escuela)", () => {
  const p = eduConsentSignaturePath("inst-1", "cons-9", "paciente");
  assert.ok(p.startsWith("inst-1/"), `el path no empieza por el instituto: ${p}`);
  assert.equal(p, "inst-1/consentimientos/cons-9/paciente.png");
  // Los cinco huecos van a archivos distintos: una contrafirma no puede
  // pisar la firma del paciente.
  const paths = ["paciente", "testigo1", "testigo2", "alumno", "docente"].map((s) =>
    eduConsentSignaturePath("inst-1", "cons-9", s as never),
  );
  assert.equal(new Set(paths).size, 5, "dos huecos comparten path");
});

test("la ruta pública es una sola y la comparten el panel y la página", () => {
  assert.equal(eduConsentPublicPath("tok"), "/instituto/consentimiento/tok");
});

test("el firmante público es un conjunto CERRADO (no un nombre de columna)", () => {
  assert.equal(parseEduConsentFirmante("paciente"), "paciente");
  assert.equal(parseEduConsentFirmante("testigo1"), "testigo1");
  assert.equal(parseEduConsentFirmante("testigo2"), "testigo2");
  // Si esto aceptara texto libre, un cuerpo con
  // `rol: "supervisorSignatureUrl"` dejaría a un tercero contrafirmando
  // como el docente responsable.
  assert.equal(parseEduConsentFirmante("docente"), null);
  assert.equal(parseEduConsentFirmante("supervisorSignatureUrl"), null);
  assert.equal(parseEduConsentFirmante(null), null);
});

test("eduConsentText recorta, normaliza saltos y descarta lo vacío", () => {
  assert.equal(eduConsentText("  hola  ", 10), "hola");
  assert.equal(eduConsentText("uno\r\ndos", 20), "uno\ndos");
  assert.equal(eduConsentText("", 10), null);
  assert.equal(eduConsentText("   ", 10), null);
  assert.equal(eduConsentText(42, 10), null);
  assert.equal(eduConsentText("abcdefghij", 4), "abcd");
});

test("la liga vive 30 días: ni un número mágico suelto en el servidor", () => {
  assert.equal(EDU_CONSENT_TTL_DAYS, 30);
});

// ─────────────────────────────────────────────────────────────────────
// 5 · 🔴 LA ASIMETRÍA QUE HACE POSIBLE LA OLA
// ─────────────────────────────────────────────────────────────────────

test("🔴 CAJA ve consentimientos ('patients') y NO ve expediente ('cases')", () => {
  const caja = { role: "CAJA" as const, eduUserId: "u-caja" };

  // El consentimiento se lee con el recurso del PACIENTE: caja tiene que
  // poder ver la carta porque la imprime y la entrega en el mostrador.
  assert.equal(eduVisibility(caja, "patients").kind, "all");

  // El expediente clínico se lee con "cases", y ahí caja sigue sin ver
  // NADA. Si esta línea se rompiera, la ola habría abierto las notas
  // clínicas de la escuela entera a recepción.
  assert.equal(eduClinicalScope(caja).kind, "none");
});

test("para alumno y docente los dos recursos recortan igual (la diferencia es SOLO caja)", () => {
  const alumno = { role: "ALUMNO" as const, eduUserId: "u-1" };
  const docente = { role: "DOCENTE" as const, eduUserId: "u-2" };

  assert.deepEqual(eduVisibility(alumno, "patients"), eduClinicalScope(alumno));
  assert.deepEqual(eduVisibility(docente, "patients"), eduClinicalScope(docente));
  assert.equal(eduVisibility(alumno, "patients").kind, "own");
  assert.equal(eduVisibility(docente, "patients").kind, "supervised");
});

test("un alumno sin eduUserId no ve un solo consentimiento", () => {
  assert.equal(eduVisibility({ role: "ALUMNO", eduUserId: "" }, "patients").kind, "none");
});

// ─────────────────────────────────────────────────────────────────────
// 6 · Los tres permisos de consentimientos
// ─────────────────────────────────────────────────────────────────────

const KEYS_CONSENT: EduPermissionKey[] = [
  "consentimientos.view",
  "consentimientos.create",
  "consentimientos.revoke",
];

test("las tres keys están en el catálogo, descritas en español", () => {
  for (const k of KEYS_CONSENT) {
    assert.ok(k in EDU_ALL_PERMISSIONS, `falta ${k}`);
    const desc = EDU_ALL_PERMISSIONS[k];
    assert.ok(desc && desc.length > 8, `${k} sin descripción usable`);
    assert.notEqual(desc, k);
  }
});

test("las tres viven en SU grupo, y cada una en uno solo", () => {
  const grupo = EDU_PERMISSION_GROUPS.filter((g) => g.keys.includes("consentimientos.view"))[0];
  assert.ok(grupo, "no hay grupo para consentimientos.view");
  for (const k of KEYS_CONSENT) {
    assert.ok(grupo.keys.includes(k), `${k} no está en "${grupo.title}"`);
    assert.equal(
      EDU_PERMISSION_GROUPS.filter((g) => g.keys.includes(k)).length,
      1,
      `${k} aparece en más de un grupo`,
    );
  }
  // Grupo APARTE del expediente: es el único bloque donde caja tiene una
  // casilla encendida, y mezclarlo haría que "darle consentimientos a
  // caja" pareciera "darle el expediente a caja".
  assert.equal(grupo.keys.includes("expediente.view"), false);
});

test("🔴 CAJA lleva view y NADA más: recepción entrega la carta, no la emite", () => {
  assert.equal(hasEduPermission({ role: "CAJA" }, "consentimientos.view"), true);
  assert.equal(hasEduPermission({ role: "CAJA" }, "consentimientos.create"), false);
  assert.equal(hasEduPermission({ role: "CAJA" }, "consentimientos.revoke"), false);
  // Y sigue sin una sola key del expediente clínico.
  for (const k of ["expediente.view", "odontograma.view", "estudios.view"] as EduPermissionKey[]) {
    assert.equal(hasEduPermission({ role: "CAJA" }, k), false, `CAJA no debería traer ${k}`);
  }
});

test("dirección, docente y alumno llevan las tres", () => {
  for (const rol of ["DIRECCION", "DOCENTE", "ALUMNO"] as const) {
    for (const k of KEYS_CONSENT) {
      assert.equal(hasEduPermission({ role: rol }, k), true, `${rol} debería traer ${k}`);
    }
  }
});

test("⚠️ el ALUMNO sí revoca, y es deliberado", () => {
  // El paciente se retracta en el sillón, delante del alumno. El estado
  // peligroso no es una revocación registrada de más: es un consentimiento
  // VIVO para un procedimiento que el paciente ya rechazó porque el alumno
  // tuvo que ir a buscar a su docente para anotarlo.
  assert.equal(hasEduPermission({ role: "ALUMNO" }, "consentimientos.revoke"), true);
});

test("los defaults nuevos no rompen a ningún rol (todos siguen entrando al panel)", () => {
  for (const rol of EDU_ROLES) {
    assert.ok(EDU_ROLE_DEFAULTS[rol].length > 0, `${rol} se quedó sin permisos`);
    assert.equal(
      new Set(EDU_ROLE_DEFAULTS[rol]).size,
      EDU_ROLE_DEFAULTS[rol].length,
      `${rol} repite keys`,
    );
    assert.equal(hasEduPermission({ role: rol }, "inicio.view"), true);
  }
});
