/**
 * DaleControl INSTITUCIONAL — el nombre de una persona, clicable.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-persona.test.ts
 *       (o `npm run test:edu`, que descubre este archivo solo)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * QUÉ SE PRUEBA Y POR QUÉ AQUÍ
 *
 * La decisión de "¿este nombre se vuelve enlace?" vive en persona-core.ts
 * como una función PURA precisamente para poder probarla sin montar React,
 * sin base y sin sesión. Lo que se prueba es lo que puede fallar en
 * silencio:
 *
 *   · la RUTA, que si se arma mal manda a la ficha de otra persona o a la
 *     lista completa (que parece que funciona);
 *   · las TRES KEYS de permiso, que si llevan una errata devuelven false
 *     para siempre y nadie ve un error: simplemente ningún nombre enlaza;
 *   · la REGLA de los dos candados (id y permiso), que es toda la ola.
 *
 * Los booleanos por rol NO se escriben a mano: se derivan de
 * EDU_ROLE_DEFAULTS. Si mañana alguien le da padron.view a CAJA, esta
 * prueba sigue verde porque la expectativa se movió con el default — y la
 * que se pone roja es la de arriba si el módulo dejó de preguntar por la
 * key que debía.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EDU_PERSONA_PERMISSION,
  eduPersonaDebeEnlazar,
  eduPersonaHref,
  eduPersonaLinksAllowed,
  type EduPersonaKind,
  type EduPersonaLinksAllowed,
} from "../persona-core";
import {
  EDU_ALL_PERMISSIONS,
  EDU_ROLE_DEFAULTS,
  hasEduPermission,
  type EduPermissionKey,
} from "../permissions";
import type { EduRole } from "../types";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CLASES: EduPersonaKind[] = ["paciente", "estudiante", "docente"];

// ═══════════════════════════════════════════════════════════════════════
// 1 · LA RUTA
// ═══════════════════════════════════════════════════════════════════════

test("eduPersonaHref: cada clase a su ruta, y ninguna a la del vecino", () => {
  assert.equal(eduPersonaHref("paciente", "p1"), "/instituto/pacientes/p1");
  assert.equal(eduPersonaHref("estudiante", "e1"), "/instituto/estudiantes/e1");
  assert.equal(eduPersonaHref("docente", "d1"), "/instituto/docentes/d1");
});

test("eduPersonaHref: el id va codificado — una barra no puede partir la ruta", () => {
  // Hoy los ids son cuid, pero un id con una barra dentro convertiría
  // /instituto/pacientes/{id} en otra ruta distinta (y en Next, en un 404 o
  // en la página equivocada). Lo mismo con "?" y "#", que abren query y
  // fragmento.
  const raro = "a/b?c#d e&f";
  const esperado = encodeURIComponent(raro);

  assert.equal(eduPersonaHref("paciente", raro), `/instituto/pacientes/${esperado}`);
  assert.equal(eduPersonaHref("estudiante", raro), `/instituto/estudiantes/${esperado}`);
  assert.equal(eduPersonaHref("docente", raro), `/instituto/docentes/${esperado}`);

  // Y de verdad se escapó: ni una barra suelta después de la raíz.
  assert.equal(eduPersonaHref("paciente", raro).split("/").length, 4);
  assert.ok(!eduPersonaHref("paciente", raro).includes("?"));
  assert.ok(!eduPersonaHref("paciente", raro).includes("#"));
});

test("eduPersonaHref: acentos y eñes sobreviven al viaje de ida y vuelta", () => {
  const id = "ñandú-áéíóú";
  const href = eduPersonaHref("docente", id);
  assert.equal(decodeURIComponent(href.replace("/instituto/docentes/", "")), id);
});

test("eduPersonaHref: id vacío LANZA en vez de devolver la lista completa", () => {
  // Sin esto devolvería "/instituto/pacientes/", que es la LISTA: un enlace
  // que parece funcionar y lleva a otro sitio. El que decide no enlazar es
  // quien llama, con eduPersonaDebeEnlazar.
  for (const kind of CLASES) {
    assert.throws(() => eduPersonaHref(kind, ""), /id vacío o no-string/);
    assert.throws(() => eduPersonaHref(kind, "   "), /id vacío o no-string/);
    assert.throws(() => eduPersonaHref(kind, null as unknown as string), /id vacío o no-string/);
    assert.throws(
      () => eduPersonaHref(kind, undefined as unknown as string),
      /id vacío o no-string/,
    );
  }
});

test("eduPersonaHref: una clase que no existe LANZA, no arma una ruta inventada", () => {
  assert.throws(
    () => eduPersonaHref("tutor" as EduPersonaKind, "x1"),
    /clase de persona desconocida/,
  );
});

// ═══════════════════════════════════════════════════════════════════════
// 2 · LAS TRES KEYS — el fallo que no se ve
// ═══════════════════════════════════════════════════════════════════════

test("eduPersonaLinksAllowed pregunta EXACTAMENTE por las tres keys documentadas", () => {
  // Si el módulo preguntara por "padron.manage" en vez de "padron.view", a
  // un docente no le enlazaría ningún alumno y no habría error en ningún
  // sitio: solo nombres muertos. Por eso se comprueba QUÉ se pregunta, no
  // solo qué se devuelve.
  const pedidas: string[] = [];
  const res = eduPersonaLinksAllowed((k) => {
    pedidas.push(k);
    return false;
  });

  assert.deepEqual(pedidas.slice().sort(), ["docentes.view", "pacientes.view", "padron.view"]);
  assert.deepEqual(res, { paciente: false, estudiante: false, docente: false });
});

test("las tres keys existen de verdad en el catálogo de permisos", () => {
  // Una errata aquí ("pacientes.ver") no rompe la compilación —el mapa está
  // tipado como string a propósito, para no atar el módulo puro al
  // catálogo— y deja el permiso en false para siempre.
  for (const kind of CLASES) {
    const key = EDU_PERSONA_PERMISSION[kind];
    assert.ok(
      key in EDU_ALL_PERMISSIONS,
      `EDU_PERSONA_PERMISSION.${kind} = "${key}" no está en EDU_ALL_PERMISSIONS`,
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════
// 3 · LOS CUATRO ROLES
// ═══════════════════════════════════════════════════════════════════════

/** El `has` de un rol SIN override: exactamente lo que le pasa el layout. */
function permisoDeRol(role: EduRole): (key: string) => boolean {
  return (key: string) =>
    hasEduPermission({ role, permissionsOverride: null }, key as EduPermissionKey);
}

