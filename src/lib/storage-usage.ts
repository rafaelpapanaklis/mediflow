import { prisma } from "@/lib/prisma";
import {
  categoriaDeArchivo,
  categoriaDeObjeto,
  desgloseVacio,
  sumarEnDesglose,
  type DesgloseAlmacenamiento,
  type KindObjetoAlmacen,
} from "@/lib/storage-usage-core";

/**
 * FUENTE ÚNICA del uso de almacenamiento. La leen la cuota de subida
 * (`storageQuotaError`), la tarjeta «Almacenamiento» de Configuración →
 * Suscripción, el aviso del panel y /admin → clínica → Resumen.
 *
 * Qué cuenta (todo lo que la clínica deja en Storage, mientras el objeto exista):
 *   patient_files (radiografías, CBCT, modelos 3D, fotos de ortodoncia, otros;
 *     incluye los quitados con borrado lógico: el blob se preserva),
 *   clinical_photos (foto + miniatura; al quitarla el binario SÍ se borra y
 *     `sizeBytes` se pone a 0 — ver `quitarFotoClinica`),
 *   patient_uploads, orthodontic_monitoring_photos, dental_lab_order_files,
 *   clinic_storage_objects (derivados y lo demás: CBCT ligero, GLB web,
 *   miniaturas, firmas, comprobantes, landing, soporte).
 *
 * Consultas AGREGADAS por lista de clínicas (una o cientos = las mismas), en
 * tandas de menos de 7 por Promise.all (el pooler se satura). Lo esencial
 * (patient_files, clinical_photos) lanza si falla; lo demás falla suave a 0 y
 * lo dice en `avisos`.
 */

export interface UsoAlmacenamiento {
  porClinica: Map<string, DesgloseAlmacenamiento>;
  /** Qué no se pudo sumar (falla suave), para decirlo en pantalla. */
  avisos: string[];
}

async function suave<T>(p: Promise<T>, que: string, avisos: string[], vacio: T): Promise<T> {
  try {
    return await p;
  } catch (e) {
    console.error(`[storage-usage] no se pudo sumar ${que}:`, e);
    avisos.push(que);
    return vacio;
  }
}

