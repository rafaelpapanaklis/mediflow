import { AgendaSkeleton } from "@/components/dashboard/loading-skeletons";
import { EsqueletoSegunBandera } from "@/components/dashboard/esqueletos-rediseno/segun-bandera";
import { EsqueletoAgenda } from "@/components/dashboard/esqueletos-rediseno/esqueletos";

export default function Loading() {
  return <EsqueletoSegunBandera viejo={<AgendaSkeleton />} nuevo={<EsqueletoAgenda />} />;
}
