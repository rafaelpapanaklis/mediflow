"use client";

/* ═══════════════════════════════════════════════════════════════════════
   EL LETRERO CON QR — el diferenciador más barato del vertical.

   🔴 POR QUÉ EXISTE: el letrero en la reja sigue siendo el canal número
   uno para vender y rentar en México, y NADIE mide si sirve. Quien pasa por
   la calle ve el letrero, escanea, entra a la ficha del inmueble, agenda
   visita — y el prospecto cae en el CRM con la fuente marcada "letrero".
   Por primera vez el asesor puede decir cuántos prospectos le trajo el
   cartón de la reja frente a lo que gasta en portales.

   La liga lleva `?f=letrero`. Se lee EN EL NAVEGADOR al enviar el
   formulario (contacto-form.tsx) y no en el servidor, porque la ficha es
   ISR y leer searchParams ahí lanza DYNAMIC_SERVER_USAGE.

   El QR se pinta en SVG con qrcode.react: se imprime nítido a cualquier
   tamaño y no depende de una imagen que el navegador podría no haber
   cargado al momento de imprimir. Nivel de corrección "M" (15%): sobrevive
   a una impresión regular y a algo de lluvia sin inflar la cuadrícula como
   haría "H".
   ═══════════════════════════════════════════════════════════════════════ */

import { useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { rutaInmuebleWeb, rutaWebInmobiliaria } from "@/lib/realty/landing";
import { REALTY_OPERATION_LABELS, REALTY_PROPERTY_KIND_LABELS } from "@/lib/realty/types";
import type { RealtyOperation, RealtyPropertyKind } from "@/lib/realty/types";

export interface InmuebleLetrero {
  ref: string;
  titulo: string;
  precio: string;
  operacion: RealtyOperation;
  kind: RealtyPropertyKind;
  colonia: string | null;
  folio: string | null;
}

const TAMANOS = [
  { id: "carta", nombre: "Carta", detalle: "21.6 × 27.9 cm — el de siempre", qr: 300 },
  { id: "media", nombre: "Media carta", detalle: "21.6 × 14 cm — para ventana", qr: 200 },
  { id: "tabloide", nombre: "Tabloide", detalle: "27.9 × 43.2 cm — se ve desde el coche", qr: 400 },
] as const;

type TamanoId = (typeof TAMANOS)[number]["id"];

export function GeneradorLetrero({
  slug,
  nombre,
  telefono,
  inmuebles,
  baseUrl,
}: {
  slug: string;
  nombre: string;
  telefono: string | null;
  inmuebles: InmuebleLetrero[];
  baseUrl: string;
}) {
  const [refElegida, setRefElegida] = useState<string>(inmuebles[0]?.ref ?? "");
  const [tamano, setTamano] = useState<TamanoId>("carta");
  const [rotulo, setRotulo] = useState("");

  const inm = inmuebles.find((i) => i.ref === refElegida) ?? null;
  const tam = TAMANOS.find((t) => t.id === tamano) ?? TAMANOS[0];

  const url = useMemo(() => {
    const ruta = inm ? rutaInmuebleWeb(slug, inm.ref) : rutaWebInmobiliaria(slug);
    return `${baseUrl}${ruta}?f=letrero`;
  }, [baseUrl, slug, inm]);

  const titular = rotulo.trim() || (inm ? REALTY_OPERATION_LABELS[inm.operacion] : "Inmuebles disponibles");

  return (
    <div className="dcrwl">
      <div className="dcrwl-controles dcrwl-nopr">
        <label className="dcrwe-campo">
          <span className="dcrwe-etiqueta">Qué anuncia el letrero</span>
          <select
            className="dcrwe-input"
            value={refElegida}
            onChange={(e) => setRefElegida(e.target.value)}
          >
            <option value="">Toda mi web (sin inmueble concreto)</option>
            {inmuebles.map((i) => (
              <option key={i.ref} value={i.ref}>
                {i.titulo}
                {i.colonia ? ` — ${i.colonia}` : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="dcrwe-campo">
          <span className="dcrwe-etiqueta">Rótulo grande</span>
          <input
            type="text"
            className="dcrwe-input"
            maxLength={28}
            value={rotulo}
            placeholder={titular}
            onChange={(e) => setRotulo(e.target.value)}
          />
        </label>

        <div className="dcrwe-campo">
          <span className="dcrwe-etiqueta">Tamaño</span>
          <div className="dcrwl-tamanos">
            {TAMANOS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`dcrwe-btn ${tamano === t.id ? "dcrwe-btn-primario" : ""}`}
                aria-pressed={tamano === t.id}
                onClick={() => setTamano(t.id)}
              >
                {t.nombre}
              </button>
            ))}
          </div>
          <span className="dcrwe-ayuda">{tam.detalle}</span>
        </div>

        <button type="button" className="dcrwe-btn dcrwe-btn-primario" onClick={() => window.print()}>
          Imprimir
        </button>

        <p className="dcrwe-ayuda">
          Quien lo escanee llega a esta liga y, si deja sus datos, entra a tus prospectos con la
          fuente <strong>letrero</strong>. Así sabes cuántos te trajo la reja.
        </p>
        <p className="dcrwl-url">{url}</p>
      </div>

      {/* La hoja. En pantalla se ve encogida; al imprimir ocupa la página. */}
      <div className={`dcrwl-hoja dcrwl-hoja-${tamano}`}>
        <div className="dcrwl-hoja-cabeza">
          <span className="dcrwl-marca">{nombre}</span>
          {inm?.folio ? <span className="dcrwl-folio">{inm.folio}</span> : null}
        </div>

        <p className="dcrwl-titular">{titular}</p>

        {inm ? (
          <>
            <p className="dcrwl-inmueble">{inm.titulo}</p>
            <p className="dcrwl-datos">
              {REALTY_PROPERTY_KIND_LABELS[inm.kind]}
              {inm.colonia ? ` · ${inm.colonia}` : ""}
            </p>
            <p className="dcrwl-precio">{inm.precio}</p>
          </>
        ) : (
          <p className="dcrwl-inmueble">Mira todo lo que tenemos</p>
        )}

        <div className="dcrwl-qr">
          <QRCodeSVG value={url} size={tam.qr} level="M" marginSize={0} />
        </div>

        <p className="dcrwl-instruccion">Escanea con la cámara de tu celular</p>
        {telefono ? <p className="dcrwl-tel">{telefono}</p> : null}
      </div>
    </div>
  );
}
