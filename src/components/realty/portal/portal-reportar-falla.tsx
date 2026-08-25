"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check } from "lucide-react";
import { portalT } from "@/components/realty/portal/portal-i18n";

/* ═══════════════════════════════════════════════════════════════════════
   REPORTAR UNA FALLA desde el celular.

   Se está saliendo el agua debajo del fregadero. La persona está de pie en
   su cocina, con una mano en el teléfono y datos móviles. El formulario
   son tres cosas: en cuál inmueble, qué pasa, y una foto.

   ── POR QUÉ LA FOTO SE COMPRIME AQUÍ Y NO EN EL SERVIDOR ──────────────
   Una foto de celular pesa 8-15 MB. El cuerpo de una petición en
   serverless no pasa de ~4.5 MB, así que sin comprimir el reporte
   FALLARÍA — y con dos fotos, siempre. Aquí se reduce a WebP con el lado
   mayor en 1600 px (≈300 KB), que es de sobra para ver una fuga.

   Además resuelve el HEIC del iPhone: el bucket realty-files no lo acepta
   (ver PORTAL_PHOTO_TYPES), y el canvas lo convierte a WebP de camino.

   El servidor NO se fía de nada de esto: vuelve a comprobar el tamaño y
   lee el tipo REAL por firma de bytes.
   ═══════════════════════════════════════════════════════════════════════ */

export interface PortalIssueLeaseOption {
  id: string;
  label: string;
}

interface FotoLista {
  /** Ya comprimida (o la original, si el navegador no supo comprimir). */
  blob: Blob;
  /** URL local para la miniatura. Se revoca al quitarla y al desmontar. */
  preview: string;
  nombre: string;
}

const LADO_MAX = 1600;

/** Lo que el bucket realty-files acepta. Sin HEIC (ver PORTAL_PHOTO_TYPES). */
const ACEPTADOS = ["image/jpeg", "image/png", "image/webp"];

async function comprimir(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const escala = Math.min(1, LADO_MAX / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * escala));
  const h = Math.max(1, Math.round(bitmap.height * escala));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("sin canvas");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/webp", 0.82),
  );
  if (!blob) throw new Error("sin blob");
  return blob;
}

/**
 * Comprime, y si el navegador no puede, manda el original.
 *
 * `createImageBitmap` no existe en Safari viejo y falla con formatos que el
 * navegador no sabe decodificar. Sin esta salida, en esos equipos NINGUNA
 * foto se puede adjuntar y el único mensaje es "esa foto no se pudo subir",
 * una y otra vez. Mejor una foto de 3 MB que ninguna.
 */
async function preparar(file: File, maxBytes: number): Promise<Blob> {
  try {
    return await comprimir(file);
  } catch {
    if (ACEPTADOS.includes(file.type) && file.size <= maxBytes) return file;
    throw new Error("sin-comprimir");
  }
}

function extensionDe(tipo: string): string {
  if (tipo === "image/png") return "png";
  if (tipo === "image/jpeg") return "jpg";
  return "webp";
}

