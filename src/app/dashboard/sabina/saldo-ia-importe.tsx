import "server-only";
import { prisma } from "@/lib/prisma";
import { fmtMXNdec } from "@/lib/format";

/**
 * El importe del Saldo IA que se enseña en la cabecera de Sabina.
 *
 * Es un componente de SERVIDOR que la página mete dentro de un `<Suspense>`:
 * la página no espera a esta lectura para pintar, y la conversación —que se
 * hidrata en el navegador con su propio GET— no se entera de que existe. El
 * importe llega por el mismo flujo, unos milisegundos después, y rellena el
 * chip. Así hay saldo a la vista sin una llamada que retrase la carga.
 *
 * Solo LEE (`findUnique`): a diferencia de `getOrCreateWallet`, entrar a
 * Sabina no da de alta un monedero. Sin fila = la clínica nunca ha gastado:
 * se enseña $0.00, que es lo que le diría la pantalla del saldo. El
 * `clinicId` sale de la sesión (lo pone `page.tsx`); sin él no se consulta,
 * porque `clinicId: undefined` no filtraría nada.
 */
export async function SaldoIaImporte({ clinicId }: { clinicId: string }) {
  if (!clinicId) return null;
  try {
    const monedero = await prisma.aiWallet.findUnique({
      where: { clinicId },
      select: { balanceCents: true },
    });
    return <>{fmtMXNdec((monedero?.balanceCents ?? 0) / 100)}</>;
  } catch {
    // Sin importe el chip sigue siendo el acceso al saldo; no se rompe nada.
    return null;
  }
}
