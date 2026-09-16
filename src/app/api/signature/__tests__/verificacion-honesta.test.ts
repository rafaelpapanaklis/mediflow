/**
 * WS1-T1 · rojo 3 — LA VERIFICACIÓN QUE SIEMPRE DECÍA «VÁLIDA».
 *
 * Run: npm run test:receta-verificacion-honesta
 *   (--experimental-test-module-mocks: se ejecuta el route handler de verdad
 *    con Prisma sustituido.)
 *
 * El fallo: `GET /api/signature/verify/[signatureId]` devolvía `valid: true`
 * con que EXISTIERA la fila. No comprobaba la firma PKCS#7, ni el certificado,
 * ni que el documento siguiera igual. En todo `src/` no hay ninguna función
 * que verifique una firma FIEL — no es que fallara: es que no existe.
 *
 * Hoy ninguna pantalla, PDF ni QR llega a esta dirección, y por eso es el menos
 * grave de los tres. Pero mientras dijera «válida» sin serlo, era una mentira
 * publicada, sin auth, a nombre de la clínica.
 *
 * El arreglo no es verificar —sin validar la cadena del SAT, una verificación
 * criptográfica solo probaría «lo firmó quien tenga esa llave», y por el rojo 2
 * esa llave puede ser de cualquiera—. El arreglo es DEJAR DE AFIRMAR.
 *
 * ⚠️ `valid` se conserva porque puede haber integraciones de fuera leyéndolo;
 * no hay forma de saberlo desde el repo. Ahora vale `false`, que es el lado
 * seguro de equivocarse: quien lo lea deja de dar por buena una firma que nadie
 * ha comprobado.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const FIRMA = {
  id: "sig_1",
  clinicId: "cli_1",
  docType: "PRESCRIPTION",
  docId: "rx_1",
  signerUserId: "doc_ruiz",
  sha256: "a".repeat(64),
  signature: "MIIFAKE...",
  tsaTimestamp: null,
  signedAt: new Date("2026-09-01T15:05:00Z"),
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      signedDocument: {
        findUnique: async ({ where }: any) => (where.id === FIRMA.id ? FIRMA : null),
      },
      user: {
        findUnique: async () => ({
          firstName: "Ana", lastName: "Ruiz",
          cedulaProfesional: "12345678", especialidad: "Endodoncia",
        }),
      },
    },
  },
});

async function verificar(signatureId: string) {
  const { GET } = await import("@/app/api/signature/verify/[signatureId]/route");
  const res = await GET({} as any, { params: { signatureId } });
  return { status: res.status, body: await res.json() };
}

test("la firma existe, pero la ruta ya NO dice que sea válida", async () => {
  const { status, body } = await verificar("sig_1");
  assert.equal(status, 200);
  assert.equal(body.registered, true, "la firma está registrada: eso sí se sabe");
  assert.equal(body.verified, false, "y no está verificada: eso también se sabe");
  assert.equal(body.verificationStatus, "not_verified");
  assert.notEqual(body.valid, true, "«valid: true» era la mentira");
});

test("el campo viejo `valid` sigue ahí, por si alguien de fuera lo lee", async () => {
  const { body } = await verificar("sig_1");
  assert.ok("valid" in body, "quitarlo rompería a quien lo consuma sin avisar");
  assert.equal(body.valid, false, "y fallar cerrado es el lado seguro");
});

test("el aviso dice, en palabras, qué NO se ha comprobado", async () => {
  const { body } = await verificar("sig_1");
  assert.match(body.detail, /NO ha sido verificada/i);
  assert.match(body.detail, /SAT/);
});

test("los metadatos útiles siguen saliendo (nadie pierde información)", async () => {
  const { body } = await verificar("sig_1");
  assert.equal(body.signatureId, "sig_1");
  assert.equal(body.docType, "PRESCRIPTION");
  assert.equal(body.docId, "rx_1");
  assert.equal(body.sha256, FIRMA.sha256);
  assert.equal(body.signer.name, "Ana Ruiz");
  assert.equal(body.signer.cedulaProfesional, "12345678");
  // La firma cruda NUNCA sale por aquí.
  assert.ok(!("signature" in body));
});

test("una firma que no existe: 404, y tampoco afirma nada", async () => {
  const { status, body } = await verificar("sig_inventada");
  assert.equal(status, 404);
  assert.equal(body.valid, false);
  assert.equal(body.registered, false);
  assert.equal(body.verified, false);
  assert.equal(body.error, "not_found");
});
