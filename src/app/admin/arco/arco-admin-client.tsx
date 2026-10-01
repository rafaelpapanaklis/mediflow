"use client";

import { useState } from "react";
import toast from "react-hot-toast";

type Estado = "PENDING" | "IN_PROGRESS" | "RESOLVED" | "REJECTED";
type Tipo = "ACCESS" | "RECTIFICATION" | "CANCELLATION" | "OPPOSITION";

interface Fila {
  id: string;
  type: Tipo;
  email: string;
  reason: string;
  status: Estado;
  resolvedNotes: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

const TIPO: Record<Tipo, string> = {
  ACCESS: "Acceso",
  RECTIFICATION: "Rectificación",
  CANCELLATION: "Cancelación",
  OPPOSITION: "Oposición",
};
const ESTADO: Record<Estado, string> = {
  PENDING: "Pendiente",
  IN_PROGRESS: "En proceso",
  RESOLVED: "Resuelta",
  REJECTED: "Rechazada",
};
const TONO: Record<Estado, string> = {
  PENDING: "warning",
  IN_PROGRESS: "info",
  RESOLVED: "success",
  REJECTED: "danger",
};

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });

export function ArcoAdminClient({ initial }: { initial: Fila[] }) {
  const [filas, setFilas] = useState(initial);
  const [editando, setEditando] = useState<Fila | null>(null);
  const [estado, setEstado] = useState<Estado>("PENDING");
  const [notas, setNotas] = useState("");
  const [guardando, setGuardando] = useState(false);

  function abrir(f: Fila) {
    setEditando(f);
    setEstado(f.status);
    setNotas(f.resolvedNotes ?? "");
  }

  async function guardar() {
    if (!editando) return;
    setGuardando(true);
    try {
      const res = await fetch(`/api/admin/arco/${editando.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: estado, resolvedNotes: notas }),
      });
      if (!res.ok) throw new Error();
      const u = await res.json();
      setFilas((fs) =>
        fs.map((f) =>
          f.id === editando.id
            ? { ...f, status: u.status, resolvedNotes: u.resolvedNotes ?? null, resolvedAt: u.resolvedAt ?? null }
            : f,
        ),
      );
      setEditando(null);
      toast.success("Solicitud actualizada");
    } catch {
      toast.error("No se pudo guardar la solicitud");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-1)", letterSpacing: "-0.02em" }}>
          Solicitudes ARCO
        </h1>
        <p style={{ fontSize: 14, color: "var(--text-3)", marginTop: 2 }}>
          Solicitudes anónimas (sin clínica) que llegan del aviso de privacidad. Las atiende la plataforma; las de
          cada clínica las atiende su propia clínica. Plazo legal: 20 días hábiles (LFPDPPP art. 32).
        </p>
      </header>

      {filas.length === 0 ? (
        <div style={{ padding: 20, background: "var(--bg-elev)", border: "1px solid var(--border-soft)", borderRadius: 10, fontSize: 13, color: "var(--text-3)" }}>
          No hay solicitudes anónimas.
        </div>
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table className="table-new">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Correo</th>
                  <th>Motivo</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.id}>
                    <td style={{ whiteSpace: "nowrap", color: "var(--text-3)" }}>{fecha(f.createdAt)}</td>
                    <td><strong style={{ fontWeight: 600 }}>{TIPO[f.type]}</strong></td>
                    <td><code className="mono" style={{ fontSize: 12 }}>{f.email}</code></td>
                    <td>
                      <div style={{ maxWidth: 360, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--text-2)" }}>
                        {f.reason}
                      </div>
                    </td>
                    <td>
                      <span className={`badge-new badge-new--${TONO[f.status]}`}>
                        <span className="badge-new__dot" />
                        {ESTADO[f.status]}
                      </span>
                    </td>
                    <td>
                      <button type="button" onClick={() => abrir(f)} className="btn-new btn-new--secondary btn-new--sm">
                        Gestionar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editando && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          onClick={(e) => { if (e.target === e.currentTarget) setEditando(null); }}
        >
          <div className="modal">
            <div className="modal__header">
              <h3 className="modal__title">{TIPO[editando.type]} · {editando.email}</h3>
            </div>
            <div className="modal__body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="field-new">
                <span className="field-new__label">Motivo del solicitante</span>
                <p style={{ padding: 10, background: "var(--bg-elev-2)", borderRadius: "var(--radius-sm)", fontSize: 13, whiteSpace: "pre-wrap", color: "var(--text-2)" }}>
                  {editando.reason}
                </p>
              </div>
              <div className="field-new">
                <span className="field-new__label">Estado</span>
                <select className="input-new" value={estado} onChange={(e) => setEstado(e.target.value as Estado)}>
                  {(Object.keys(ESTADO) as Estado[]).map((k) => (
                    <option key={k} value={k}>{ESTADO[k]}</option>
                  ))}
                </select>
              </div>
              <div className="field-new">
                <span className="field-new__label">Notas internas</span>
                <textarea
                  className="input-new"
                  value={notas}
                  onChange={(e) => setNotas(e.target.value.slice(0, 4000))}
                  rows={5}
                  style={{ height: "auto", resize: "vertical" }}
                />
              </div>
            </div>
            <div className="modal__footer">
              <button type="button" onClick={() => setEditando(null)} className="btn-new btn-new--secondary">
                Cancelar
              </button>
              <button type="button" onClick={guardar} disabled={guardando} className="btn-new btn-new--primary">
                {guardando ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
