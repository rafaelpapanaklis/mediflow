import { ListSkeleton } from "@/components/dashboard/loading-skeletons";
import { EsqueletoSegunBandera } from "@/components/dashboard/esqueletos-rediseno/segun-bandera";
import { EsqueletoLista } from "@/components/dashboard/esqueletos-rediseno/esqueletos";

// /dashboard/billing redirige a Caja: con la bandera, la forma es la de Caja.
export default function Loading() {
  return <EsqueletoSegunBandera viejo={<ListSkeleton rows={8} />} nuevo={<EsqueletoLista variante="caja" filas={8} />} />;
}
