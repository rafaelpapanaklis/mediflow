"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImageOff } from "lucide-react";
import type { EduPhotoRow } from "@/lib/edu/fotos-core";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * UNA FOTO QUE SE RENUEVA SOLA, Y QUE DICE LA VERDAD CUANDO NO PUEDE (N-5).
 *
 * 🔴 EL PROBLEMA QUE CIERRA. El `onError` de la miniatura encendía SIEMPRE
 * el mismo aviso —«los enlaces de las fotos caducaron»— pasara lo que
 * pasara. Si el binario era ilegible (un HEIC que sharp no supo convertir,
 * un objeto que ya no está en el bucket), la `<img>` fallaba, salía
 * «Actualiza para renovarlos: no se pierde nada», se pulsaba «Renovar los
 * enlaces», `router.refresh()`, y volvía a fallar. Bucle, y lo que se
 * concluye es «se perdieron las fotos del paciente».
 *
 * Son DOS causas distintas y aquí se distinguen SIN adivinar:
 *   1. el enlace caducó → se pide uno nuevo a `/fotos/[fotoId]/url` y la
 *      foto aparece, sin recargar la pestaña y sin que nadie se entere;
 *   2. con un enlace RECIÉN FIRMADO sigue sin pintarse → no es el reloj:
 *      ese binario no se puede mostrar. Se pone un hueco honesto en su
 *      sitio y se dice por qué.
 *
 * La prueba de cuál es cuál no es un temporizador —el reloj del navegador
 * puede ir corrido—: es que el segundo intento, con la URL nueva, también
 * falle.
 *
 * 🔴 Y ES EL MISMO COMPONENTE EN LOS TRES SITIOS: la galería, el visor a
 * pantalla completa y el comparador. Los dos últimos usaban la URL de la
 * carga inicial SIN `onError`, así que a la hora enseñaban imágenes rotas
 * sin una palabra — y `/fotos/[fotoId]/url`, escrita justo para ellos, no
 * la llamaba nadie (N-16).
 * ═══════════════════════════════════════════════════════════════════════
 */
export type EduFotoEstado = "ok" | "renovando" | "rota";

export interface EduFotoImagenProps {
  patientId: string;
  foto: EduPhotoRow;
  /** Pintar la MINIATURA (con caída a la completa si no tiene). */
  mini?: boolean;
  className?: string;
  alt: string;
  loading?: "lazy" | "eager";
  draggable?: boolean;
  /** Para que la pantalla pueda CONTAR cuántas no se pueden pintar. */
  onEstado?: (id: string, estado: EduFotoEstado) => void;
}

const ROTA_TITULO =
  "Esta foto no se puede mostrar: el archivo quedó en un formato que el navegador no abre " +
  "(un HEIC sin convertir, por ejemplo) o ya no está en el almacenamiento. No es que el " +
  "enlace haya caducado: con uno recién firmado tampoco se pinta.";

export function EduFotoImagen({
  patientId,
  foto,
  mini = false,
  className,
  alt,
  loading,
  draggable,
  onEstado,
}: EduFotoImagenProps) {
  const inicial = mini ? foto.thumbUrl || foto.url : foto.url;
  const [src, setSrc] = useState(inicial);
  const [estado, setEstado] = useState<EduFotoEstado>(inicial ? "ok" : "rota");
  // Ya se pidió una URL nueva para ESTA foto: el segundo fallo ya no es del
  // reloj. Vive en una ref y no en el estado porque no tiene que repintar.
  const renovada = useRef(false);

  // Al cambiar de foto (el visor pasa a la siguiente) se empieza de cero:
  // sin esto, la segunda foto heredaría el "rota" de la primera.
  useEffect(() => {
    renovada.current = false;
    setSrc(inicial);
    setEstado(inicial ? "ok" : "rota");
  }, [foto.id, inicial]);

  const marcar = useCallback(
    (e: EduFotoEstado) => {
      setEstado(e);
      if (onEstado) onEstado(foto.id, e);
    },
    [foto.id, onEstado],
  );

  const alFallar = useCallback(async () => {
    if (renovada.current) {
      marcar("rota");
      return;
    }
    renovada.current = true;
    marcar("renovando");
    try {
      const res = await fetch(`/api/instituto/pacientes/${patientId}/fotos/${foto.id}/url`, {
        cache: "no-store",
      });
      if (!res.ok) {
        // 410 (dada de baja), 404 (no existe o no te toca), 502 (Storage no
        // la pudo firmar): en los tres, el hueco honesto es la respuesta.
        marcar("rota");
        return;
      }
      const fresca = (await res.json()) as { url?: string; thumbUrl?: string };
      const nueva = mini ? fresca.thumbUrl || fresca.url : fresca.url;
      if (!nueva) {
        marcar("rota");
        return;
      }
      setSrc(nueva);
      marcar("ok");
    } catch {
      marcar("rota");
    }
  }, [patientId, foto.id, mini, marcar]);

  if (estado === "rota" || !src) {
    return (
      <span className={`edu-fotos-rota ${className ?? ""}`} title={ROTA_TITULO}>
        <ImageOff size={mini ? 22 : 34} aria-hidden />
        <span className="edu-fotos-rota__txt">No se puede mostrar</span>
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- URL firmada que
    // caduca: next/image la cachearía y después daría 403.
    <img
      src={src}
      alt={alt}
      className={className}
      loading={loading}
      draggable={draggable}
      onError={() => void alFallar()}
    />
  );
}
