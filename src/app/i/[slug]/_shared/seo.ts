import "server-only";

/* ═══════════════════════════════════════════════════════════════════════
   SEO Y DATOS ESTRUCTURADOS DE LA WEB PÚBLICA DE INMUEBLES.

   Para muchas cuentas esta página es su ÚNICO sitio: lo que ponen en la
   bio de Instagram y lo que Google indexa. El título, la descripción, la
   imagen social y el JSON-LD no son un adorno.

   ── EL TIPO CAMBIA CON EL MODO, PORQUE EL SUJETO CAMBIA ───────────
   · AGENT  → RealEstateAgent + Person. El sujeto es la persona, y sus
     credenciales van marcadas como `hasCredential`: con los resúmenes de
     IA comiéndose los clics, E-E-A-T pesa, y una acreditación verificable
     es exactamente la señal que esos sistemas buscan citar.
   · AGENCY → RealEstateAgent (que EN SCHEMA.ORG YA ES un LocalBusiness y
     una Organization: no existe ningún "RealEstateOrganization", y
     inventarse un tipo hace que Google ignore el bloque entero).
   · OWNER  → NADA de negocio. Un rentista no es una inmobiliaria y
     marcarlo como tal sería falso; su página se marca como WebSite y sus
     inmuebles como ItemList.
   · Los tres → RealEstateListing en cada ficha, con BreadcrumbList.

   ── LO QUE NO SE PONE, Y POR QUÉ ─────────────────────────────────
   `aggregateRating` y `review`. Los testimonios de esta web los escribe la
   propia cuenta en su editor: no vienen de Google ni de un tercero
   verificable. Marcarlos sería pedirle a Google estrellas en el buscador a
   partir de un texto que escribió el interesado — justo lo que sus guías
   de reseñas autogeneradas prohíben, y por lo que se penaliza el sitio
   entero. Se pintan en la página, no en el JSON-LD.

   Y el FAQPage SOLO se emite con las preguntas que de verdad están
   escritas y visibles en la ficha (las arma preguntasDeFicha con datos
   reales del inmueble). Un FAQPage cuyo contenido no aparece en pantalla
   es motivo de acción manual.
   ═══════════════════════════════════════════════════════════════════════ */

import type { Metadata } from "next";
import { SITE_URL } from "@/lib/seo";
import {
  fotoPortada,
  precioInmueble,
  recamaras as fmtRecamaras,
  rutaAgenteWeb,
  rutaContactoWeb,
  rutaInmuebleWeb,
  rutaPropiedadesWeb,
  rutaWebInmobiliaria,
  superficie,
  ubicacionPublica,
  urlFacebook,
  urlInstagram,
  urlLinkedin,
  urlTiktok,
  urlYoutube,
  type RealtyWebAgenteDTO,
  type RealtyWebConfig,
  type RealtyWebCuentaDTO,
  type RealtyWebInmuebleDTO,
} from "@/lib/realty/landing";
import {
  REALTY_OPERATION_LABELS,
  REALTY_PROPERTY_KIND_LABELS,
  type RealtyPropertyKind,
} from "@/lib/realty/types";

export const BASE_URL = SITE_URL;

export function urlAbsoluta(ruta: string): string {
  return `${BASE_URL}${ruta}`;
}

/* ── Metadata ─────────────────────────────────────────────────────── */

function tituloPorModo(cuenta: RealtyWebCuentaDTO): string {
  const donde = cuenta.ciudad ? ` en ${cuenta.ciudad}` : "";
  if (cuenta.modo === "AGENT") return `${cuenta.nombre} — Asesor inmobiliario${donde}`;
  if (cuenta.modo === "OWNER") return `${cuenta.nombre} — Inmuebles en renta${donde}`;
  return `${cuenta.nombre} — Inmobiliaria${donde}`;
}

function descripcionPorModo(cuenta: RealtyWebCuentaDTO): string {
  const donde = cuenta.ciudad ? ` en ${cuenta.ciudad}` : "";
  if (cuenta.modo === "AGENT") {
    return `Casas, departamentos y terrenos${donde} con asesoría de principio a fin. Mira la cartera de ${cuenta.nombre} y agenda una visita.`;
  }
  if (cuenta.modo === "OWNER") {
    return `Rentas directo con el dueño${donde}, sin comisión de inmobiliaria. Mira qué está disponible y pregunta por WhatsApp.`;
  }
  return `Inventario de casas, departamentos y terrenos${donde}. Busca por zona, precio y recámaras con ${cuenta.nombre}.`;
}

