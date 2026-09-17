import { ListSkeleton } from "@/components/dashboard/loading-skeletons";
import { EsqueletoSegunBandera } from "@/components/dashboard/esqueletos-rediseno/segun-bandera";
import { EsqueletoLista } from "@/components/dashboard/esqueletos-rediseno/esqueletos";

export default function Loading() {
  return <EsqueletoSegunBandera viejo={<ListSkeleton rows={10} />} nuevo={<EsqueletoLista variante="pacientes" filas={10} />} />;
}
