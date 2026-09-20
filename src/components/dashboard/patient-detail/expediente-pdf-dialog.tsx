"use client";

import { useEffect, useState } from "react";
import { FileText, Images, Loader2, Receipt, ShieldAlert } from "lucide-react";
import toast from "react-hot-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/i18n-provider";

/** Lo que devuelve GET …/expediente-pdf?estimar=1. */
interface Estimacion {
  estudios: number;
  imagenes: number;
  bytes: number;
  pesoLegible: string;
  topeImagenes: number;
  recortado: boolean;
}

interface ExpedientePdfDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: { id: string; firstName: string; lastName: string; patientNumber: string };
}

/**
 * El diálogo de «Descargar expediente completo».
 *
 * DOS CASILLAS, LAS DOS APAGADAS AL ABRIR, y se reinician en cada apertura: que
 * el documento de hoy no herede lo que alguien marcó hace media hora. Es una
 * decisión y no un descuido —
 *
 *   · IMÁGENES. Un expediente con dieciséis placas se va a decenas de MB.
 *     Antes de encenderla el diálogo dice CUÁNTO va a pesar, con el número real
 *     de este paciente (se pregunta al abrir, con `?estimar=1`, que no genera
 *     nada ni deja rastro porque no sale ningún dato clínico). Apagada, las
 *     placas salen LISTADAS con su tipo, su fecha y quién las subió — no
 *     desaparecen.
 *   · ADMINISTRATIVO. La NOM-004 no pide facturas: el expediente es clínico.
 *     Mezclar dinero con historia clínica se lee mal en una reclamación, así
 *     que hay que pedirlo a propósito.
 *
 * Y NO DEJA EL BOTÓN COLGADO. Un expediente con treinta notas y sus imágenes
 * tarda; mientras se genera, el botón dice que está trabajando y el diálogo
 * avisa de que puede tardar, en vez de fingir que no pasa nada. La descarga va
 * por `fetch` + blob y no por `window.open` para poder contar de verdad qué
 * falló: un 403 se dice con palabras, no con una pestaña en blanco.
 */