/** Lo que DEBERÍA salir, leído del default del rol. No se escribe a mano. */
function esperadoDeRol(role: EduRole): EduPersonaLinksAllowed {
  const defaults = EDU_ROLE_DEFAULTS[role];
  const tiene = (kind: EduPersonaKind) =>
    defaults.includes(EDU_PERSONA_PERMISSION[kind] as EduPermissionKey);
  return {
    paciente: tiene("paciente"),
    estudiante: tiene("estudiante"),
    docente: tiene("docente"),
  };
}

test("DIRECCION abre las tres fichas", () => {
  const res = eduPersonaLinksAllowed(permisoDeRol("DIRECCION"));
  assert.deepEqual(res, esperadoDeRol("DIRECCION"));
});

test("DOCENTE abre las tres fichas", () => {
  const res = eduPersonaLinksAllowed(permisoDeRol("DOCENTE"));
  assert.deepEqual(res, esperadoDeRol("DOCENTE"));
});

test("ALUMNO abre la del paciente y ninguna persona del instituto", () => {
  // La razón de que el proveedor exista: para un alumno, los nombres de sus
  // compañeros y de sus docentes se quedan como texto, igual que hoy.
  const res = eduPersonaLinksAllowed(permisoDeRol("ALUMNO"));
  assert.deepEqual(res, esperadoDeRol("ALUMNO"));
});

test("CAJA abre la del paciente y ninguna persona del instituto", () => {
  const res = eduPersonaLinksAllowed(permisoDeRol("CAJA"));
  assert.deepEqual(res, esperadoDeRol("CAJA"));
});

