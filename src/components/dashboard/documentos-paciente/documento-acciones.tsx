"use client";

// La barra de acciones de un documento del paciente: descargar PDF, imprimir,
// WhatsApp y correo. NO es parte de la carta: va fuera de la hoja, pegada
// arriba, y no se imprime (`ATRIBUTO_ACCIONES`, ver `impresion.ts`).
//
// Un envío que no sale NUNCA falla en silencio: el motivo que devuelve el
// servidor se queda escrito en la barra (un toast se va solo y nadie lo lee).
// El caso normal es WhatsApp fuera de la ventana de 24 h, que llega con
// `code: WA_FUERA_DE_VENTANA` y se pinta como aviso, no como error.

import { useState, type ReactNode } from "react";
import { Download, Loader2, Mail, MessageCircle, Printer } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { ATRIBUTO_ACCIONES } from "./impresion";
import s from "./documento.module.css";
import type { RutasDeDocumento } from "./tipos";

type Canal = "whatsapp" | "correo";
type Estado = { tono: "bien" | "aviso"; texto: string } | null;

export function DocumentoAcciones({
  rutas, puedeEnviar, inicio,
}: {
  rutas: RutasDeDocumento;
  /** Solo lo firmado sale de la clínica. En un borrador los dos envíos se apagan. */
  puedeEnviar: boolean;
  /** Lo que va a la izquierda de la barra (el «Volver»). */
  inicio?: ReactNode;
}) {
  const t = useT();
  const confirm = useConfirm();
  const [enviando, setEnviando] = useState<Canal | null>(null);
  const [estado, setEstado] = useState<Estado>(null);

  async function enviar(canal: Canal, url: string) {
    const ok = await confirm({
      title: t(`documentosPaciente.acciones.confirm.${canal}Title`),
      description: t(`documentosPaciente.acciones.confirm.${canal}Body`),
    });
    if (!ok) return;
    setEnviando(canal);
    setEstado(null);
    try {
      const res = await fetch(url, { method: "POST" });
      const json = await res.json().catch(() => null);
      if (res.ok) {
        setEstado({ tono: "bien", texto: t("documentosPaciente.acciones.sentTo", { destino: json?.destino ?? "" }) });
      } else {
        setEstado({ tono: "aviso", texto: (json && json.error) || t("documentosPaciente.acciones.error") });
      }
    } catch {
      setEstado({ tono: "aviso", texto: t("documentosPaciente.acciones.error") });
    } finally {
      setEnviando(null);
    }
  }

  const apagado = enviando !== null;
  const soloFirmado = puedeEnviar ? undefined : t("documentosPaciente.acciones.onlySigned");
  const girando = <Loader2 size={14} className="animate-spin" aria-hidden />;

  return (
    <div className={s.barra} {...{ [ATRIBUTO_ACCIONES]: "" }}>
      {inicio}
      <div className={s.barraAcciones}>
        <a className="btn-new btn-new--secondary btn-new--sm" href={`${rutas.pdf}?download=1`} download>
          <Download size={14} aria-hidden /> {t("documentosPaciente.acciones.pdf")}
        </a>
        <ButtonNew size="sm" onClick={() => window.print()}>
          <Printer size={14} aria-hidden /> {t("documentosPaciente.acciones.print")}
        </ButtonNew>
        {rutas.whatsapp ? (
          <ButtonNew
            size="sm"
            disabled={apagado || !puedeEnviar}
            title={soloFirmado}
            onClick={() => void enviar("whatsapp", rutas.whatsapp as string)}
          >
            {enviando === "whatsapp" ? girando : <MessageCircle size={14} aria-hidden />}{" "}
            {t("documentosPaciente.acciones.whatsapp")}
          </ButtonNew>
        ) : null}
        {rutas.correo ? (
          <ButtonNew
            size="sm"
            disabled={apagado || !puedeEnviar}
            title={soloFirmado}
            onClick={() => void enviar("correo", rutas.correo as string)}
          >
            {enviando === "correo" ? girando : <Mail size={14} aria-hidden />}{" "}
            {t("documentosPaciente.acciones.email")}
          </ButtonNew>
        ) : null}
      </div>
      {!puedeEnviar && (rutas.whatsapp || rutas.correo) ? (
        <p className={s.estado} role="note">{t("documentosPaciente.acciones.onlySigned")}</p>
      ) : null}
      {estado ? (
        <p
          className={[s.estado, estado.tono === "bien" ? s.estadoBien : s.estadoAviso].join(" ")}
          role={estado.tono === "bien" ? "status" : "alert"}
        >
          {estado.texto}
        </p>
      ) : null}
    </div>
  );
}
