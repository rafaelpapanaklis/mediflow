/**
 * EL EQUIPO de DaleControl INSTITUCIONAL (Ola 1B), probado SIN base de
 * datos y sin tocar Supabase Auth.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-equipo.test.ts
 *
 * (No hay `npm run test:edu-equipo`: package.json es un archivo del
 * producto dental y este vertical no lo toca.)
 *
 * ── POR QUÉ EXISTE ESTA OLA ─────────────────────────────────────────────
 * Hasta aquí NO había forma de crear un alumno, un docente ni un cajero
 * desde el panel: el padrón decía "las cuentas se dan de alta aparte" y ese
 * "aparte" era un INSERT a mano en Supabase. Con una generación de 200
 * alumnos, eso no es un producto.
 *
 * ── QUÉ FIJA ESTE ARCHIVO ───────────────────────────────────────────────
 *  1. el saneo de UNA persona (y que el error se lee en español);
 *  2. el PEGADO: columnas, separadores, encabezado, correos repetidos y
 *     rol por defecto — todo lo que decide qué se va a crear ANTES de
 *     crear nada;
 *  3. la contraseña temporal: forma, alfabeto sin caracteres ambiguos y
 *     que SIEMPRE lleva un dígito;
 *  4. la tabla de credenciales que se copia;
 *  5. los filtros de la URL (y que NO leen un institutionId).
 *
 * ── HASTA DÓNDE LLEGA, Y HASTA DÓNDE NO ─────────────────────────────────
 * Todo esto es el módulo PURO. Lo que NO se prueba aquí, porque necesita
 * red y base: que Supabase cree la cuenta, que un correo ya registrado se
 * REUSE en vez de fallar, y que la fila de edu_users quede escrita. Eso
 * está descrito en ORQUESTA.md como lo que hay que probar a mano.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EDU_ROLES, EDU_ROLE_LABELS } from "../types";
import {
  EDU_TEAM_BULK_CHUNK,
  EDU_TEMP_PASSWORD_BYTES,
  eduTeamCredentialsText,
  eduTeamFullName,
  eduTeamMemberInput,
  eduTeamRowsListas,
  eduTempPasswordFromBytes,
  parseEduTeamFilters,
  parseEduTeamPaste,
  parseEduTeamRole,
  type EduTeamAltaResult,
} from "../equipo-core";

// ═══════════════════════════════════════════════════════════════════════
// 1 · UNA PERSONA
// ═══════════════════════════════════════════════════════════════════════

test("una persona bien capturada sale limpia y normalizada", () => {
  const r = eduTeamMemberInput({
    firstName: "  María  Elena ",
    lastName: "Rodríguez",
    email: "  MARIA@Instituto.MX ",
    role: "ALUMNO",
    phone: "55 4433 2211",
  });
  assert.equal(r.error, null);
  assert.deepEqual(r.value, {
    firstName: "María Elena",
    lastName: "Rodríguez",
    email: "maria@instituto.mx",
    role: "ALUMNO",
    phone: "5544332211",
  });
});

test("el teléfono es opcional de verdad (vacío, null o ausente)", () => {
  for (const phone of ["", null, undefined]) {
    const r = eduTeamMemberInput({
      firstName: "Ana",
      lastName: "Ruiz",
      email: "ana@x.mx",
      role: "DOCENTE",
      phone,
    });
    assert.equal(r.error, null, `falló con phone=${String(phone)}`);
    assert.equal(r.value?.phone, null);
  }
});

test("cada campo que falta devuelve un error EN ESPAÑOL, no un código", () => {
  const casos: [Record<string, unknown>, RegExp][] = [
    [{ lastName: "Ruiz", email: "a@x.mx", role: "ALUMNO" }, /nombre/i],
    [{ firstName: "Ana", email: "a@x.mx", role: "ALUMNO" }, /apellidos/i],
    [{ firstName: "Ana", lastName: "Ruiz", role: "ALUMNO" }, /correo/i],
    [{ firstName: "Ana", lastName: "Ruiz", email: "a@x.mx" }, /rol/i],
    [{ firstName: "Ana", lastName: "Ruiz", email: "no-es-correo", role: "ALUMNO" }, /correo/i],
    [{ firstName: "Ana", lastName: "Ruiz", email: "a@x.mx", role: "RECTOR" }, /rol/i],
  ];
  for (const [input, esperado] of casos) {
    const r = eduTeamMemberInput(input);
    assert.equal(r.value, null, `debería rechazar ${JSON.stringify(input)}`);
    assert.match(r.error ?? "", esperado);
  }
});

test("el rol se entiende escrito como lo escribe una persona", () => {
  assert.equal(parseEduTeamRole("ALUMNO"), "ALUMNO");
  assert.equal(parseEduTeamRole("Alumno"), "ALUMNO");
  assert.equal(parseEduTeamRole(" estudiante "), "ALUMNO");
  assert.equal(parseEduTeamRole("Dirección"), "DIRECCION");
  assert.equal(parseEduTeamRole("direccion"), "DIRECCION");
  assert.equal(parseEduTeamRole("Profesora"), "DOCENTE");
  assert.equal(parseEduTeamRole("cajera"), "CAJA");
  // Y lo que NO reconoce devuelve null en vez de adivinar: un renglón con
  // "Docente " mal escrito tiene que salir marcado, no convertirse en
  // silencio en un ALUMNO.
  assert.equal(parseEduTeamRole("Rector"), null);
  assert.equal(parseEduTeamRole(""), null);
  assert.equal(parseEduTeamRole(null), null);
  assert.equal(parseEduTeamRole(7 as unknown as string), null);
});

test("los cuatro roles del producto se pueden asignar desde aquí", () => {
  for (const r of EDU_ROLES) {
    assert.equal(parseEduTeamRole(r), r);
    assert.equal(parseEduTeamRole(EDU_ROLE_LABELS[r]), r, `la etiqueta de ${r} no se reconoce`);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// 2 · EL PEGADO
// ═══════════════════════════════════════════════════════════════════════

test("una lista con comas se interpreta renglón por renglón", () => {
  const filas = parseEduTeamPaste(
    [
      "María Elena, Rodríguez Gómez, maria@instituto.mx, Alumno",
      "Juan, Pérez, juan@instituto.mx, Docente",
    ].join("\n"),
  );
  assert.equal(filas.length, 2);
  assert.equal(filas[0].error, null);
  assert.equal(filas[0].email, "maria@instituto.mx");
  assert.equal(filas[0].role, "ALUMNO");
  assert.equal(filas[1].role, "DOCENTE");
});

test("una lista pegada de Excel (tabuladores) se interpreta igual", () => {
  const filas = parseEduTeamPaste("Ana\tRuiz\tana@x.mx\tCaja");
  assert.equal(filas.length, 1);
  assert.equal(filas[0].error, null);
  assert.equal(filas[0].role, "CAJA");
});

test("un renglón sin rol usa el rol por defecto del diálogo", () => {
  // Una generación entera se pega con TRES columnas y el rol se elige una
  // vez arriba: obligar a escribir "Alumno" 200 veces sería absurdo.
  const filas = parseEduTeamPaste("Ana, Ruiz, ana@x.mx", "ALUMNO");
  assert.equal(filas[0].error, null);
  assert.equal(filas[0].role, "ALUMNO");
  // Y sin rol por defecto, ese mismo renglón se marca en vez de inventarlo.
  const sinDefault = parseEduTeamPaste("Ana, Ruiz, ana@x.mx");
  assert.notEqual(sinDefault[0].error, null);
  assert.match(sinDefault[0].error ?? "", /rol/i);
});

test("el rol del renglón GANA al rol por defecto", () => {
  const filas = parseEduTeamPaste("Ana, Ruiz, ana@x.mx, Docente", "ALUMNO");
  assert.equal(filas[0].role, "DOCENTE");
});

test("los renglones vacíos se saltan y los números de línea se respetan", () => {
  // El número de línea es lo que le permite a alguien encontrar el renglón
  // malo en su hoja de cálculo: si se renumerara al saltar los vacíos, la
  // vista previa señalaría la línea equivocada.
  const filas = parseEduTeamPaste("\n\nAna, Ruiz, ana@x.mx, Caja\n\nBeto, Paz, beto@x.mx, Caja\n");
  assert.equal(filas.length, 2);
  assert.deepEqual(filas.map((f) => f.line), [3, 5]);
});

test("el encabezado pegado sin querer se IGNORA, no se marca como error", () => {
  const filas = parseEduTeamPaste("Nombre,Apellidos,Correo,Rol\nAna, Ruiz, ana@x.mx, Caja");
  assert.equal(filas[0].isHeader, true);
  assert.equal(filas[0].error, null);
  assert.equal(eduTeamRowsListas(filas).length, 1, "solo se crea la persona, no el encabezado");
});

test("🔴 un correo repetido DENTRO del pegado se marca en el segundo", () => {
  // Sin esto, la lista con dos "ana@" crearía la cuenta la primera vez y
  // fallaría la segunda con un error de base de datos que nadie
  // relacionaría con el renglón 47.
  const filas = parseEduTeamPaste(
    "Ana, Ruiz, ana@x.mx, Caja\nAna, Ruiz Dos, ANA@x.mx, Caja",
  );
  assert.equal(filas[0].error, null);
  assert.match(filas[1].error ?? "", /dos veces/i);
  assert.equal(eduTeamRowsListas(filas).length, 1);
});

test("un renglón con columnas de menos se marca y NO tumba a los demás", () => {
  const filas = parseEduTeamPaste(
    ["Ana, Ruiz, ana@x.mx, Caja", "Beto", "Cris, Paz, cris@x.mx, Caja"].join("\n"),
  );
  assert.equal(filas.length, 3);
  assert.match(filas[1].error ?? "", /columnas/i);
  assert.equal(eduTeamRowsListas(filas).length, 2);
});

test("un correo inválido a media lista se marca y el resto sigue", () => {
  const filas = parseEduTeamPaste(
    ["Ana, Ruiz, ana@x.mx, Caja", "Beto, Paz, beto-arroba-x, Caja"].join("\n"),
  );
  assert.equal(filas[0].error, null);
  assert.match(filas[1].error ?? "", /correo/i);
});

test("el renglón crudo se conserva para poder enseñarlo tal cual", () => {
  const filas = parseEduTeamPaste("Beto");
  assert.equal(filas[0].raw, "Beto");
});

test("SIN límite de renglones: 200 se interpretan los 200", () => {
  // Una generación son 20 o 200 y el producto no puede opinar. Quien parte
  // el trabajo en trozos es la pantalla (EDU_TEAM_BULK_CHUNK), no el
  // interpretador.
  const texto = Array.from({ length: 200 }, (_, i) => `A${i}, Ruiz, a${i}@x.mx, Alumno`).join("\n");
  const filas = parseEduTeamPaste(texto);
  assert.equal(filas.length, 200);
  assert.equal(eduTeamRowsListas(filas).length, 200);
  assert.ok(EDU_TEAM_BULK_CHUNK > 0 && EDU_TEAM_BULK_CHUNK < 200);
});

test("lo que no es texto no revienta el interpretador", () => {
  assert.deepEqual(parseEduTeamPaste(null), []);
  assert.deepEqual(parseEduTeamPaste(undefined), []);
  assert.deepEqual(parseEduTeamPaste(42), []);
  assert.deepEqual(parseEduTeamPaste("   \n  \n"), []);
});

// ═══════════════════════════════════════════════════════════════════════
// 3 · LA CONTRASEÑA TEMPORAL
// ═══════════════════════════════════════════════════════════════════════

/** Bytes deterministas para poder afirmar cosas exactas. */
function bytes(...v: number[]): number[] {
  return v;
}

