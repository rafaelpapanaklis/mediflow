// Periodontics — server-side loader para fotos perio. SPEC §6, COMMIT 2.
//
// NO es "use server" (no es un action invocable desde cliente). Lo importan
// server components / route handlers para hidratar la galería.

import { prisma } from "@/lib/prisma";
import {
  PERIO_PHOTO_TYPE_TO_SCHEMA,
  schemaPhotoTypeToPerioKind,
  type PerioPhotoKind,
} from "./photo-types";

export interface PerioPhotoListItem {
  id: string;
  kind: PerioPhotoKind | null;
  stage: "pre" | "during" | "post" | "control";
  blobUrl: string;
  thumbnailUrl: string | null;
  toothFdi: number | null;
  notes: string | null;
  capturedAt: Date;
}

export interface LoadPerioPhotosInput {
  clinicId: string;
  patientId: string;
  /** Filtra a un slug perio específico. */
  kind?: PerioPhotoKind;
  /** Tope alto para evitar OOM en pacientes con cientos de fotos. */
  limit?: number;
}

/**
 * Devuelve fotos `module='periodontics'` no borradas ordenadas por
 * `capturedAt` descendente. Las fotos legacy (`perio_initial`,
 * `perio_surgery`) se devuelven con `kind=null` para que la UI las
 * muestre en una sección "Sin clasificar" sin perderlas.
 */
export async function loadPerioPhotos(
  input: LoadPerioPhotosInput,
): Promise<PerioPhotoListItem[]> {
  const photoTypeFilter = input.kind
    ? PERIO_PHOTO_TYPE_TO_SCHEMA[input.kind]
    : undefined;

  const rows = await prisma.clinicalPhoto.findMany({
    where: {
      clinicId: input.clinicId,
      patientId: input.patientId,
      module: "periodontics",
      deletedAt: null,
      ...(photoTypeFilter ? { photoType: photoTypeFilter } : {}),
    },
    orderBy: { capturedAt: "desc" },
    take: input.limit ?? 200,
    select: {
      id: true,
      photoType: true,
      stage: true,
      blobUrl: true,
      thumbnailUrl: true,
      toothFdi: true,
      notes: true,
      capturedAt: true,
    },
  });

  return rows.map((r) => ({
    id: r.id,
    kind: schemaPhotoTypeToPerioKind(r.photoType),
    stage: r.stage,
    blobUrl: r.blobUrl,
    thumbnailUrl: r.thumbnailUrl,
    toothFdi: r.toothFdi,
    notes: r.notes,
    capturedAt: r.capturedAt,
  }));
}
