/**
 * WS1-T1 · rojo 2 — LA FIRMA FIEL NO PROBABA NADA.
 *
 * Run: npm run test:receta-firma
 *   (--experimental-test-module-mocks: se ejecutan los route handlers DE
 *    VERDAD —firmar y registrar certificado— y el constructor real del PDF,
 *    con Prisma, la auth, la auditoría y el renderer sustituidos. La
 *    criptografía NO se falsea: node-forge firma y compara llaves de verdad,
 *    con un certificado hecho en casa para el test.)
 *
 * El fallo, en cuatro líneas:
 *   · se firmaba `body.content` —lo que mandara el navegador—; el servidor
 *     nunca releía la receta;
 *   · cualquier DOCTOR o ADMIN de la clínica podía sellar LA RECETA DE OTRO
 *     con una llamada desde la consola;
 *   · el PDF ponía «Firmada electrónicamente (e.firma)» si existía CUALQUIER
 *     firma con ese id, viniera de quien viniera;
 *   · la contraseña de la llave se pedía y no se usaba: no se comprobaba que
 *     la llave abriera, ni que fuera la pareja del certificado.
 *
 * 🔴 LO QUE ESTE TEST NO PUEDE PROBAR, porque el código no lo hace: que el
 * certificado sea del SAT. Los certificados de aquí abajo están hechos en casa
 * y el sistema los acepta. Es la parte que queda abierta a propósito — ver
 * REPORTE-ws1-t1.md. Si algún día se valida la cadena del SAT, este archivo
 * tendrá que dejar de pasar con certificados caseros.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import forge from "node-forge";

// ── Un certificado hecho en casa, con su llave, como el del informe ─────────

interface Identidad {
  cerDer: Buffer;
  /** PKCS#8 EncryptedPrivateKeyInfo en DER, la forma que usa el SAT. */
  keyDerCifrada: Buffer;
  password: string;
}

function identidadCasera(cn: string, password = "clave-de-prueba"): Identidad {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const forgePriv = forge.pki.privateKeyFromPem(privateKey);
  const forgePub = forge.pki.publicKeyFromPem(publicKey);

  const cert = forge.pki.createCertificate();
  cert.publicKey = forgePub;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - 24 * 3600 * 1000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 3600 * 1000);
  const attrs = [
    { name: "commonName", value: cn },
    { name: "serialNumber", value: "RUIA880304AB1" },
  ];
  cert.setSubject(attrs);
  // El emisor dice "SAT" y nadie lo comprueba. Justamente ese es el agujero.
  cert.setIssuer([{ name: "commonName", value: "AC DEL SERVICIO DE ADMINISTRACION TRIBUTARIA" }]);
  cert.sign(forgePriv, forge.md.sha256.create());

  const cerDer = Buffer.from(
    forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(),
    "binary",
  );
  const encInfo = forge.pki.encryptPrivateKeyInfo(
    forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(forgePriv)),
    password,
    { algorithm: "aes256" },
  );
  const keyDerCifrada = Buffer.from(forge.asn1.toDer(encInfo).getBytes(), "binary");

  return { cerDer, keyDerCifrada, password };
}

const DRA_RUIZ = identidadCasera("Ana Ruiz");
const DR_SOLIS = identidadCasera("Beto Solis");

// ── El estado de la base ───────────────────────────────────────────────────

const ITEMS = [
  { cumsKey: "MX-0030", dosage: "1 cada 8 h", duration: "7 días", quantity: "21", notes: null,
    cums: { descripcion: "Amoxicilina 500 mg", presentacion: "Caja c/21", cofeprisGroup: "IV" } },
];