test("la contraseña tiene la forma Edu-XXXX-XXXY y 13 caracteres", () => {
  const p = eduTempPasswordFromBytes(bytes(0, 1, 2, 3, 4, 5, 6, 7));
  assert.equal(p.length, 13);
  assert.match(p, /^Edu-[A-Z2-9]{4}-[A-Z2-9]{3}[2-9]$/);
});

test("🔴 SIEMPRE acaba en dígito (una política de complejidad la rechazaría)", () => {
  // Si la instancia de Supabase exige un número, una contraseña que saliera
  // solo con letras fallaría una de cada tantas veces — la peor clase de
  // fallo, porque parecería aleatorio.
  for (let i = 0; i < 256; i++) {
    const p = eduTempPasswordFromBytes(bytes(i, i, i, i, i, i, i, i));
    assert.match(p.slice(-1), /[2-9]/, `byte ${i} produjo "${p}"`);
  }
});

test("🔴 no lleva caracteres que se confundan al dictarla por teléfono", () => {
  // Fuera O/0 y I/1: esta contraseña se dicta en el mostrador y se teclea
  // en otro dispositivo, y ahí "cero" y "o" suenan igual. La L mayúscula sí
  // se queda: en mayúsculas no se confunde con el 1 (la minúscula sí, y por
  // eso el alfabeto es todo mayúsculas).
  for (let i = 0; i < 256; i++) {
    const cuerpo = eduTempPasswordFromBytes(bytes(i, i, i, i, i, i, i, i)).slice(4);
    assert.equal(/[O0I1]/.test(cuerpo), false, `byte ${i} metió un carácter ambiguo`);
  }
});

