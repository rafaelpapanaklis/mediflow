"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CLAVE_ETIQUETA_CATEGORIA, opcionesDeCambioDeTipo } from "@/lib/uploads/categorias-archivo";
import { mensajeDeError, mensajeDeRespuesta } from "@/lib/errores/mensaje-de-error";
import { useT } from "@/i18n/i18n-provider";

export interface ArchivoCambiable {
  id: string;
  name: string;
  category: string;
  mimeType?: string | null;
}

/**
 * «Cambiar tipo» de un archivo ya subido (ficha y visor). Solo cambia la
 * etiqueta: el archivo no se toca. El servidor exige `xrays.upload`, deja en
 * Movimientos quién y de qué a qué, y vuelve a validar el tipo contra el formato.
 */
export function CambiarTipoDialog({
  archivo,
  onClose,
  onCambiado,
}: {
  archivo: ArchivoCambiable | null;
  onClose: () => void;
  onCambiado: (id: string, categoria: string) => void;
}) {
  const t = useT();
  const [nuevo, setNuevo] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => { setNuevo(""); }, [archivo?.id]);

  const opciones = archivo ? opcionesDeCambioDeTipo(archivo.category, archivo.mimeType) : [];
  const etiqueta = (c: string) => (CLAVE_ETIQUETA_CATEGORIA[c] ? t(CLAVE_ETIQUETA_CATEGORIA[c]) : c);

  async function guardar() {
    if (!archivo || !nuevo || guardando) return;
    setGuardando(true);
    try {
      const res = await fetch(`/api/xrays/${archivo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: nuevo }),
      });
      if (!res.ok) {
        toast.error(await mensajeDeRespuesta(res, t, t("patients.xrays.cambiarTipo.error")));
        return;
      }
      onCambiado(archivo.id, nuevo);
      toast.success(t("patients.xrays.cambiarTipo.hecho", { tipo: etiqueta(nuevo) }));
      onClose();
    } catch (e) {
      toast.error(mensajeDeError(e, t, { porDefecto: t("patients.xrays.cambiarTipo.error") }));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog open={!!archivo} onOpenChange={(o) => { if (!o && !guardando) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-foreground font-bold">{t("patients.xrays.cambiarTipo.titulo")}</DialogTitle></DialogHeader>
        {archivo && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground break-all">{archivo.name}</p>
            <p className="text-sm">
              {t("patients.xrays.cambiarTipo.actual")}: <strong>{etiqueta(archivo.category)}</strong>
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="nuevo-tipo-archivo">{t("patients.xrays.cambiarTipo.nuevo")}</Label>
              <select
                id="nuevo-tipo-archivo"
                className="flex h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
                value={nuevo}
                onChange={(e) => setNuevo(e.target.value)}
              >
                <option value="">{t("patients.xrays.tipo.elige")}</option>
                {opciones.map((c) => <option key={c} value={c}>{etiqueta(c)}</option>)}
              </select>
              <p className="text-xs text-muted-foreground">{t("patients.xrays.cambiarTipo.aviso")}</p>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={guardando}>{t("common.cancel")}</Button>
          <Button onClick={guardar} disabled={!nuevo || guardando}>
            {guardando ? t("common.saving") : t("patients.xrays.cambiarTipo.guardar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