function receta(over: Record<string, any> = {}) {
  return {
    id: "rx_1",
    clinicId: "cli_1",
    patientId: "pat_1",
    doctorId: "doc_ruiz",
    medicalRecordId: null,
    medications: [],
    indications: "Tomar con alimentos.",
    diagnosis: "Absceso periapical",
    qrCode: "RX-000123",
    verifyUrl: "https://www.dalecontrol.com/portal/prescription/rx_1/verify",
    issuedAt: new Date("2026-09-01T15:00:00Z"),
    expiresAt: new Date("2027-02-28T15:00:00Z"),
    cofeprisGroup: "IV",
    cofeprisFolio: null,
    digitalSignature: null,
    aiCheck: null,
    status: "ACTIVE",
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    items: ITEMS,
    patient: { firstName: "Laura", lastName: "Menendez", dob: new Date("1988-03-04T00:00:00Z") },
    doctor: { firstName: "Ana", lastName: "Ruiz", especialidad: "Endodoncia",
              cedulaProfesional: "12345678", cedulaEspecialidad: "87654321" },
    clinic: { name: "Clinica Menta", address: "Reforma 1", city: "CDMX", phone: "5555555555",
              email: "hola@menta.mx", clues: "DFSSA000001", logoUrl: null },
    ...over,
  };
}

let fila: any = receta();
/** Filas de `signed_documents`. */
let firmas: any[] = [];
/** Certificados registrados, por userId. */
let certs: Record<string, any> = {};

const prescriptionDelegate = {
  findFirst: async ({ where }: any) => {
    if (!fila) return null;
    if (where?.id && where.id !== fila.id) return null;
    if (where?.clinicId && where.clinicId !== fila.clinicId) return null;
    return fila;
  },
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      prescription: prescriptionDelegate,
      doctorSignatureCert: {
        findUnique: async ({ where }: any) => certs[where.userId] ?? null,
        upsert: async ({ where, create }: any) => {
          certs[where.userId] = { id: "cert_1", userId: where.userId, ...create };
          return certs[where.userId];
        },
      },
      signedDocument: {
        create: async ({ data }: any) => {
          const row = { id: `sig_${firmas.length + 1}`, signedAt: new Date("2026-09-01T15:05:00Z"), ...data };
          firmas.push(row);
          return row;
        },
        findFirst: async ({ where }: any) => {
          const hit = firmas.filter(
            (f) =>
              f.docType === where.docType &&
              f.docId === where.docId &&
              (where.signerUserId === undefined || f.signerUserId === where.signerUserId),
          );
          return hit.length ? hit[hit.length - 1] : null;
        },
      },
      user: { findUnique: async () => null },
    },
  },
});

let usuario: any = { id: "doc_ruiz", clinicId: "cli_1", role: "DOCTOR" };
mock.module("@/lib/auth", { namedExports: { getCurrentUser: async () => usuario } });
mock.module("@/lib/audit", { namedExports: { logMutation: async () => {} } });
// El sobre AES no es lo que se prueba aquí: se guarda y se recupera tal cual,
// para que la llave que llega a node-forge sea la de verdad.
mock.module("@/lib/signature/envelope", {
  namedExports: {
    encryptPrivateKey: (buf: Buffer) => ({ ciphertext: buf, iv: "aXY=", authTag: "dGFn" }),
    decryptPrivateKey: ({ ciphertext }: any) => Buffer.from(ciphertext),
  },
});

// El renderer real tarda segundos: se captura el árbol y se lee su texto.
let elementoCapturado: any = null;
mock.module("@react-pdf/renderer", {
  namedExports: {
    renderToBuffer: async (el: any) => { elementoCapturado = el; return Buffer.from("%PDF-1.7 fake"); },
    Document: "pdf-document", Page: "pdf-page", Text: "pdf-text",
    View: "pdf-view", Image: "pdf-image",
    StyleSheet: { create: (o: any) => o },
    Font: { register: () => undefined },
  },
});

function textoDe(nodo: any): string {
  if (nodo == null || typeof nodo === "boolean") return "";
  if (typeof nodo === "string" || typeof nodo === "number") return String(nodo);
  if (Array.isArray(nodo)) return nodo.map(textoDe).join(" ");
  if (typeof nodo.type === "function") return textoDe(nodo.type(nodo.props));
  return [nodo.props?.src, nodo.props?.children].map(textoDe).join(" ");
}