export function PortalReportarFalla({
  contratos,
  maxFotos,
  maxFotoBytes,
  minCaracteres,
  maxCaracteres,
}: {
  contratos: PortalIssueLeaseOption[];
  maxFotos: number;
  maxFotoBytes: number;
  minCaracteres: number;
  maxCaracteres: number;
}) {
  const t = useMemo(() => portalT(), []);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [leaseId, setLeaseId] = useState(contratos[0]?.id ?? "");
  const [texto, setTexto] = useState("");
  const [fotos, setFotos] = useState<FotoLista[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  // Las miniaturas viven en URLs de objeto: si la persona se va a otra
  // pestaña del portal con fotos cargadas, sin esto se quedan colgadas
  // hasta una recarga dura.
  const fotosRef = useRef<FotoLista[]>([]);
  fotosRef.current = fotos;
  useEffect(() => {
    return () => {
      fotosRef.current.forEach((f) => URL.revokeObjectURL(f.preview));
    };
  }, []);

  const agregarFotos = async (files: FileList) => {
    setError(null);
    const hueco = maxFotos - fotos.length;
    if (hueco <= 0) return;
    const nuevas: FotoLista[] = [];
    for (const file of Array.from(files).slice(0, hueco)) {
      try {
        const blob = await preparar(file, maxFotoBytes);
        nuevas.push({
          blob,
          preview: URL.createObjectURL(blob),
          nombre: `falla.${extensionDe(blob.type)}`,
        });
      } catch {
        setError(t("fallas.errorFoto"));
      }
    }
    if (nuevas.length) setFotos((prev) => [...prev, ...nuevas]);
  };

  const quitarFoto = (idx: number) => {
    setFotos((prev) => {
      const foto = prev[idx];
      if (foto) URL.revokeObjectURL(foto.preview);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const enviar = async () => {
    setError(null);
    if (texto.trim().length < minCaracteres) {
      setError(t("fallas.errorTexto"));
      return;
    }
    if (!leaseId) {
      setError(t("fallas.errorGenerico"));
      return;
    }
    setOcupado(true);
    try {
      const fd = new FormData();
      fd.append("leaseId", leaseId);
      fd.append("description", texto.trim().slice(0, maxCaracteres));
      fotos.forEach((f, i) =>
        fd.append("fotos", f.blob, `falla-${i + 1}.${extensionDe(f.blob.type)}`),
      );

      const res = await fetch("/api/realty/portal/inquilino/fallas", { method: "POST", body: fd });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? t("fallas.errorGenerico"));
        return;
      }
      fotos.forEach((f) => URL.revokeObjectURL(f.preview));
      setFotos([]);
      setTexto("");
      setListo(true);
      // 🔴 SIN ESTO, LA PANTALLA MIENTE. La lista de "Mis reportes" la pinta
      // el componente de servidor de arriba, que no se vuelve a ejecutar
      // solo: la señora vería "Listo, ya lo recibieron · aquí mismo vas
      // viendo cómo avanza" señalando una lista donde su reporte NO está,
      // creería que se perdió y lo mandaría otra vez. Hasta diez veces, que
      // es el tope.
      router.refresh();
    } catch {
      setError(t("login.sinRed"));
    } finally {
      setOcupado(false);
    }
  };

  if (listo) {
    return (
      <section className="dcr-card">
        <p style={{ margin: "0 0 10px", color: "var(--pine-600, #2f6b4d)" }}>
          <Check size={26} aria-hidden="true" />
        </p>
        <h2 className="dcr-h3" style={{ fontSize: 18 }}>
          {t("fallas.enviado")}
        </h2>
        <p className="dcr-p" style={{ marginTop: 6 }}>
          {t("fallas.enviadoSub")}
        </p>
        <button
          type="button"
          className="dcr-btn dcr-btn--ghost dcr-btn--block"
          style={{ marginTop: 16 }}
          onClick={() => setListo(false)}
        >
          {t("fallas.otroMas")}
        </button>
      </section>
    );
  }

  return (
    <section className="dcr-card">
      <h2 className="dcr-h3" style={{ fontSize: 18, marginBottom: 4 }}>
        {t("fallas.title")}
      </h2>
      <p className="dcr-p" style={{ marginBottom: 16 }}>
        {t("fallas.sub")}
      </p>

      {error ? (
        <p className="dcr-alert dcr-alert--error" role="alert">
          {error}
        </p>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void enviar();
        }}
      >
        {contratos.length > 1 ? (
          <label className="dcr-field">
            <span className="dcr-label">{t("fallas.contrato")}</span>
            <select
              className="dcr-select"
              value={leaseId}
              onChange={(e) => setLeaseId(e.target.value)}
            >
              {contratos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="dcr-field">
          <span className="dcr-label">{t("fallas.descripcion")}</span>
          <textarea
            className="dcr-textarea"
            value={texto}
            maxLength={maxCaracteres}
            placeholder={t("fallas.descripcionPlaceholder")}
            onChange={(e) => setTexto(e.target.value)}
            required
          />
          <span className="dcr-hint">{t("fallas.descripcionAyuda")}</span>
        </label>

        <div className="dcr-field">
          <span className="dcr-label">{t("fallas.fotos")}</span>
          <input
            ref={inputRef}
            className="dcr-sr"
            type="file"
            /* image/* abre la cámara directamente en iOS y Android. */
            accept="image/*"
            multiple
            aria-label={t("fallas.agregarFotos")}
            onChange={(e) => {
              if (e.target.files) void agregarFotos(e.target.files);
              // Sin esto no se puede volver a elegir la MISMA foto.
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="dcr-btn dcr-btn--ghost dcr-btn--block"
            onClick={() => inputRef.current?.click()}
            disabled={ocupado || fotos.length >= maxFotos}
          >
            <Camera size={17} aria-hidden="true" />
            {t("fallas.agregarFotos")}
          </button>
          <span className="dcr-hint">{t("fallas.fotosAyuda", { max: maxFotos })}</span>

          {fotos.length > 0 ? (
            <div className="dcr-photos">
              {fotos.map((f, i) => (
                <div key={f.preview} className="dcr-photo">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.preview} alt="" />
                  <button
                    type="button"
                    className="dcr-photo__x"
                    onClick={() => quitarFoto(i)}
                    aria-label={t("fallas.quitarFoto")}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <button
          type="submit"
          className="dcr-btn dcr-btn--primary dcr-btn--block"
          disabled={ocupado}
          style={{ marginTop: 6 }}
        >
          {ocupado ? (
            <>
              <span className="dcr-spin" aria-hidden="true" />
              {t("fallas.enviando")}
            </>
          ) : (
            t("fallas.enviar")
          )}
        </button>
      </form>
    </section>
  );
}
