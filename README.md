# Scanme

A private, offline-capable barcode reader for screenshots. Paste, drop, or upload an
image and Scanme finds common 1D and 2D barcodes locally with `zxing-wasm`. An
optional Tesseract.js action extracts text from the same image.

Built with Better-T-Stack, React, TanStack Router, Tailwind CSS, and Vite PWA.
Scanning, OCR, and history remain browser-only. Images are uploaded only when a
user opens the missed-barcode report dialog, reviews the sanitized preview, checks
the consent box, and submits it.

OCR runtime and English language assets are served from the app itself. They load
only when OCR is requested and are cached for later offline use.

## Local development

```bash
bun install
bun run dev
```

Open [http://localhost:3001](http://localhost:3001).

Useful checks:

```bash
bun run check-types
bun run test
bun run build
```

## Optional PostHog analytics

Copy `apps/web/.env.example` to `apps/web/.env` and add the public project key from
an EU Cloud PostHog project. Without a key, analytics remain disabled.

PostHog is configured as cookieless and anonymous, with autocapture and session
recording disabled. Only coarse scan timing, count, source, status, and format names
are sent—never images, filenames, dimensions, decoded contents, or URLs.

## Cloudflare deployment

The production build uses a Cloudflare Worker with Static Assets at
`scan.bedeh.ro`. The Worker serves the PWA, accepts consented reports, and exposes
the Access-protected report viewer at `/reports`.

### Required Cloudflare resources

- A private R2 bucket named `scanme-reports`, bound to the Worker as `REPORTS`.
- A 30-day R2 object lifecycle rule covering the whole bucket.
- A managed Turnstile widget for `scan.bedeh.ro`, `localhost`, and `127.0.0.1`.
- A Cloudflare Access self-hosted application covering `/reports`,
  `/reports/*`, `/api/admin/reports`, and `/api/admin/reports/*`.
- An Access Allow policy for the owner's exact email address, requiring the
  One-time PIN login method. Keep that address in deployment configuration rather
  than source control.

The Access application audience and team domain replace the safe placeholder
values in `apps/web/wrangler.jsonc`. Keep `workers_dev` and preview URLs disabled,
otherwise a secondary hostname could bypass the Access policy.

Create the R2 bucket and retention rule idempotently:

```bash
cd apps/web
bunx wrangler r2 bucket info scanme-reports ||
  bunx wrangler r2 bucket create scanme-reports
bunx wrangler r2 bucket lifecycle list scanme-reports
bunx wrangler r2 bucket lifecycle add scanme-reports scanme-reports-30-days \
  --expire-days 30
```

Do not add the lifecycle rule again if `scanme-reports-30-days` already appears in
the list.

Set the private Turnstile secret through Wrangler's secure prompt, never in source
control or command arguments:

```bash
bunx wrangler secret put TURNSTILE_SECRET
```

Place the widget's public sitekey in an ignored `apps/web/.env.production` file:

```dotenv
VITE_PUBLIC_TURNSTILE_SITE_KEY=your_public_sitekey
VITE_APP_VERSION=production
```

Then deploy:

```bash
cd apps/web
bunx wrangler login
cd ../..
bun run deploy
```

The `bedeh.ro` zone and R2 bucket must be in the authenticated Cloudflare account.
After deployment, verify that:

1. A report submission creates one `images/` object and one `metadata/` object.
2. `/reports` requests an emailed PIN and rejects every email except the configured
   owner address.
3. The viewer can preview, download, and permanently delete a report.
4. The R2 lifecycle list shows a 30-day expiration rule.

The bucket remains private. The R2 dashboard is the fallback review path. Neither
`robots.txt` nor `noindex` is treated as security; Cloudflare Access and Worker JWT
validation are the security boundary.