export function ExpedientePdfDialog({ open, onOpenChange, patient }: ExpedientePdfDialogProps) {
  const t = useT();
  const nombre = `${patient.firstName} ${patient.lastName}`.trim();

  const [incluirImagenes, setIncluirImagenes] = useState(false);
  const [incluirAdministrativo, setIncluirAdministrativo] = useState(false);
  const [estimacion, setEstimacion] = useState<Estimacion | null>(null);
  const [generando, setGenerando] = useState(false);

  // Reinicio total en cada apertura + estimación del peso.
  useEffect(() => {
    if (!open) return;
    let cancelado = false;
    setIncluirImagenes(false);
    setIncluirAdministrativo(false);
    setGenerando(false);
    setEstimacion(null);
    fetch(`/api/patients/${patient.id}/expediente-pdf?estimar=1`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data) => {
        if (!cancelado) setEstimacion(data as Estimacion);
      })
      .catch(() => {
        // Sin estimación no se bloquea nada: la casilla sigue disponible y el
        // texto lo dice. Lo que no se hace es inventar un número.
        if (!cancelado) setEstimacion(null);
      });
    return () => {
      cancelado = true;
    };
  }, [open, patient.id]);

  async function generar() {
    setGenerando(true);
    try {
      const params = new URLSearchParams();
      if (incluirImagenes) params.set("imagenes", "1");
      if (incluirAdministrativo) params.set("administrativo", "1");
      const qs = params.toString();
      const res = await fetch(
        `/api/patients/${patient.id}/expediente-pdf${qs ? `?${qs}` : ""}`,
      );
      if (!res.ok) {
        const detalle = await res.json().catch(() => ({}));
        throw new Error(
          res.status === 403
            ? t("patients.expedientePdf.errorPermiso")
            : (detalle?.error ?? t("patients.expedientePdf.error")),
        );
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nombreDeArchivo(res, patient.patientNumber);
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Se suelta el objeto en el siguiente tick: revocarlo antes de que el
      // navegador arranque la descarga la cancela en Safari.
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast.success(t("patients.expedientePdf.listo"));
      onOpenChange(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t("patients.expedientePdf.error"));
    } finally {
      setGenerando(false);
    }
  }

  return (
    // El diálogo se puede cerrar aunque esté generando, a propósito: un
    // expediente con imágenes puede tardar un minuto y dejar a alguien
    // encerrado en una ventana es peor que dejarle seguir trabajando. La
    // descarga NO se pierde por cerrar — el enlace que la dispara cuelga de
    // <body>, no de este árbol, así que el archivo llega igual.
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText size={18} strokeWidth={1.75} aria-hidden />
            {t("patients.expedientePdf.title")}
          </DialogTitle>
        </DialogHeader>

        {/* `flex-1 overflow-y-auto min-h-0` lo pide el contrato de DialogContent:
            sin él, en una laptop de poca altura el botón «Generar PDF» se sale
            de la pantalla y no hay forma de pulsarlo. */}
        <div className="flex-1 overflow-y-auto min-h-0 px-6 pb-2 space-y-4 text-sm">
          <p className="text-muted-foreground">
            {t("patients.expedientePdf.intro", { name: nombre, folio: patient.patientNumber })}
          </p>

          {/* Casilla 1 — imágenes, con el peso por delante. */}
          <label className="flex gap-3 rounded-lg border p-3 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-violet-600"
              checked={incluirImagenes}
              disabled={generando}
              onChange={(e) => setIncluirImagenes(e.target.checked)}
            />
            <span className="space-y-1">
              <span className="flex items-center gap-1.5 font-medium">
                <Images size={14} strokeWidth={1.75} aria-hidden />
                {t("patients.expedientePdf.imagesLabel")}
              </span>
              <span className="block text-xs text-muted-foreground">
                {estimacion
                  ? estimacion.imagenes === 0
                    ? t("patients.expedientePdf.imagesNone")
                    : t("patients.expedientePdf.imagesHint", {
                        count: estimacion.imagenes,
                        size: estimacion.pesoLegible,
                      })
                  : t("patients.expedientePdf.imagesUnknown")}
              </span>
              {estimacion?.recortado && (
                <span className="block text-xs text-amber-700 dark:text-amber-500">
                  {t("patients.expedientePdf.imagesCapped", { max: estimacion.topeImagenes })}
                </span>
              )}
              {!incluirImagenes && (
                <span className="block text-xs text-muted-foreground">
                  {t("patients.expedientePdf.imagesOffHint")}
                </span>
              )}
            </span>
          </label>

          {/* Casilla 2 — administrativo, con el porqué de que venga apagada. */}
          <label className="flex gap-3 rounded-lg border p-3 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-violet-600"
              checked={incluirAdministrativo}
              disabled={generando}
              onChange={(e) => setIncluirAdministrativo(e.target.checked)}
            />
            <span className="space-y-1">
              <span className="flex items-center gap-1.5 font-medium">
                <Receipt size={14} strokeWidth={1.75} aria-hidden />
                {t("patients.expedientePdf.billingLabel")}
              </span>
              <span className="block text-xs text-muted-foreground">
                {t("patients.expedientePdf.billingHint")}
              </span>
            </span>
          </label>

          <div className="flex gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            <ShieldAlert size={14} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden />
            <span>{t("patients.expedientePdf.auditNotice")}</span>
          </div>

          {generando && (
            <p className="text-xs text-muted-foreground">
              {t("patients.expedientePdf.working")}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={generando} onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={generar} disabled={generando}>
            {generando ? (
              <>
                <Loader2 size={14} className="mr-1.5 animate-spin" aria-hidden />
                {t("patients.expedientePdf.generating")}
              </>
            ) : (
              t("patients.expedientePdf.generate")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * El nombre que propone el servidor en `Content-Disposition`, y si no llega,
 * uno armado aquí. Nunca un "descarga.pdf": el archivo se va a guardar en el
 * disco de alguien y tiene que decir de quién es.
 */
function nombreDeArchivo(res: Response, folio: string): string {
  const cd = res.headers.get("content-disposition") ?? "";
  const m = /filename="([^"]+)"/.exec(cd);
  if (m?.[1]) return m[1];
  return `expediente-${folio || "paciente"}-${new Date().toISOString().slice(0, 10)}.pdf`;
}
