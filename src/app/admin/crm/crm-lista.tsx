"use client";

// ═══════════════════════════════════════════════════════════════════════
// La vista de lista: la misma información del tablero, pero comparable
// entre sí y accesible con teclado (la etapa se cambia con un selector,
// no arrastrando).
//
// Es también la salida cuando una columna del tablero tiene más tarjetas
// de las que conviene pintar: desde ahí se llega aquí ya filtrado.
// ═══════════════════════════════════════════════════════════════════════
import Link from "next/link";
import {
  crmDiasSinContacto,
  crmTelefonoLegible,
  crmVertical,
  CRM_DIAS_PARA_ENFRIARSE,
} from "@/lib/admin/crm/crm-core";
import type { CrmProspectoDTO } from "@/lib/admin/crm/service";
import {
  CrmAccionesContacto,
  CrmAccionesFila,
  CrmAvatar,
  CrmEtapaSelect,
  CrmOrigenChip,
  CrmSemaforoChip,
  CrmVerticalChip,
  crmFmtMxn,
} from "./crm-ui";

export function CrmLista({
  filas,
  ahora,
  mover,
  alEditar,
  alTextos,
}: {
  filas: CrmProspectoDTO[];
  ahora: Date;
  mover: (id: string, etapa: string) => void;
  /** Abre el formulario EN SITIO, sin salir de la lista (ver crm-client). */
  alEditar: (p: CrmProspectoDTO) => void;
  alTextos?: (p: CrmProspectoDTO) => void;
}) {
  if (filas.length === 0) {
    return (
      <div style={{ padding: "44px 18px", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
        Ningún prospecto coincide con lo que buscas.
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="table-new">
        <thead>
          <tr>
            <th>Negocio</th>
            <th>Contacto</th>
            <th style={{ width: 160 }}>Etapa</th>
            <th>Próximo paso</th>
            <th style={{ textAlign: "right" }}>Sin contacto</th>
            <th style={{ textAlign: "right" }}>Valor / mes</th>
            <th>Contactar</th>
            <th style={{ width: 210 }}>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((p) => {
            const dias = crmDiasSinContacto(p.lastContactAt, ahora);
            const v = crmVertical(p.vertical);
            return (
              <tr key={p.id}>
                <td>
                  <div style={{ display: "flex", gap: 9, alignItems: "center", minWidth: 0 }}>
                    <CrmAvatar name={p.name} vertical={p.vertical} size={30} />
                    <div style={{ minWidth: 0 }}>
                      <Link
                        href={`/admin/crm/${p.id}`}
                        className="crm-tarjeta-nombre"
                        style={{
                          color: "var(--text-1)",
                          fontWeight: 600,
                          textDecoration: "none",
                          display: "block",
                        }}
                      >
                        {p.name}
                      </Link>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <CrmVerticalChip vertical={p.vertical} />
                        {(p.city || p.state || p.country) && (
                          <span style={{ fontSize: 11, color: "var(--text-4)" }}>
                            {[p.city, p.state, p.country].filter(Boolean).join(", ")}
                          </span>
                        )}
                        {p.size ? (
                          <span style={{ fontSize: 11, color: "var(--text-4)" }}>
                            {p.size} {v.medida.toLowerCase()}
                          </span>
                        ) : null}
                        <CrmOrigenChip p={p} />
                      </div>
                    </div>
                  </div>
                </td>

                <td style={{ color: "var(--text-2)" }}>
                  {p.contactName && (
                    <div style={{ fontSize: 12 }}>
                      {p.contactName}
                      {p.contactRole && (
                        <span style={{ color: "var(--text-4)" }}> · {p.contactRole}</span>
                      )}
                    </div>
                  )}
                  <div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
                    {p.phone ? crmTelefonoLegible(p.phone) : "sin teléfono"}
                  </div>
                  {p.email && (
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text-4)",
                        maxWidth: 190,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={p.email}
                    >
                      {p.email}
                    </div>
                  )}
                </td>

                <td>
                  <CrmEtapaSelect stage={p.stage} mover={(etapa) => mover(p.id, etapa)} />
                </td>

                <td style={{ maxWidth: 260 }}>
                  <CrmSemaforoChip fecha={p.nextActionAt} nota={p.nextActionNote} ahora={ahora} />
                </td>

                {/* Los días sin contacto se tiñen a partir del umbral de
                    "enfriándose": un 21 en gris se lee igual que un 2, y es
                    justo la diferencia que hace que un prospecto se pierda. */}
                <td
                  className="mono"
                  style={{
                    textAlign: "right",
                    color:
                      dias !== null && dias >= CRM_DIAS_PARA_ENFRIARSE
                        ? "var(--warning)"
                        : "var(--text-3)",
                    fontWeight: dias !== null && dias >= CRM_DIAS_PARA_ENFRIARSE ? 600 : 400,
                  }}
                >
                  {dias === null ? (
                    <span style={{ color: "var(--text-4)" }}>nunca</span>
                  ) : dias === 0 ? (
                    "hoy"
                  ) : (
                    `${dias} d`
                  )}
                </td>

                <td className="mono" style={{ textAlign: "right", color: "var(--text-2)", fontWeight: 600 }}>
                  {p.monthlyValue ? crmFmtMxn(p.monthlyValue) : "—"}
                </td>

                <td>
                  <CrmAccionesContacto p={p} soloIconos />
                </td>

                <td>
                  <CrmAccionesFila p={p} alEditar={alEditar} alTextos={alTextos} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