export function tituloSeo(cuenta: RealtyWebCuentaDTO, config: RealtyWebConfig): string {
  return config.seoTitulo || tituloPorModo(cuenta);
}

export function descripcionSeo(cuenta: RealtyWebCuentaDTO, config: RealtyWebConfig): string {
  return (config.seoDescripcion || descripcionPorModo(cuenta)).slice(0, 165);
}

export function imagenSocial(config: RealtyWebConfig, cuenta: RealtyWebCuentaDTO): string | null {
  return config.ogImagen || config.fotos.portada || config.fotos.retrato || cuenta.logo || null;
}

/** La metadata común: canonical, robots, Open Graph y Twitter. */
export function metadataDe(opciones: {
  titulo: string;
  descripcion: string;
  ruta: string;
  imagen: string | null;
  indexable: boolean;
  nombre: string;
}): Metadata {
  const url = urlAbsoluta(opciones.ruta);
  const imagenes = opciones.imagen ? [opciones.imagen] : [];
  return {
    title: { absolute: opciones.titulo },
    description: opciones.descripcion,
    alternates: { canonical: url },
    // Una cuenta que apagó su web —o cuya suscripción no está al día— no se
    // queda indexada. Se sigue sirviendo, pero deja de alimentar a Google.
    robots: opciones.indexable
      ? { index: true, follow: true }
      : { index: false, follow: false },
    openGraph: {
      type: "website",
      locale: "es_MX",
      url,
      siteName: opciones.nombre,
      title: opciones.titulo,
      description: opciones.descripcion,
      images: imagenes,
    },
    twitter: {
      card: imagenes.length > 0 ? "summary_large_image" : "summary",
      title: opciones.titulo,
      description: opciones.descripcion,
      images: imagenes,
    },
  };
}

/* ── JSON-LD ──────────────────────────────────────────────────────── */

function sinVacios<T extends Record<string, unknown>>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    out[k] = v;
  }
  return out as T;
}

function direccionLd(cuenta: RealtyWebCuentaDTO) {
  if (!cuenta.direccion && !cuenta.ciudad && !cuenta.estado) return null;
  return sinVacios({
    "@type": "PostalAddress",
    streetAddress: cuenta.direccion,
    addressLocality: cuenta.ciudad,
    addressRegion: cuenta.estado,
    addressCountry: "MX",
  });
}

function redesLd(config: RealtyWebConfig): string[] {
  return [
    urlInstagram(config.instagram),
    urlFacebook(config.facebook),
    urlTiktok(config.tiktok),
    urlYoutube(config.youtube),
    urlLinkedin(config.linkedin),
  ].filter((u): u is string => typeof u === "string");
}

/**
 * Las credenciales como `hasCredential`.
 *
 * Es el bloque que de verdad diferencia en este mercado: solo el 10% de
 * los asesores mexicanos está capacitado y el 15% pertenece a una
 * asociación. La licencia de la cuenta solo entra si sigue vigente —
 * aCuentaPublica ya la deja en null cuando venció.
 */
function credencialesLd(cuenta: RealtyWebCuentaDTO, config: RealtyWebConfig) {
  const out: Record<string, unknown>[] = [];
  if (cuenta.licencia) {
    out.push(
      sinVacios({
        "@type": "EducationalOccupationalCredential",
        credentialCategory: "license",
        name: `Licencia inmobiliaria ${cuenta.licencia.estado ?? "estatal"}`,
        identifier: cuenta.licencia.numero,
      }),
    );
  }
  for (const c of config.credenciales.slice(0, 8)) {
    out.push(
      sinVacios({
        "@type": "EducationalOccupationalCredential",
        name: c.titulo,
        identifier: c.folio ?? undefined,
        description: c.detalle ?? undefined,
      }),
    );
  }
  return out;
}

