// ─────────────────────────────────────────────────────────────────────────────
// A quién se le manda el WhatsApp de confirmación de una reserva web (M9,
// auditoría 30-sep-2026).
//
// Antes `/api/public/book` mandaba la plantilla —desde el número de la CLÍNICA—
// al teléfono que escribía quien reserva, con el nombre que escribía dentro del
// texto: cualquier cuenta de paciente verificada podía usar el WhatsApp de una
// clínica para escribirle a desconocidos (phishing, reportes a Meta contra el
// número de la clínica).
//
// No existe verificación de teléfono en las cuentas de paciente (solo la del
// correo), así que "verificado" aquí es lo más cercano que hay: el teléfono que
// la clínica YA tiene en el expediente de ese paciente, o el que la cuenta dio
// al registrarse. El campo libre del formulario de reserva NUNCA es destino.
// ─────────────────────────────────────────────────────────────────────────────

const soloDigitos = (v: string | null | undefined): string => (v ?? "").replace(/\D/g, "");

/** Teléfono (solo dígitos, ≥10) o null si no sirve para mandar un WhatsApp. */
export function telefonoUtil(v: string | null | undefined): string | null {
  const d = soloDigitos(v);
  return d.length >= 10 && d.length <= 15 ? d : null;
}

export interface EntradasDestino {
  /** El paciente ya existía en la clínica (no lo creó esta reserva). */
  pacienteYaRegistrado: boolean;
  /** Teléfono que la clínica tiene en el expediente de ese paciente. */
  telefonoDelExpediente: string | null | undefined;
  /** Teléfono de la cuenta del portal (dado al registrarse la cuenta). */
  telefonoDeLaCuenta: string | null | undefined;
}

/**
 * Destino del WhatsApp de confirmación, o null si no hay uno confiable (la
 * reserva se hace igual; solo no se manda el mensaje). Nunca recibe el teléfono
 * que se escribió en el formulario.
 */
export function elegirDestinoWhatsApp(e: EntradasDestino): string | null {
  if (e.pacienteYaRegistrado) {
    const delExpediente = telefonoUtil(e.telefonoDelExpediente);
    if (delExpediente) return delExpediente;
  }
  return telefonoUtil(e.telefonoDeLaCuenta);
}

/**
 * El nombre que va dentro de la plantilla: solo letras, números, espacios y
 * `.'-`, de hasta 40 caracteres. Sin enlaces (`:` `/`), sin saltos de línea y
 * sin símbolos: un texto libre no puede convertir el mensaje de la clínica en
 * un anzuelo.
 */
export function nombreParaPlantilla(nombre: string | null | undefined): string {
  const limpio = (nombre ?? "")
    .replace(/[^\p{L}\p{N} .'’-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
  return limpio || "paciente";
}

/** Tope de citas web futuras sin cancelar por paciente y clínica. */
export const TOPE_CITAS_WEB_PENDIENTES = 5;
