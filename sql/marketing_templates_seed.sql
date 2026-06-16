-- ═══════════════════════════════════════════════════════════════════
-- Plantillas semilla GLOBALES del módulo Marketing (WS-MKT-T6)
--
-- OPCIONAL. La biblioteca (/dashboard/marketing/library) YA muestra estas
-- plantillas desde el set integrado en código
-- (src/lib/marketing/seed-templates.ts), así que NO necesitas aplicar esto
-- para que la biblioteca funcione.
--
-- Aplícalo solo si quieres que estas plantillas existan como filas globales
-- (clinicId = NULL) y se devuelvan por GET /api/marketing/templates (p. ej.
-- para que otras herramientas/terminales las consuman por la API).
--
-- Refleja el subconjunto UNIVERSAL (specialty = NULL) de seed-templates.ts.
--
-- ORDEN: aplica PRIMERO sql/marketing.sql (crea la tabla + RLS). Este script
-- es IDEMPOTENTE (ON CONFLICT (id) DO NOTHING) y seguro de re-correr.
-- Delimitador $mkt$ (NUNCA $$ pelado — el editor de Supabase rompe el parser).
-- APLICAR A MANO en el SQL editor de Supabase.
-- ═══════════════════════════════════════════════════════════════════

DO $mkt$
BEGIN
  IF to_regclass('public.marketing_templates') IS NULL THEN
    RAISE NOTICE 'Tabla marketing_templates inexistente — aplica antes sql/marketing.sql. Seed saltado.';
    RETURN;
  END IF;

  INSERT INTO "marketing_templates" ("id", "clinicId", "specialty", "kind", "title", "body", "tags")
  VALUES
    ('seed-idea-univ-equipo', NULL, NULL, 'IDEA', 'Conoce al equipo',
      E'Presenta a una persona del equipo: nombre, qué hace y un dato cercano (su frase favorita, por qué eligió esta profesión). Acerca la marca y genera confianza antes de la primera visita.',
      ARRAY['equipo','confianza','marca']::TEXT[]),

    ('seed-idea-univ-faq', NULL, NULL, 'IDEA', 'Resuelve una duda frecuente',
      E'Toma la pregunta que más te hacen y respóndela en 3 líneas. Cierra con: "¿Tienes otra duda? Escríbenos por mensaje directo." Educar posiciona a tu clínica como experta.',
      ARRAY['educativo','faq','autoridad']::TEXT[]),

    ('seed-idea-univ-antes-despues', NULL, NULL, 'IDEA', 'Antes y después',
      E'Comparte una transformación real (siempre con consentimiento firmado del paciente). Explica brevemente el procedimiento y el tiempo que tomó. Es el contenido que más agenda citas.',
      ARRAY['resultados','prueba-social','consentimiento']::TEXT[]),

    ('seed-idea-univ-detras', NULL, NULL, 'IDEA', 'Detrás de cámaras',
      E'Muestra el día a día: la preparación de tu espacio, la limpieza, la tecnología que usas. La transparencia tranquiliza a quien nunca te ha visitado.',
      ARRAY['cercanía','transparencia','reels']::TEXT[]),

    ('seed-idea-univ-testimonio', NULL, NULL, 'IDEA', 'Testimonio en video',
      E'Pide a un paciente satisfecho que cuente en 20 segundos cómo se sintió. Sin guion, natural. Un testimonio real vale más que cualquier anuncio.',
      ARRAY['testimonio','video','confianza']::TEXT[]),

    ('seed-caption-univ-bienvenida', NULL, NULL, 'CAPTION', 'Bienvenida a nuevos pacientes',
      E'¿Primera vez con nosotros? 💙\nEn {clinica} cuidamos cada detalle para que te sientas en confianza desde que entras.\nAgenda tu cita por mensaje directo o al {telefono}.\n📍 {ciudad}',
      ARRAY['bienvenida','nuevos-pacientes']::TEXT[]),

    ('seed-caption-univ-recordatorio', NULL, NULL, 'CAPTION', 'Recordatorio: agenda tu cita',
      E'Tu salud no puede esperar. ⏰\nAgenda hoy y aparta el horario que mejor te acomode.\n👉 Escríbenos por mensaje directo y con gusto te atendemos.',
      ARRAY['recordatorio','agenda']::TEXT[]),

    ('seed-caption-univ-promo', NULL, NULL, 'CAPTION', 'Promoción del mes',
      E'🎉 Promo de {mes}: {beneficio}.\nVálida hasta el {fecha} o hasta agotar lugares.\nAparta el tuyo por mensaje directo. ¡Te esperamos!',
      ARRAY['promoción','oferta']::TEXT[]),

    ('seed-caption-univ-tip', NULL, NULL, 'CAPTION', 'Tip de la semana',
      E'Tip de la semana 💡\n{tip_breve}\nGuárdalo para que no se te olvide y compártelo con quien lo necesite. 👇',
      ARRAY['tip','educativo','guardar']::TEXT[]),

    ('seed-caption-univ-gracias', NULL, NULL, 'CAPTION', 'Agradecimiento a pacientes',
      E'Gracias por confiar en nosotros 🙏\nCada sonrisa que sale de aquí es la razón por la que hacemos lo que hacemos.\nNos vemos pronto. 💙',
      ARRAY['agradecimiento','comunidad']::TEXT[]),

    ('seed-campaign-univ-servicio', NULL, NULL, 'CAMPAIGN', 'Lanzamiento de servicio nuevo',
      E'Campaña de 4 publicaciones para estrenar un servicio:\n1) Teaser: "Algo nuevo llega a {clinica}" (genera intriga).\n2) Revelación: qué es y para quién es.\n3) Beneficios: 3 razones para probarlo + precio de lanzamiento.\n4) Prueba social: primer testimonio o resultado.\nPublica una cada 2-3 días.',
      ARRAY['lanzamiento','plan','servicio']::TEXT[]),

    ('seed-campaign-univ-referidos', NULL, NULL, 'CAMPAIGN', 'Programa de referidos',
      E'Campaña para que tus pacientes te recomienden:\n1) Anuncio: "Recomienda y gana {beneficio}".\n2) Cómo participar en 2 pasos.\n3) Recordatorio con un testimonio de quien ya refirió.\nEl boca a boca es tu canal más barato y confiable.',
      ARRAY['referidos','fidelización','plan']::TEXT[]),

    ('seed-campaign-univ-temporada', NULL, NULL, 'CAMPAIGN', 'Campaña de temporada',
      E'Aprovecha una fecha (regreso a clases, fin de año, Día de las Madres):\n1) Conecta tu servicio con la temporada.\n2) Oferta o paquete especial con fecha límite.\n3) Últimos días: urgencia + lugares limitados.\nLas fechas dan un motivo natural para agendar.',
      ARRAY['temporada','estacional','plan']::TEXT[]),

    ('seed-brief-univ-fachada', NULL, NULL, 'IMAGE_BRIEF', 'Foto de recepción / fachada',
      E'Objetivo: transmitir limpieza y profesionalismo.\n• Luz natural, espacio ordenado y sin objetos personales a la vista.\n• Encuadre horizontal, a la altura de los ojos.\n• Incluye tu logo o un detalle de marca.\nEvita: desorden, cables visibles, iluminación amarilla.',
      ARRAY['foto','espacio','marca']::TEXT[]),

    ('seed-brief-univ-retrato', NULL, NULL, 'IMAGE_BRIEF', 'Retrato del especialista',
      E'Objetivo: humanizar a quien atiende.\n• Fondo neutro o el propio consultorio desenfocado.\n• Bata o uniforme limpio, sonrisa natural.\n• Vertical para que funcione en historias y reels.\nUsa esta foto en tu perfil y en publicaciones de "conoce al equipo".',
      ARRAY['retrato','equipo','foto']::TEXT[]),

    ('seed-brief-univ-carrusel', NULL, NULL, 'IMAGE_BRIEF', 'Carrusel educativo (5 slides)',
      E'Estructura de un carrusel que se guarda y comparte:\n1) Portada con la pregunta o el mito.\n2-4) Una idea por slide, frase corta + icono.\n5) Cierre con tu marca y llamado: "Agenda por mensaje directo".\nMantén la misma tipografía y colores en todos los slides.',
      ARRAY['carrusel','educativo','diseño']::TEXT[])
  ON CONFLICT ("id") DO NOTHING;

  RAISE NOTICE 'Plantillas semilla de marketing aplicadas (o ya existentes).';
END
$mkt$;