function req(body: any): any {
  return { json: async () => body, headers: new Headers(), url: "http://localhost/api/signature/sign" };
}

async function firmar(body: any) {
  const { POST } = await import("@/app/api/signature/sign/route");
  const res = await POST(req(body));
  return { status: res.status, body: await res.json() };
}

async function registrarCert(id: Identidad, password = id.password) {
  const { POST } = await import("@/app/api/signature/cert/route");
  const res = await POST(req({
    cerBase64: id.cerDer.toString("base64"),
    keyBase64: id.keyDerCifrada.toString("base64"),
    keyPassword: password,
  }));
  return { status: res.status, body: await res.json() };
}

/** Deja a la Dra. Ruiz con su certificado activo ya cargado en la base. */
function certActivoDe(userId: string, id: Identidad) {
  certs[userId] = {
    id: `cert_${userId}`,
    userId,
    isActive: true,
    validUntil: new Date(Date.now() + 365 * 24 * 3600 * 1000),
    cerFileUrl: `inline:base64:${id.cerDer.toString("base64")}`,
    keyFileUrl: `inline:base64:${id.keyDerCifrada.toString("base64")}`,
    keyEncIv: "aXY=",
    keyEncAuthTag: "dGFn",
  };
}

beforeEach(() => {
  fila = receta();
  firmas = [];
  certs = {};
  elementoCapturado = null;
  usuario = { id: "doc_ruiz", clinicId: "cli_1", role: "DOCTOR" };
  certActivoDe("doc_ruiz", DRA_RUIZ);
  certActivoDe("doc_solis", DR_SOLIS);
});

// ── 1. Firmar la receta de otro médico ─────────────────────────────────────

test("firmar la receta de OTRO doctor: rechazado", async () => {
  usuario = { id: "doc_solis", clinicId: "cli_1", role: "DOCTOR" };
  const { status, body } = await firmar({
    docType: "PRESCRIPTION", docId: "rx_1", content: { lo: "que sea" }, keyPassword: DR_SOLIS.password,
  });
  assert.equal(status, 403);
  assert.equal(body.error, "not_prescription_doctor");
  assert.equal(firmas.length, 0, "no quedó ninguna firma");
});

test("ni un ADMIN de la misma clínica puede sellar la receta de un médico", async () => {
  usuario = { id: "gerente_1", clinicId: "cli_1", role: "ADMIN" };
  certActivoDe("gerente_1", DR_SOLIS);
  const { status } = await firmar({
    docType: "PRESCRIPTION", docId: "rx_1", content: {}, keyPassword: DR_SOLIS.password,
  });
  assert.equal(status, 403);
  assert.equal(firmas.length, 0);
});

test("la receta de otra clínica sigue siendo 404, no 403 (no se filtra que existe)", async () => {
  usuario = { id: "doc_ruiz", clinicId: "otra_clinica", role: "DOCTOR" };
  const { status, body } = await firmar({
    docType: "PRESCRIPTION", docId: "rx_1", content: {}, keyPassword: DRA_RUIZ.password,
  });
  assert.equal(status, 404);
  assert.equal(body.error, "prescription_not_found");
});

test("una receta ANULADA no se firma", async () => {
  fila = receta({ status: "VOIDED", voidedAt: new Date(), voidReason: "error de dosis" });
  const { status, body } = await firmar({
    docType: "PRESCRIPTION", docId: "rx_1", content: {}, keyPassword: DRA_RUIZ.password,
  });
  assert.equal(status, 422);
  assert.equal(body.error, "prescription_voided");
  assert.equal(firmas.length, 0);
});

// ── 2. Se firma LO GUARDADO, no lo que manda el navegador ──────────────────

