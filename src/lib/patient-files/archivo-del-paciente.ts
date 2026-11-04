/**
 * Ids de `PatientFile` que manda el cliente (auditoría de seguridad ola 3, BAJA de run-3).
 *
 * Endodoncia (`conductometryFileId`, `controlFileId`, `intraoperativeFileId`) e implantes
 * (`patientPhotoFileId`) guardaban CUALQUIER id: los zod aceptan cualquier string y las acciones solo
 * ataban el padre. Luego los lectores seguían la FK (`include: { conductometryFile: true }`) sin mirar
 * la clínica, y la fila entera del archivo ajeno —ruta del bucket, nombre, `doctorNotes`,
 * anotaciones— viajaba al panel de quien la guardó. Mismo criterio que `uploadPhotoToSet` (X6).
 */
import { prisma } from "@/lib/prisma";

/**
 * ¿Se puede guardar este id de archivo en un registro de `patientId` de `clinicId` (la de la sesión)?
 * `true` si no hay id (nada que atar) o si el archivo es de esa clínica, de ese paciente y no está
 * borrado; `false` si es de otra clínica, de otro paciente (también uno oculto) o no existe.
 */
export async function assertPatientFileInClinic(args: {
  id: string | null | undefined;
  clinicId: string;
  patientId: string;
}): Promise<boolean> {
  if (!args.id) return true;
  if (!args.clinicId || !args.patientId) return false;
  const file = await prisma.patientFile.findFirst({
    where: { id: args.id, clinicId: args.clinicId, patientId: args.patientId, deletedAt: null },
    select: { id: true },
  });
  return !!file;
}

type Dueno = { clinicId: string; patientId: string };

/** El archivo solo si es de la clínica y del paciente del registro que lo enlaza; si no, `null`. */
export function esArchivoDe<F extends Dueno>(file: F | null | undefined, dueno: Dueno): F | null {
  return file && file.clinicId === dueno.clinicId && file.patientId === dueno.patientId ? file : null;
}

type TratamientoEndoConArchivos = Dueno & {
  rootCanals?: Array<{ conductometryFile?: Dueno | null }>;
  followUps?: Array<{ controlFile?: Dueno | null }>;
  apicalSurgery?: { intraoperativeFile?: Dueno | null } | null;
};

/**
 * Lector defensivo de endodoncia: deja en `null` todo archivo enlazado que no sea de la clínica y del
 * paciente del tratamiento (un id ajeno guardado antes del arreglo). Modifica y devuelve el mismo objeto.
 */
export function soloArchivosDelTratamiento<T extends TratamientoEndoConArchivos>(t: T): T {
  for (const rc of t.rootCanals ?? []) {
    if ("conductometryFile" in rc) rc.conductometryFile = esArchivoDe(rc.conductometryFile, t);
  }
  for (const fu of t.followUps ?? []) {
    if ("controlFile" in fu) fu.controlFile = esArchivoDe(fu.controlFile, t);
  }
  if (t.apicalSurgery && "intraoperativeFile" in t.apicalSurgery) {
    t.apicalSurgery.intraoperativeFile = esArchivoDe(t.apicalSurgery.intraoperativeFile, t);
  }
  return t;
}
