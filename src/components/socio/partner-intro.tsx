/**
 * Presentación del socio — foto + texto propio, en /socio/<slug>.
 *
 * UNA sola implementación, usada por la página pública Y por la vista previa
 * del panel del afiliado. Es a propósito: si la vista previa tuviera su propia
 * copia del maquetado, cualquier cambio en una dejaría a la otra enseñando
 * algo que no es, y el socio aprobaría a ciegas un diseño que no va a ver.
 *
 * Server-safe: sin "use client", sin hooks. Solo estructura y clases.
 *
 * EL TEXTO ES TEXTO PLANO. Se pinta con `{bio}` dentro de un <p>, así que
 * React lo escapa: si el socio escribe `<script>` o `<b>hola</b>`, el visitante
 * lee esos caracteres tal cual. Es contenido de un tercero en nuestro dominio
 * y jamás se interpreta como marcado — ni HTML, ni markdown.
 */
import "./partner-intro.css";

export interface PartnerIntroProps {
  /** Nombre del socio, tal como está en su cuenta. Él no lo edita. */
  name: string;
  photoUrl: string | null;
  bio: string | null;
}

/**
 * Devuelve null si no hay ni foto ni texto: un socio que no personalizó nada
 * no gana un bloque vacío, su página queda exactamente como siempre.
 */
export function PartnerIntro({ name, photoUrl, bio }: PartnerIntroProps) {
  if (!photoUrl && !bio) return null;

  return (
    <section className="dcsi" aria-labelledby="dcsi-name">
      <div className="dcsi__container">
        <div className="dcsi__card">
          {photoUrl ? (
            // <img> y no next/image: la foto vive en Supabase Storage y el
            // host no está en images.remotePatterns de next.config, así que el
            // optimizador la rechazaría. width/height fijos para que no haya
            // salto de maquetación mientras carga.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="dcsi__photo"
              src={photoUrl}
              alt={`Foto de ${name}`}
              width={124}
              height={124}
              loading="lazy"
              decoding="async"
            />
          ) : null}

          <div className="dcsi__body">
            <span className="dcsi__eyebrow">Quién te recomienda</span>
            <h2 className="dcsi__name" id="dcsi-name">
              {name}
            </h2>
            {bio ? <p className="dcsi__bio">{bio}</p> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