test("bytes distintos dan contraseñas distintas (no es una constante)", () => {
  const a = eduTempPasswordFromBytes(bytes(0, 0, 0, 0, 0, 0, 0, 0));
  const b = eduTempPasswordFromBytes(bytes(1, 1, 1, 1, 1, 1, 1, 1));
  assert.notEqual(a, b);
});

test("con menos bytes de los necesarios LANZA en vez de dar algo predecible", () => {
  // Una contraseña generada con "lo que hubiera" sería adivinable, y el
  // fallo sería invisible.
  assert.throws(() => eduTempPasswordFromBytes(bytes(1, 2, 3)), /bytes/i);
  assert.throws(() => eduTempPasswordFromBytes([]), /bytes/i);
  assert.equal(EDU_TEMP_PASSWORD_BYTES, 8);
});

// ═══════════════════════════════════════════════════════════════════════
// 4 · LA TABLA QUE SE COPIA
// ═══════════════════════════════════════════════════════════════════════

const RESULTADOS: EduTeamAltaResult[] = [
  {
    ok: true,
    email: "maria@x.mx",
    name: "María Rodríguez",
    role: "ALUMNO",
    tempPassword: "Edu-ABCD-EFG7",
    reused: false,
    id: "u1",
    error: null,
  },
  {
    ok: true,
    email: "juan@x.mx",
    name: "Juan Pérez",
    role: "DOCENTE",
    tempPassword: null,
    reused: true,
    id: "u2",
    error: null,
  },
  {
    ok: false,
    email: "mal@x.mx",
    name: "",
    role: null,
    tempPassword: null,
    reused: false,
    id: null,
    error: "Ya hay alguien con ese correo en este instituto.",
  },
];

