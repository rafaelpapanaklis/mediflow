import { PatientDetailSkeleton } from "@/components/dashboard/loading-skeletons";
import { EsqueletoSegunBandera } from "@/components/dashboard/esqueletos-rediseno/segun-bandera";
import { EsqueletoExpediente } from "@/components/dashboard/esqueletos-rediseno/esqueletos";

export default function Loading() {
  return <EsqueletoSegunBandera viejo={<PatientDetailSkeleton />} nuevo={<EsqueletoExpediente />} />;
}