/** El bloque de la CUENTA, distinto según el modo. */
export function jsonLdCuenta(
  cuenta: RealtyWebCuentaDTO,
  config: RealtyWebConfig,
): Record<string, unknown> {
  const url = urlAbsoluta(rutaWebInmobiliaria(cuenta.slug));
  const imagen = imagenSocial(config, cuenta);
  const dir = direccionLd(cuenta);
  const redes = redesLd(config);
  const credenciales = credencialesLd(cuenta, config);

  const sitio = sinVacios({
    "@type": "WebSite",
    "@id": `${url}#sitio`,
    url,
    name: cuenta.nombre,
    inLanguage: "es-MX",
  });

  // OWNER: un rentista NO es una inmobiliaria. Marcarlo como negocio
  // inmobiliario sería falso, y Google trata los tipos de negocio local
  // con criterios que no le aplican.
  if (cuenta.modo === "OWNER") {
    return { "@context": "https://schema.org", "@graph": [sitio] };
  }

  const negocio = sinVacios({
    // RealEstateAgent ya ES LocalBusiness y Organization en schema.org. No
    // existe ningún "RealEstateOrganization": un tipo inventado hace que
    // Google descarte el bloque entero sin avisar.
    "@type": "RealEstateAgent",
    "@id": `${url}#negocio`,
    name: cuenta.nombre,
    url,
    image: imagen ?? undefined,
    logo: cuenta.logo ?? undefined,
    telephone: config.telefono || cuenta.telefono || undefined,
    // Solo el correo que la cuenta escribió en su editor: el de
    // RealtyAccount es su usuario del panel y ni siquiera se lee.
    email: config.correo || undefined,
    address: dir ?? undefined,
    areaServed: config.zonas.length > 0 ? config.zonas.slice(0, 24) : cuenta.ciudad ?? undefined,
    sameAs: redes,
    hasCredential: credenciales,
    description: descripcionSeo(cuenta, config),
  });

  const nodos: Record<string, unknown>[] = [sitio, negocio];

  // AGENT: además de la ficha de negocio, la PERSONA. Es la mitad del
  // producto en este modo — el 70% de los compradores mira la reputación
  // del asesor antes de decidir.
  if (cuenta.modo === "AGENT") {
    nodos.push(
      sinVacios({
        "@type": "Person",
        "@id": `${url}#persona`,
        name: cuenta.nombre,
        image: config.fotos.retrato || imagen || undefined,
        jobTitle: "Asesor inmobiliario",
        worksFor: { "@id": `${url}#negocio` },
        knowsAbout: config.zonas.slice(0, 24),
        hasCredential: credenciales,
        sameAs: redes,
      }),
    );
  }

  return { "@context": "https://schema.org", "@graph": nodos };
}

/** Tipo de schema.org del inmueble. Sin inventar: lo que no encaja es Place. */
const TIPO_SCHEMA: Record<RealtyPropertyKind, string> = {
  CASA: "House",
  DEPARTAMENTO: "Apartment",
  EDIFICIO: "ApartmentComplex",
  // Terreno, bodega, local, oficina y rancho no son vivienda: `Place` es
  // el tipo honesto. Marcar una bodega como `House` es mentir en el dato.
  TERRENO: "Place",
  BODEGA: "Place",
  LOCAL: "Place",
  OFICINA: "Place",
  RANCHO: "Place",
};

