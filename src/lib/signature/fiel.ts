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
  const keyAsn1 = forge.asn1.fromDer(forge.util.createBuffer(opts.keyDer.toString("binary")));
  const decrypted = forge.pki.decryptPrivateKeyInfo(keyAsn1, opts.keyPassword);
  if (!decrypted) {
    throw new Error("invalid_key_password");
  }
  const privateKey = forge.pki.privateKeyFromAsn1(decrypted);

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
