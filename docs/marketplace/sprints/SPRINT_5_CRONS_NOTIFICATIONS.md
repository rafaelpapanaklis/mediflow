# Sprint 5 — Crons + Notifications (Vercel Cron + Postmark + Twilio)

> **Objetivo:** Automatizar recordatorios del trial (días 7, 3, 1), renovaciones de suscripción, y mantenimiento de estados de módulos.
>
> **Tiempo estimado:** 1–2 días
>
> **Pre-requisitos:** Sprint 4 ✅ DONE

---

## Contexto del sprint

Sin este sprint, el trial expira sin avisar al doctor y los módulos vencidos no se desactivan. Aquí montamos los Vercel Crons que mantienen el sistema vivo.

Lee `BRIEF.md` sección 3.3 (cron jobs) y la sección 7 del brief original (templates de notificaciones).

---

## Tareas

### Tarea 5.1 — Configurar Vercel Crons

**`vercel.json`** (en raíz del proyecto):

```json
{
  "crons": [
    {
      "path": "/api/cron/trial-reminders",
      "schedule": "0 15 * * *"
    },
    {
      "path": "/api/cron/trial-expiry-check",
      "schedule": "0 * * * *"
    },
    {
      "path": "/api/cron/subscription-renewal",
      "schedule": "0 16 * * *"
    }
  ]
}
```

**Schedules en UTC:**
- 15:00 UTC = 9:00 AM CST (México) → recordatorios diarios
- 16:00 UTC = 10:00 AM CST → renovaciones diarias
- Cada hora → check de expiración

### Tarea 5.2 — Helper de seguridad para crons

Vercel Crons requieren proteger los endpoints. Crear `lib/cron-auth.ts`:

```ts
export function isAuthorizedCronRequest(request: Request): boolean {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}
```

Usar en cada endpoint de cron:

```ts
if (!isAuthorizedCronRequest(request)) {
  return new Response('Unauthorized', { status: 401 });
}
```

### Tarea 5.3 — Cron 1: Trial Reminders

**`app/api/cron/trial-reminders/route.ts`**

```ts
import { prisma } from '@/lib/prisma';
import { sendTrialReminderEmail, sendTrialReminderWhatsApp } from '@/lib/notifications';
import { isAuthorizedCronRequest } from '@/lib/cron-auth';

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const now = new Date();
  const in7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const in8d = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
  const in3d = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const in4d = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000);
  const in1d = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);
  const in2d = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);

  // 7 días: solo email
  const clinics7d = await prisma.clinic.findMany({
    where: {
      trialEndsAt: { gte: in7d, lt: in8d },
      trialNotified7d: false
    }
  });
  for (const clinic of clinics7d) {
    await sendTrialReminderEmail(clinic, 7);
    await prisma.clinic.update({
      where: { id: clinic.id },
      data: { trialNotified7d: true }
    });
  }

  // 3 días: email + WhatsApp
  const clinics3d = await prisma.clinic.findMany({
    where: {
      trialEndsAt: { gte: in3d, lt: in4d },
      trialNotified3d: false
    }
  });
  for (const clinic of clinics3d) {
    await sendTrialReminderEmail(clinic, 3);
    await sendTrialReminderWhatsApp(clinic, 3);
    await prisma.clinic.update({
      where: { id: clinic.id },
      data: { trialNotified3d: true }
    });
  }

  // 1 día: email + WhatsApp urgente
  const clinics1d = await prisma.clinic.findMany({
    where: {
      trialEndsAt: { gte: in1d, lt: in2d },
      trialNotified1d: false
    }
  });
  for (const clinic of clinics1d) {
    await sendTrialReminderEmail(clinic, 1);
    await sendTrialReminderWhatsApp(clinic, 1);
    await prisma.clinic.update({
      where: { id: clinic.id },
      data: { trialNotified1d: true }
    });
  }

  return Response.json({
    sent7d: clinics7d.length,
    sent3d: clinics3d.length,
    sent1d: clinics1d.length
  });
}
```

### Tarea 5.4 — Cron 2: Trial Expiry Check

**`app/api/cron/trial-expiry-check/route.ts`**

