// Server component a propósito (sin estado ni handlers): la portada de /admin
// le pasa las cifras YA calculadas y aquí sólo se pintan.
//
// Rafael (15-nov-2026): «no puedo ver los ingresos de barbería, el que pagó
// $749». La portada sólo sabía del dental. Esta tarjeta pone a Barberías como
// una línea PROPIA, al lado del dental y sin mezclarse con él: las cifras del
// dental llegan tal cual las calcula la portada (las mismas de la tarjeta
// «MRR») y las de barber salen de src/lib/barber/admin-ingresos.ts, el mismo
// cálculo que /admin/barberias.
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { Cifra, Tarjeta } from "@/components/admin/rediseno/piezas";
import type { ResumenIngresosBarber } from "@/lib/barber/admin-ingresos";

function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`;
}

export function TarjetaIngresosPorLinea({
  dentalMrr,
  dentalCobradoMes,
  barberias,
}: {
  /** MRR del dental: planes + módulos (lo mismo que enseña la tarjeta «MRR»). */
  dentalMrr: number;
  /** Cobrado este mes en subscription_invoices; null = no se pudo leer. */
  dentalCobradoMes: number | null;
  /** null = no se pudo medir barber: se pinta «—», nunca $0. */
  barberias: ResumenIngresosBarber | null;
}) {
  const barberMrr = barberias ? Number(barberias.mrr) : null;
  return (
    <Tarjeta
      title="Ingreso mensual por línea"
      sub="Ingreso mensual recurrente de cada línea con sus propias cifras: Barberías no toca las del dental"
      action={<Link href="/admin/barberias" className="dcp-enlace">Barberías <ArrowUpRight size={13} /></Link>}
    >
      <div className="dcp-cifras" data-ingresos-lineas>
        <Cifra
          label="Dental"
          n={formatCurrency(dentalMrr)}
          tono="brand"
          pie={`planes + módulos · cobrado este mes ${dentalCobradoMes === null ? "—" : formatCurrency(dentalCobradoMes)}`}
        />
        <Cifra
          label="Barberías"
          n={barberMrr === null ? "—" : formatCurrency(barberMrr)}
          tono="success"
          pie={
            barberias
              ? `${plural(barberias.pagan, "paga", "pagan")} por Stripe · ${plural(barberias.cortesia, "cortesía", "cortesías")} y ${barberias.sinPagar} sin pagar no suman · cobrado este mes: sin registro`
              : "no se pudieron leer las barberías"
          }
        />
        <Cifra
          label="Total"
          n={barberMrr === null ? "—" : formatCurrency(dentalMrr + barberMrr)}
          pie="dental + barberías"
        />
      </div>
    </Tarjeta>
  );
}
