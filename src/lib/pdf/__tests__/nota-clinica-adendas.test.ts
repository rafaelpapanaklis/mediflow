/**
 * WS1-T5 · hallazgo 25 (segunda mitad) — las ADENDAS en el PDF del expediente.
 *
 * Run: npm run test:nota-adendas
 *
 * El hallazgo: una nota firmada es inalterable (NOM-024), así que el doctor que
 * anotó «pieza 26» donde era la 27 lo corrige con una ADENDA
 * (POST /api/clinical-notes/[id]/addendum, hallazgo 25, ya en producción). El
 * dato se guardaba bien… y el PDF no lo imprimía. Quien recibía el expediente
 * en papel —el paciente, un colega, un seguro, un juzgado— leía la versión
 * equivocada y NADA en el documento avisaba de que existía una corrección
 * firmada. El papel dejaba de coincidir con el expediente.
 *
 * Lo que se fija aquí:
 *   · una nota con adendas las imprime, con su texto, su fecha y su autor;
 *   · la nota original se imprime TAL CUAL: la adenda se añade, no sustituye;
 *   · varias adendas salen numeradas y en orden cronológico, lleguen como
 *     lleguen;
 *   · el aviso de que hay correcciones sale ANTES del cuerpo de la nota (y en
 *     el pie de todas las páginas), no escondido en la última página;
 *   · una nota SIN adendas imprime exactamente lo de siempre.
 *
 * Cómo: se ejecuta el route handler de verdad —GET /api/clinical-notes/[id]/pdf—
 * con Prisma y el renderer sustituidos, y se lee el texto que el documento
 * imprimiría recorriendo su árbol (`textoDe`). El componente NO se falsea: si
 * una adenda no llega a la página, aquí sale. Mismo patrón que
 * receta-verificacion-publica.test.ts.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { ownPrivateRecordsOnly } from "@/lib/clinical/record-scope";

const TEXTO_CORRECCION =
  "Donde dice «pieza 26» debe decir «pieza 27». Se corrige por error de captura al transcribir la exploracion.";
const TEXTO_SEGUIMIENTO =
  "Control de 15 dias: sin sintomatologia, pruebas de vitalidad normales.";
const TEXTO_AMPLIACION =
  "Se amplia el hallazgo a peticion del seguro: exposicion pulpar puntiforme no visible en la radiografia previa.";

const AUTOR = "Dr/a. Ana Ruiz";
const AUTOR_2 = "Dr/a. Luis Prado";

/** La nota firmada, con lo que diga `specialtyData.addenda`. */
function filaNota(addenda: unknown[] | undefined) {
  const specialtyData: Record<string, unknown> = {
    type: "dental",
    status: "SIGNED",
    signedAt: "2026-09-01T17:05:00.000Z",
    procedures: [{ name: "Resina compuesta oclusal" }],
  };
  if (addenda !== undefined) specialtyData.addenda = addenda;
  return {
    id: "rec_1",
    patientId: "pat_1",
    visitDate: new Date("2026-09-01T16:30:00.000Z"),
    // Lo firmado dice 26 — y tiene que seguir diciendo 26 en el papel.
    subjective: "Dolor en pieza 26 al masticar.",
    objective: "Caries oclusal profunda en pieza 26.",
    assessment: "Pulpitis reversible en pieza 26.",
    plan: "Resina compuesta y control en 15 dias.",
    specialtyData,
    doctor: { firstName: "Ana", lastName: "Ruiz" },
    patient: {
      firstName: "Laura",
      lastName: "Menendez",
      dob: new Date("1988-03-04T00:00:00.000Z"),
      gender: "Femenino",
    },
    clinic: { name: "Clinica Dental Menta" },
    diagnoses_v2: [{ cie10: { code: "K02.1", description: "Caries de la dentina" } }],
  };
}

function adenda(text: string, createdAt: string, authorName: string | null) {
  return { id: `ad_${createdAt}`, text, createdAt, authorName, authorId: "u1" };
}

// ── Dobles ──────────────────────────────────────────────────────────────────
let fila: any = filaNota(undefined);

mock.module("@/lib/auth", {
  namedExports: {
    // ADMIN: tiene "medicalRecord.view". El permiso real (denyIfMissingPermission)
    // no se falsea, se cumple.
    getCurrentUser: async () => ({
      id: "u1",
      clinicId: "cli_1",
      role: "ADMIN",
      permissionsOverride: [],
    }),
  },
});

/**
 * `@/lib/branches` empieza con `import "server-only"`, que fuera de Next no
 * resuelve. El propio repo dejó la salida puesta: la función vive de verdad en
 * `@/lib/clinical/record-scope` —"módulo PURO, sin server-only, para poder…"—
 * y el barril solo la reexporta. Así que aquí NO se falsea el filtro de notas
 * privadas: se usa el mismo código, saltándose el barril.
 */
