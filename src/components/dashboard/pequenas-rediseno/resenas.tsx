"use client";

import { useState } from "react";
import { MessageSquare, Star, Flag, EyeOff } from "lucide-react";
import { ReviewStars } from "@/components/reviews/ReviewStars";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import {
  REVIEW_MAX_RESPONSE_CHARS,
  formatReviewDate,
  type ClinicReviewDTO,
  type ClinicReviewsResponse,
} from "@/lib/reviews/types";
import { RaizPequenas } from "./raiz";
import { Aviso, Boton, Cabecera, Cargando, Etiqueta, Girando, Vacio, estilos as s } from "./piezas";

/**
 * Reseñas, vestida con el lenguaje del menú de dos niveles.
 *
 * Los DATOS y la paginación siguen viviendo en `ResenasClient` (la misma
 * llamada a /api/reviews de siempre, ni una más); esto solo pinta lo que le
 * llega y devuelve los mismos eventos. Lo único que hace por su cuenta es lo
 * que la tarjeta de siempre también hace por su cuenta: publicar la respuesta
 * a una reseña contra el MISMO endpoint.
 *
 * Mismos clics que hoy: «Responder» abre el cuadro, «Publicar respuesta» la
 * guarda. Todo lo que hoy se ve sin clic sigue a la vista.
 */
export function ResenasRediseno({
  data,
  page,
  loading,
  error,
  onPage,
  onResponded,
}: {
  data: ClinicReviewsResponse | null;
  page: number;
  loading: boolean;
  error: string;
  onPage: (p: number) => void;
  onResponded: (r: ClinicReviewDTO) => void;
}) {
  return (
    <RaizPequenas ancho="estrecho">
      <Cabecera
        icono={<Star size={18} strokeWidth={1.75} />}
        titulo="Reseñas"
        subtitulo="Opiniones verificadas de pacientes que tuvieron una cita contigo."
      />

      {data && data.summary.count > 0 && (
        <div className={s.kpis}>
          <div className={`${s.kpi} ${s.kpiDestacado}`}>
            <div className={s.kpiArriba}>
              <span className={s.kpiEtiqueta}>Calificación promedio</span>
              <span className={s.kpiIcono}><Star size={16} strokeWidth={1.75} aria-hidden /></span>
            </div>
            <div className={s.kpiValor}>{data.summary.avg.toFixed(1)}</div>
            <div className={s.kpiPie}>
              <ReviewStars value={data.summary.avg} size={14} />
              <span>de 5</span>
            </div>
          </div>
          <div className={s.kpi}>
            <div className={s.kpiArriba}>
              <span className={s.kpiEtiqueta}>{data.summary.count === 1 ? "Reseña publicada" : "Reseñas publicadas"}</span>
              <span className={s.kpiIcono}><MessageSquare size={16} strokeWidth={1.75} aria-hidden /></span>
            </div>
            <div className={s.kpiValor}>{data.summary.count}</div>
            <div className={s.kpiPie}>opiniones verificadas de pacientes</div>
          </div>
        </div>
      )}

      {loading ? (
        <Cargando texto="Cargando…" />
      ) : error ? (
        <Aviso>{error}</Aviso>
      ) : !data || data.items.length === 0 ? (
        <Vacio
          icono={<Star size={20} strokeWidth={1.75} />}
          titulo="Todavía no tienes reseñas"
          pista="Cuando marques una cita como completada, el paciente recibirá una invitación para calificarte."
        />
      ) : (
        <div className={s.lista}>
          {data.items.map((r) => (
            <TarjetaResena key={r.id} review={r} onResponded={onResponded} />
          ))}

          {data.totalPages > 1 && (
            <div className={`${s.paginador} ${s.paginadorCentrado}`}>
              <Boton peq disabled={page <= 1} onClick={() => onPage(page - 1)}>Anterior</Boton>
              <span className={s.paginadorInfo}>{page} / {data.totalPages}</span>
              <Boton peq disabled={page >= data.totalPages} onClick={() => onPage(page + 1)}>Siguiente</Boton>
            </div>
          )}
        </div>
      )}
    </RaizPequenas>
  );
}

function TarjetaResena({
  review,
  onResponded,
}: {
  review: ClinicReviewDTO;
  onResponded: (r: ClinicReviewDTO) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function send() {
    if (saving || !text.trim()) return;
    setSaving(true);
    setErr("");
    try {
      const res = await fetch(`/api/reviews/${review.id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: text.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(body.error ?? "No se pudo guardar.");
        setSaving(false);
        return;
      }
      onResponded(body.review as ClinicReviewDTO);
      setOpen(false);
    } catch {
      setErr("No se pudo guardar.");
      setSaving(false);
    }
  }

  const hidden = review.status === "hidden";

  return (
    <article className={`${s.tarjeta} ${hidden ? s.tarjetaApagada : ""}`.trim()}>
      <div className={s.tarjetaCuerpo}>
        <div className={s.tarjetaCabeza}>
          <div className={s.tarjetaQuien}>
            <AvatarNew name={review.authorName} />
            <div className={s.tarjetaTextos}>
              <div className={s.tarjetaTituloFila}>
                <h3 className={s.tarjetaTitulo}>{review.authorName}</h3>
                {review.rating != null && <ReviewStars value={review.rating} size={14} />}
              </div>
              <p className={s.tarjetaSub} style={{ textTransform: "capitalize" }}>
                {formatReviewDate(review.submittedAt ?? review.createdAt)}
              </p>
            </div>
          </div>
          <div className={s.tarjetaAcciones}>
            {review.reported && (
              <Etiqueta tono="ambar"><Flag size={11} strokeWidth={1.75} aria-hidden /> Reportada</Etiqueta>
            )}
            {hidden && (
              <Etiqueta tono="neutra"><EyeOff size={11} strokeWidth={1.75} aria-hidden /> Oculta</Etiqueta>
            )}
            {review.response && <Etiqueta tono="info">Respondida</Etiqueta>}
          </div>
        </div>

        {review.comment && <p className={s.parrafo}>{review.comment}</p>}

        {review.response ? (
          <div className={s.cita}>
            <Etiqueta tono="violeta">Tu respuesta</Etiqueta>
            <p className={s.parrafo}>{review.response}</p>
          </div>
        ) : open ? (
          <div className={s.formulario}>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, REVIEW_MAX_RESPONSE_CHARS))}
              rows={3}
              placeholder="Responde con amabilidad y profesionalismo…"
              autoFocus
              className={`${s.entrada} ${s.entradaAncha}`}
            />
            {err && <div className={s.avisoPeq}>{err}</div>}
            <div className={s.formularioAcciones}>
              <Boton principal onClick={send} disabled={saving || !text.trim()}>
                {saving && <Girando />} Publicar respuesta
              </Boton>
              <Boton suave onClick={() => { setOpen(false); setErr(""); }}>
                Cancelar
              </Boton>
            </div>
          </div>
        ) : (
          <Boton peq className={s.margenArriba} onClick={() => setOpen(true)}>
            <MessageSquare size={16} strokeWidth={1.75} aria-hidden /> Responder
          </Boton>
        )}
      </div>
    </article>
  );
}