/** RealEstateListing de una ficha. */
export function jsonLdInmueble(
  cuenta: RealtyWebCuentaDTO,
  inm: RealtyWebInmuebleDTO,
): Record<string, unknown> {
  const url = urlAbsoluta(rutaInmuebleWeb(cuenta.slug, inm.ref));
  const portada = fotoPortada(inm);
  const imagenes = inm.fotos.slice(0, 6).map((f) => f.url);
  const enRenta = inm.operation === "RENTA";
  const precio = enRenta ? (inm.precioRenta ?? inm.precio) : inm.precio;

  const domicilio = sinVacios({
    "@type": "PostalAddress",
    // Igual que en la página: la calle solo si el propietario lo autorizó.
    streetAddress: inm.direccionExacta ? inm.direccion ?? undefined : undefined,
    addressLocality: inm.ciudad ?? undefined,
    addressRegion: inm.estado ?? undefined,
    addressCountry: "MX",
  });

  const acerca = sinVacios({
    "@type": TIPO_SCHEMA[inm.kind] ?? "Place",
    name: inm.titulo,
    address: Object.keys(domicilio).length > 1 ? domicilio : undefined,
    numberOfRooms: inm.recamaras ?? undefined,
    numberOfBathroomsTotal:
      inm.banos !== null || inm.mediosBanos !== null
        ? (inm.banos ?? 0) + (inm.mediosBanos ?? 0) * 0.5
        : undefined,
    floorSize:
      inm.construidoM2 !== null
        ? { "@type": "QuantitativeValue", value: inm.construidoM2, unitCode: "MTK" }
        : undefined,
    // Las coordenadas SOLO con dirección exacta: un `geo` a siete decimales
    // es la dirección que el propietario pidió no publicar, con otro nombre.
    geo:
      inm.direccionExacta && inm.lat !== null && inm.lng !== null
        ? { "@type": "GeoCoordinates", latitude: inm.lat, longitude: inm.lng }
        : undefined,
    photo: imagenes.length > 0 ? imagenes : undefined,
  });

  const oferta = sinVacios({
    "@type": "Offer",
    price: precio > 0 ? precio : undefined,
    priceCurrency: inm.moneda,
    availability:
      inm.status === "DISPONIBLE"
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
    businessFunction: enRenta
      ? "http://purl.org/goodrelations/v1#LeaseOut"
      : "http://purl.org/goodrelations/v1#Sell",
    url,
  });

  return {
    "@context": "https://schema.org",
    ...sinVacios({
      "@type": "RealEstateListing",
      "@id": url,
      url,
      name: inm.titulo,
      description: inm.descripcion ?? undefined,
      datePosted: inm.publicadoEn,
      image: portada ? [portada.url, ...imagenes.filter((u) => u !== portada.url)] : imagenes,
      about: acerca,
      offers: precio > 0 ? oferta : undefined,
      provider: { "@type": "RealEstateAgent", name: cuenta.nombre, url: urlAbsoluta(rutaWebInmobiliaria(cuenta.slug)) },
    }),
  };
}

/** El asesor, en su propia página. */
export function jsonLdAgente(
  cuenta: RealtyWebCuentaDTO,
  agente: RealtyWebAgenteDTO,
): Record<string, unknown> {
  const url = urlAbsoluta(rutaAgenteWeb(cuenta.slug, agente.ref ?? ""));
  return {
    "@context": "https://schema.org",
    ...sinVacios({
      "@type": "RealEstateAgent",
      "@id": url,
      url,
      name: agente.nombre,
      image: agente.foto ?? undefined,
      description: agente.bio ?? undefined,
      areaServed: agente.zonas.slice(0, 24),
      knowsAbout: agente.especialidades.slice(0, 12),
      parentOrganization: {
        "@type": "RealEstateAgent",
        name: cuenta.nombre,
        url: urlAbsoluta(rutaWebInmobiliaria(cuenta.slug)),
      },
      hasCredential: agente.credenciales.map((c) =>
        sinVacios({
          "@type": "EducationalOccupationalCredential",
          name: c.titulo,
          identifier: c.folio ?? undefined,
          description: c.detalle ?? undefined,
        }),
      ),
    }),
  };
}

/** Las migas de pan, en el mismo orden en que se pintan. */
export function jsonLdMigas(
  migas: Array<{ nombre: string; ruta: string }>,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: migas.map((m, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: m.nombre,
      item: urlAbsoluta(m.ruta),
    })),
  };
}

/** El listado como ItemList (buscador y página del asesor). */
export function jsonLdListado(
  cuenta: RealtyWebCuentaDTO,
  inmuebles: RealtyWebInmuebleDTO[],
  nombre: string,
  total: number,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: nombre,
    numberOfItems: total,
    itemListElement: inmuebles.slice(0, 40).map((inm, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: inm.titulo,
      url: urlAbsoluta(rutaInmuebleWeb(cuenta.slug, inm.ref)),
    })),
  };
}

/* ── Las preguntas frecuentes de la ficha ─────────────────────────── */

export interface PreguntaFicha {
  pregunta: string;
  respuesta: string;
}

