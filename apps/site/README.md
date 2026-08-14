# Docket site

Static marketing and download page, plus a Worker that serves the installers.

    node serve.mjs          # local preview on :4321

## Why there is a Worker at all

The installers are 92–161 MB each. Cloudflare caps Worker static assets at
**25 MiB per file**, so they cannot ship in the site bundle. `worker/index.ts`
streams them instead, from an R2 bucket when one is bound and otherwise from
the private release, and serves both from this site's own origin.

That indirection is the point. A public bucket URL would advertise the storage
provider and let anyone enumerate builds outside the page, so no download URL,
redirect, or error message names where the file actually came from. Range
requests are supported, so a dropped 130 MB download resumes.

    node --experimental-strip-types worker/index.test.mjs

## Turning downloads on

Nothing serves downloads until one of the two paths below is finished. Both
need one action that only the account owner can take.

### R2 (preferred)

No egress charge, no dependency on the release, and roughly 1.2 GB against a
10 GB free tier.

1. **Enable R2 on the account.** This is a dashboard action; the API refuses
   with `code: 10042` until it is done.
   <https://dash.cloudflare.com/444be2a92b72f0c993cdd8978eb47fff/r2>

2. **Re-authenticate wrangler.** A token issued before R2 was enabled carries
   no `r2` scope, and bucket commands fail on permissions even though R2 is
   now on. Check with `npx wrangler whoami`.

       npx wrangler login

3. **Create the bucket.** The name must match the `DOWNLOADS` binding.

       npx wrangler r2 bucket create docket-downloads

4. **Bind it.** Uncomment `r2_buckets` in `wrangler.jsonc`. It is commented by
   default because `wrangler deploy` fails when a binding names a bucket that
   does not exist yet.

5. **Stage the installers and upload them.** The publish step rewrites
   `public/downloads.json` with the real sizes and refuses to run if anything
   listed on the page is missing.

       gh release download v0.1.0 --dir ../../dist-release
       node scripts/publish-downloads.mjs --dry-run
       node scripts/publish-downloads.mjs

6. **Deploy.**

       npx wrangler deploy

### Private release (no R2)

Works today, but keeps the download path dependent on the release and its
token.

1. Create a fine-grained personal access token with **Contents: read** on the
   repository named in `BUILD_REPO`.
2. `npx wrangler secret put BUILD_TOKEN`
3. `npx wrangler deploy`

The Worker lists releases rather than asking for the latest one, because
GitHub defines "latest" as the newest **non-draft** release and the build
workflow drafts its releases while the macOS and Windows binaries are
unsigned. Asking for the latest returns 404 here.

## Keeping the page honest

`public/downloads.json` lists what the page offers. Every entry must match a
file the build actually produced, or the link 404s. The publish script fails
before uploading anything when an entry is missing, and reports any installer
that was built but is not listed.
