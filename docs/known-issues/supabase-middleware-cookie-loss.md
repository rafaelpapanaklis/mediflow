# Sub-bug latente: pérdida de cookies en `updateSession` middleware

**Detectado:** 2026-05-05 durante el fix del bug "cookie de clínica activa
en server" (PR `hotfix/auth-clinic-cookie`).
**Estado:** documentado, **NO arreglado**. Se trata aparte.
**Severidad:** baja en condiciones normales — alta en sesiones que
necesiten emitir varias cookies en el mismo request.

## Archivo

`src/lib/supabase/middleware.ts` — función `updateSession()`.

## Síntoma

Cuando `supabase.auth.getUser()` dispara internamente `set()` para
emitir varias cookies en el mismo request (típicamente: refresh del
`access_token` + emisión paralela de `refresh_token`, o cualquier flujo
donde el SDK de Supabase llame al callback `set` más de una vez), solo
la **última** cookie llamada queda en la respuesta.

Las cookies de llamadas previas se descartan, porque el callback
recrea el `NextResponse` desde cero en cada invocación.

## Causa

```ts
let response = NextResponse.next({ request: { headers: request.headers } });
const supabase = createServerClient(..., {
  cookies: {
    set(name, value, options) {
      const finalOptions = { ...options, maxAge: options?.maxAge ?? SESSION_MAX_AGE_SECONDS };
      request.cookies.set({ name, value, ...finalOptions });
      response = NextResponse.next({ request: { headers: request.headers } }); // <-- reset
      response.cookies.set({ name, value, ...finalOptions });
    },
    // ... idem en remove()
  },
});
```

`NextResponse.next({ request: ... })` no copia las `Set-Cookie`
headers que el response anterior pudiera tener — solo arranca un
response nuevo con las request headers (mutadas). La línea
`response = NextResponse.next(...)` dentro del callback efectivamente
"olvida" cualquier cookie que el response previo ya tenía escrita.

## Por qué no afecta el bug del activeClinicId

- La cookie `activeClinicId` se setea en route handlers
  (`/api/auth/post-login`, `/api/auth/callback`, `/api/switch-clinic`,
  `/api/admin/impersonate`) que **no pasan por este middleware**: el
  matcher es `/dashboard/:path*`, `/admin/:path*`, `/api/admin/:path*`.
- En requests al dashboard, el browser ya envió la cookie en el header
  `Cookie:` y el middleware no la borra del browser, solo no la
  re-emite (porque nada la está reescribiendo). El reset del response
  pisa otras cookies de Supabase, no de terceros.

## Cuándo sí mordería

- Si Supabase rota el `access_token` y el `refresh_token` en el mismo
  call y necesita emitir 2 `Set-Cookie` distintos: solo el segundo
  llegaría al browser. El primero se "pierde", el browser conserva la
  versión vieja de esa cookie hasta el siguiente refresh.
- Si en el futuro se agregan otras cookies que se emiten desde dentro
  del `set` callback (p.ej. una cookie de auditoría / preferencia
  refrescada en cada request), todas las anteriores a la última se
  pierden.

## Fix propuesto (futuro)

Crear el `NextResponse` UNA sola vez fuera del callback, y dentro del
callback solo hacer `response.cookies.set(...)` sin recrear:

```ts
const response = NextResponse.next({ request: { headers: request.headers } });
const supabase = createServerClient(..., {
  cookies: {
    get(name) { return request.cookies.get(name)?.value; },
    set(name, value, options) {
      const finalOptions = { ...options, maxAge: options?.maxAge ?? SESSION_MAX_AGE_SECONDS };
      request.cookies.set({ name, value, ...finalOptions });
      response.cookies.set({ name, value, ...finalOptions });
    },
    remove(name, options) {
      request.cookies.set({ name, value: "", ...options, maxAge: 0 });
      response.cookies.set({ name, value: "", ...options, maxAge: 0 });
    },
  },
});
```

Validar contra el ejemplo oficial de `@supabase/ssr` para confirmar
que la mutación de `request.cookies` es la única razón por la que el
response se recreaba (probablemente un copy-paste de un patrón viejo
del SDK).

## Plan de validación post-fix

1. Forzar refresh del `access_token` (sleep hasta que esté cerca de
   expirar, o cambiarlo manualmente) y verificar que **ambas** cookies
   `sb-...-access-token` y `sb-...-refresh-token` aparecen en el
   `Set-Cookie` de la respuesta del middleware.
2. Confirmar que la sesión sobrevive un cierre de browser y reapertura
   ya con el token rotado.
