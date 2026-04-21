"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { useRouter } from "next/navigation";
import { AlertTriangle, X, Trash2 } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";

interface Counts {
  users:        number;
  patients:     number;
  appointments: number;
  records:      number;
  invoices:     number;
  files:        number;
}

interface Props {
  clinicId:   string;
  clinicName: string;
  counts:     Counts;
  canDelete:  boolean;  // false si es la única clínica del sistema
  reason?:    string;   // razón cuando canDelete = false
  onClose:    () => void;
}

const CONFIRM_WORD = "ELIMINAR";

export function DeleteClinicModal({ clinicId, clinicName, counts, canDelete, reason, onClose }: Props) {
  const router = useRouter();
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting]       = useState(false);

  const canSubmit = canDelete && confirmText === CONFIRM_WORD && !deleting;

  async function handleDelete() {
    if (!canSubmit) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/clinics/${clinicId}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      toast.success("Clínica eliminada");
      if (data.storageErrors > 0) {
        toast(`${data.storageErrors} archivo(s) de storage no se pudieron borrar`, { icon: "⚠️" });
      }
      router.push("/admin/clinics");
      router.refresh();
    } catch (e: any) {
      toast.error(e.message ?? "Error al eliminar");
      setDeleting(false);
    }
  }

  const total =
    counts.users + counts.patients + counts.appointments + counts.records + counts.invoices + counts.files;

  const countRows: Array<[string, number]> = [
    ["Usuarios", counts.users],
    ["Pacientes", counts.patients],
    ["Citas", counts.appointments],
    ["Expedientes", counts.records],
    ["Facturas", counts.invoices],
    ["Archivos (radiografías + fotos)", counts.files],
  ];

  return (
    <div className="modal-overlay" onClick={() => (deleting ? null : onClose())}>
      <div
        className="modal"
        onClick={e => e.stopPropagation()}
        style={{
          borderColor: "rgba(239,68,68,0.3)",
          boxShadow: "0 20px 50px -10px rgba(0,0,0,0.6), 0 0 20px rgba(239,68,68,0.15)",
        }}
      >
        <div className="modal__header" style={{ borderBottomColor: "rgba(239,68,68,0.2)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: "rgba(239,68,68,0.12)",
              display: "grid", placeItems: "center",
              color: "var(--danger)",
            }}>
              <AlertTriangle size={16} />
            </div>
            <div>
              <div className="modal__title" style={{ color: "var(--danger)" }}>Eliminar clínica</div>
              <div style={{ fontSize: 11, color: "var(--text-3)" }}>Esta acción es irreversible</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="btn-new btn-new--ghost btn-new--sm"
            aria-label="Cerrar"
          >
            <X size={14} />
          </button>
        </div>

        <div className="modal__body">
          {!canDelete ? (
            <div style={{
              padding: 14,
              background: "rgba(245,158,11,0.08)",
              border: "1px solid rgba(245,158,11,0.3)",
              borderRadius: 10,
              fontSize: 13,
              color: "var(--text-2)",
            }}>
              {reason ?? "Esta clínica no se puede eliminar en este momento."}
            </div>
          ) : (
            <>
              <div style={{
                padding: 12,
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.2)",
                borderRadius: 10,
                marginBottom: 14,
                fontSize: 12,
                color: "var(--text-2)",
                lineHeight: 1.6,
              }}>
                <strong style={{ color: "var(--danger)" }}>Se eliminarán permanentemente:</strong>{" "}
                Todos los datos de <span style={{ fontWeight: 700, color: "var(--text-1)" }}>{clinicName}</span>:
                pacientes, citas, expedientes, facturas, radiografías, usuarios, pagos de suscripción, cupones
                usados, notas, análisis IA y cualquier archivo subido al storage.
              </div>

              <div style={{
                padding: 12,
                background: "var(--bg-elev-2)",
                border: "1px solid var(--border-soft)",
                borderRadius: 10,
                marginBottom: 14,
              }}>
                <div style={{
                  fontSize: 10,
                  color: "var(--text-3)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  fontWeight: 700,
                  marginBottom: 10,
                }}>
                  Datos que se perderán ({total.toLocaleString()} registros + archivos de storage)
                </div>
                <ul style={{
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 8,
                  fontSize: 13,
                }}>
                  {countRows.map(([label, value]) => (
                    <li key={label} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ color: "var(--text-3)" }}>{label}</span>
                      <span style={{ fontWeight: 700, color: "var(--text-1)" }}>{value}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="field-new">
                <label className="field-new__label">
                  Escribe{" "}
                  <strong className="mono" style={{ color: "var(--danger)" }}>{CONFIRM_WORD}</strong>{" "}
                  para confirmar
                </label>
                <input
                  type="text"
                  autoFocus
                  disabled={deleting}
                  value={confirmText}
                  onChange={e => setConfirmText(e.target.value)}
                  placeholder={`Escribe ${CONFIRM_WORD} para confirmar`}
                  className="input-new mono"
                />
              </div>
            </>
          )}
        </div>

        <div className="modal__footer">
          <ButtonNew variant="ghost" onClick={onClose} disabled={deleting}>
            Cancelar
          </ButtonNew>
          <ButtonNew
            variant="danger"
            disabled={!canSubmit}
            onClick={handleDelete}
            icon={<Trash2 size={14} />}
          >
            {deleting ? "Eliminando…" : "Confirmar eliminación"}
          </ButtonNew>
        </div>
      </div>
    </div>
  );
}
