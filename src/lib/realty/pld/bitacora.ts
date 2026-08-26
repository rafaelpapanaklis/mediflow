// ═══════════════════════════════════════════════════════════════════════
// DaleControl INMUEBLES · PLD — LA BITÁCORA DE LA BÓVEDA.
//
// La conservación de diez años tiene dos mitades. La primera es no borrar
// el papel; la segunda —la que casi todo el mundo olvida— es poder decir
// QUIÉN lo consultó y CUÁNDO. Este módulo es esa segunda mitad.
//
// ── 🔴 ESCRIBIR EN LA BITÁCORA JAMÁS PUEDE TUMBAR LA ACCIÓN ────────────
// Si el `create` falla (la tabla sin migrar, la base con un hipo), la
// pantalla del usuario NO se cae: se registra el error en el log del
// servidor y se sigue. Un expediente que no abre porque su bitácora falló
// es peor producto que un renglón de bitácora perdido — y el que se pierde
// se ve en el log del servidor.
//
// Al revés NO vale: la bitácora se escribe DESPUÉS de comprobar el
// accountId y ANTES de devolver el dato. Nunca se registra un acceso que no
// ocurrió, y nunca se entrega un papel sin intentar registrarlo.
//
// ── QUÉ SE GUARDA Y QUÉ NO ────────────────────────────────────────────
// Se guarda el nombre de la persona EN EL RENGLÓN, no solo su id: dentro de
// diez años el RealtyUser puede haberse borrado y "el usuario cku3n…" no le
// dice nada a nadie. Se guarda la IP y el user-agent porque es lo que pide
// cualquier revisión. NO se guarda el contenido del papel.
// ═══════════════════════════════════════════════════════════════════════
import "server-only";
import { prisma } from "@/lib/prisma";
import type { RealtyContext } from "@/lib/realty-auth";
import type { PldAccessAction } from "./contrato";

/**
 * Nombre para el renglón. Cae al correo si la ficha está a medias: un
 * renglón de bitácora sin nadie a quien atribuirlo no sirve de nada.
 */
export function nombreDeUsuario(u: { firstName: string; lastName: string; email: string }): string {
  return `${u.firstName} ${u.lastName}`.trim() || u.email;
}

export interface EntradaBitacora {
  action: PldAccessAction;
  fileId?: string | null;
  documentId?: string | null;
  /** Para DESCARGAR_AVISO: el periodo del que se bajó el archivo. */
  subject?: string | null;
}

/**
 * Saca IP y user-agent de la petición. Los dos son "lo que dijo el
 * cliente", así que se recortan: un user-agent puede venir con kilobytes de
 * basura y ese renglón se guarda diez años.
 */
export function huellaDePeticion(req: Request): { ip: string | null; userAgent: string | null } {
  const h = req.headers;
  // x-forwarded-for llega como "cliente, proxy1, proxy2": el primero es el
  // que importa. En Vercel siempre viene poblado.
  const fwd = h.get("x-forwarded-for") ?? "";
  const ip = (fwd.split(",")[0] || h.get("x-real-ip") || "").trim();
  const ua = (h.get("user-agent") ?? "").trim();
  return {
    ip: ip ? ip.slice(0, 60) : null,
    userAgent: ua ? ua.slice(0, 240) : null,
  };
}

/**
 * Deja constancia de un acceso. NUNCA lanza.
 *
 * `ctx` da el accountId (nunca el body de la petición) y el nombre de quien
 * consultó. `req` es opcional: hay caminos —el render de una página de
 * servidor— que no tienen la Request a mano y aun así deben registrar.
 */
export async function registrarAcceso(
  ctx: RealtyContext,
  entrada: EntradaBitacora,
  req?: Request,
): Promise<void> {
  try {
    const huella = req ? huellaDePeticion(req) : { ip: null, userAgent: null };
    await prisma.realtyPldAccessLog.create({
      data: {
        accountId: ctx.accountId,
        action: entrada.action,
        fileId: entrada.fileId ?? null,
        documentId: entrada.documentId ?? null,
        subject: entrada.subject ? entrada.subject.slice(0, 180) : null,
        userId: ctx.realtyUserId,
        userName: nombreDeUsuario(ctx.user),
        ip: huella.ip,
        userAgent: huella.userAgent,
      },
    });
  } catch (e) {
    // Ver la cabecera: se registra el fallo y se sigue.
    console.error("[realty-pld] no se pudo escribir en la bitácora:", e);
  }
}

export interface RenglonBitacora {
  id: string;
  action: PldAccessAction;
  userName: string | null;
  fileId: string | null;
  documentId: string | null;
  subject: string | null;
  /** Nombre del contacto del expediente, si el renglón apunta a uno. */
  sobre: string | null;
  ip: string | null;
  createdAt: string;
}

/**
 * Los últimos accesos de la cuenta. `fileId` acota a un expediente.
 *
 * 🔴 El `where` SIEMPRE lleva accountId. `fileId` viaja como
 * `fileId ?? undefined`… NO: con `undefined` Prisma BORRA el filtro y
 * devolvería la bitácora entera. Se arma el where a mano.
 */
export async function leerBitacora(
  ctx: RealtyContext,
  opciones: { fileId?: string | null; take?: number } = {},
): Promise<RenglonBitacora[]> {
  const take = Math.min(200, Math.max(1, opciones.take ?? 60));
  const where: { accountId: string; fileId?: string } = { accountId: ctx.accountId };
  if (opciones.fileId) where.fileId = opciones.fileId;

  try {
    const filas = await prisma.realtyPldAccessLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        action: true,
        userName: true,
        fileId: true,
        documentId: true,
        subject: true,
        ip: true,
        createdAt: true,
        file: { select: { contact: { select: { name: true } } } },
      },
    });
    return filas.map((f) => ({
      id: f.id,
      action: f.action,
      userName: f.userName,
      fileId: f.fileId,
      documentId: f.documentId,
      subject: f.subject,
      sobre: f.file?.contact?.name ?? null,
      ip: f.ip,
      createdAt: f.createdAt.toISOString(),
    }));
  } catch (e) {
    console.error("[realty-pld] no se pudo leer la bitácora:", e);
    return [];
  }
}
