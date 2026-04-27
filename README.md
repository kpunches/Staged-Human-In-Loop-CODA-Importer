# WGU Document Staging App

A human-in-the-loop review interface for WGU document imports into Coda.
Reviewers can inspect extracted data side-by-side with the original source file,
approve or flag individual fields, and trigger the Coda write only after
full sign-off by an Academic Director.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router) |
| Auth | next-auth v5 — magic link via Resend |
| Database | Postgres (Render managed) |
| ORM | Prisma |
| File storage | Cloudflare R2 |
| Email | Resend |
| Deployment | Render |

---

## Local setup

### 1. Clone and install

```bash
git clone <your-repo-url>
cd wgu-staging-app
npm install
```

### 2. Configure environment

```bash
cp .env.local.example .env.local
# Fill in all values — see comments in the file
```

Required env vars:
- `NEXTAUTH_SECRET` — generate with `openssl rand -base64 32`
- `DATABASE_URL` — local Postgres or Render connection string
- `RESEND_API_KEY` — from resend.com dashboard
- `RESEND_FROM_EMAIL` — a verified sender domain in Resend
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` — from Cloudflare dashboard
- `PIPELINE_API_TOKEN` — generate with `openssl rand -base64 32` (used by Claude pipeline)

### 3. Set up the database

```bash
# Run migrations
npm run db:migrate

# Generate Prisma client
npm run db:generate

# Seed default tenant
npm run db:seed
```

### 4. Run locally

```bash
npm run dev
# App runs at http://localhost:3000
```

---

## Cloudflare R2 setup

1. Go to Cloudflare dashboard → R2 → Create bucket: `wgu-staging-files`
2. Create an R2 API token (Account → R2 → Manage R2 API tokens)
   - Permissions: Object Read & Write
   - Copy Account ID, Access Key ID, Secret Access Key
3. Add to `.env.local`

For PDF rendering in the split-screen viewer, the R2 bucket does **not** need to be
publicly accessible — files are served via signed URLs with 15-minute expiry.

---

## Resend setup

1. Sign up at resend.com
2. Add and verify your sending domain (requires DNS access)
3. Copy the API key to `RESEND_API_KEY`
4. Set `RESEND_FROM_EMAIL` to `noreply@yourdomain.com`

> **Important for WGU demo**: Test that magic link emails actually arrive in
> `@wgu.edu` inboxes before the demo. WGU may have spam filters that block
> transactional email from unknown domains. If needed, add SPF/DKIM records
> for your sending domain in Resend's dashboard.

---

## Render deployment

The `render.yaml` in the root configures everything automatically:

1. Push this repo to GitHub
2. Go to render.com → New → Blueprint
3. Connect your GitHub repo
4. Render detects `render.yaml` and creates:
   - Web service: `wgu-staging-app`
   - Postgres database: `wgu-staging-db`
5. Add the secret env vars in the Render dashboard (those marked `sync: false`):
   - `RESEND_API_KEY`
   - `RESEND_FROM_EMAIL`
   - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`
   - `PIPELINE_API_TOKEN`

The build command runs `db:migrate` automatically on every deploy.

---

## Role system

| Role | What they can do |
|------|-----------------|
| `ID` | Approve / flag fields, add notes |
| `EPD` | Same as ID + approve competency-level fields |
| `AD` | Final sign-off — triggers Coda write |
| `ADMIN` | Manage users, tenants, all reviews |

Roles are assigned manually in the database after first sign-in.
To promote a user to AD:

```sql
UPDATE "User" SET role = 'AD' WHERE email = 'name@wgu.edu';
```

Or via Prisma Studio:

```bash
npm run db:studio
```

---

## Claude pipeline integration

After `doc-extractor` + `extract-qa` complete successfully, push the files
to the staging app using the included helper script:

```bash
python3 scripts/push_to_staging.py \
  --source   "/mnt/user-data/uploads/D944_CCW.pdf" \
  --json     "/home/claude/D944_CCW.extraction.json" \
  --doc-id   "4YIajnJqvo" \
  --program  "FNP" \
  --course   "D944" \
  --workflow CCW \
  --app-url  "https://wgu-staging-app.onrender.com" \
  --token    "$PIPELINE_API_TOKEN"
```

The script prints the review URL. Share it with the reviewer team.

---

## Multitenancy

- All data is scoped to a `tenant_id`
- Tenants are created in the `Tenant` table (use `db:seed` or `db:studio`)
- New users are auto-assigned to the `default` tenant on first sign-in
- To move a user to a different tenant, update their `tenantId` in the DB
- Future: self-serve tenant assignment based on email subdomain or AD group

---

## Upgrading auth to Entra ID (when IT approves)

1. Register an app in Azure Entra ID → note Client ID and Client Secret
2. In `render.yaml`, add `AZURE_AD_CLIENT_ID`, `AZURE_AD_CLIENT_SECRET`, `AZURE_AD_TENANT_ID`
3. In `src/app/api/auth/[...nextauth]/route.ts`, swap the Resend provider for the Azure AD provider:

```ts
import AzureAD from "next-auth/providers/azure-ad"

// Replace Resend(...) with:
AzureAD({
  clientId: process.env.AZURE_AD_CLIENT_ID!,
  clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
  tenantId: process.env.AZURE_AD_TENANT_ID!,
})
```

4. Remove the `sendVerificationRequest` override and the `signIn` domain check callback
   (Entra ID handles domain enforcement at the IdP level)
5. Redeploy — existing user records are preserved, only the auth provider changes

---

## Project structure

```
src/
├── app/
│   ├── api/
│   │   ├── auth/[...nextauth]/   # NextAuth handler
│   │   ├── approve/              # Final approval + Coda write trigger
│   │   ├── review/field/         # Field-level approve/flag
│   │   ├── upload/               # File upload from browser or pipeline
│   │   └── health/               # Render health check
│   ├── auth/
│   │   ├── signin/               # Magic link sign-in form
│   │   ├── verify/               # "Check your email" page
│   │   └── error/                # Auth error page
│   ├── dashboard/                # Review list (tenant-scoped)
│   ├── review/[id]/              # Split-screen review UI
│   └── layout.tsx / globals.css
├── components/review/
│   └── ReviewSplitScreen.tsx     # Main split-screen component
├── lib/
│   ├── auth/                     # NextAuth config + API token validation
│   ├── db/                       # Prisma client singleton
│   ├── email/                    # Resend magic link sender
│   └── storage/                  # Cloudflare R2 client
├── middleware.ts                  # Route protection
prisma/
├── schema.prisma                  # DB schema
├── migrations/0001_init.sql       # Initial migration
└── seed.ts                        # Default tenant seed
scripts/
└── push_to_staging.py             # Claude pipeline → staging app uploader
render.yaml                        # Render deployment config
```
