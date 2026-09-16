/**
 * El TEXTO QUE SE FIRMA de una receta — construido en el servidor, desde la
 * base, con orden fijo de campos.
 *
 * ── POR QUÉ ────────────────────────────────────────────────────────────────
 * Hasta el 15-sep-2026 `POST /api/signature/sign` firmaba `body.content`: lo
 * que mandara el navegador. El servidor nunca releía la receta. Dos
 * consecuencias: (a) la firma podía cubrir un contenido que no era el de la
 * receta guardada, y (b) el modal, incluso en el flujo honrado, solo mandaba
 * `{ id, qrCode, items, issuedAt }` — sin paciente, sin diagnóstico, sin
 * vigencia, sin grupo COFEPRIS, sin folio y sin médico. Es decir: lo firmado
 * no incluía justo lo que importa de una receta.
 *
 * Aquí se arma el contenido desde lo guardado. El orden de las claves es el
 * orden de escritura del literal (JSON.stringify lo respeta) y los items van
 * ordenados de forma determinista, para que el mismo documento produzca
 * siempre el mismo sha256 — condición necesaria si algún día se verifica de
 * verdad (ver `verificarFirmaReceta` cuando exista).
 *
 * `v: 1` marca la versión del formato. Si el formato cambia, sube el número:
 * una firma vieja seguirá diciendo con qué reglas se calculó.
 */

export interface RecetaFirmableItem {
  cumsKey: string;
  dosage: string;
  duration?: string | null;
  quantity?: string | null;
  notes?: string | null;
}

export interface RecetaFirmable {
  id: string;
  clinicId: string;
  patientId: string;
  doctorId: string;
  qrCode: string;
  issuedAt: Date | string;
  expiresAt?: Date | string | null;
  diagnosis?: string | null;
  indications?: string | null;
  cofeprisGroup?: string | null;
  cofeprisFolio?: string | null;
  status?: string | null;
  items: RecetaFirmableItem[];
}

function iso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

/**
 * Orden determinista de los items: por TODOS sus campos, `notes` incluido.
 *
 * `notes` no es decorativo aquí. `PrescriptionItem` no tiene columna de orden
 * (a diferencia de `EduPrescriptionItem.orden`, que existe justo por esto) y el
 * `SELECT` que los trae no puede prometer un orden estable sin `ORDER BY`. Dos
 * items del mismo medicamento con la misma dosis y distinta nota —«por la
 * mañana» y «por la noche»— quedaban desempatados por el orden que devolviera
 * Postgres. El mismo documento podía dar dos sha256 distintos, que es
 * exactamente lo que este archivo promete que no pasa.
 */
function clave(it: RecetaFirmableItem): string {
  return [it.cumsKey, it.dosage, it.duration ?? "", it.quantity ?? "", it.notes ?? ""].join("\u0000");
}

function ordenar(items: RecetaFirmableItem[]): RecetaFirmableItem[] {
  return [...items].sort((a, b) => {
    const ka = clave(a);
    const kb = clave(b);
    // Comparación por code point, no `localeCompare`: el resultado no puede
    // depender del idioma del servidor que firme.
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

export function canonicalPrescriptionContent(rx: RecetaFirmable): string {
  return JSON.stringify({
    v: 1,
    doc: "PRESCRIPTION",
    id: rx.id,
    clinicId: rx.clinicId,
    patientId: rx.patientId,
    doctorId: rx.doctorId,
    qrCode: rx.qrCode,
    issuedAt: iso(rx.issuedAt),
    expiresAt: iso(rx.expiresAt),
    diagnosis: rx.diagnosis ?? null,
    indications: rx.indications ?? null,
    cofeprisGroup: rx.cofeprisGroup ?? null,
    cofeprisFolio: rx.cofeprisFolio ?? null,
    status: rx.status ?? "ACTIVE",
    items: ordenar(rx.items).map((it) => ({
      cumsKey: it.cumsKey,
      dosage: it.dosage,
      duration: it.duration ?? null,
      quantity: it.quantity ?? null,
      notes: it.notes ?? null,
    })),
  });
}
