/**
 * WS1-T2 · hallazgo 9 — la verificación PÚBLICA de recetas.
 *
 * Run: npm run test:receta-verify
 *   (--experimental-test-module-mocks: se ejecutan los DOS route handlers de
 *    verdad, con Prisma y el renderer de PDF sustituidos. El documento
 *    PrescriptionDocument NO se falsea: se invoca y se lee el texto que
 *    imprimiría, así que si el diagnóstico se cuela por cualquier prop, sale.)
 *
 * El hallazgo: GET /api/prescriptions/[id]/verify/pdf publicaba, sin ninguna
 * autenticación, el NOMBRE COMPLETO del paciente y su DIAGNÓSTICO. Su gemela
 * GET /api/prescriptions/[id]/verify sí enmascara el apellido y nunca
 * selecciona el diagnóstico, y prisma/schema.prisma dice del campo
 * `diagnosis`: "NUNCA se muestra en la verificación pública".
 *
 * Por eso casi todos los casos de aquí ejecutan LAS DOS RUTAS con la misma
 * fila y comparan el resultado: el arreglo no es "el PDF tapa el apellido",
 * es "las dos rutas dicen lo mismo". Si mañana alguien cambia el criterio en
 * una sola, este archivo se pone rojo.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

// Palabras que solo existen en el diagnóstico: si alguna aparece en el PDF
// público, se filtró algo — completo o recortado.
const DIAGNOSTICO =
  "Absceso periapical agudo secundario a inmunosupresion por VIH en tratamiento antirretroviral";
const PALABRAS_DEL_DIAGNOSTICO = ["Absceso", "periapical", "inmunosupresion", "VIH", "antirretroviral"];

const APELLIDO = "Menendez";
const NOMBRE = "Laura";

function filaReceta(over: Record<string, any> = {}) {
  return {
    id: "rx_1",
    medicalRecordId: null,
    patientId: "pat_1",
    doctorId: "doc_1",
    clinicId: "cli_1",
    medications: [{ name: "Amoxicilina 500 mg", dosage: "1 cada 8 h" }],
    indications: "Tomar con alimentos. No suspender antes de terminar la caja.",
    diagnosis: DIAGNOSTICO,
    qrCode: "RX-2026-000123",
    verifyUrl: "https://www.dalecontrol.com/portal/prescription/rx_1/verify",
    issuedAt: new Date("2026-08-01T15:00:00Z"),
    expiresAt: new Date("2026-09-30T15:00:00Z"),
    cofeprisGroup: "IV",
    cofeprisFolio: "F-778899",
    digitalSignature: null,
    aiCheck: { summary: "sin interacciones" },
    status: "ACTIVE",
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    patient: { firstName: NOMBRE, lastName: APELLIDO, dob: new Date("1988-03-04T00:00:00Z") },
    doctor: {
      firstName: "Ana",
      lastName: "Ruiz",
      specialty: "Endodoncia",
      especialidad: "Endodoncia",
      cedulaProfesional: "12345678",
      cedulaEspecialidad: "87654321",
    },
    clinic: {
      name: "Clinica Menta",
      address: "Reforma 1",
      city: "CDMX",
      phone: "5555555555",
      email: "hola@menta.mx",
      clues: "DFSSA000001",
      logoUrl: null,
    },
    items: [
      {
        cumsKey: "CUMS-1",
        dosage: "1 tableta cada 8 horas",
        duration: "7 dias",
        quantity: "21 tabletas",
        notes: null,
        cums: {
          descripcion: "Amoxicilina 500 mg tableta",
          presentacion: "Caja con 21 tabletas",
          cofeprisGroup: "IV",
        },
      },
    ],
    ...over,
  };
}

// ── Estado compartido por los dobles ────────────────────────────────────────
let fila: any = filaReceta();

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      prescription: {
        // El PDF usa findFirst (con o sin clinicId); la gemela JSON, findUnique.
        findFirst: async ({ where }: any) =>
          fila && (!where.clinicId || where.clinicId === fila.clinicId) && where.id === fila.id
            ? fila
            : null,
        findUnique: async ({ where }: any) => (fila && where.id === fila.id ? fila : null),
      },
      signedDocument: { findFirst: async () => ({ signedAt: new Date("2026-08-01T15:05:00Z") }) },
    },
  },
});

/**
 * El renderer real tarda segundos y devuelve un PDF con los flujos
 * comprimidos — buscar texto ahí dentro daría verde aunque el dato SÍ esté
 * impreso. Se captura el elemento y se lee su texto (ver `textoDe`).
 * Los primitivos se sustituyen por etiquetas de cadena: no pintan nada, pero
 * dejan que el componente de verdad se ejecute y arme su árbol.
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

/** Texto que el documento imprimiría, recorriendo el arbol de React. */
function textoDe(nodo: any): string {
  if (nodo == null || typeof nodo === "boolean") return "";
  if (typeof nodo === "string" || typeof nodo === "number") return String(nodo);
  if (Array.isArray(nodo)) return nodo.map(textoDe).join(" ");
  if (typeof nodo.type === "function") return textoDe(nodo.type(nodo.props));
  const propios = [nodo.props?.src, nodo.props?.children];
  return propios.map(textoDe).join(" ");
}

