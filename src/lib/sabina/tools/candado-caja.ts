/**
 * El candado de Caja para Sabina: la BANDERA, no la key.
 *
 * 🔴 Por qué no basta con `permiso: "billing.view"`: esa key la tienen por
 * defecto los cinco roles, READONLY incluido. Lo que de verdad cierra Caja es
 * `canUseCaja` (SUPER_ADMIN siempre; el resto solo con `User.canAccessCaja`), y
 * la pantalla y las seis rutas de /api/caja lo piden ADEMÁS de la key. Una
 * herramienta con la key sola le enseñaría la caja a quien la pantalla se la
 * niega: es el hallazgo 23, ya cerrado en /api/caja/current, volviendo por la
 * puerta de Sabina.
 *
 * Cómo se resuelve, y por qué así:
 *  · La herramienta conserva `permiso: "billing.view"`, la misma key de la
 *    pantalla. El runner la mira con el rol y el override del ctx, así que el
 *    recorte por usuario que el SUPER_ADMIN pone a Sabina (en camino por la rama
 *    feat/sabina-permisos-equipo, aplicado en `crearSabinaCtx` y hecho de keys)
 *    la gobierna sin tocar nada aquí: si le quita facturación a Sabina, le quita
 *    también Caja.
 *  · Y además este candado llama a `canUseCaja` —la MISMA función de la
 *    pantalla, no una copia de su criterio— con la fila del usuario leída por
 *    `ctx.db`. No se añade `canAccessCaja` a `SabinaCtx`: ese ctx lo está
 *    rehaciendo esa otra rama, y un segundo sitio donde se decide el acceso es
 *    el bug que ese trabajo existe para evitar.
 *  · La fila se busca por `id` Y `clinicId` de la sesión, activa. Una persona
 *    tiene una fila por clínica; la bandera de la sede de al lado no abre esta.
 *    Sin fila (usuario dado de baja entre la sesión y la pregunta) no abre.
 *
 * Se exporta suelto porque la pestaña Facturas vive DENTRO de Caja y hereda su
 * candado (MAPA-caja §0.8): una consulta que enseñe la lista general de facturas
 * tendría que ponérselo también.
 */

import { canUseCaja } from "@/lib/caja-pin";
import { dbDe } from "./base";
import type { SabinaCandado, SabinaCtx } from "../tipos";

/** Lo que viaja en `sin_permiso.permiso`. Su prefijo da la frase «No tienes acceso a Caja». */
export const CANDADO_CAJA = "caja.acceso";

export const candadoCaja: SabinaCandado = {
  etiqueta: CANDADO_CAJA,
  async abre(ctx: SabinaCtx): Promise<boolean> {
    const usuario = await dbDe(ctx).user.findFirst({
      where: { id: ctx.userId, clinicId: ctx.clinicId, isActive: true },
      select: { role: true, canAccessCaja: true },
    });
    return canUseCaja(usuario);
  },
};
