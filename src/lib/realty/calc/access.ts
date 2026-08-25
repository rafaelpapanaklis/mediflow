// ═══════════════════════════════════════════════════════════════════════
// Alcance de los prospectos dentro de las calculadoras — PUNTO ÚNICO.
//
// Vivía duplicado entre la ruta de API y la página del panel. Eran
// equivalentes, que es justo lo peligroso: dos copias que hoy dicen lo mismo
// y mañana no, sin que nada avise. Ahora las tres superficies (buscador,
// bitácora e historial) preguntan aquí.
//
// Módulo puro: recibe lo mínimo del contexto, así que lo puede importar tanto
// una página de servidor como una ruta de API sin arrastrar Prisma.
// ═══════════════════════════════════════════════════════════════════════
import type { RealtyRole } from "@/lib/realty/types";

/**
 * El trozo de `where` que acota los prospectos que este usuario alcanza.
 *
 * Un ASESOR solo ve los suyos: esconder los ajenos por defecto es la
 * dirección segura mientras la ola de prospectos fija la política definitiva
 * de visibilidad del embudo. Los demás roles (OWNER, MANAGER, ASSISTANT) ven
 * los de la cuenta — coherente con sus permisos por defecto.
 */
export function filtroLeadsDelRol(ctx: {
  role: RealtyRole;
  realtyUserId: string;
}): { assignedUserId?: string } {
  return ctx.role === "AGENT" ? { assignedUserId: ctx.realtyUserId } : {};
}

/**
 * Quita los comodines de LIKE del término de búsqueda.
 *
 * 🔴 Prisma NO escapa `%` ni `_` dentro de `contains`: van directos al LIKE de
 * Postgres. Sin esto, buscar "%" empareja con TODOS los contactos de la cuenta
 * y el buscador se convierte en un volcado de la libreta entera.
 */
export function limpiarBusqueda(raw: string): string {
  return raw.replace(/[%_\\]/g, " ").replace(/\s+/g, " ").trim();
}
