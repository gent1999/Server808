# Cloud808 storage integration

Server808's `utils/storage.js` can now upload new media to **Cloud808**
(our self-hosted MinIO server -- see the sibling `Cloud808` repo) instead
of Cloudinary. This is additive and opt-in per call site: nothing changes
for any upload that doesn't explicitly ask for it, and nothing changes at
all on a machine/environment where the `CLOUD808_*` env vars aren't set.

## Provider order

For a call site that passes `options.site`:

1. **Cloud808** -- attempted only when every `CLOUD808_*` env var needed
   for that site is present (`isCloud808Configured(site)`).
2. **Cloudinary** -- the fallback if Cloud808 is unconfigured, or if a
   configured Cloud808 upload throws for any reason.
3. **ImageKit** -- unchanged, last-resort fallback if Cloudinary also
   fails.

A call site that omits `options.site` entirely (or passes none) behaves
exactly as it did before this integration: Cloudinary, then ImageKit.

Every attempt and fallback is logged with the provider name and resulting
URL -- never with the access key/secret.

## Why AWS SDK v3 here doesn't mean AWS

`config/cloud808.js` uses `@aws-sdk/client-s3` purely as an S3-compatible
**protocol client**. Every request it makes goes to `CLOUD808_ENDPOINT` --
our own MinIO server -- never to an AWS endpoint. `forcePathStyle: true`
is required because MinIO addresses buckets as `endpoint/bucket/key`, not
via virtual-hosted subdomains the way AWS S3 does.

## Bucket / URL selection

Both sites share one MinIO server (`CLOUD808_ENDPOINT`) but write to their
own bucket, and are served back from their own public hostname:

| site         | bucket env                    | public URL env                     |
|--------------|--------------------------------|-------------------------------------|
| `cry808`     | `CLOUD808_CRY808_BUCKET`       | `CLOUD808_CRY808_PUBLIC_URL`        |
| `2koveralls` | `CLOUD808_2KOVERALLS_BUCKET`   | `CLOUD808_2KOVERALLS_PUBLIC_URL`    |

The final stored URL is `${PUBLIC_URL}/${bucket}/${key}`, matching the
already-live pattern `https://media.cry808.com/cry808/hello.txt`.

`spotifyEmbeds.js` is the one route with its own `site` column (values
`'cry808'` / legacy `'lowkeygrid'`); it maps `'lowkeygrid'` -> the Cloud808
site key `'2koveralls'` locally, without touching the stored DB value.

## Object keys

`<folder>/<YYYY>/<MM>/<uuid><ext>` -- `folder` is the same string each
route already passed to Cloudinary (`rap-blog`, `koveralls-articles`,
`2k-overalls`, etc.), so both providers organize media the same way. The
extension comes from the original filename (or the MIME type as a
fallback); nothing else about the user-supplied filename is used, so it
can't collide, and it can't inject a path.

## Wired routes

- **cry808**: `articles.js` (cover + 3 additional images, create + update),
  `artists.js`, `submissions.js` (image + document), `referralAds.js`.
- **2koveralls**: `overalls.js`, `koveralls-articles.js`,
  `lowkeygridArticles.js`, `spotifyEmbeds.js` (site-aware, see above).
- **Not wired (deliberately, this pass)**: `amazonProducts.js` -- its
  `/api/amazon-products` endpoint is called by both Cry808 and 2KOveralls
  with no `site` field to key off of, so there's no reliable way to pick a
  bucket. Left on the Cloudinary/ImageKit path until that route gains a
  way to identify which site an upload belongs to.

## Credentials

`CLOUD808_ACCESS_KEY` / `CLOUD808_SECRET_KEY` must be a **scoped-down
MinIO user** (read+write on the two buckets only) -- not the MinIO root
user. Create one on the production Cloud808 host with `mc admin user add`
and a policy limited to `s3:GetObject`/`s3:PutObject`/`s3:DeleteObject` on
`arn:aws:s3:::cry808/*` and `arn:aws:s3:::2koveralls/*` (MinIO accepts
AWS-style policy JSON). All four `CLOUD808_*` credential/endpoint vars
live only in Server808's environment (Vercel project env vars in
production) -- never in Cry808's or 2KOveralls's frontend env, and never
committed.

## Production access (resolved 2026-09-19)

The production Cloud808 host runs MinIO natively on Windows (Docker isn't
available there -- virtualization is disabled in that machine's firmware),
behind a Cloudflare Tunnel with three hostnames:

| Hostname | Purpose | Access |
|---|---|---|
| `media.cry808.com` | Public delivery, `cry808` bucket | Anonymous read-only |
| `media.2koveralls.com` | Public delivery, `2koveralls` bucket | Anonymous read-only |
| `storage.cry808.com` | Authenticated S3 API, both buckets | No anonymous access; requires the `server808` credentials |

`CLOUD808_ENDPOINT` must be `storage.cry808.com` -- the media.*.com
hostnames are read-only and reject writes with 403. This was corrected
here after initially guessing `media.cry808.com` before the production
side's tunnel layout was documented.

Server808 authenticates as a dedicated, restricted MinIO user (`server808`),
scoped to `GetObject`/`PutObject`/`DeleteObject` + minimal `ListBucket` on
just the `cry808` and `2koveralls` buckets -- not the MinIO root account.

**Real end-to-end upload testing was completed against production** from
the development PC on 2026-09-19, using credentials provided directly by
the user (stored only in Server808's local, gitignored `.env` -- never
committed): uploaded a real object to each bucket via `uploadImage()`
end-to-end (through the actual route-facing function, not a bypass),
confirmed each was fetchable at its public `media.*.com` URL, then deleted
both via `deleteImage()` and confirmed each returned 404 afterward. See the
session summary for the exact keys/results.