test("mandando un content distinto al guardado, se firma lo guardado", async () => {
  const { canonicalPrescriptionContent } = await import("@/lib/signature/contenido-receta");
  const delServidor = canonicalPrescriptionContent(fila as any);
  const shaGuardado = createHash("sha256").update(Buffer.from(delServidor, "utf8")).digest("hex");

  // Una mentira con la forma exacta que mandaba el modal.
  const mentira = { id: "rx_1", qrCode: "RX-000123", items: [{ cumsKey: "MX-0022", dosage: "10 cajas" }],
                    issuedAt: fila.issuedAt };
  const shaMentira = createHash("sha256")
    .update(Buffer.from(JSON.stringify(mentira), "utf8")).digest("hex");

  const { status, body } = await firmar({
    docType: "PRESCRIPTION", docId: "rx_1", content: mentira, keyPassword: DRA_RUIZ.password,
  });

  assert.equal(status, 201);
  assert.equal(body.sha256, shaGuardado, "el sha es el de la receta guardada");
  assert.notEqual(body.sha256, shaMentira, "y NO el de lo que mandó el navegador");
  assert.equal(firmas[0].sha256, shaGuardado);
});

test("sin `content` en el cuerpo, una receta se firma igual", async () => {
  const { status } = await firmar({
    docType: "PRESCRIPTION", docId: "rx_1", keyPassword: DRA_RUIZ.password,
  });
  assert.equal(status, 201, "el contenido lo arma el servidor; el del cliente sobra");
});

test("lo firmado incluye lo que importa: paciente, vigencia, grupo, folio y médico", async () => {
  const { canonicalPrescriptionContent } = await import("@/lib/signature/contenido-receta");
  const texto = canonicalPrescriptionContent(receta({ cofeprisFolio: "F-778899" }) as any);
  // Antes se firmaba { id, qrCode, items, issuedAt } y nada más.
  for (const campo of ["patientId", "doctorId", "expiresAt", "cofeprisGroup", "cofeprisFolio", "indications", "status"]) {
    assert.ok(texto.includes(`"${campo}"`), `falta ${campo} en lo firmado`);
  }
  // Mismo documento → mismo texto, siempre (si no, nunca podrá verificarse).
  assert.equal(texto, canonicalPrescriptionContent(receta({ cofeprisFolio: "F-778899" }) as any));
});

test("dos items iguales salvo en la nota dan el MISMO texto venga como venga de la base", async () => {
  const { canonicalPrescriptionContent } = await import("@/lib/signature/contenido-receta");
  // El mismo medicamento, la misma dosis, distinta indicación. `PrescriptionItem`
  // no tiene columna de orden y el SELECT no puede prometer uno estable: si el
  // desempate no mirara `notes`, Postgres decidiría el sha256 de la receta.
  const manana = { cumsKey: "MX-0030", dosage: "1 tableta", duration: "7 días", quantity: "7", notes: "por la mañana" };
  const noche  = { cumsKey: "MX-0030", dosage: "1 tableta", duration: "7 días", quantity: "7", notes: "por la noche" };

  const unOrden  = canonicalPrescriptionContent(receta({ items: [manana, noche] }) as any);
  const elOtro   = canonicalPrescriptionContent(receta({ items: [noche, manana] }) as any);
  assert.equal(unOrden, elOtro, "el orden de las filas no puede cambiar lo firmado");
  // Y las dos notas siguen dentro: ordenar no es descartar.
  assert.ok(unOrden.includes("por la mañana") && unOrden.includes("por la noche"));
});

test("cambiar una nota SÍ cambia lo firmado (la firma cubre la receta entera)", async () => {
  const { canonicalPrescriptionContent } = await import("@/lib/signature/contenido-receta");
  const a = canonicalPrescriptionContent(
    receta({ items: [{ cumsKey: "MX-0030", dosage: "1 tableta", duration: null, quantity: null, notes: "con alimentos" }] }) as any);
  const b = canonicalPrescriptionContent(
    receta({ items: [{ cumsKey: "MX-0030", dosage: "1 tableta", duration: null, quantity: null, notes: "en ayunas" }] }) as any);
  assert.notEqual(a, b);
});

// ── 3. El sello del PDF ────────────────────────────────────────────────────