test("la tabla se copia con TABULADORES (se pega en columnas en Excel)", () => {
  const texto = eduTeamCredentialsText(RESULTADOS);
  const lineas = texto.split("\n");
  assert.equal(lineas[0], "Nombre\tCorreo\tRol\tContraseña temporal");
  assert.equal(lineas.length, 3, "cabecera + las DOS que sí se crearon");
  assert.ok(lineas[1].includes("Edu-ABCD-EFG7"));
});

test("quien REUSÓ cuenta sale con el aviso, no con una celda vacía", () => {
  // Una celda en blanco se lee como "no se creó", y sí se creó: esa persona
  // entra con la contraseña que ya usaba en DaleControl.
  const texto = eduTeamCredentialsText(RESULTADOS);
  assert.match(texto, /ya tenía cuenta/i);
});

test("los renglones que fallaron NO ensucian la tabla de contraseñas", () => {
  const texto = eduTeamCredentialsText(RESULTADOS);
  assert.equal(texto.includes("mal@x.mx"), false);
});

test("el nombre completo no deja el espacio de más cuando falta el apellido", () => {
  assert.equal(eduTeamFullName({ firstName: "Ana", lastName: "" }), "Ana");
  assert.equal(eduTeamFullName({ firstName: "", lastName: "", email: "a@x.mx" }), "a@x.mx");
  assert.equal(eduTeamFullName({ firstName: "", lastName: "" }), "Sin nombre");
});

// ═══════════════════════════════════════════════════════════════════════
// 5 · LOS FILTROS DE LA URL
// ═══════════════════════════════════════════════════════════════════════

test("los filtros descartan lo que no reconocen en vez de reventar", () => {
  assert.deepEqual(parseEduTeamFilters({ rol: "DOCENTE", estado: "activos", q: " ana " }), {
    role: "DOCENTE",
    estado: "activos",
    q: "ana",
  });
  assert.deepEqual(parseEduTeamFilters({ rol: "RECTOR", estado: "borrados" }), {
    role: null,
    estado: null,
    q: null,
  });
  assert.deepEqual(parseEduTeamFilters(null), { role: null, estado: null, q: null });
});

test("🔴 la URL NO puede traer un institutionId: no se lee ni por accidente", () => {
  // Si se leyera, bastaría con teclearlo para listar el equipo de otra
  // escuela. El tenant sale de la sesión y de ningún otro lado.
  const f = parseEduTeamFilters({
    institutionId: "otro_instituto",
    institution: "otro",
    rol: "CAJA",
  });
  assert.deepEqual(Object.keys(f).sort(), ["estado", "q", "role"]);
  assert.equal(f.role, "CAJA");
});

test("el término de búsqueda se recorta (no se manda una novela al LIKE)", () => {
  const largo = "a".repeat(500);
  assert.equal(parseEduTeamFilters({ q: largo }).q?.length, 60);
});
