/**
 * DaleControl INSTITUCIONAL — EL HASH de lo que se manda a autorizar.
 *
 * Módulo de SERVIDOR (importa `node:crypto`) pero SIN prisma, y ésa es toda
 * la razón de que exista aparte:
 *
 *  · No puede vivir en autorizaciones-core.ts porque ese módulo lo importan
 *    componentes "use client" (etiquetas, tipos, el juicio del lote), y
 *    arrastrar `node:crypto` al bundle del navegador rompe el build.
 *  · No puede vivir en autorizaciones.ts porque ése importa prisma, y
 *    entonces la prueba que fija LA regla de esta ola —firmar, editar, y que
 *    la firma deje de valer— necesitaría una base de datos para correr.
 *
 * Así la receta (autorizaciones-core.ts) y su digestión (este archivo) se
 * comprueban las dos sin Postgres y sin navegador, que es donde de verdad se
 * puede demostrar que un hash cambia cuando cambia el contenido.
 */
import { createHash } from "node:crypto";
import {
  eduApprovalCanonicalText,
  type EduApprovalSnapshot,
} from "@/lib/edu/autorizaciones-core";

/**
 * sha256 hexadecimal (64 caracteres) del texto canónico del snapshot.
 *
 * 🔴 Se resume el TEXTO CANÓNICO y no un `JSON.stringify` del objeto. La
 * diferencia importa: el orden de las claves de un objeto en JavaScript
 * depende de cómo se construyó, así que dos lecturas del mismo renglón de
 * base de datos pueden producir dos JSON distintos —y por tanto dos hashes
 * distintos— sin que nadie haya editado nada. Una autorización que se vence
 * sola por eso es peor que no tener autorizaciones: nadie confía en un gate
 * que miente.
 */
export function eduApprovalHash(snapshot: EduApprovalSnapshot): string {
  return createHash("sha256").update(eduApprovalCanonicalText(snapshot), "utf8").digest("hex");
}
