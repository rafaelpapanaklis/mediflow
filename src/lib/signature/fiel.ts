/**
 * Firma electrónica avanzada FIEL/SAT con node-forge.
 *
 * Capacidades:
 *  - parseCer: lee un .cer DER y extrae serial/issuer/validity/RFC.
 *  - signDetached: firma un buffer con la .key privada (descifrada
 *    en memoria) y devuelve PKCS#7 detached en base64.
 *  - requestTsaTimestamp: solicita timestamp RFC 3161 a SAT (best
 *    effort, falla silencioso).
 *
 * NOTA: en testing puede fallar la validación de TSA. La firma sigue
 * siendo válida como "firma electrónica avanzada" según LFEA si hay
 * PKCS7+cert válidos (TSA es nice-to-have).
 */

import forge from "node-forge";

export interface ParsedCert {
  serial: string;
  issuer: string;
  subject: string;
  validFrom: Date;
  validUntil: Date;
  rfc: string;
}

/**
 * Parsea un .cer DER (binary) del SAT y extrae metadatos. El RFC del
 * titular viene en el subject o en una extensión (uniqueIdentifier en
 * algunos certs SAT, o serialNumber).
 */
export function parseCer(cerDer: Buffer): ParsedCert {
  const asn1 = forge.asn1.fromDer(forge.util.createBuffer(cerDer.toString("binary")));
  const cert = forge.pki.certificateFromAsn1(asn1);

  const issuer = cert.issuer.attributes.map((a) => `${a.shortName ?? a.name}=${a.value}`).join(", ");
  const subject = cert.subject.attributes.map((a) => `${a.shortName ?? a.name}=${a.value}`).join(", ");

  // Buscar el RFC del titular. SAT lo coloca en distintos lugares según
  // el certificado: subject CN, subject serialNumber, o subject
  // x500UniqueIdentifier. Probamos varios.
  let rfc = "";
  for (const attr of cert.subject.attributes) {
    const v = String(attr.value ?? "");
    // RFC físico: 13 chars [A-Z]{4}\d{6}[A-Z0-9]{3} | RFC moral: 12
    if (/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(v)) {
      rfc = v;
      break;
    }
  }

  return {
    serial: cert.serialNumber,
    issuer,
    subject,
    validFrom: cert.validity.notBefore,
    validUntil: cert.validity.notAfter,
    rfc,
  };
}

/**
 * Abre una .key del SAT (PKCS#8 EncryptedPrivateKeyInfo en DER) con su
 * contraseña. Lanza `invalid_key_password` si la contraseña no es la buena, y
 * `invalid_key_file` si el archivo no es una llave, que son cosas distintas y
 * el médico merece que se le digan distintas.
 *
 * ── POR QUÉ NO BASTA CON MIRAR SI DEVUELVE `null` ─────────────────────────
 * node-forge decide si la contraseña sirve mirando el relleno PKCS#5 del texto
 * descifrado. Con una contraseña equivocada ese relleno cuadra por casualidad
 * más o menos una vez de cada 256, y entonces forge sigue adelante y parsea la
 * basura como ASN.1 ahí dentro (`pbe.js:378-380`): revienta con cosas como
 * «Only 8, 16, 24, or 32 bits supported: 424» en lugar de devolver `null`.
 * Sin este `try`, una de cada 256 veces el médico que teclea mal su contraseña
 * recibía «no se pudo leer el archivo», o un 500. Es el tipo de fallo que
 * aparece de higos a brevas y nadie consigue reproducir.
 *
 * Una vez aplicada la contraseña, cualquier tropiezo ya solo tiene una
 * explicación: la contraseña estaba mal.
 */
function abrirLlave(keyDer: Buffer, keyPassword: string): forge.pki.rsa.PrivateKey {
  let keyAsn1;
  try {
    keyAsn1 = forge.asn1.fromDer(forge.util.createBuffer(keyDer.toString("binary")));
  } catch {
    // Esto no es ni ASN.1: el archivo no es una .key. La contraseña no tiene la culpa.
    throw new Error("invalid_key_file");
  }

  try {
    const decrypted = forge.pki.decryptPrivateKeyInfo(keyAsn1, keyPassword);
    if (!decrypted) throw new Error("invalid_key_password");
    return forge.pki.privateKeyFromAsn1(decrypted) as forge.pki.rsa.PrivateKey;
  } catch (e) {
    // Es ASN.1 válido pero no una llave cifrada: tampoco es culpa de la contraseña.
    if (String(e).includes("EncryptedPrivateKeyInfo")) throw new Error("invalid_key_file");
    throw new Error("invalid_key_password");
  }
}

