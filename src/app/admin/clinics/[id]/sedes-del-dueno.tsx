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
      <ul className="dcp-sedes-lista">
        {sedes.map((s) => {
          const estado = s.incluida ? "Sede incluida" : s.status === "active" ? "Pagando" : (s.status ?? "sin estado");
          const tono = s.incluida ? "badge-new badge-new--info" : s.status === "active" ? "badge-new badge-new--success" : "badge-new";
          const contenido = (
            <>
              <span className="dcp-sedes-fila__nombre">{s.name}{s.esEsta ? " (esta)" : ""}</span>
              <span className="dcp-suave">{s.plan}</span>
              <span className={tono}>{estado}</span>
              <span className="dcp-suave">{s.pacientes} pacientes</span>
              <span className="dcp-suave">{s.bytes === null ? "uso sin medir" : bytesCortos(s.bytes)}</span>
              {!s.esEsta && <span className="dcp-sedes-fila__ir" aria-hidden="true">Abrir →</span>}
            </>
          );
          return (
            <li key={s.id}>
              {s.esEsta ? (
                <div className="dcp-sedes-fila dcp-sedes-fila--esta" aria-current="page">{contenido}</div>
              ) : (
                <Link href={`/admin/clinics/${s.id}`} className="dcp-sedes-fila" aria-label={`Abrir la ficha de ${s.name}`}>{contenido}</Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