mock.module("@/lib/branches", {
  namedExports: { ownPrivateRecordsOnly },
});

mock.module("@/lib/patient-visibility", {
  namedExports: { assertPatientVisible: async () => null },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      medicalRecord: {
        findFirst: async ({ where }: any) =>
          fila && where.id === fila.id && where.clinicId === "cli_1" ? fila : null,
      },
    },
  },
});

/**
 * El renderer real devuelve un PDF con los flujos comprimidos: buscar texto
 * ahí daría verde aunque la adenda NO estuviera impresa. Se captura el
 * elemento y se lee su árbol. Los primitivos son etiquetas de cadena: no
 * pintan, pero dejan que el componente de verdad se ejecute.
 */
let elementoCapturado: any = null;
mock.module("@react-pdf/renderer", {
  namedExports: {
    renderToBuffer: async (el: any) => {
      elementoCapturado = el;
      return Buffer.from("%PDF-1.7 fake");
    },
    Document: "pdf-document",
    Page: "pdf-page",
    Text: "pdf-text",
    View: "pdf-view",
    Image: "pdf-image",
    StyleSheet: { create: (o: any) => o },
    Font: { register: () => undefined },
  },
});

/** Texto que el documento imprimiría, recorriendo el árbol de React. */
function textoDe(nodo: any): string {
  if (nodo == null || typeof nodo === "boolean") return "";
  if (typeof nodo === "string" || typeof nodo === "number") return String(nodo);
  if (Array.isArray(nodo)) return nodo.map(textoDe).join(" ");
  if (typeof nodo.type === "function") return textoDe(nodo.type(nodo.props));
  return textoDe(nodo.props?.children);
}

/** GET /api/clinical-notes/[id]/pdf con la nota que se le ponga delante. */
async function imprimir(addenda: unknown[] | undefined) {
  fila = filaNota(addenda);
  elementoCapturado = null;
  const { GET } = await import("@/app/api/clinical-notes/[id]/pdf/route");
  const { NextRequest } = await import("next/server");
  const req = new NextRequest("https://dalecontrol.test/api/clinical-notes/rec_1/pdf");
  const res = await GET(req, { params: { id: "rec_1" } });
  return {
    status: res.status,
    texto: elementoCapturado ? textoDe(elementoCapturado).replace(/\s+/g, " ") : "",
  };
}

// ── El hallazgo ─────────────────────────────────────────────────────────────

test("H25-PDF · una adenda se imprime, con su texto, su fecha y quien la firmo", async () => {
  const { status, texto } = await imprimir([
    adenda(TEXTO_CORRECCION, "2026-09-02T14:32:00.000Z", AUTOR),
  ]);

  assert.equal(status, 200);
  assert.ok(texto.includes(TEXTO_CORRECCION), "el texto de la adenda no sale impreso");
  assert.ok(texto.includes(AUTOR), "la adenda se imprime sin decir quien la firmo");
  assert.match(texto, /2 de septiembre de 2026/, "la adenda se imprime sin fecha");
  assert.match(texto, /Adenda 1 de 1/, "la adenda no viene identificada");
});

test("H25-PDF · la nota original se imprime tal cual: la adenda no la sustituye", async () => {
  const { texto } = await imprimir([
    adenda(TEXTO_CORRECCION, "2026-09-02T14:32:00.000Z", AUTOR),
  ]);

  // Las dos versiones conviven, que es el punto entero de una adenda.
  for (const original of [
    "Dolor en pieza 26 al masticar.",
    "Caries oclusal profunda en pieza 26.",
    "Pulpitis reversible en pieza 26.",
    "Resina compuesta y control en 15 dias.",
  ]) {
    assert.ok(texto.includes(original), `la nota firmada perdio: ${original}`);
  }
  assert.ok(texto.includes(TEXTO_CORRECCION), "y la correccion tambien tiene que estar");
});

test("H25-PDF · el aviso sale ANTES del cuerpo, no escondido al final", async () => {
  const { texto } = await imprimir([
    adenda(TEXTO_CORRECCION, "2026-09-02T14:32:00.000Z", AUTOR),
  ]);

  const aviso = texto.indexOf("ATENCIÓN") >= 0 ? texto.indexOf("ATENCIÓN") : texto.search(/tiene 1 adenda/i);
  const cuerpo = texto.indexOf("Subjetivo (S)");
  const seccion = texto.indexOf("Adenda 1 de 1");

  assert.ok(aviso >= 0, "no hay ningun aviso de que la nota esta corregida");
  assert.ok(cuerpo >= 0, "el cuerpo SOAP tiene que seguir ahi");
  assert.ok(aviso < cuerpo, "el aviso sale despues del cuerpo: se pasa por alto");
  assert.ok(cuerpo < seccion, "las adendas van DEBAJO de la nota original, no encima");

  // Y en el pie, que en este documento va `fixed` y por tanto en TODAS las
  // páginas: es lo único que sigue avisando si una adenda larga se parte.
  assert.match(texto, /Este documento incluye 1 adenda posterior a la firma/);
});