test("los cuatro roles no salen todos iguales — si no, el proveedor sobra", () => {
  // Cinturón contra el falso verde: si un día las cuatro combinaciones
  // fueran idénticas, las cuatro pruebas de arriba pasarían igual y esta
  // ola habría dejado de servir para algo. Que se entere alguien.
  const formas = new Set(
    (["DIRECCION", "DOCENTE", "ALUMNO", "CAJA"] as EduRole[]).map((r) =>
      JSON.stringify(eduPersonaLinksAllowed(permisoDeRol(r))),
    ),
  );
  assert.ok(
    formas.size >= 2,
    "los cuatro roles ven exactamente las mismas fichas: revisa EDU_ROLE_DEFAULTS",
  );
});

test("eduPersonaLinksAllowed niega todo si no le dan una función", () => {
  const nada = { paciente: false, estudiante: false, docente: false };
  assert.deepEqual(eduPersonaLinksAllowed(null as unknown as (k: string) => boolean), nada);
  assert.deepEqual(eduPersonaLinksAllowed(undefined as unknown as (k: string) => boolean), nada);
});

// ═══════════════════════════════════════════════════════════════════════
// 4 · LA REGLA — los dos candados
// ═══════════════════════════════════════════════════════════════════════

const TODO: EduPersonaLinksAllowed = { paciente: true, estudiante: true, docente: true };
const NADA: EduPersonaLinksAllowed = { paciente: false, estudiante: false, docente: false };

test("sin id no hay enlace, aunque sobre el permiso", () => {
  // El paciente enmascarado de la clínica en vivo llega con patientId: null
  // A PROPÓSITO. Si esto devolviera true, el enmascaramiento se caería por
  // la puerta de atrás.
  for (const kind of CLASES) {
    assert.equal(eduPersonaDebeEnlazar(kind, null, TODO), false);
    assert.equal(eduPersonaDebeEnlazar(kind, undefined, TODO), false);
    assert.equal(eduPersonaDebeEnlazar(kind, "", TODO), false);
    assert.equal(eduPersonaDebeEnlazar(kind, "   ", TODO), false);
  }
});

test("sin permiso no hay enlace, aunque haya id", () => {
  for (const kind of CLASES) {
    assert.equal(eduPersonaDebeEnlazar(kind, "id-real", NADA), false);
  }
});

test("con id y con permiso, enlace", () => {
  for (const kind of CLASES) {
    assert.equal(eduPersonaDebeEnlazar(kind, "id-real", TODO), true);
  }
});

test("el permiso es POR CLASE: el de paciente no abre la del estudiante", () => {
  const soloPaciente: EduPersonaLinksAllowed = {
    paciente: true,
    estudiante: false,
    docente: false,
  };
  assert.equal(eduPersonaDebeEnlazar("paciente", "id-real", soloPaciente), true);
  assert.equal(eduPersonaDebeEnlazar("estudiante", "id-real", soloPaciente), false);
  assert.equal(eduPersonaDebeEnlazar("docente", "id-real", soloPaciente), false);
});

