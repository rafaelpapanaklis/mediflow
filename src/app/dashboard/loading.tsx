import { DashboardSkeleton } from "@/components/dashboard/loading-skeletons";
import { EsqueletoSegunBandera } from "@/components/dashboard/esqueletos-rediseno/segun-bandera";
import { EsqueletoHoy } from "@/components/dashboard/esqueletos-rediseno/esqueletos";

// Es también el esqueleto de toda ruta de /dashboard sin loading.tsx propio.
export default function Loading() {
  return <EsqueletoSegunBandera viejo={<DashboardSkeleton />} nuevo={<EsqueletoHoy />} />;
}
