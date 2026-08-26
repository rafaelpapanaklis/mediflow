export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════════
// /i/firmar/{token} — la liga que abre quien tiene que firmar.
//
// 🔴 UNA SOLA PANTALLA PARA TODO LO QUE NO SIRVE. `openSigningToken`
// devuelve null para: token con forma rara, token que no existe, vencido,
// revocado, quemado por intentos, o de un contrato anulado o en borrador.
// Los seis casos pintan EXACTAMENTE lo mismo. Quien pruebe ligas al azar
// no aprende nada — ni siquiera si el token existía. Es la diferencia
// deliberada con /share/p del dental, que dice "Link revocado" y con eso
// confirma que el token era bueno.
//
// 🔴 force-dynamic. Un documento a punto de firmarse no puede quedarse en
// el caché de Next ni en el de un proxy: dos personas distintas abren
// ligas distintas de la misma ruta. (La API que lo sirve además manda
// no-store en cada respuesta.)
//
// El idioma sale de la CUENTA, no del navegador: el contrato está
// redactado en ese idioma y unos botones en otro no ayudarían a nadie.
// ═══════════════════════════════════════════════════════════════════════
import type { Metadata } from "next";
import { ContractTablesMissingError, openSigningToken } from "@/lib/realty/contracts";
import { SignClient } from "@/components/realty/contracts/sign-client";
import type { PublicSigningDTO } from "@/components/realty/contracts/shared";
import type { Dictionary } from "@/i18n/t";
import contractsDict from "@/i18n/dictionaries/realty/contracts.json";

// El título no lleva el nombre del documento a propósito: se ve en el
// historial del navegador y en la vista de pestañas compartida.
export const metadata: Metadata = {
  title: "Documento para firmar",
  robots: { index: false, follow: false },
};

function dictFor(locale: "es" | "en"): Dictionary {
  return (contractsDict as unknown as Record<string, Dictionary>)[locale];
}

function LigaMuerta({ dict }: { dict: Dictionary }) {
  const f = dict.firmar as Dictionary;
  return (
    <div className="sgn">
      <div className="sgn__wrap">
        <div className="sgn__done" style={{ borderColor: "var(--border-soft)", background: "var(--bg-elev)" }}>
          <div className="sgn__done-title">{f.muertaTitle as string}</div>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: "var(--text-2)" }}>
            {f.muertaBody as string}
          </p>
        </div>
      </div>
    </div>
  );
}

export default async function Page({ params }: { params: { token: string } }) {
  let doc: PublicSigningDTO | null = null;
  try {
    doc = await openSigningToken(params.token);
  } catch (e) {
    // Ni siquiera "faltan las tablas" se le cuenta a quien abre la liga: no
    // es su problema y el nombre de un archivo del repo no le sirve de nada.
    // Al log del servidor sí, que es donde alguien puede arreglarlo.
    if (e instanceof ContractTablesMissingError) {
      console.error("[i/firmar] tablas ausentes:", e.detail);
    } else {
      console.error("[i/firmar]", e);
    }
    doc = null;
  }

  if (!doc) return <LigaMuerta dict={dictFor("es")} />;

  const dict = dictFor(doc.locale);
  return <SignClient dict={dict} token={params.token} doc={doc} />;
}
