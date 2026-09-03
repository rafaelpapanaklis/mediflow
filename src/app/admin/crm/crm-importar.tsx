"use client";

// ═══════════════════════════════════════════════════════════════════════
// Importar pegando — la forma rápida de llenar la libreta.
//
// Se pega lo que sea: una hoja de cálculo, una búsqueda de Google Maps
// copiada, una lista escrita a mano. El lector (crmLeerImportacion) NO
// asume el orden de las columnas: clasifica cada celda por lo que ES —
// correo, teléfono, nombre— y la pantalla enseña la tabla resultante ANTES
// de guardar. Así un error de lectura se ve aquí y no se descubre en la
// base tres semanas después, cuando toque marcar.
//
// Lo que NUNCA hace: pisar. Un prospecto que ya está en la lista se cuenta
// como repetido y se deja intacto, con su etapa y su bitácora.
// ═══════════════════════════════════════════════════════════════════════
import { useMemo, useState, useTransition } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, X } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import {
  crmLeerImportacion,
  crmTelefonoLegible,
  CRM_ETAPAS,
  CRM_FUENTES,
  CRM_IMPORT_MAX,
  CRM_VERTICALES,
} from "@/lib/admin/crm/crm-core";
import { importarAccion } from "./actions";

const EJEMPLO = `Clínica Dental Sonrisa\t5512345678\tPuebla
Odontología Integral del Valle, 8112345678, Monterrey, hola@integral.mx
Universidad Cuauhtémoc — Facultad de Odontología\t2223456789\tPuebla`;

export function CrmImportar({ alCerrar }: { alCerrar: () => void }) {
  const [texto, setTexto] = useState("");
  const [vertical, setVertical] = useState("DENTAL");
  const [source, setSource] = useState("GOOGLE_MAPS");
  const [stage, setStage] = useState("NUEVO");
  const [pendiente, startTransition] = useTransition();

  const lectura = useMemo(() => crmLeerImportacion(texto), [texto]);
  const hay = lectura.filas.length;

  function importar() {
    if (hay === 0) {
      toast.error("Todavía no hay nada legible que importar.");
      return;
    }
    startTransition(async () => {
      const r = await importarAccion(lectura.filas, { vertical, source, stage });
      if (!r.ok) {
        toast.error(r.error ?? "No se pudo importar.");
        return;
      }
      toast.success(r.mensaje ?? "Listo.");
      alCerrar();
    });
  }

  return (
    <div className="modal-overlay" onClick={alCerrar}>
      <div
        className="modal modal--full"
        role="dialog"
        aria-modal="true"
        aria-labelledby="crm-import-titulo"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <div className="modal__title" id="crm-import-titulo">
            Importar prospectos pegando
          </div>
          <ButtonNew
            size="sm"
            variant="ghost"
            icon={<X size={14} />}
            onClick={alCerrar}
            aria-label="Cerrar"
          />
        </div>

        <div className="modal__body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <p style={{ fontSize: 12.5, color: "var(--text-2)", margin: 0, maxWidth: 760 }}>
            Pega una línea por negocio. No importa el orden de las columnas: lo que parezca correo
            se lee como correo y lo que traiga 10 dígitos, como teléfono. Si la primera línea trae
            encabezados (<code>nombre</code>, <code>teléfono</code>, <code>ciudad</code>…), se usan.
            Máximo {CRM_IMPORT_MAX} por pegada.
          </p>

          <div className="field-new">
            <label className="field-new__label" htmlFor="crm-import-texto">
              Lo que pegaste
            </label>
            <textarea
              id="crm-import-texto"
              className="input-new"
              style={{
                height: "auto",
                minHeight: 130,
                padding: "10px 12px",
                lineHeight: 1.5,
                resize: "vertical",
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 11.5,
              }}
              placeholder={EJEMPLO}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <div className="field-new">
              <label className="field-new__label" htmlFor="crm-import-vertical">
                Giro de todos
              </label>
              <select
                id="crm-import-vertical"
                className="input-new"
                value={vertical}
                onChange={(e) => setVertical(e.target.value)}
              >
                {CRM_VERTICALES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-new">
              <label className="field-new__label" htmlFor="crm-import-source">
                De dónde salieron
              </label>
              <select
                id="crm-import-source"
                className="input-new"
                value={source}
                onChange={(e) => setSource(e.target.value)}
              >
                {CRM_FUENTES.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-new">
              <label className="field-new__label" htmlFor="crm-import-stage">
                Etapa de arranque
              </label>
              <select
                id="crm-import-stage"
                className="input-new"
                value={stage}
                onChange={(e) => setStage(e.target.value)}
              >
                {CRM_ETAPAS.filter((e) => !e.terminal).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* ── Lo que se va a dar de alta ───────────────────────────── */}
          {texto.trim() !== "" && (
            <div>
              <div className="form-section__title">
                Así se van a guardar ({hay})
                <span className="form-section__rule" />
              </div>
              {hay === 0 ? (
                <p style={{ fontSize: 12.5, color: "var(--text-3)", margin: 0 }}>
                  No se distingue ningún nombre de negocio en lo que pegaste.
                </p>
              ) : (
                <div
                  style={{
                    maxHeight: 260,
                    overflow: "auto",
                    border: "1px solid var(--border-soft)",
                    borderRadius: 8,
                  }}
                >
                  <table className="table-new">
                    <thead>
                      <tr>
                        <th>Negocio</th>
                        <th>Contacto</th>
                        <th>Teléfono</th>
                        <th>Correo</th>
                        <th>Ciudad</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lectura.filas.map((f, i) => (
                        <tr key={`${f.name}-${i}`}>
                          <td style={{ fontWeight: 500 }}>{f.name}</td>
                          <td style={{ color: "var(--text-3)" }}>{f.contactName ?? "—"}</td>
                          <td className="mono" style={{ color: f.phone ? "var(--text-2)" : "var(--text-4)" }}>
                            {f.phone ? crmTelefonoLegible(f.phone) : "—"}
                          </td>
                          <td style={{ color: "var(--text-3)" }}>{f.email ?? "—"}</td>
                          <td style={{ color: "var(--text-3)" }}>{f.city ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {lectura.ignoradas.length > 0 && (
                <div
                  style={{
                    marginTop: 10,
                    padding: "8px 10px",
                    borderRadius: 8,
                    background: "var(--warning-soft)",
                    border: "1px solid var(--border-soft)",
                    fontSize: 11.5,
                    color: "var(--text-2)",
                  }}
                >
                  <AlertTriangle size={12} style={{ verticalAlign: "-2px", marginRight: 5 }} />
                  {lectura.ignoradas.length}{" "}
                  {lectura.ignoradas.length === 1 ? "línea se salta" : "líneas se saltan"}:{" "}
                  {lectura.ignoradas
                    .slice(0, 3)
                    .map((x) => `"${x.linea.slice(0, 40)}" (${x.motivo})`)
                    .join(" · ")}
                  {lectura.ignoradas.length > 3 && " …"}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal__footer">
          <span style={{ fontSize: 11.5, color: "var(--text-3)", marginRight: "auto" }}>
            Los que ya estén en la lista (mismo nombre o mismo teléfono) se dejan como están.
          </span>
          <ButtonNew variant="ghost" onClick={alCerrar} disabled={pendiente}>
            Cancelar
          </ButtonNew>
          <ButtonNew variant="primary" onClick={importar} disabled={pendiente || hay === 0}>
            {pendiente ? "Importando…" : `Dar de alta ${hay || ""}`.trim()}
          </ButtonNew>
        </div>
      </div>
    </div>
  );
}
