import { S3Client } from '@aws-sdk/client-s3';

/**
 * Cloud808 is our own self-hosted MinIO server (see the sibling Cloud808
 * repo) -- an S3-COMPATIBLE object store, not AWS. @aws-sdk/client-s3 is
 * used here purely as a protocol client because MinIO speaks the S3 API;
 * no request from this module ever reaches an AWS endpoint. `endpoint` is
 * always our own CLOUD808_ENDPOINT, and `forcePathStyle: true` is required
 * for MinIO (it doesn't do virtual-hosted-style bucket subdomains).
 *
 * Both sites share one MinIO server/endpoint but write to their own bucket:
 *   cry808      -> CLOUD808_CRY808_BUCKET,      served from CLOUD808_CRY808_PUBLIC_URL
 *   2koveralls  -> CLOUD808_2KOVERALLS_BUCKET,  served from CLOUD808_2KOVERALLS_PUBLIC_URL
 *
 * All of CLOUD808_ACCESS_KEY / CLOUD808_SECRET_KEY / CLOUD808_ENDPOINT live
 * only in this backend's environment. They are never sent to, or readable
 * by, either frontend.
 */

const SITES = {
  cry808: {
    bucketEnv: 'CLOUD808_CRY808_BUCKET',
    publicUrlEnv: 'CLOUD808_CRY808_PUBLIC_URL',
  },
  '2koveralls': {
    bucketEnv: 'CLOUD808_2KOVERALLS_BUCKET',
    publicUrlEnv: 'CLOUD808_2KOVERALLS_PUBLIC_URL',
  },
};

let s3Client = null;

function getClient() {
  if (!s3Client) {
    s3Client = new S3Client({
      endpoint: process.env.CLOUD808_ENDPOINT,
      region: 'us-east-1', // required by the SDK; ignored by MinIO
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.CLOUD808_ACCESS_KEY,
        secretAccessKey: process.env.CLOUD808_SECRET_KEY,
      },
    });
  }
  return s3Client;
}

/**
 * True only when every env var needed to actually talk to Cloud808 for the
 * given site is present. Callers use this to decide whether to attempt
 * Cloud808 at all -- when false (e.g. this dev machine, which has no
 * production Cloud808 credentials), storage.js skips straight to the
 * Cloudinary/ImageKit path with no behavior change from before this
 * integration existed.
 */
export function isCloud808Configured(site) {
  const siteConfig = SITES[site];
  if (!siteConfig) return false;
  return Boolean(
    process.env.CLOUD808_ENDPOINT &&
    process.env.CLOUD808_ACCESS_KEY &&
    process.env.CLOUD808_SECRET_KEY &&
    process.env[siteConfig.bucketEnv] &&
    process.env[siteConfig.publicUrlEnv]
  );
}

/**
 * Resolves the bucket name + public delivery URL base for a site.
 * Throws on an unknown site -- that's a programming error at the call
 * site, not a runtime/config condition to fall back from.
 */
export function getCloud808SiteConfig(site) {
  const siteConfig = SITES[site];
  if (!siteConfig) {
    throw new Error(`[cloud808] Unknown site "${site}" -- expected one of: ${Object.keys(SITES).join(', ')}`);
  }
  return {
    bucket: process.env[siteConfig.bucketEnv],
    publicUrlBase: process.env[siteConfig.publicUrlEnv],
  };
}

export function getCloud808Client() {
  return getClient();
}
