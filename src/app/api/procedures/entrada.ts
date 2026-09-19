/**
 * Lo que el panel puede escribir en `procedure_catalog`, y nada más.
 *
 * `code` NO está aquí a propósito. No es un código SAT: es la llave `ODO_*`
 * con la que el odontograma encuentra qué cobrar al cerrar una cita
 * (`src/lib/odontogram/snapshot.ts`). Mientras la pantalla lo editaba, vaciar
 * ese campo mandaba `code: null`, rompía el enlace y el siguiente cierre de
 * cita sembraba una fila DUPLICADA a precio de seed. Si viene en el body se
 * ignora en silencio.
 */

// Sin unión discriminada: con `"strict": false` TypeScript no estrecha por `ok`.
export interface Gasto { ok: boolean; value: number | null; error?: string }

/**
 * Gasto del procedimiento: número ≥ 0, o null si viene vacío.
 * null = «no lo hemos medido»; 0 = «no cuesta nada». No son lo mismo.
 */
export function leerGasto(raw: unknown): Gasto {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw === "string" && raw.trim() === "") return { ok: true, value: null };
  if (typeof raw !== "number" && typeof raw !== "string") return { ok: false, value: null, error: "Gasto inválido" };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return { ok: false, value: null, error: "Gasto inválido" };
  return { ok: true, value: n };
}

export interface Entrada<T> { ok: boolean; data?: T; error?: string }

export interface DatosAlta {
  name: string;
  category: string;
  basePrice: number;
  cost: number | null;
  duration: number | null;
  description: string | null;
}

export function datosDeAlta(body: any): Entrada<DatosAlta> {
  if (!body?.name?.trim()) return { ok: false, error: "Nombre es requerido" };
  if (body.basePrice === undefined || body.basePrice < 0) return { ok: false, error: "Precio inválido" };
  const gasto = leerGasto(body.cost);
  if (!gasto.ok) return { ok: false, error: gasto.error };
  return {
    ok: true,
    data: {
      name: body.name.trim(),
      category: body.category?.trim() || "general",
      basePrice: Number(body.basePrice),
      cost: gasto.value,
      duration: body.duration ? Number(body.duration) : null,
      description: body.description?.trim() || null,
    },
  };
}

export type DatosCambio = Partial<DatosAlta & { isActive: boolean }>;

export function datosDeCambio(body: any): Entrada<DatosCambio> {
  const data: DatosCambio = {};
  if (body?.cost !== undefined) {
    const gasto = leerGasto(body.cost);
    if (!gasto.ok) return { ok: false, error: gasto.error };
    data.cost = gasto.value;
  }
  if (body?.name !== undefined) data.name = body.name.trim();
  if (body?.category !== undefined) data.category = body.category.trim();
  if (body?.basePrice !== undefined) data.basePrice = Number(body.basePrice);
  if (body?.duration !== undefined) data.duration = body.duration ? Number(body.duration) : null;
  if (body?.description !== undefined) data.description = body.description?.trim() || null;
  if (body?.isActive !== undefined) data.isActive = Boolean(body.isActive);
  return { ok: true, data };
}
