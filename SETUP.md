# MediFlow — Setup Guide

## 1. Supabase

1. Ve a **supabase.com** → tu proyecto → **SQL Editor** → **New query**
2. Pega todo el contenido de `mediflow-create-tables.sql`
3. Haz clic en **Run** → deberías ver `MediFlow tables created successfully`

## 2. Variables de entorno en Vercel

Ve a tu proyecto en Vercel → **Settings** → **Environment Variables** y agrega:

| Variable | Dónde encontrarla |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → anon public key |
| `DATABASE_URL` | Supabase → Project Settings → Database → URI (con **?pgbouncer=true&connection_limit=1** al final) |
| `DIRECT_URL` | Supabase → Project Settings → Database → URI (sin modificar, puerto 5432) |
| `NEXT_PUBLIC_APP_URL` | Tu URL de Vercel, ej: `https://mediflow-pi.vercel.app` |

### Formato de DATABASE_URL (con PgBouncer):
```
postgresql://postgres.XXXX:PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
```

### Formato de DIRECT_URL:
```
postgresql://postgres.XXXX:PASSWORD@aws-0-us-east-1.pooler.supabase.com:5432/postgres
```

## 3. Supabase Auth — Redirect URLs

1. Supabase → **Authentication** → **URL Configuration**
2. **Site URL**: `https://tu-proyecto.vercel.app`
3. **Redirect URLs**: agrega `https://tu-proyecto.vercel.app/api/auth/callback`

## 4. Subir a GitHub y Vercel

```bash
git add .
git commit -m "feat: MediFlow completo con backend"
git push
```

Vercel detectará el push y desplegará automáticamente.

## Flujo de usuario

1. Usuario va a `/register` → llena el formulario de 5 pasos
2. Se crea cuenta en Supabase Auth + Clinic + User en DB en una transacción
3. Cada clínica tiene un `clinicId` único — todos los datos están aislados
4. Al hacer login, el middleware verifica la sesión
5. `getCurrentUser()` obtiene el usuario + clínica desde la DB
6. Todas las consultas filtran por `clinicId` — nunca se mezclan datos entre clínicas

## Stack

- **Next.js 14** (App Router, Server Components)
- **Supabase** (Auth + PostgreSQL)
- **Prisma ORM** (queries type-safe)
- **TailwindCSS** + Radix UI
- **Recharts** (gráficas)