export async function medirAlmacenamiento(clinicIds: string[]): Promise<UsoAlmacenamiento> {
  const avisos: string[] = [];
  const porClinica = new Map<string, DesgloseAlmacenamiento>();
  // `clinicId: { in: [] }` no filtra nada peligroso, pero no hay nada que medir.
  const ids = Array.from(new Set(clinicIds.filter(Boolean)));
  if (ids.length === 0) return { porClinica, avisos };
  const en = { clinicId: { in: ids } };
  const de = (id: string) => {
    let d = porClinica.get(id);
    if (!d) porClinica.set(id, (d = desgloseVacio()));
    return d;
  };
  for (const id of ids) de(id);

  // ── Tanda 1 (4): lo esencial ────────────────────────────────────────────
  const [archivos, cbct, fotos, subidas] = await Promise.all([
    prisma.patientFile.groupBy({ by: ["clinicId", "category"], where: en, _sum: { size: true } }),
    // Los CBCT viven en SCAN_STL junto a los modelos 3D; se distinguen por la carpeta.
    prisma.patientFile.groupBy({
      by: ["clinicId"],
      where: { ...en, category: "SCAN_STL", url: { contains: "/dicom-sets/" } },
      _sum: { size: true },
    }),
    // SIN filtrar deletedAt: quitar una foto borra el binario y pone sizeBytes en 0;
    // una foto con borrado lógico cuyo binario sigue en el bucket sigue ocupando.
    prisma.clinicalPhoto.groupBy({ by: ["clinicId"], where: en, _sum: { sizeBytes: true } }),
    suave(
      prisma.patientUpload.groupBy({ by: ["clinicId"], where: en, _sum: { sizeBytes: true } }),
      "documentos del portal",
      avisos,
      [] as { clinicId: string; _sum: { sizeBytes: number | null } }[],
    ),
  ]);

  const cbctPor = new Map<string, number>();
  for (const r of cbct) cbctPor.set(r.clinicId, Number(r._sum.size ?? 0));
  const porCat = new Map<string, { clave: string; bytes: number }[]>();
  for (const r of archivos) {
    const bytes = Number(r._sum.size ?? 0);
    const lista = porCat.get(r.clinicId) ?? [];
    if (r.category === "SCAN_STL") {
      // Parte CBCT / parte modelos 3D del mismo grupo.
      const c = cbctPor.get(r.clinicId) ?? 0;
      lista.push({ clave: "SCAN_STL:CBCT", bytes: c }, { clave: "SCAN_STL", bytes: Math.max(0, bytes - c) });
    } else {
      lista.push({ clave: String(r.category), bytes });
    }
    porCat.set(r.clinicId, lista);
  }
  for (const [id, filas] of Array.from(porCat.entries())) {
    sumarEnDesglose(de(id), filas, (k) => (k === "SCAN_STL:CBCT" ? "radiografias" : categoriaDeArchivo(k)));
  }
  for (const r of fotos) de(r.clinicId).fotos += Number(r._sum.sizeBytes ?? 0);
  for (const r of subidas) de(r.clinicId).documentos += Number(r._sum.sizeBytes ?? 0);

  // ── Tanda 2 (3): el resto ──────────────────────────────────────────────
  const [monitoreo, labs, objetos] = await Promise.all([
    suave(
      prisma.orthodonticMonitoringPhoto.groupBy({ by: ["clinicId"], where: en, _sum: { sizeBytes: true } }),
      "fotos de monitoreo",
      avisos,
      [] as { clinicId: string; _sum: { sizeBytes: number | null } }[],
    ),
    // Los archivos de laboratorio cuelgan de la orden (que lleva clinicId).
    suave(
      prisma.$queryRaw<{ clinicId: string; bytes: bigint | number | null }[]>`
        SELECT o."clinicId" AS "clinicId", SUM(f."sizeBytes") AS "bytes"
        FROM "dental_lab_order_files" f
        JOIN "dental_lab_orders" o ON o."id" = f."orderId"
        WHERE o."clinicId" = ANY(${ids})
        GROUP BY o."clinicId"`,
      "archivos de laboratorio",
      avisos,
      [],
    ),
    suave(
      prisma.clinicStorageObject.groupBy({ by: ["clinicId", "kind"], where: en, _sum: { sizeBytes: true } }),
      "archivos derivados, firmas y comprobantes",
      avisos,
      [] as { clinicId: string; kind: string; _sum: { sizeBytes: bigint | null } }[],
    ),
  ]);
  for (const r of monitoreo) de(r.clinicId).fotos += Number(r._sum.sizeBytes ?? 0);
  for (const r of labs) de(r.clinicId).documentos += Number(r.bytes ?? 0);
  // sizeBytes es BigInt: la suma llega como bigint (exacta en la base) y se pasa a Number
  // solo al final; por debajo de 2^53 bytes (~9 PB) no pierde precisión.
  for (const r of objetos) de(r.clinicId)[categoriaDeObjeto(r.kind)] += Number(r._sum.sizeBytes ?? BigInt(0));

  return { porClinica, avisos };
}

/** Desglose de UNA clínica. `clinicId` viene de la sesión; vacío = error, no «todas». */
export async function medirAlmacenamientoDeClinica(clinicId: string): Promise<DesgloseAlmacenamiento> {
  if (!clinicId) throw new Error("medirAlmacenamientoDeClinica: falta clinicId");
  const { porClinica } = await medirAlmacenamiento([clinicId]);
  return porClinica.get(clinicId) ?? desgloseVacio();
}

/**
 * Anota el tamaño de un objeto que se acaba de subir y que no tiene columna de
 * tamaño propia. Falla suave (tabla sin crear, red): nunca tumba la subida.
 */
export async function registrarObjetoAlmacen(args: {
  clinicId: string;
  kind: KindObjetoAlmacen;
  bucket: string;
  path: string;
  sizeBytes: number;
}): Promise<void> {
  if (!args.clinicId || !Number.isFinite(args.sizeBytes) || args.sizeBytes < 0) return;
  const sizeBytes = Math.round(args.sizeBytes);
  try {
    await prisma.clinicStorageObject.upsert({
      where: { bucket_path: { bucket: args.bucket, path: args.path } },
      create: { clinicId: args.clinicId, kind: args.kind, bucket: args.bucket, path: args.path, sizeBytes: BigInt(sizeBytes) },
      // Regenerar el mismo objeto (upsert en Storage) actualiza su tamaño, no lo duplica.
      update: { sizeBytes: BigInt(sizeBytes) },
    });
  } catch (e) {
    console.error("[storage-usage] no se pudo registrar el objeto:", args.bucket, args.path, e);
  }
}

/** Quita el registro de un objeto que SÍ se borró del bucket. */
export async function olvidarObjetoAlmacen(bucket: string, path: string): Promise<void> {
  try {
    await prisma.clinicStorageObject.deleteMany({ where: { bucket, path } });
  } catch (e) {
    console.error("[storage-usage] no se pudo olvidar el objeto:", bucket, path, e);
  }
}