test("sin proveedor (allowed ausente) no hay enlace: falla CERRADO", () => {
  // Es el valor por omisión del contexto de React, y también lo que llega
  // si alguien pasa un undefined. Las dos rutas tienen que negar.
  for (const kind of CLASES) {
    assert.equal(eduPersonaDebeEnlazar(kind, "id-real", null), false);
    assert.equal(eduPersonaDebeEnlazar(kind, "id-real", undefined), false);
  }
  assert.equal(
    eduPersonaDebeEnlazar("tutor" as EduPersonaKind, "id-real", TODO),
    false,
    "una clase desconocida no puede colarse por un objeto con las tres en true",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// 5 · EL CONTRATO DEL COMPONENTE
//
// No se monta React —en este vertical ninguna prueba lo hace— así que el
// contrato se comprueba LEYENDO el archivo, igual que edu-theme.test.ts
// hace con la hoja de estilos. Lo que se guarda aquí es exactamente lo que
// las tres olas siguientes van a dar por hecho y no van a volver a mirar.
// ═══════════════════════════════════════════════════════════════════════

const RAIZ = join(__dirname, "..", "..", "..", "..");
const COMPONENTE = readFileSync(
  join(RAIZ, "src", "components", "edu", "persona", "persona-link.tsx"),
  "utf8",
);
const TEMA = readFileSync(join(RAIZ, "src", "app", "instituto", "edu-theme.css"), "utf8");

test("el componente es cliente y usa la decisión pura, no una suya", () => {
  assert.ok(
    COMPONENTE.trimStart().startsWith('"use client"'),
    'persona-link.tsx tiene que abrir con "use client" en su primera línea',
  );
  assert.ok(
    COMPONENTE.includes("eduPersonaDebeEnlazar("),
    "el componente tiene que decidir con eduPersonaDebeEnlazar, no con un if propio",
  );
  assert.ok(COMPONENTE.includes("eduPersonaHref("), "la ruta la arma persona-core, no el JSX");
});

test("es un <Link> y nada más: sin onClick, sin router, sin estado", () => {
  // Un onClick con router.push rompe abrir en pestaña nueva, copiar el
  // enlace y el prefetch de Next, y no gana nada. stopPropagation es la
  // señal de que alguien lo metió dentro de un botón — que es justo lo que
  // el JSDoc prohíbe.
  const codigo = COMPONENTE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const prohibido of ["onClick", "router.push", "stopPropagation", "useState", "useRouter"]) {
    assert.ok(
      !codigo.includes(prohibido),
      `persona-link.tsx no puede usar ${prohibido}: es un <Link> y ya`,
    );
  }
});

test("la clase base y el data-persona están, y la clase existe en el tema", () => {
  // className se SUMA a .edu-persona, no la sustituye: la plantilla tiene
  // que empezar por la base. Si alguien invierte el orden o la pierde, la
  // ola siguiente pinta noventa nombres sin estilo.
  assert.ok(
    COMPONENTE.includes("`edu-persona ${className}`"),
    "className se suma a edu-persona; la plantilla tiene que empezar por la base",
  );
  assert.ok(COMPONENTE.includes('"edu-persona"'), "sin className, la clase es solo edu-persona");
  assert.ok(
    COMPONENTE.includes("data-persona={kind}"),
    "data-persona={kind} es cómo lo encuentran las pruebas y el QA visual",
  );

  // Y la clase existe de verdad en la hoja: una clase que solo vive en el
  // JSX no pinta nada y no da error en ningún sitio.
  assert.ok(
    /^\.edu-persona\s*\{/m.test(TEMA),
    ".edu-persona tiene que estar declarada en edu-theme.css",
  );
  // Una clase, un dueño (la trampa que ya mordió a este vertical con
  // .edu-linea). edu-theme.test.ts lo vigila en general; aquí se vigila
  // esta.
  const declaraciones = TEMA.match(/^\.edu-persona\s*\{/gm) ?? [];
  assert.equal(declaraciones.length, 1, ".edu-persona declarada más de una vez en edu-theme.css");
});

/**
 * El contenido de cada `@media print { ... }`, recortado por llaves.
 *
 * ⚠️ A propósito NO se hace con un split: la parte de después del último
 * "@media print" llega hasta el FINAL DEL ARCHIVO y se tragaría reglas que
 * no son de impresión — la prueba saldría verde con el bloque borrado. Es
 * la misma trampa que ya mordió a la prueba del visor con @container.
 */
function bloquesPrint(css: string): string[] {
  const out: string[] = [];
  const re = /@media\s+print\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    let prof = 1;
    let i = m.index + m[0].length;
    const desde = i;
    while (i < css.length && prof > 0) {
      if (css[i] === "{") prof++;
      else if (css[i] === "}") prof--;
      i++;
    }
    out.push(css.slice(desde, i - 1));
  }
  return out;
}

test("el nombre no se imprime como enlace", () => {
  // Un recibo o una receta en papel no llevan enlaces azules: sobre papel un
  // enlace no es nada, solo tinta rara encima del nombre de un paciente.
  const bloques = bloquesPrint(TEMA);
  assert.ok(bloques.length > 0, "no se encontró ni un @media print en edu-theme.css");

  const suyo = bloques.filter((b) => b.includes(".edu-persona"));
  assert.equal(suyo.length, 1, "falta (o sobra) la regla de .edu-persona dentro de un @media print");
  assert.ok(suyo[0].includes("text-decoration: none"), "en papel el nombre no va subrayado");
  assert.ok(suyo[0].includes("color: inherit"), "en papel el nombre va del color del texto");
});
