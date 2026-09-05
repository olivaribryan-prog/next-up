# Next Up

A small app for planning dates with friends: suggest ideas, vote on them, and see what's coming up on a calendar.

- **Ideas & poll** — anyone can suggest a place/activity (free or with a cost), and everyone votes. Live updates via Supabase Realtime.
- **Calendar** — schedule a date for any idea, see it grouped by month, mark it done once it's happened.
- **Sign-in** — lightweight: just a name + email, stored in `participants`. No passwords.

## Stack

- Next.js 14 (App Router) + TypeScript
- Supabase (Postgres + Realtime), tables: `participants`, `date_ideas`, `votes`
- Deployed on Vercel

## Local development

```bash
npm install
npm run dev
```

Copy `.env.local.example` to `.env.local` and fill in your Supabase project URL and publishable (anon) key — find both in Supabase → Project Settings → API.

## Deploying

1. Push this repo to GitHub.
2. Import it in Vercel.
3. In Vercel → Project → Settings → Environment Variables, add:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Redeploy.

## A note on access

This app uses Supabase's public (anon) key with open row-level-security policies, since sign-in is just name + email rather than real authentication. That's a reasonable tradeoff for a small private group sharing a link, but anyone with the link and a bit of curiosity could read or write data directly through the Supabase API. Don't put anything sensitive in it, and if you ever open it up beyond a trusted friend group, switch to real Supabase Auth first.
