"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Loader2, ShieldAlert, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/i18n/i18n-provider";

/** Espejo de PatientDeleteBlocker (@/lib/patient-deletion) del lado cliente. */
interface DeleteBlocker {
  type: string;
  count: number;
}

interface DeletePatientModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: { id: string; firstName: string; lastName: string; patientNumber: string };
}

/**
 * Modal de "Eliminar paciente" con DOS salidas, porque borrar de verdad no
 * siempre se puede (y casi nunca conviene):
 *
 *   · Archivar — seguro y siempre disponible. Sale de la lista activa pero
 *     conserva todo el expediente.
 *   · Eliminar definitivamente — borra la fila. Exige escribir la palabra de
 *     confirmación y solo procede si el paciente no tiene facturación ni
 *     registros clínicos que obliguen a conservarlo.
 *
 * El precheck (GET .../deletable) es solo para poder explicar el bloqueo de
 * entrada; la autoridad es el 409 del DELETE, que también se maneja aquí.
 */
export function DeletePatientModal({ open, onOpenChange, patient }: DeletePatientModalProps) {
  const t = useT();
  const router = useRouter();
  const fullName = `${patient.firstName} ${patient.lastName}`.trim();
  const confirmWord = t("patients.deleteModal.confirmWord");

  const [checking, setChecking] = useState(true);
  const [blockers, setBlockers] = useState<DeleteBlocker[] | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState<"archive" | "delete" | null>(null);

  // Precheck al abrir. Se resetea todo en cada apertura para no arrastrar el
  // estado de una sesión anterior del modal (texto tecleado incluido).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setTyped("");
    setBusy(null);
    setBlockers(null);
    setChecking(true);
    fetch(`/api/patients/${patient.id}/deletable`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data) => {
        if (!cancelled) setBlockers(Array.isArray(data?.reasons) ? data.reasons : []);
      })
      .catch(() => {
        // Si el precheck falla no bloqueamos la UI: se deja intentar y que el
        // DELETE conteste con la verdad (409 o borrado).
        if (!cancelled) setBlockers([]);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => { cancelled = true; };
  }, [open, patient.id]);

  const isBlocked = (blockers?.length ?? 0) > 0;
  const canConfirm = typed.trim().toUpperCase() === confirmWord.toUpperCase();

  function reasonText(b: DeleteBlocker): string {
    // Lenguaje humano, sin nombres de tabla. `related` es el comodín del
    // servidor cuando revienta una FK que el precheck no anticipó.
    const key = `patients.deleteModal.reasons.${b.type}`;
    const text = t(key, { count: b.count });
    // `t` devuelve la propia llave cuando falta: si el servidor manda un tipo
    // nuevo, cae al mensaje genérico en vez de escupir "patients.deleteModal…".
    return text === key ? t("patients.deleteModal.reasons.related") : text;
  }

  async function archive() {
    setBusy("archive");
    try {
      const res = await fetch(`/api/patients/${patient.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ARCHIVED" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? t("patients.deleteModal.archiveError"));
      }
      toast.success(t("patients.deleteModal.archivedToast", { name: fullName }));
      onOpenChange(false);
      router.push("/dashboard/patients");
      router.refresh();
    } catch (err: any) {
      toast.error(err?.message ?? t("patients.deleteModal.archiveError"));
    } finally {
      setBusy(null);
    }
  }

  async function hardDelete() {
    if (!canConfirm) return;
    setBusy("delete");
    try {
      const res = await fetch(`/api/patients/${patient.id}?mode=hard`, { method: "DELETE" });
      if (res.status === 409) {
        // El servidor tiene la última palabra: puede haberse creado una factura
        // entre el precheck y este clic.
        const data = await res.json().catch(() => ({}));
        setBlockers(Array.isArray(data?.reasons) ? data.reasons : [{ type: "related", count: 0 }]);
        setTyped("");
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? t("patients.deleteModal.deleteError"));
      }
      toast.success(t("patients.deleteModal.deletedToast", { name: fullName }));
      onOpenChange(false);
      router.push("/dashboard/patients");
      router.refresh();
    } catch (err: any) {
      toast.error(err?.message ?? t("patients.deleteModal.deleteError"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="pr-8">
            {t("patients.deleteModal.title", { name: fullName })}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 px-6 pb-2 space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("patients.deleteModal.intro", { number: patient.patientNumber })}
          </p>

          {/* Opción segura — siempre disponible. */}
          <div className="rounded-[var(--radius)] border border-border p-4">
            <div className="flex items-start gap-2.5">
              <Archive className="w-4 h-4 mt-0.5 shrink-0 text-[var(--text-3)]" strokeWidth={1.75} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-foreground">
                  {t("patients.deleteModal.archiveTitle")}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("patients.deleteModal.archiveHint")}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={archive}
                  disabled={busy !== null}
                >
                  {busy === "archive" ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Archive className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden />
                  )}
                  {t("patients.deleteModal.archiveAction")}
                </Button>
              </div>
            </div>
          </div>

          {/* Opción destructiva — bloqueada, cargando o con confirmación fuerte. */}
          <div className="rounded-[var(--radius)] border border-[color-mix(in_srgb,var(--danger)_28%,transparent)] bg-[var(--danger-soft)] p-4">
            <div className="flex items-start gap-2.5">
              <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0 text-[var(--danger)]" strokeWidth={1.75} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-[var(--danger)]">
                  {t("patients.deleteModal.deleteTitle")}
                </div>

                {checking ? (
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin" aria-hidden />
                    {t("patients.deleteModal.checking")}
                  </p>
                ) : isBlocked ? (
                  <>
                    <p className="text-xs text-[var(--danger)] mt-1 font-medium">
                      {t("patients.deleteModal.blockedIntro")}
                    </p>
                    <ul className="text-xs text-[var(--danger)] mt-1.5 space-y-1 list-disc pl-4">
                      {blockers!.map((b) => (
                        <li key={b.type}>{reasonText(b)}</li>
                      ))}
                    </ul>
                    <p className="text-xs text-muted-foreground mt-2">
                      {t("patients.deleteModal.blockedHint")}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("patients.deleteModal.deleteHint")}
                    </p>
                    <Label htmlFor="delete-patient-confirm" className="block text-xs mt-3">
                      {t("patients.deleteModal.confirmLabel", { word: confirmWord })}
                    </Label>
                    <Input
                      id="delete-patient-confirm"
                      value={typed}
                      onChange={(e) => setTyped(e.target.value)}
                      placeholder={confirmWord}
                      autoComplete="off"
                      className="mt-1.5 h-9"
                      disabled={busy !== null}
                    />
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      className="mt-3"
                      onClick={hardDelete}
                      disabled={!canConfirm || busy !== null}
                    >
                      {busy === "delete" ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden />
                      )}
                      {t("patients.deleteModal.deleteAction")}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={busy !== null}
          >
            {t("common.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
