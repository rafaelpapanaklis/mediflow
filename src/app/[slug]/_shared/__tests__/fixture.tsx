/* ============================================================
   LA CLÍNICA DE PRUEBA DE LAS PLANTILLAS DE LANDING.

   Una sola clínica ficticia con TODO lleno: servicios con precio y
   duración, dos doctores, testimonios, FAQs, galería, horarios,
   urgencias, meses sin intereses y una foto en CADA ranura del
   manifiesto. Así ninguna sección se oculta por falta de datos y el
   HTML que se compara cubre la plantilla entera.

   `landingSections` va VACÍO a propósito: es el caso que importa
   —la clínica que nunca tocó el editor— y el que prueba que los
   textos por defecto de la plantilla siguen saliendo igual después
   de instrumentarla.

   Sin "use client": esto no se compila, se ejecuta en node con tsx.
   ============================================================ */
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import type { LandingClinic } from "../types";
import { allPhotoSlotIds } from "../template-manifest";

import { ClinicLandingClient } from "../../landing-client";
import { TemplateFuturista } from "../../templates/template-futurista";
import { TemplateHealthtech } from "../../templates/template-healthtech";
import { TemplateCalido } from "../../templates/template-calido";
import { TemplateEquipo } from "../../templates/template-equipo";
import { TemplateSonrisa } from "../../templates/template-sonrisa";
import { TemplateConsultorio } from "../../templates/template-consultorio";
import { TemplateEspecialistas } from "../../templates/template-especialistas";

/* ------------------------------------------------------------------
   El reloj. Dos plantillas leen la fecha al pintar (el año del pie y
   el día de hoy en la tabla de horarios), así que sin congelarlo el
   HTML cambiaría cada día y el golden fallaría un lunes por nada.
   ------------------------------------------------------------------ */
const MOMENTO = Date.UTC(2026, 2, 4, 15, 0, 0); // miércoles 4 de marzo de 2026

export function congelarReloj() {
  const Real = Date;
  class Congelada extends Real {
    constructor(...args: any[]) {
      // @ts-expect-error — pasar los args tal cual es el punto
      super(...(args.length === 0 ? [MOMENTO] : args));
    }
    static now() { return MOMENTO; }
  }
  (globalThis as any).Date = Congelada;
}

/* ------------------------------------------------------------------
   La clínica
   ------------------------------------------------------------------ */

/** Una foto distinta por ranura: así se nota si una se pinta en el hueco de otra. */
function fotosDeTodasLasRanuras(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of allPhotoSlotIds().sort()) {
    out[id] = `https://ejemplo.test/storage/v1/object/public/clinic-public/landing/cl-1/${id}/1.webp`;
  }
  return out;
}