test("el PDF NO pone el sello por una firma de otro doctor", async () => {
  // Un colega consigue meter una fila de firma para esta receta.
  firmas.push({ id: "sig_intrusa", docType: "PRESCRIPTION", docId: "rx_1",
                signerUserId: "doc_solis", signedAt: new Date("2026-09-01T16:00:00Z") });

  const { buildPrescriptionPdf } = await import("@/lib/pdf/prescription-pdf");
  await buildPrescriptionPdf("rx_1", "cli_1");
  const texto = textoDe(elementoCapturado);
  assert.ok(!/Firmada/i.test(texto), `el PDF no debe decir que está firmada:\n${texto.slice(0, 400)}`);
});

test("el PDF sí pone el sello cuando firma el médico de la receta", async () => {
  await firmar({ docType: "PRESCRIPTION", docId: "rx_1", keyPassword: DRA_RUIZ.password });

  const { buildPrescriptionPdf } = await import("@/lib/pdf/prescription-pdf");
  await buildPrescriptionPdf("rx_1", "cli_1");
  const texto = textoDe(elementoCapturado);
  assert.match(texto, /Firmada digitalmente por el médico/);
  // Y deja de prometer una e.firma que nadie ha validado contra el SAT.
  assert.ok(!/e\.firma/i.test(texto), "el PDF ya no dice «e.firma»");
});

// ── 4. El certificado y su llave ───────────────────────────────────────────

test("subir un certificado con la llave de OTRO: rechazado", async () => {
  certs = {};
  const { status, body } = await registrarCert({
    cerDer: DRA_RUIZ.cerDer,
    keyDerCifrada: DR_SOLIS.keyDerCifrada,
    password: DR_SOLIS.password,
  });
  assert.equal(status, 400);
  assert.equal(body.error, "key_does_not_match_cert");
  assert.equal(Object.keys(certs).length, 0, "no se guardó nada");
});

test("subir un certificado con la contraseña equivocada: rechazado, SIEMPRE", async () => {
  // Veinte contraseñas malas, no una: `decryptPrivateKeyInfo` decide por el
  // relleno PKCS#5 y con una contraseña equivocada ese relleno cuadra por
  // casualidad ~1 de cada 256 veces. Con una sola prueba, el fallo aparecía de
  // higos a brevas y contestaba `key_parse_failed` a quien solo había tecleado
  // mal. Con veinte, si vuelve la grieta, sale en rojo.
  for (let i = 0; i < 20; i++) {
    certs = {};
    const { status, body } = await registrarCert(DRA_RUIZ, `no-es-la-contraseña-${i}`);
    assert.equal(status, 400);
    assert.equal(body.error, "invalid_key_password", `intento ${i}: ${body.error} / ${body.detail}`);
    assert.equal(Object.keys(certs).length, 0);
  }
});

test("un archivo que no es una .key se distingue de una contraseña mala", async () => {
  certs = {};
  const { status, body } = await registrarCert({
    cerDer: DRA_RUIZ.cerDer,
    keyDerCifrada: Buffer.from("esto no es DER, es texto"),
    password: "da igual",
  });
  assert.equal(status, 400);
  assert.equal(body.error, "invalid_key_file", "no se le echa la culpa a la contraseña");
  assert.equal(Object.keys(certs).length, 0);
});

test("el par correcto sí se registra", async () => {
  certs = {};
  const { status } = await registrarCert(DRA_RUIZ);
  assert.equal(status, 201);
  assert.ok(certs["doc_ruiz"], "queda guardado");
});

test("🔴 ABIERTO A PROPÓSITO: un certificado hecho en casa sigue pasando", async () => {
  // No es un descuido del test: es el límite del arreglo. Nadie comprueba que
  // el .cer lo haya emitido el SAT. Cuando eso se implemente, este caso tiene
  // que empezar a fallar — y entonces se cambia a esperar el rechazo.
  certs = {};
  const { status, body } = await registrarCert(identidadCasera("Quien Sea"));
  assert.equal(status, 201);
  assert.match(body.cerIssuer, /ADMINISTRACION TRIBUTARIA/);
});
