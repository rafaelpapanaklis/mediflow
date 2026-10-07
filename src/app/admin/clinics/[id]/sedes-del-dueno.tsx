import Link from "next/link";
import { bytesCortos } from "@/lib/admin/uso-core";

export interface SedeDeDueno {
  id: string;
  name: string;
  plan: string;
  status: string | null;
  /** Sede incluida en el plan de la clínica principal (no paga aparte). */
  incluida: boolean;
  esEsta: boolean;
  pacientes: number;
  bytes: number | null;
}

/**
 * «Sedes de este dueño»: la principal y sus sedes con estado y uso, cada una con enlace a su ficha.
 * En la ficha de una sede, enlace a la principal que la paga. Solo lectura.
 */
export function SedesDelDueno({ sedes, principal }: { sedes: SedeDeDueno[]; principal: { id: string; name: string } | null }) {
  if (sedes.length < 2 && !principal) return null;
  return (
    <section className="dcp-card" aria-label="Sedes de este dueño" data-sedes-del-dueno style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <h3 style={{ margin: 0, fontSize: 15 }}>Sedes de este dueño</h3>
      {principal && (
        <p style={{ margin: 0, fontSize: 13 }}>
          Sede incluida en el plan de <Link href={`/admin/clinics/${principal.id}`}><strong>{principal.name}</strong></Link>, que es quien paga.
        </p>
      )}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {sedes.map((s) => (
          <li key={s.id} style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", alignItems: "baseline", fontSize: 13 }}>
            {s.esEsta ? <strong>{s.name} (esta)</strong> : <Link href={`/admin/clinics/${s.id}`}>{s.name}</Link>}
            <span>{s.plan}</span>
            <span>{s.incluida ? "Sede incluida" : s.status === "active" ? "Pagando" : (s.status ?? "sin estado")}</span>
            <span>{s.pacientes} pacientes</span>
            <span>{s.bytes === null ? "uso sin medir" : bytesCortos(s.bytes)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