export const CLINICA_FIXTURE: LandingClinic = {
  id: "cl-1",
  name: "Clínica Dental Aurora",
  slug: "aurora",
  specialty: "Odontología general y estética",
  phone: "+52 55 1234 5678",
  email: "hola@aurora.test",
  address: "Av. Reforma 250, piso 4",
  city: "Ciudad de México",
  logoUrl: "https://ejemplo.test/logo.png",
  description: "Atendemos con cita, sin filas y con el costo cerrado antes de empezar.",
  landingThemeColor: "#0e7c66",
  landingCoverUrl: "https://ejemplo.test/portada-vieja.jpg",
  landingGallery: [
    "https://ejemplo.test/gal-1.jpg",
    "https://ejemplo.test/gal-2.jpg",
    "https://ejemplo.test/gal-3.jpg",
    "https://ejemplo.test/gal-4.jpg",
    "https://ejemplo.test/gal-5.jpg",
  ],
  landingTestimonials: [
    { name: "Mariana R.", text: "Me explicaron el plan completo antes de tocarme un diente.", rating: 5, meta: "hace 2 meses" },
    { name: "Julio C.",   text: "Llegué con dolor un domingo y me atendieron ese mismo día.", rating: 5, meta: "hace 3 semanas" },
    { name: "Ana P.",     text: "El presupuesto que me dieron fue el que pagué, sin sorpresas.", rating: 4, meta: "hace 1 año" },
  ],
  landingFaqs: [
    { q: "¿Aceptan tarjeta?", a: "Sí, débito y crédito, y manejamos meses sin intereses." },
    { q: "¿Atienden urgencias?", a: "Sí, con cita el mismo día si hay hueco." },
    { q: "¿Puedo llevar mi radiografía?", a: "Claro, tráela y la revisamos en la valoración." },
  ],
  landingServices: [
    { name: "Valoración y diagnóstico", desc: "Revisión completa con radiografía.", price: "$450", durationMin: 30, icon: "🦷" },
    { name: "Limpieza dental",          desc: "Ultrasonido y pulido.",              price: "$800", durationMin: 45, icon: "✨" },
    { name: "Resina estética",          desc: "Del color de tu diente.",            price: "$1,200", durationMin: 60, icon: "🪥" },
    { name: "Ortodoncia",               desc: "Brackets o alineadores.",            price: "$18,000", durationMin: 90, icon: "😁" },
  ],
  landingWhatsapp: "5215512345678",
  landingInstagram: "https://instagram.com/aurora",
  landingFacebook: "https://facebook.com/aurora",
  landingTiktok: "https://tiktok.com/@aurora",
  landingMapEmbed: "https://www.google.com/maps/embed?pb=demo",
  landingTagline: "Tu tratamiento, con el precio cerrado desde la primera cita",
  landingTemplate: "equipo",
  landingYearsExperience: 12,
  landingPatients: "8,400",
  // null a propósito: con ficha de Google la plantilla lanza un fetch en un
  // efecto, y en el render de servidor los efectos no corren. Dejarlo nulo
  // hace explícito que el golden es el HTML SIN reseñas de Google.
  googlePlaceId: null,
  landingSections: undefined,
  landingPhotos: fotosDeTodasLasRanuras(),
  landingUrgentText: "¿Traes dolor? Llámanos y te damos hueco hoy mismo.",
  landingMsiPlazos: [3, 6, 12],
  users: [
    { id: "u-1", firstName: "Laura",  lastName: "Méndez", specialty: "Ortodoncia",  color: "#0e7c66", avatarUrl: "https://ejemplo.test/dra.jpg", services: ["Ortodoncia", "Valoración y diagnóstico"] },
    { id: "u-2", firstName: "Andrés", lastName: "Gil",    specialty: "Endodoncia",  color: "#1d4ed8", avatarUrl: null,                            services: ["Resina estética"] },
  ],
  schedules: [
    { dayOfWeek: 0, enabled: true,  openTime: "09:00", closeTime: "19:00" },
    { dayOfWeek: 1, enabled: true,  openTime: "09:00", closeTime: "19:00" },
    { dayOfWeek: 2, enabled: true,  openTime: "09:00", closeTime: "19:00" },
    { dayOfWeek: 3, enabled: true,  openTime: "09:00", closeTime: "19:00" },
    { dayOfWeek: 4, enabled: true,  openTime: "09:00", closeTime: "15:00" },
    { dayOfWeek: 5, enabled: true,  openTime: "10:00", closeTime: "14:00" },
    { dayOfWeek: 6, enabled: false, openTime: "00:00", closeTime: "00:00" },
  ],
};

const DESTACADOS = ["Odontograma digital", "Radiografías", "Plan de tratamiento por pieza", "Evaluación periodontal"];

/* ------------------------------------------------------------------
   El registro de plantillas para las pruebas.

   Deliberadamente aparte del switch de clinic-landing-server.tsx: ese
   archivo importa prisma y no se puede cargar en node sin base. Si una
   plantilla instrumentada falta AQUÍ, la prueba truena en vez de
   saltársela — que es justo lo que queremos.
   ------------------------------------------------------------------ */
