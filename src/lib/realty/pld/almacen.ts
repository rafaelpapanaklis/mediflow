// ═══════════════════════════════════════════════════════════════════════
// DaleControl INMUEBLES · PLD — los papeles en el bucket privado.
//
// Envoltorio delgadísimo sobre src/lib/realty/media.ts. Existe por UNA
// razón concreta: `realtyStoragePath()` exige un `propertyId` y una carpeta
// de una lista cerrada ("fotos" | "panoramicas" | "documentos" |
// "exclusivas"). Un expediente de cumplimiento no cuelga de un inmueble
// —cuelga de una PERSONA— y su carpeta no está en esa lista.
//
// Ampliar el union de media.ts sería tocar un archivo que comparten todas
// las terminales del vertical por una necesidad que es solo de este módulo.
// Se construye la ruta aquí, con la MISMA disciplina:
//
//   · empieza SIEMPRE por el accountId → un listado por prefijo jamás cruza
//     inquilinos y `pathBelongsToAccount()` de media.ts sigue valiendo;
//   · el nombre del objeto se GENERA, nunca es el que mandó el navegador
//     (un "../../otra-cuenta/x.pdf" en el nombre original sería una fuga);
//   · la extensión sale del MIME, no del nombre.
//
// 🔴 LO QUE SUBE AQUÍ ES LO MÁS DELICADO DE TODO EL PRODUCTO: la copia de
// la credencial de alguien, su CURP, su comprobante de domicilio. El bucket
// `realty-files` es PRIVADO y estos objetos se leen SIEMPRE con una URL
// firmada de vida corta, después de comprobar el accountId de la sesión, y
// dejando renglón en la bitácora. Nunca se guarda una URL firmada en una
// columna: caduca, y si acaba en una página cacheada se publica sola.
// ═══════════════════════════════════════════════════════════════════════
import "server-only";
import { REALTY_DOC_URL_TTL, extensionForMime, signRealtyUrl } from "@/lib/realty/media";

/** La carpeta del módulo dentro del bucket. */
export const PLD_FOLDER = "cumplimiento";

/**
 * Ruta del objeto de un papel del expediente:
 *
 *   <accountId>/cumplimiento/<fileId>/<único>.<ext>
 *
 * El `fileId` es el del expediente (RealtyPldFile), no el del contacto: si
 * mañana se fusionan dos contactos, los papeles siguen con su expediente.
 */
export function pldStoragePath(accountId: string, fileId: string, mime: string): string {
  const ext = extensionForMime(mime);
  const unique = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${accountId}/${PLD_FOLDER}/${fileId}/${unique}.${ext}`;
}

/**
 * Firma un papel para leerlo. TTL corto (el de los documentos, no el de las
 * fotos): son papeles ajenos y la ventana tiene que ser mínima.
 *
 * Devuelve "" si no se pudo firmar — falla suave, como el resto del
 * vertical: la pantalla enseña el renglón sin enlace en vez de reventar.
 */
export async function firmarPapelPld(path: string | null | undefined): Promise<string> {
  return signRealtyUrl(path, REALTY_DOC_URL_TTL);
}
