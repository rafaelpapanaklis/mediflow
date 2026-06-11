// Fallback de t() para las superficies PÚBLICAS que reusan estos componentes
// (p. ej. /live/[slug], que NO está bajo el I18nProvider del dashboard).
// Cubre solo las llaves usadas por live-mode.tsx y waiting-room.tsx, en
// español (idioma default del producto). Sin esto, useT() lanza fuera del
// provider y la vista pública muere en el ErrorBoundary ("No se pudo
// dibujar el plano").
import type { TFunction } from "@/i18n/t";

const FALLBACK_ES: Record<string, string> = {
  "pages.clinicLayout.assignChairsHint":
    "Asigna sillones a los elementos del layout para verlos aquí.",
  "pages.clinicLayout.backToNow": "Volver a ahora",
  "pages.clinicLayout.dayAgenda": "Agenda del día",
  "pages.clinicLayout.legendFree": "Libre",
  "pages.clinicLayout.legendOccupied": "Ocupado",
  "pages.clinicLayout.legendUpcoming": "Próximo",
  "pages.clinicLayout.next": "Próxima",
  "pages.clinicLayout.noPendingAppointments": "Sin citas pendientes",
  "pages.clinicLayout.odontogram": "Odontograma",
  "pages.clinicLayout.openRecordOdontogram": "Abrir expediente / odontograma",
  "pages.clinicLayout.waitingChairFallback": "Sillón",
  "pages.clinicLayout.waitingEmpty": "Sin pacientes esperando.",
  "pages.clinicLayout.waitingNow": "ahora",
  "pages.clinicLayout.waitingRoomTitle": "Sala de espera",
  "pages.clinicLayout.waitingSoundOff": "Sonido del llamado: silenciado",
  "pages.clinicLayout.waitingSoundOn": "Sonido del llamado: activo",
};

export const publicLiveFallbackT: TFunction = ((key: string) =>
  FALLBACK_ES[key] ?? key) as TFunction;
