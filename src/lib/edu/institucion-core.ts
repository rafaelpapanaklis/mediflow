/**
 * DaleControl INSTITUCIONAL — LOS DATOS DEL PROPIO INSTITUTO · parte PURA
 * (H-150).
 *
 * Módulo PURO y client-safe: sin prisma, sin "server-only". Valida lo que
 * la dirección puede corregir de su escuela. Lo que toca la base vive en
 * institucion.ts.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 POR QUÉ (H-150)
 *
 * «Los datos del propio instituto no se editan desde ninguna pantalla del
 * panel. En todo el vertical hay DOS escrituras a `EduInstitution`, y
 * ninguna es del panel: el seed de demo y el medidor de almacenamiento.
 * Nombre, ciudad, estado, teléfono, correo, logo y LA ZONA HORARIA —la que
 * gobierna toda la vista consolidada— no tienen dónde corregirse. Un
 * instituto de Tijuana dado de alta con el default de CDMX no tiene
 * arreglo.»
 *
 * 🔴 CERO SQL. Las columnas existen TODAS desde la Ola 0 y la Ola 1. Lo
 * que faltaba era el endpoint y la pantalla, no la migración.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 LO QUE **NO** SE EDITA DESDE AQUÍ, Y NO ES UN OLVIDO:
 *
 *   · `slug`         → es la URL pública del instituto. Cambiarlo rompe
 *     todos los enlaces que la escuela ya repartió, incluidas las cartas
 *     de consentimiento que un paciente tiene en el teléfono.
 *   · `isActive`     → apagar un instituto es una decisión de DaleControl,
 *     no de la escuela. Se hace desde /admin.
 *   · `contractStartsAt` / `contractEndsAt` / `storageQuotaBytes` → son
 *     CLÁUSULAS DEL CONTRATO. El esquema ya lo dice con todas sus letras:
 *     «la dirección la VE en su panel y no la edita con ningún permiso; si
 *     la escuela pudiera subírsela sola, el cobro por TB extra no
 *     existiría».
 *
 * Repetir esa lista en el endpoint sería la forma de que un día se cuele
 * una: aquí abajo hay UNA lista, EDU_INSTITUCION_EDITABLE, y el endpoint
 * no escribe nada que no esté en ella.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { eduSafeTimeZone } from "@/lib/edu/agenda-core";

/**
 * Los campos que la dirección PUEDE corregir, con su tope. El tope es el
 * mismo `@db.VarChar(n)` del esquema: si aquí fuera mayor, Postgres
 * rebotaría la escritura con un error en inglés en vez de un mensaje.
 */
export const EDU_INSTITUCION_EDITABLE = {
  name: 160,
  legalName: 200,
  rfc: 13,
  city: 80,
  state: 80,
  phone: 30,
  email: 160,
  logoUrl: 500,
  timezone: 60,
} as const;

export type EduInstitucionCampo = keyof typeof EDU_INSTITUCION_EDITABLE;

export const EDU_INSTITUCION_LABELS: Record<EduInstitucionCampo, string> = {
  name: "Nombre",
  legalName: "Razón social",
  rfc: "RFC",
  city: "Ciudad",
  state: "Estado",
  phone: "Teléfono",
  email: "Correo",
  logoUrl: "Logo",
  timezone: "Zona horaria",
};

/** Los campos que NO se editan, con el porqué. Se pinta en la pantalla. */
export const EDU_INSTITUCION_NO_EDITABLE: Record<string, string> = {
  slug: "Es la URL pública del instituto. Cambiarla rompe los enlaces que ya repartiste.",
  isActive: "Encender o apagar un instituto es de DaleControl, no de la escuela.",
  contractStartsAt: "Es una cláusula del contrato. Se cambia desde el /admin de DaleControl.",
  contractEndsAt: "Es una cláusula del contrato. Se cambia desde el /admin de DaleControl.",
  storageQuotaBytes:
    "La cuota de almacenamiento es una cláusula del contrato: se ve aquí y se cambia allá.",
};

export interface EduInstitucionPatch {
  name?: string;
  legalName?: string | null;
  rfc?: string | null;
  city?: string | null;
  state?: string | null;
  phone?: string | null;
  email?: string | null;
  logoUrl?: string | null;
  timezone?: string;
}

/**
 * Lee el cuerpo y devuelve SOLO lo que se puede escribir.
 *
 * 🔴 CAMPO AUSENTE NO SE ESCRIBE (`undefined`), campo en blanco SÍ se
 * borra (`null`). Es la misma regla que `patient-update-core.ts` del
 * dental y que el resto del vertical: sin ella, un PATCH que solo trae el
 * teléfono le vaciaría el RFC a la escuela.
 *
 * 🔴 `name` Y `timezone` NO SE PUEDEN VACIAR. Los dos son NOT NULL en la
 * base, y además el segundo gobierna toda la vista consolidada: un
 * instituto sin zona horaria no puede pintar una agenda.
 */
export function eduInstitucionParsePatch(body: Record<string, unknown>): EduInstitucionPatch {
  const out: EduInstitucionPatch = {};

  const texto = (campo: Exclude<EduInstitucionCampo, "name" | "timezone">) => {
    const raw = body[campo];
    if (raw === undefined) return;
    if (raw === null) {
      (out as Record<string, unknown>)[campo] = null;
      return;
    }
    if (typeof raw !== "string") return;
    const v = raw.trim();
    (out as Record<string, unknown>)[campo] = v
      ? v.slice(0, EDU_INSTITUCION_EDITABLE[campo])
      : null;
  };

  if (body.name !== undefined) {
    const v = typeof body.name === "string" ? body.name.trim() : "";
    if (v.length < 2) {
      throw new Error("El nombre del instituto no puede quedar vacío.");
    }
    out.name = v.slice(0, EDU_INSTITUCION_EDITABLE.name);
  }

  if (body.timezone !== undefined) {
    const v = typeof body.timezone === "string" ? body.timezone.trim() : "";
    if (!v) throw new Error("La zona horaria no puede quedar vacía.");
    // 🔴 SE COMPRUEBA CONTRA Intl, NO CONTRA UNA LISTA A MANO. Una lista
    // se queda vieja; `eduSafeTimeZone` devuelve "UTC" cuando la zona no
    // existe, y eso aquí ES el error: guardar "UTC" porque alguien
    // escribió "America/Tijuna" movería la agenda de toda la escuela dos
    // horas sin decir nada.
    if (eduSafeTimeZone(v) !== v) {
      throw new Error(
        `«${v}» no es una zona horaria que este servidor conozca. Usa el formato «America/Tijuana».`,
      );
    }
    out.timezone = v.slice(0, EDU_INSTITUCION_EDITABLE.timezone);
  }

  texto("legalName");
  texto("rfc");
  texto("city");
  texto("state");
  texto("phone");
  texto("email");
  texto("logoUrl");

  if (typeof out.rfc === "string") out.rfc = out.rfc.toUpperCase();
  if (typeof out.email === "string") out.email = out.email.toLowerCase();

  if (Object.keys(out).length === 0) {
    throw new Error("No llegó ningún campo que se pueda corregir.");
  }
  return out;
}
