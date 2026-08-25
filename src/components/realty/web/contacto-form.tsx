"use client";

/* ═══════════════════════════════════════════════════════════════════════
   EL FORMULARIO QUE CAE EN EL CRM.

   Es lo único de la web pública que escribe en la base, y lo pinta una
   página abierta a la calle. Por eso:
     · El envío va por server action (Next comprueba el origen solo: no hay
       token CSRF que mantener) y NUNCA manda un accountId.
     · Los campos tienen tope de caracteres aquí Y en el servidor. El de
       aquí es cortesía; el que manda es el otro.
     · Si el envío falla, se ofrece el WhatsApp: quien vino de Google a ver
       una casa no vuelve a intentar un formulario roto.

   DENTRO DEL EDITOR no se envía nada (`editando`): la vista previa no puede
   sembrar prospectos de mentira en el CRM de la inmobiliaria.
   ═══════════════════════════════════════════════════════════════════════ */

import { useState, useTransition } from "react";
import { enviarProspectoWeb } from "@/components/realty/web/lead-action";
import { IcoWhatsApp } from "@/components/realty/web/pieces";

export interface ContactoFormProps {
  slug: string;
  /** publicUrlSlug o id del inmueble que se está viendo. */
  inmueble?: string;
  /** publicSlug del asesor cuya página trajo al visitante. */
  agente?: string;
  /** "web" o "letrero". */
  fuente?: string;
  /** Liga de WhatsApp ya armada, o null si la cuenta no puso número. */
  whatsapp: string | null;
  etiquetas: {
    nombre: string;
    telefono: string;
    mensaje: string;
    enviar: string;
    whatsapp: string;
    aviso: string;
  };
  /** true = vista previa del editor: el botón no envía nada. */
  editando?: boolean;
}

export function ContactoForm({
  slug,
  inmueble,
  agente,
  fuente,
  whatsapp,
  etiquetas,
  editando,
}: ContactoFormProps) {
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const [enviando, empezar] = useTransition();

  /**
   * De dónde vino el visitante.
   *
   * 🔴 Se lee del `?f=` EN EL NAVEGADOR y no en el servidor a propósito: la
   * ficha es ISR, y leer searchParams en una ruta con `revalidate` lanza
   * DYNAMIC_SERVER_USAGE al regenerar y le devuelve un 500 al visitante.
   * Leerlo aquí, y solo al enviar, deja intacto el caché y no puede
   * provocar un desajuste de hidratación (no se pinta nada con él).
   *
   * Es lo que hace que el QR del letrero de la reja —el canal número uno en
   * México, del que nadie mide nada— entre al CRM marcado como "letrero".
   */
  function fuenteReal(): string {
    if (fuente) return fuente;
    try {
      return new URLSearchParams(window.location.search).get("f") === "letrero" ? "letrero" : "web";
    } catch {
      return "web";
    }
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (editando) return;
    setError(null);
    empezar(async () => {
      const r = await enviarProspectoWeb({
        slug,
        nombre,
        telefono,
        mensaje,
        inmueble,
        agente,
        fuente: fuenteReal(),
      });
      if (r.ok) {
        setListo(true);
        setNombre("");
        setTelefono("");
        setMensaje("");
      } else {
        setError(r.error ?? "No pudimos enviar tu mensaje. Inténtalo de nuevo.");
      }
    });
  }

  if (listo) {
    return (
      <div className="dcrw-form dcrw-form-ok" role="status">
        <p className="dcrw-form-oktitulo">Listo, ya llegó tu mensaje.</p>
        <p className="dcrw-form-oktexto">Te contactamos por WhatsApp lo antes posible.</p>
        {whatsapp ? (
          <a className="dcrw-btn dcrw-btn-whatsapp" href={whatsapp} target="_blank" rel="noopener noreferrer">
            <IcoWhatsApp />
            {etiquetas.whatsapp}
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <form className="dcrw-form" onSubmit={onSubmit} noValidate>
      <label className="dcrw-campo">
        <span>{etiquetas.nombre}</span>
        <input
          type="text"
          name="nombre"
          autoComplete="name"
          maxLength={80}
          required
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
        />
      </label>

      <label className="dcrw-campo">
        <span>{etiquetas.telefono}</span>
        <input
          type="tel"
          name="telefono"
          autoComplete="tel"
          inputMode="numeric"
          maxLength={20}
          required
          value={telefono}
          onChange={(e) => setTelefono(e.target.value)}
        />
      </label>

      <label className="dcrw-campo dcrw-campo-ancho">
        <span>{etiquetas.mensaje}</span>
        <textarea
          name="mensaje"
          rows={3}
          maxLength={900}
          value={mensaje}
          onChange={(e) => setMensaje(e.target.value)}
        />
      </label>

      {error ? (
        <p className="dcrw-form-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="dcrw-form-pie">
        <button type="submit" className="dcrw-btn dcrw-btn-primario" disabled={enviando || editando}>
          {enviando ? "Enviando…" : etiquetas.enviar}
        </button>
        {whatsapp ? (
          <a className="dcrw-btn dcrw-btn-whatsapp" href={whatsapp} target="_blank" rel="noopener noreferrer">
            <IcoWhatsApp />
            {etiquetas.whatsapp}
          </a>
        ) : null}
      </div>

      <p className="dcrw-form-aviso">{etiquetas.aviso}</p>
    </form>
  );
}
