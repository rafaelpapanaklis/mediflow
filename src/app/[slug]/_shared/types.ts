export interface LandingDoctor { id:string; firstName:string; lastName:string; specialty:string|null; color:string; avatarUrl:string|null; services:string[]; }
export interface LandingSchedule { dayOfWeek:number; enabled:boolean; openTime:string; closeTime:string; }
export interface LandingClinic {
  id:string; name:string; slug:string; specialty:string;
  phone:string|null; email:string|null; address:string|null; city:string|null;
  logoUrl:string|null; description:string|null;
  landingThemeColor:string|null; landingCoverUrl:string|null;
  landingGallery:string[]; landingTestimonials:any; landingFaqs:any; landingServices:any;
  landingWhatsapp:string|null; landingInstagram:string|null; landingFacebook:string|null;
  landingTiktok:string|null; landingMapEmbed:string|null; landingTagline:string|null;
  landingTemplate:string|null; landingYearsExperience:number|null; landingPatients:string|null;
  googlePlaceId:string|null;
  /* Landing v2 (sql/landing-v2.sql). Opcionales: una clínica que nunca abrió
     el editor nuevo los tiene en null y las plantillas caen a sus respaldos.
     Leerlos SIEMPRE por los helpers de landing-data.ts, nunca crudos. */
  landingSections?:unknown; landingPhotos?:unknown;
  landingUrgentText?:string|null; landingMsiPlazos?:number[];
  /* Landing v3 (sql/landing-copy.sql): { claveDelManifiesto: texto } con TODO
     el texto suelto que reescribió la clínica. Leerlo por copyMap/copyValue. */
  landingCopy?:unknown;
  /**
   * ws1-t1 (Ortodoncia conectada a la reserva web) — "Valoración de
   * ortodoncia" del catálogo de Configuración, SOLO si el módulo está
   * contratado en esta clínica. `null` si no aplica: la reserva se ve
   * exactamente como hoy. Se inyecta como un servicio más en
   * `booking-modal.tsx` (`toBookingClinic`), nunca en `landingServices`
   * (ese es JSON que edita la clínica a mano; esto no se guarda ahí).
   */
  orthoValoracion?: { name: string; durationMin: number } | null;
  users:LandingDoctor[]; schedules:LandingSchedule[];
}
export interface TemplateProps { clinic:LandingClinic; highlights?:string[]; }