let ipSeq = 0;
async function nuevaRequest(url: string) {
  const { NextRequest } = await import("next/server");
  // IP distinta por llamada: el rate limit real (10/min y 20/min por IP+ruta)
  // sigue puesto y no es lo que se esta probando aqui.
  return new NextRequest(url, {
    headers: { "x-forwarded-for": `10.2.0.${(++ipSeq % 250) + 1}` },
  } as any);
}

/** GET /api/prescriptions/[id]/verify/pdf — la ruta PÚBLICA del PDF. */
async function pdfPublico(id = "rx_1") {
  elementoCapturado = null;
  const { GET } = await import("@/app/api/prescriptions/[id]/verify/pdf/route");
  const res = await GET(await nuevaRequest(`https://dalecontrol.test/api/prescriptions/${id}/verify/pdf`), {
    params: { id },
  });
  return { status: res.status, texto: elementoCapturado ? textoDe(elementoCapturado) : "" };
}

/** GET /api/prescriptions/[id]/verify — la gemela JSON, la que ya lo hacia bien. */
async function jsonPublico(id = "rx_1") {
  const { GET } = await import("@/app/api/prescriptions/[id]/verify/route");
  const res = await GET(await nuevaRequest(`https://dalecontrol.test/api/prescriptions/${id}/verify`), {
    params: { id },
  });
  return { status: res.status, body: await res.json() };
}

/** El PDF con sesion: dashboard (con clinicId) y portal del paciente (sin el). */
async function pdfConSesion(clinicId?: string) {
  elementoCapturado = null;
  const { buildPrescriptionPdf } = await import("@/lib/pdf/prescription-pdf");
  const out = await buildPrescriptionPdf("rx_1", clinicId);
  return { out, texto: elementoCapturado ? textoDe(elementoCapturado) : "" };
}

// ── El hallazgo ─────────────────────────────────────────────────────────────

test("H9 · el PDF publico no imprime el diagnostico, ni completo ni a trozos", async () => {
  fila = filaReceta();
  const { status, texto } = await pdfPublico();
  assert.equal(status, 200);
  assert.equal(texto.includes(DIAGNOSTICO), false, "el diagnostico completo salio impreso");
  for (const palabra of PALABRAS_DEL_DIAGNOSTICO) {
    assert.equal(texto.includes(palabra), false, `se filtro "${palabra}" del diagnostico`);
  }
  assert.equal(texto.includes("Diagnostico"), false);
  assert.equal(texto.includes("Diagnóstico"), false, "ni siquiera el titulo de la seccion");
});

test("H9 · la gemela JSON tampoco lo publica (sigue igual)", async () => {
  fila = filaReceta();
  const { status, body } = await jsonPublico();
  assert.equal(status, 200);
  assert.equal("diagnosis" in body, false);
  assert.equal(JSON.stringify(body).includes("VIH"), false);
});

test("H9 · el PDF publico y la gemela JSON enmascaran IGUAL", async () => {
  fila = filaReceta();
  const { body } = await jsonPublico();
  const { texto } = await pdfPublico();

  // Esta es la comparacion que evita que vuelvan a divergir.
  assert.equal(body.patient, "Laura M.");
  assert.equal(texto.includes(body.patient), true, `el PDF no imprime "${body.patient}"`);
  assert.equal(
    texto.includes(`${NOMBRE} ${APELLIDO}`),
    false,
    "el PDF publico sigue imprimiendo el apellido completo",
  );
  assert.equal(texto.includes(APELLIDO), false);
  // La edad sale del dob y la gemela no la publica: el PDF publico tampoco.
  assert.equal(texto.includes("Edad:"), false, "la edad es dato del paciente y la gemela no la da");
});

