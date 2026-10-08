# Link Trace

Short links with a visitor log. Create a link, share `/r/your-slug`, and see clicks, unique visitors, IP addresses, referrers, and places. Add platform tags and share `/r/your-slug/instagram` so each channel is counted on its own. The app is Next.js, hosted on Vercel, with links and clicks stored in Supabase.

If the tables already exist, run `supabase/schema.sql` again to add tags.

## What a visit stores

- IP address
- A first-party visitor cookie (`lt_vid`) so the same browser counts as one visitor
- Browser user agent
- Referrer
- Country, region, and city from Vercel’s `x-vercel-ip-*` headers (filled in after deploy, not on localhost)

Known bots are stored and tagged, and left out of the headline counts. The dashboard is locked with `ADMIN_PASSWORD`. The redirect itself is public.

## Supabase

1. Create a project.
2. In the SQL editor, run [`supabase/schema.sql`](supabase/schema.sql).
3. Copy the project URL and the **service_role** key from Project Settings → API.

Row level security is enabled and there are no public policies. Only the service role key, used on the server, can read or write.

## Local

```bash
npm install
cp .env.example .env.local
npm run dev
```

Fill in `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `ADMIN_PASSWORD`.

## Vercel

1. Import this repo.
2. Add the Supabase integration, or set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `ADMIN_PASSWORD` yourself. Do not prefix the service role key with `NEXT_PUBLIC_`.
3. Deploy. Optional: set `NEXT_PUBLIC_APP_URL` to the public origin used in copied links. If unset, the app uses the request host.