Este corre cada hora. Su trabajo es:

1. Identificar clínicas cuyo trial acaba de expirar (entre la última hora y ahora)
2. Si no tienen módulos activos → enviar email "Tu prueba terminó" + invalidar caches
3. Si tienen módulos activos → no hacer nada (ya pagaron, todo bien)

```ts
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  // Clínicas que expiraron en la última hora
  const justExpired = await prisma.clinic.findMany({
    where: {
      trialEndsAt: { gte: oneHourAgo, lt: now }
    },
    include: {
      modules: {
        where: { status: 'active' }
      }
    }
  });

  let notified = 0;
  for (const clinic of justExpired) {
    if (clinic.modules.length === 0) {
      await sendTrialExpiredEmail(clinic);
      notified++;
    }
  }

  return Response.json({ checked: justExpired.length, notified });
}
```

### Tarea 5.5 — Cron 3: Subscription Renewal

**`app/api/cron/subscription-renewal/route.ts`**

Maneja vencimientos de `clinic_modules`:

- Stripe y PayPal renuevan automáticamente, sus webhooks crean nueva Order. **No tocamos esos.**
- **SPEI requiere intervención manual.** Si `currentPeriodEnd < NOW()` y método es SPEI:
  - Marcar como `paused` (3 días de gracia)
  - Mandar email recordatorio
  - Si pasa otra semana sin renovar → marcar `cancelled`

```ts
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // SPEI vencidos → marcar paused
  const expiredSpei = await prisma.clinicModule.findMany({
    where: {
      paymentMethod: 'spei',
      status: 'active',
      currentPeriodEnd: { lt: now }
    },
    include: { clinic: true, module: true }
  });

  for (const cm of expiredSpei) {
    await prisma.clinicModule.update({
      where: { id: cm.id },
      data: { status: 'paused' }
    });
    await sendModulePausedEmail(cm.clinic, cm.module);
  }

  // Paused hace más de 7 días → cancelled
  const longPaused = await prisma.clinicModule.findMany({
    where: {
      status: 'paused',
      currentPeriodEnd: { lt: sevenDaysAgo }
    }
  });

  for (const cm of longPaused) {
    await prisma.clinicModule.update({
      where: { id: cm.id },
      data: { status: 'cancelled', cancelledAt: now }
    });
  }

  return Response.json({
    paused: expiredSpei.length,
    cancelled: longPaused.length
  });
}
```

### Tarea 5.6 — Servicio de notificaciones

**`lib/notifications/index.ts`**

Si MediFlow ya tiene `lib/email.ts` y `lib/whatsapp.ts` con Postmark/Twilio integrados (probable), reutilizar. Si no, crear.

**`lib/notifications/templates/trial-reminder.ts`**

```ts
export function getTrialReminderEmail(daysLeft: 7 | 3 | 1, clinic: Clinic) {
  const subjects = {
    7: 'Te quedan 7 días de prueba en MediFlow',
    3: '⏰ 3 días para que termine tu prueba',
    1: '🚨 Último día: tu prueba termina mañana'
  };

  return {
    subject: subjects[daysLeft],
    htmlBody: renderTemplate('trial-reminder', { clinic, daysLeft }),
  };
}
```

Crear plantillas HTML en `lib/notifications/templates/`. Si MediFlow ya usa Postmark Templates, **mejor crear los templates en Postmark** y solo pasarles variables desde el código:

```ts
await postmark.sendEmailWithTemplate({
  TemplateAlias: 'trial-reminder-7d',
  TemplateModel: { firstName, daysLeft, marketplaceUrl, ... },
  From: 'noreply@mediflow.app',
  To: clinic.email,
});
```

### Tarea 5.7 — Templates de WhatsApp con Twilio