test("H25-PDF · varias adendas: numeradas, completas y en orden cronologico", async () => {
  // Llegan desordenadas a proposito.
  const { texto } = await imprimir([
    adenda(TEXTO_SEGUIMIENTO, "2026-09-16T18:10:00.000Z", AUTOR_2),
    adenda(TEXTO_CORRECCION, "2026-09-02T14:32:00.000Z", AUTOR),
    adenda(TEXTO_AMPLIACION, "2026-09-03T09:15:00.000Z", AUTOR),
  ]);

  for (const t of [TEXTO_CORRECCION, TEXTO_AMPLIACION, TEXTO_SEGUIMIENTO]) {
    assert.ok(texto.includes(t), `falta una adenda en el PDF: ${t.slice(0, 40)}…`);
  }
  assert.match(texto, /Adenda 1 de 3/);
  assert.match(texto, /Adenda 2 de 3/);
  assert.match(texto, /Adenda 3 de 3/);

  // La secuencia se entiende: la del 2 de septiembre va antes que la del 3, y
  // esa antes que la del 16, aunque hayan llegado al reves.
  const i1 = texto.indexOf(TEXTO_CORRECCION);
  const i2 = texto.indexOf(TEXTO_AMPLIACION);
  const i3 = texto.indexOf(TEXTO_SEGUIMIENTO);
  assert.ok(i1 < i2 && i2 < i3, "las adendas no salen en orden cronologico");

  // Cada una con su autor: no se hereda el de la nota.
  assert.ok(texto.includes(AUTOR_2), "el autor de la tercera adenda no aparece");
  assert.match(texto, /Este documento incluye 3 adendas posteriores a la firma/);
});

test("H25-PDF · una nota SIN adendas no menciona ninguna (sigue igual que hoy)", async () => {
  for (const caso of [undefined, [], [{ text: "   ", createdAt: "" }, { nada: true }]]) {
    const { status, texto } = await imprimir(caso as any);
    assert.equal(status, 200);
    assert.equal(/adenda/i.test(texto), false, `una nota sin adendas hablo de adendas: ${JSON.stringify(caso)}`);
    // Y lo de siempre sigue estando.
    assert.ok(texto.includes("Dolor en pieza 26 al masticar."));
    assert.ok(texto.includes("K02.1"));
  }
});

test("H25-PDF · readNoteAddenda: sanea, ordena y no inventa cronologias", async () => {
  const { readNoteAddenda } = await import("@/lib/pdf/clinical-note-document");

  assert.deepEqual(readNoteAddenda(null), []);
  assert.deepEqual(readNoteAddenda({}), []);
  assert.deepEqual(readNoteAddenda({ addenda: "no es una lista" }), []);

  const filas = readNoteAddenda({
    addenda: [
      adenda(TEXTO_SEGUIMIENTO, "2026-09-16T18:10:00.000Z", AUTOR_2),
      adenda(TEXTO_CORRECCION, "2026-09-02T14:32:00.000Z", AUTOR),
      { text: "", createdAt: "2026-09-04T00:00:00.000Z", authorName: AUTOR },   // sin texto
      { text: "algo", createdAt: "", authorName: AUTOR },                        // sin fecha
      null,
      { text: "sin autor", createdAt: "2026-09-03T00:00:00.000Z" },
    ],
  });

  assert.equal(filas.length, 3, "se coló una fila inservible o se perdió una buena");
  assert.deepEqual(
    filas.map((f) => f.createdAt),
    ["2026-09-02T14:32:00.000Z", "2026-09-03T00:00:00.000Z", "2026-09-16T18:10:00.000Z"],
  );
  assert.equal(filas[1].authorName, null, "el autor ausente se marca, no se inventa");

  // Una fecha ilegible no reordena a las demás ni se descarta a ciegas.
  const raras = readNoteAddenda({
    addenda: [
      adenda("primera", "fecha-rota", AUTOR),
      adenda("segunda", "2026-09-02T14:32:00.000Z", AUTOR),
    ],
  });
  assert.deepEqual(raras.map((f) => f.text), ["primera", "segunda"]);
});