const PLANTILLAS: Record<string, (p: { clinic: LandingClinic; highlights?: string[] }) => ReactElement> = {
  classic:       ClinicLandingClient as any,
  futurista:     TemplateFuturista as any,
  healthtech:    TemplateHealthtech as any,
  calido:        TemplateCalido as any,
  equipo:        TemplateEquipo as any,
  sonrisa:       TemplateSonrisa as any,
  consultorio:   TemplateConsultorio as any,
  especialistas: TemplateEspecialistas as any,
};

/** Las ocho, en el orden del manifiesto. El golden se guarda para todas. */
export const PLANTILLAS_CON_GOLDEN = Object.keys(PLANTILLAS);

/** Dónde vive el HTML de referencia, relativo a la raíz del repo. */
export const CARPETA_GOLDEN = "src/app/[slug]/_shared/__tests__/html-publicado";

/**
 * LA OTRA CLÍNICA: la que no tiene nada.
 *
 * Sin equipo, sin testimonios, sin galería y con la semana entera cerrada.
 * Existe porque hay textos que SOLO se pintan en ese estado —el tercer acceso
 * de `equipo` dice "Cómo llegar" cuando no hay doctores, y la tabla de
 * horarios solo dice "Cerrado" si hay días cerrados—, y sin renderizarla esos
 * textos podrían declararse en el manifiesto y no existir en ninguna parte.
 *
 * NO se compara contra ninguna captura: solo sirve para comprobar presencia.
 */
export const CLINICA_VACIA: LandingClinic = {
  ...CLINICA_FIXTURE,
  users: [],
  landingTestimonials: [],
  landingGallery: [],
  landingFaqs: [],
  landingPhotos: {},
  landingCoverUrl: null,
  landingPatients: null,
  landingYearsExperience: null,
  landingMsiPlazos: [],
  landingUrgentText: null,
  schedules: CLINICA_FIXTURE.schedules.map(s => ({ ...s, enabled: false })),
};

/**
 * LA CLÍNICA DE UN SOLO DOCTOR.
 *
 * `sonrisa` y `especialistas` pintan la sección de equipo de DOS maneras
 * distintas: con un solo doctor cambian a un retrato grande —que es la ranura
 * de foto "doctor"— y a una lista de tratamientos con su rótulo. Con dos
 * doctores esa mitad de la plantilla no existe, así que sin este estado la
 * ranura y ese rótulo podrían declararse y no estar instrumentados.
 *
 * NO se compara contra ninguna captura: solo sirve para comprobar presencia.
 */
export const CLINICA_UN_DOCTOR: LandingClinic = {
  ...CLINICA_FIXTURE,
  users: [CLINICA_FIXTURE.users[0]],
};

/** El elemento de una plantilla con la clínica de prueba. */
export function elementoDePlantilla(tpl: string, clinica: LandingClinic = CLINICA_FIXTURE): ReactElement {
  const Plantilla = PLANTILLAS[tpl];
  if (!Plantilla) {
    throw new Error(
      `La plantilla "${tpl}" está marcada como instrumentada pero no está en el registro de pruebas ` +
      `(src/app/[slug]/_shared/__tests__/fixture.tsx). Agrégala ahí.`,
    );
  }
  return <Plantilla clinic={{ ...clinica, landingTemplate: tpl }} highlights={DESTACADOS} />;
}

/**
 * El HTML que sirve el servidor para la página PÚBLICA.
 *
 * `renderToString` y no `renderToStaticMarkup` a propósito: es el que
 * usa Next, marcas de hidratación incluidas. Si instrumentar añadiera
 * un separador de texto donde antes no lo había, eso ES un cambio en el
 * DOM público y esta prueba tiene que verlo.
 */
export function htmlPublicado(tpl: string): string {
  return renderToString(elementoDePlantilla(tpl));
}