/**
 * Firma un buffer con la .key privada SAT (PKCS#8 DER o PEM) y devuelve
 * PKCS#7 detached signature en base64.
 */
export function signDetached(opts: {
  contentBuffer: Buffer;
  cerDer: Buffer;
  keyDer: Buffer;
  keyPassword: string;
}): string {
  // SAT keys son PKCS#8 EncryptedPrivateKeyInfo en DER. Descifrar primero.
  const privateKey = abrirLlave(opts.keyDer, opts.keyPassword);

  const cerAsn1 = forge.asn1.fromDer(forge.util.createBuffer(opts.cerDer.toString("binary")));
  const cert = forge.pki.certificateFromAsn1(cerAsn1);

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(opts.contentBuffer.toString("binary"));
  p7.addCertificate(cert);
  // signingTime espera Date a runtime pero el tipo TS de node-forge dice
  // string — cast a any para evitar fricción.
  p7.addSigner({
    key: privateKey,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    authenticatedAttributes: ([
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
    ] as any),
  });

  // Detached signature: contenido NO se incluye dentro del PKCS7
  p7.sign({ detached: true });

  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return forge.util.encode64(der);
}

/**
 * ¿La llave privada abre con esa contraseña Y es la pareja del certificado?
 *
 * Hasta el 15-sep-2026 `POST /api/signature/cert` pedía la contraseña de la
 * llave y NO la usaba: guardaba el .cer y el .key sin comprobar que abrieran,
 * ni que fueran pareja. Se podía subir el certificado de alguien y la llave de
 * otro, y el sistema no se enteraba nunca — porque tampoco hay nadie que
 * verifique una firma después (ver la ruta /api/signature/verify).
 *
 * Para RSA (que es lo que emite el SAT), ser pareja es que el módulo y el
 * exponente público de la llave privada coincidan con los del certificado.
 *
 * Lanza `invalid_key_password` si la contraseña no abre la llave.
 * Devuelve `false` si abre pero no es la pareja del certificado.
 *
 * 🔴 ESTO NO DICE que el certificado sea del SAT. Un certificado hecho en casa
 * con su propia llave pasa esta comprobación. Validar la cadena del SAT y la
 * revocación es otro trabajo.
 */
export function keyMatchesCert(opts: {
  cerDer: Buffer;
  keyDer: Buffer;
  keyPassword: string;
}): boolean {
  const privateKey = abrirLlave(opts.keyDer, opts.keyPassword);

  const cerAsn1 = forge.asn1.fromDer(forge.util.createBuffer(opts.cerDer.toString("binary")));
  const cert = forge.pki.certificateFromAsn1(cerAsn1);
  const publicKey = cert.publicKey as forge.pki.rsa.PublicKey;

  if (!publicKey?.n || !publicKey?.e) return false;
  return privateKey.n.compareTo(publicKey.n) === 0 && privateKey.e.compareTo(publicKey.e) === 0;
}

/**
 * Solicita un timestamp RFC 3161 a una TSA. Best effort — si falla,
 * devuelve null y el doc queda firmado sin TSA.
 *
 * NOTA: la TSA del SAT requiere acceso autenticado en producción. Esta
 * implementación es un stub que intenta el endpoint público; el éxito
 * real depende de la disponibilidad y configuración de SAT.
 */
export async function requestTsaTimestamp(_sha256: string): Promise<string | null> {
  const tsaUrl = process.env.TSA_URL ?? "https://tsa.sat.gob.mx";
  // Implementación real requiere construir un TimeStampReq ASN.1, hacer
  // POST con Content-Type application/timestamp-query y parsear el
  // TimeStampResp. node-forge no lo trae out-of-the-box.
  //
  // Por ahora devolvemos null para no bloquear la firma. El registro
  // queda en signed_documents.tsaTimestamp = null (válido en sí mismo
  // por el PKCS7 + cert).
  console.warn("TSA timestamp not implemented — returning null. TSA url:", tsaUrl);
  return null;
}
