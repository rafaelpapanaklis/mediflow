// Inventario A (WS1-T4, ajuste 1) — comprobante de una compra como ARCHIVO
// (foto o PDF), aparte del folio de texto libre que ya existía.
//
// Mismo patrón que la subida de radiografías/archivos del paciente
// (src/app/api/xrays/route.ts): bucket privado `patient-files`
// (src/lib/storage.ts — el nombre es histórico, ya conviven ahí "archivos de
// laboratorios y proveedores", ver storage-quota.ts), path SIEMPRE prefijado
// por clinicId, validación de tipo por whitelist MIME + magic number real
// (file-type, no el file.type del navegador, que es falseable), y en la base
// se guarda SOLO el path interno — la URL se firma bajo demanda (TTL corto)
// en listarCompras().
//
// A propósito NO cuenta contra la cuota de almacenamiento del plan
// (storageQuotaError): storage-quota.ts ya documenta "archivos de
// laboratorios y proveedores" como una subestimación conocida y aceptada
// ("nunca sobreestima"); un comprobante de compra es del mismo calibre —
// ocasional y pequeño — así que no se tocó ese archivo compartido.
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BUCKETS, uploadFileToStorage, removeFileFromStorage, signMaybeUrl } from "@/lib/storage";
import {
  PERFILES,
  validarArchivo,
  generarLlaveAlmacenamiento,
  registrarSubidaRechazada,
} from "@/lib/uploads/validar-archivo";

export const COMPROBANTE_ALLOWED_TYPES = PERFILES.COMPROBANTE.mimesPermitidos;
export const COMPROBANTE_MAX_SIZE = PERFILES.COMPROBANTE.maxBytes; // 10MB — es una foto/PDF de un ticket, no un escaneo

// Mismo criterio de tolerancia que compras.server.ts (ver su nota completa):
// P2021/P2022 + PrismaClientValidationError + TypeError del cliente viejo.
function faltaTabla(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  if (code === "P2021" || code === "P2022") return true;
  if (e instanceof Prisma.PrismaClientValidationError) return true;
  return e instanceof TypeError && /Cannot read propert(y|ies) of undefined/.test((e as Error).message ?? "");
}

export class ComprasTablaFaltanteError extends Error {
  code = "COMPRAS_TABLA_FALTANTE" as const;
  // Ajuste 1 (QA en vivo): este mensaje decía "la tabla inventory_purchases
  // no existe" — copiado de compras.server.ts sin ajustar. La tabla YA
  // existe (ahí se acaba de escribir la compra); lo que falta aquí son las
  // 3 columnas NUEVAS de ESTE ajuste, y el SQL correcto es otro archivo.
  constructor() { super("Faltan las columnas de comprobante en inventory_purchases. Aplica sql/inventario-compra-comprobante-t4-ajuste1.sql en Supabase."); }
}

export class ComprobanteInvalidoError extends Error {
  code = "COMPROBANTE_INVALIDO" as const;
}

export class CompraNoEncontradaError extends Error {
  code = "COMPRA_NO_ENCONTRADA" as const;
  constructor() { super("La compra no existe en esta clínica."); }
}

export interface ComprobanteSubido {
  receiptFileUrl: string;
  receiptFileName: string;
}

export async function subirComprobanteDeCompra(
  params: { clinicId: string; purchaseId: string; file: File; userId?: string },
  db: PrismaClient = prisma,
): Promise<ComprobanteSubido> {
  // Validación de tipo/tamaño real ANTES de tocar la base o el storage — igual
  // que antes de este cambio: un archivo inválido no debe gastar ni una
  // consulta a Prisma. Atajo barato por tamaño DECLARADO primero (sin leer el
  // archivo completo a memoria) y luego el contenido real.
  if (params.file.size > PERFILES.COMPROBANTE.maxBytes) {
    const maxMb = Math.round(PERFILES.COMPROBANTE.maxBytes / (1024 * 1024));
    await registrarSubidaRechazada({
      clinicId: params.clinicId,
      userId: params.userId,
      ruta: "/api/inventory/purchases/[id]/comprobante",
      motivo: `Archivo demasiado grande (máx ${maxMb} MB)`,
      codigo: "demasiado_grande",
      nombreOriginal: params.file.name,
    });
    throw new ComprobanteInvalidoError(`Archivo demasiado grande (máx ${maxMb}MB).`);
  }

  const bytes = await params.file.arrayBuffer();
  const validado = await validarArchivo({
    bytes,
    nombreOriginal: params.file.name,
    perfil: PERFILES.COMPROBANTE,
  });
  if (validado.ok === false) {
    await registrarSubidaRechazada({
      clinicId: params.clinicId,
      userId: params.userId,
      ruta: "/api/inventory/purchases/[id]/comprobante",
      motivo: validado.motivo,
      codigo: validado.codigo,
      nombreOriginal: params.file.name,
    });
    throw new ComprobanteInvalidoError(validado.motivo);
  }

  let compra: { id: string; receiptFilePath: string | null } | null;
  try {
    compra = await db.inventoryPurchase.findFirst({
      where:  { id: params.purchaseId, clinicId: params.clinicId },
      select: { id: true, receiptFilePath: true },
    });
  } catch (e) {
    if (faltaTabla(e)) throw new ComprasTablaFaltanteError();
    throw e;
  }
  if (!compra) throw new CompraNoEncontradaError();

  const path = generarLlaveAlmacenamiento(
    [params.clinicId, "inventory-purchases", params.purchaseId],
    validado.extensionReal,
  );

  await uploadFileToStorage(path, bytes, validado.mimeReal, BUCKETS.PATIENT_FILES);

  try {
    await db.inventoryPurchase.update({
      where: { id: params.purchaseId },
      data:  { receiptFilePath: path, receiptFileName: validado.nombreSaneado, receiptFileMime: validado.mimeReal },
    });
  } catch (e) {
    // El archivo ya subió al bucket pero no se pudo enlazar en la base —
    // limpiar el objeto huérfano antes de propagar el error.
    await removeFileFromStorage(path, BUCKETS.PATIENT_FILES).catch(() => {});
    if (faltaTabla(e)) throw new ComprasTablaFaltanteError();
    throw e;
  }

  // Reemplazo: si ya había un comprobante, se borra el anterior (best-effort,
  // nunca bloquea la respuesta por un fallo de borrado).
  if (compra.receiptFilePath) {
    removeFileFromStorage(compra.receiptFilePath, BUCKETS.PATIENT_FILES).catch((e) =>
      console.error("[comprobante] no se pudo borrar el archivo anterior:", (e as Error)?.message ?? e),
    );
  }

  const receiptFileUrl = await signMaybeUrl(path, undefined, BUCKETS.PATIENT_FILES);
  return { receiptFileUrl, receiptFileName: validado.nombreSaneado };
}