/**
 * Preguntas armadas con los DATOS REALES del inmueble.
 *
 * 🔴 Se pintan en la página Y se marcan como FAQPage. Ese orden importa:
 * un FAQPage cuyo contenido no está visible es motivo de acción manual de
 * Google. Por eso esta función es la única fuente de las dos cosas y la
 * ficha la recorre para pintarla.
 *
 * Solo entran preguntas que se pueden responder con lo que hay capturado:
 * nada de "¿acepta mascotas?" cuando la amenidad no está marcada.
 */
export function preguntasDeFicha(
  cuenta: RealtyWebCuentaDTO,
  inm: RealtyWebInmuebleDTO,
  requisitos: string[],
): PreguntaFicha[] {
  const out: PreguntaFicha[] = [];
  const que = REALTY_PROPERTY_KIND_LABELS[inm.kind] ?? "inmueble";
  const operacion = (REALTY_OPERATION_LABELS[inm.operation] ?? "").toLowerCase();

  const precio = inm.operation === "RENTA" ? (inm.precioRenta ?? inm.precio) : inm.precio;
  if (precio > 0) {
    out.push({
      pregunta:
        inm.operation === "RENTA"
          ? `¿Cuánto cuesta la renta de ${inm.titulo}?`
          : `¿Cuánto cuesta ${inm.titulo}?`,
      respuesta:
        inm.operation === "RENTA"
          ? `${precioInmueble(precio, inm.moneda)} al mes.${
              inm.mantenimiento ? ` El mantenimiento es de ${precioInmueble(inm.mantenimiento, inm.moneda)}.` : ""
            }`
          : `${precioInmueble(precio, inm.moneda)}.`,
    });
  }

  const donde = ubicacionPublica(inm);
  if (donde) {
    out.push({
      pregunta: `¿Dónde está ${inm.titulo}?`,
      respuesta: inm.direccionExacta
        ? `En ${donde}.`
        : `En ${donde}. La dirección exacta se comparte al coordinar la visita.`,
    });
  }

  const rec = fmtRecamaras(inm.recamaras);
  const m2 = superficie(inm.construidoM2) ?? superficie(inm.terrenoM2);
  if (rec || m2) {
    out.push({
      pregunta: `¿Qué tamaño tiene?`,
      respuesta: [rec, m2 ? `${m2} de construcción` : null].filter(Boolean).join(" y ") + ".",
    });
  }

  if (inm.tours.length > 0) {
    out.push({
      pregunta: `¿Se puede ver por dentro sin ir?`,
      respuesta: `Sí. Este ${que.toLowerCase()} tiene recorrido virtual: se abre desde esta misma página.`,
    });
  }

  if (requisitos.length > 0 && inm.operation !== "VENTA") {
    out.push({
      pregunta: `¿Qué se necesita para rentarlo?`,
      respuesta: requisitos.join(". ") + ".",
    });
  }

  // "venta o renta" no encaja detrás de "está": la etiqueta de AMBAS es un
  // sustantivo y las otras dos son locuciones ("en venta", "en renta"). Sin
  // esto, la ficha pinta —y el FAQPage INDEXA— "Este departamento está venta
  // o renta".
  const estado =
    inm.operation === "AMBAS" ? "disponible en venta o en renta" : operacion || "disponible";
  out.push({
    pregunta: `¿Cómo agendo una visita?`,
    respuesta: `Deja tus datos en el formulario de esta página o escribe por WhatsApp a ${cuenta.nombre}. Este ${que.toLowerCase()} está ${estado}.`,
  });

  return out;
}

export function jsonLdPreguntas(preguntas: PreguntaFicha[]): Record<string, unknown> | null {
  if (preguntas.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: preguntas.map((p) => ({
      "@type": "Question",
      name: p.pregunta,
      acceptedAnswer: { "@type": "Answer", text: p.respuesta },
    })),
  };
}

/* ── Migas listas ─────────────────────────────────────────────────── */

export function migasDe(
  cuenta: RealtyWebCuentaDTO,
  extra: Array<{ nombre: string; ruta: string }> = [],
): Array<{ nombre: string; ruta: string }> {
  return [{ nombre: cuenta.nombre, ruta: rutaWebInmobiliaria(cuenta.slug) }, ...extra];
}

export const RUTA_PROPIEDADES = rutaPropiedadesWeb;
export const RUTA_CONTACTO = rutaContactoWeb;
