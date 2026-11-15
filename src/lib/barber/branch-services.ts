// ═══════════════════════════════════════════════════════════════════════
// Servicios que hereda una sucursal nueva.
//
// Una sede recién creada nacía con 0 servicios (y por eso con la reserva y
// la caja vacías, aunque su página pública ya estaba abierta). Ahora, al
// crearla, se copian los servicios ACTIVOS de la matriz — en la misma
// transacción que la sede, para que no exista una sede a medias.
//
// Es una COPIA, no un vínculo: cada sede ajusta después sus propios precios.
// Función pura (sin Prisma) para poder probar qué se copia y qué no.
// ═══════════════════════════════════════════════════════════════════════

export interface ServicioDeMatriz {
  name: string;
  description: string | null;
  durationMin: number;
  /** Decimal de Prisma o número: se pasa tal cual, sin redondear. */
  price: unknown;
  category: string;
  isActive: boolean;
  sortOrder: number;
}

/** Filas listas para `createMany` en la sede nueva. Solo los activos. */
export function serviciosParaSedeNueva(matriz: ServicioDeMatriz[], sedeId: string) {
  return matriz
    .filter((s) => s.isActive)
    .map((s) => ({
      barbershopId: sedeId,
      name: s.name,
      description: s.description,
      durationMin: s.durationMin,
      price: s.price as never,
      category: s.category,
      isActive: true,
      sortOrder: s.sortOrder,
    }));
}
