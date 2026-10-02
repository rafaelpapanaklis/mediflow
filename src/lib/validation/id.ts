// El id de un registro de la base, venga de donde venga (ws1-t12, «Invalid uuid» de BEVADENT, oct-2026).
//
// 🔴 NO VALIDES UN ID DE LA BASE CON `z.string().uuid()`. El formato de un id NO lo garantiza el modelo:
//   - Prisma declara unos modelos `@default(uuid())` (ortodoncia, endodoncia, implantes…) y otros `@default(cuid())`
//     (pacientes, facturas, citas…), y el `@default` solo aplica cuando quien inserta NO manda id.
//   - El importador insertaba en lote con ids propios con forma de cuid también en los modelos uuid: en BEVADENT
//     47 de 51 casos de ortodoncia, 96 de 98 hojas de control, 282 de 306 fases. Con `.uuid()` el doctor veía
//     «Invalid uuid» al firmar el control de una paciente importada de Dentalink.
//   - Las siembras de prueba y de demo usan ids legibles («prueba-orto-plan-02», «demo-altabrisa-patient-02»).
// Los datos ya importados NO se reescriben (son ids de clientes): el código acepta los tres formatos.
//
// Qué acepta: uuid, cuid/cuid2 y los ids de siembra; letras, dígitos, «-» y «_», de 1 a 64 caracteres, empezando y
// acabando en letra o dígito. Qué rechaza: vacío, espacios, comillas, puntos, barras, «%», saltos de línea y lo
// demasiado largo. NO autoriza nada: quien lo usa sigue buscando el registro con el `clinicId` de la sesión.
//
// Cuándo SÍ va `.uuid()`: un valor que el SERVIDOR genera con `randomUUID()` y nunca sale de la base de un cliente
// (p. ej. el «intento» de un aviso de Sabina, el id de una propuesta de Sabina, el UUID fiscal de un CFDI).

import { z } from "zod";

/** Largo máximo de un id de la base: uuid = 36, cuid = 25, cuid2 ≤ 32, siembras ≤ 40. */
export const LARGO_MAXIMO_DE_ID = 64;

const ID_DE_LA_BASE = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,62}[A-Za-z0-9])?$/;

/** Lo que ve quien llama con un id que no es de la base. */
export const MENSAJE_ID_INVALIDO = "Identificador inválido";

/** ¿Tiene forma de id de un registro de la base (uuid, cuid/cuid2 o id de siembra)? */
export function esIdDeLaBase(valor: unknown): valor is string {
  return typeof valor === "string" && valor.length <= LARGO_MAXIMO_DE_ID && ID_DE_LA_BASE.test(valor);
}

/**
 * Esquema zod del id de un registro de la base. Úsalo en lugar de `z.string().uuid()`:
 * `idDeLaBase()`, `idDeLaBase().nullable()`, `idDeLaBase().optional()`…
 */
export function idDeLaBase() {
  return z.string().max(LARGO_MAXIMO_DE_ID, MENSAJE_ID_INVALIDO).regex(ID_DE_LA_BASE, MENSAJE_ID_INVALIDO);
}