```ts
// lib/notifications/whatsapp.ts
import { twilio } from '@/lib/twilio';

export async function sendTrialReminderWhatsApp(clinic: Clinic, daysLeft: number) {
  if (!clinic.phoneE164) return;

  const messages = {
    3: `🩺 Hola ${clinic.contactName}, tu prueba de MediFlow termina en 3 días. Asegura tu acceso eligiendo los módulos que más usas: ${process.env.APP_URL}/marketplace`,
    1: `🚨 ${clinic.contactName}, tu prueba de MediFlow termina MAÑANA. Activa tus módulos hoy para no perder acceso: ${process.env.APP_URL}/marketplace`
  };

  await twilio.messages.create({
    from: 'whatsapp:' + process.env.TWILIO_WHATSAPP_FROM,
    to: 'whatsapp:' + clinic.phoneE164,
    body: messages[daysLeft as 3 | 1]
  });
}
```

> **NOTA:** WhatsApp Business API requiere templates pre-aprobados para mensajes salientes. Asegúrate de tener un template aprobado antes de usar este flujo en producción. En sandbox/desarrollo cualquier mensaje funciona.

### Tarea 5.8 — Templates exactos de copy

Usar los textos exactos del `BRIEF.md` sección 7 para email y WhatsApp. Adaptar variables:

- `{{firstName}}` → `clinic.contactName`
- `{{trialEndsAt | date}}` → formatear fecha en español MX
- `{{patientCount}}`, `{{appointmentCount}}`, `{{recordCount}}` → queries reales
- `{{recommendedModules}}` → llamar `getTrialRecommendations()`
- `{{marketplaceUrl}}` → `${APP_URL}/marketplace`

### Tarea 5.9 — Verificación manual

Probar localmente cada cron manualmente:

```bash
# Trial reminders
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/trial-reminders

# Expiry check
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/trial-expiry-check

# Subscription renewal
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/subscription-renewal
```

Crear clínicas de test con fechas específicas para forzar cada caso:

- Clínica con `trial_ends_at = NOW() + 7 days 5 minutes` → debería disparar email 7d
- Clínica con `trial_ends_at = NOW() + 3 days` → debería disparar email + WA 3d
- Clínica con `trial_ends_at = NOW() + 1 day` → debería disparar email + WA 1d
- Clínica con `trial_ends_at = NOW() - 30 minutes` → debería disparar "trial expirado"
- Clínica con módulo SPEI vencido → debería marcarse como `paused`
- Clínica con módulo `paused` desde hace 8 días → debería marcarse como `cancelled`

Verificar:
- [ ] Los emails llegan a Postmark (revisar Activity)
- [ ] Los WhatsApp llegan a Twilio (revisar Console)
- [ ] Los flags `trialNotifiedXd` se actualizan
- [ ] No se duplican mensajes (idempotencia)
- [ ] El template HTML se ve bien (probar en Postmark preview)

### Tarea 5.10 — Configurar en Vercel

Cuando despliegues:

1. Configurar `CRON_SECRET` en Vercel Environment Variables
2. Vercel detectará automáticamente `vercel.json` y registrará los crons
3. En Vercel Dashboard → Settings → Cron Jobs verifica que aparezcan los 3
4. Espera al primer run programado o trigger manual desde Vercel para verificar

---

## Criterios de "DONE"

✅ Los 3 Vercel Crons configurados en `vercel.json`
✅ Endpoints protegidos con `CRON_SECRET`
✅ Notificaciones de 7d, 3d, 1d funcionando con email + WhatsApp
✅ Templates en Postmark (o HTML) con copy del brief
✅ SPEI vencidos se marcan como `paused` automáticamente
✅ Idempotencia probada (correr el cron 2 veces no duplica mensajes)
✅ Pruebas manuales con curl pasando
✅ `PROGRESS.md` actualizado

---

## Notas importantes

- 🚨 **CRON_SECRET es crítico.** Sin él, cualquiera puede triggerear los crons y mandar spam masivo.
- 🚨 **WhatsApp tiene rate limits.** Twilio cobra por mensaje. Si tienes 1000 clínicas en trial 3d, son 1000 mensajes. Considera throttling.
- 🚨 **Postmark también tiene límites.** Verificar el plan actual.
- 🚨 **Logs de notificaciones.** Considera guardar `notifications_sent` en una tabla para auditoría y debugging.

---

## Después de terminar

1. Actualiza `PROGRESS.md` (Sprint 5 ✅ DONE)
2. **DETÉNTE** y avisa a Rafael.
