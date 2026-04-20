"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { useRouter } from "next/navigation";
import { AlertTriangle, X, Trash2 } from "lucide-react";

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 overflow-y-auto"
      onClick={() => (deleting ? null : onClose())}
    >
      <div
        className="relative my-8 w-full max-w-xl rounded-2xl bg-slate-900 border-2 border-red-500 shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-red-500/40 bg-red-950/60 rounded-t-2xl">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-red-400" />
            <h2 className="text-lg font-extrabold text-red-300">Eliminar clínica</h2>
          </div>
          <button
            disabled={deleting}
            onClick={onClose}
            className="p-1 text-red-300 hover:text-white disabled:opacity-40"
            aria-label="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {!canDelete ? (
            <div className="rounded-xl bg-amber-950/50 border border-amber-700 p-4 text-sm text-amber-200">
              {reason ?? "Esta clínica no se puede eliminar en este momento."}
            </div>
          ) : (
            <>
              <div className="rounded-xl bg-red-950/60 border border-red-700/60 p-4 space-y-2">
                <p className="text-sm font-bold text-red-200">
                  Esta acción es IRREVERSIBLE.
                </p>
                <p className="text-sm text-red-100 leading-relaxed">
                  Se eliminarán TODOS los datos de <span className="font-bold">{clinicName}</span>: pacientes,
                  citas, expedientes, facturas, radiografías, usuarios, pagos de suscripción, cupones usados, notas,
                  análisis IA y cualquier archivo subido al storage.
                </p>
              </div>

              <div className="rounded-xl bg-slate-800/60 border border-slate-700 p-4">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3">
                  Datos que se perderán ({total.toLocaleString()} registros + archivos de storage)
                </div>
                <ul className="grid grid-cols-2 gap-2 text-sm">
                  <li className="flex justify-between"><span className="text-slate-400">Usuarios</span>       <span className="font-bold text-white">{counts.users}</span></li>
                  <li className="flex justify-between"><span className="text-slate-400">Pacientes</span>      <span className="font-bold text-white">{counts.patients}</span></li>
                  <li className="flex justify-between"><span className="text-slate-400">Citas</span>          <span className="font-bold text-white">{counts.appointments}</span></li>
                  <li className="flex justify-between"><span className="text-slate-400">Expedientes</span>    <span className="font-bold text-white">{counts.records}</span></li>
                  <li className="flex justify-between"><span className="text-slate-400">Facturas</span>       <span className="font-bold text-white">{counts.invoices}</span></li>
                  <li className="flex justify-between"><span className="text-slate-400">Archivos (radiografías + fotos)</span> <span className="font-bold text-white">{counts.files}</span></li>
                </ul>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-300">
                  Escribe <code className="font-mono font-black text-red-400">{CONFIRM_WORD}</code> para confirmar
                </label>
                <input
                  type="text"
                  autoFocus
                  disabled={deleting}
                  value={confirmText}
                  onChange={e => setConfirmText(e.target.value)}
                  placeholder={`Escribe ${CONFIRM_WORD} para confirmar`}
                  className="w-full bg-slate-800 border-2 border-red-700/60 focus:border-red-500 text-white font-mono tracking-wider text-sm rounded-lg px-3 py-2.5 focus:outline-none disabled:opacity-40"
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-slate-800 bg-slate-950/40 rounded-b-2xl">
          <button
            disabled={deleting}
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-bold disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            disabled={!canSubmit}
            onClick={handleDelete}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-4 h-4" />
            {deleting ? "Eliminando…" : "Confirmar eliminación"}
          </button>
        </div>
      </div>
    </div>
  );
}