test("H9 · mismo criterio de enmascarado para apellidos raros", async () => {
  const casos = [
    { firstName: "Jose Luis", lastName: "Perez Gomez" },
    { firstName: "Ana", lastName: "Ñañez" },
    { firstName: "Luis", lastName: "de la Torre" },
    { firstName: "Mia", lastName: "O'Connor" },
  ];
  for (const paciente of casos) {
    fila = filaReceta({ patient: { ...paciente, dob: new Date("1990-01-01T00:00:00Z") } });
    const { body } = await jsonPublico();
    const { texto } = await pdfPublico();
    assert.equal(
      texto.includes(body.patient),
      true,
      `desalineados con ${paciente.firstName} ${paciente.lastName}: la gemela dice "${body.patient}"`,
    );
    assert.equal(texto.includes(paciente.lastName), false, `apellido completo en el PDF: ${paciente.lastName}`);
  }
});

// ── Lo que el PDF publico SI tiene que seguir demostrando ───────────────────

test("H9 · el PDF publico sigue sirviendo para verificar la receta", async () => {
  fila = filaReceta();
  const { status, texto } = await pdfPublico();
  assert.equal(status, 200);
  for (const dato of [
    "RX-2026-000123", // folio
    "Clinica Menta", // clinica
    "Ana Ruiz", // medico tratante
    "12345678", // cedula profesional
    "Amoxicilina 500 mg tableta", // lo recetado
    "1 tableta cada 8 horas", // posologia
    "F-778899", // folio COFEPRIS
    "https://www.dalecontrol.com/portal/prescription/rx_1/verify", // QR / verificacion
  ]) {
    assert.equal(texto.includes(dato), true, `falta en el PDF publico: ${dato}`);
  }
  // Y el nombre de pila sigue ahi: sin el, el mostrador no puede cotejar nada.
  assert.equal(texto.includes("Laura M."), true);
});

test("H9 · receta ANULADA: el PDF publico lo sigue gritando, y sin diagnostico", async () => {
  fila = filaReceta({
    status: "VOIDED",
    voidedAt: new Date("2026-08-15T10:00:00Z"),
    voidReason: "Emitida por error",
  });
  const { texto } = await pdfPublico();
  const { body } = await jsonPublico();
  assert.equal(body.valid, false);
  assert.equal(body.isVoided, true);
  assert.equal(texto.includes("ANULADA"), true, "el PDF de una receta anulada tiene que decirlo");
  assert.equal(texto.includes("Emitida por error"), true);
  assert.equal(texto.includes("VIH"), false);
});

test("H9 · 404 si la receta no existe (la ruta publica no cambia de forma)", async () => {
  fila = filaReceta();
  const { status } = await pdfPublico("rx_no_existe");
  assert.equal(status, 404);
});

// ── Y lo que NO se debe cerrar de mas ───────────────────────────────────────

test("H9 · el PDF del dashboard (con clinicId) sigue con nombre completo y diagnostico", async () => {
  fila = filaReceta();
  const { out, texto } = await pdfConSesion("cli_1");
  assert.notEqual(out, null);
  assert.equal(texto.includes(`${NOMBRE} ${APELLIDO}`), true);
  assert.equal(texto.includes(DIAGNOSTICO), true, "el doctor SI tiene que ver el diagnostico");
  assert.equal(texto.includes("Edad:"), true);
});

test("H9 · el PDF del portal del paciente (sin clinicId) tampoco se recorta", async () => {
  // /api/paciente/recetas/[id]/pdf llama sin clinicId con la ownership ya
  // validada: que falte el clinicId NO puede significar "publico".
  fila = filaReceta();
  const { out, texto } = await pdfConSesion(undefined);
  assert.notEqual(out, null);
  assert.equal(texto.includes(`${NOMBRE} ${APELLIDO}`), true);
  assert.equal(texto.includes(DIAGNOSTICO), true, "el paciente SI ve su propio diagnostico");
});

test("H9 · aislamiento por clinica intacto: otra clinica no saca el PDF", async () => {
  fila = filaReceta();
  const { out } = await pdfConSesion("cli_OTRA");
  assert.equal(out, null);
});
