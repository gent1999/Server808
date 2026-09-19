import ImageKit from 'imagekit';
import { randomUUID } from 'node:crypto';
import { Readable } from 'stream';
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import cloudinary from '../config/cloudinary.js';
import { isCloud808Configured, getCloud808SiteConfig, getCloud808Client } from '../config/cloud808.js';

/**
 * Shared image storage. Three providers, in priority order:
 *
 *   1. Cloud808 (self-hosted MinIO) -- used only when `options.site` is
 *      passed AND that site's env vars are fully configured (see
 *      config/cloud808.js). This is opt-in per call site so existing
 *      callers that don't pass `site` are completely unaffected.
 *   2. Cloudinary -- the long-standing primary, and the fallback whenever
 *      Cloud808 is unconfigured or a Cloud808 upload fails.
 *   3. ImageKit -- fallback of last resort, unchanged from before.
 *
 * There's no documented, stable way to detect "quota exceeded" specifically
 * from Cloudinary's Node SDK (checked -- no reliable error code/message to
 * key on), so the Cloudinary step falls back to ImageKit on ANY failure --
 * quota, outage, whatever. Same practical effect, no fragile error-message
 * matching. Every fallback is logged (provider + reason, never secrets) so
 * it's visible in logs which provider actually handled a given upload.
 */

const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
});

// Small, deliberately narrow map -- only the types this app actually
// uploads (images from multer, plus the odd submission document). Falls
// back to sniffing the original filename, then to a generic extension.
const EXTENSION_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'image/svg+xml': '.svg',
  'application/pdf': '.pdf',
};

function extensionFor(filename, contentType) {
  if (filename) {
    const match = /\.[a-zA-Z0-9]+$/.exec(filename);
    if (match) return match[0].toLowerCase();
  }
  if (contentType && EXTENSION_BY_MIME[contentType]) return EXTENSION_BY_MIME[contentType];
  return '.bin';
}

/**
 * Clean, collision-resistant object key: <folder>/<YYYY>/<MM>/<uuid><ext>.
 * Never derived from a user-supplied filename beyond its extension, so
 * nothing about the original name (or any path traversal attempt inside
 * it) reaches the stored key.
 */
function buildObjectKey(folder, filename, contentType) {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const ext = extensionFor(filename, contentType);
  return `${folder}/${yyyy}/${mm}/${randomUUID()}${ext}`;
}

async function uploadToCloud808(buffer, folder, site, { filename, contentType } = {}) {
  const { bucket, publicUrlBase } = getCloud808SiteConfig(site);
  const key = buildObjectKey(folder, filename, contentType);

  await getCloud808Client().send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType || 'application/octet-stream',
  }));

  return `${publicUrlBase.replace(/\/$/, '')}/${bucket}/${key}`;
}

function uploadToCloudinaryRaw(buffer, folder) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'auto' },
      (error, result) => (error ? reject(error) : resolve(result))
    );
    Readable.from(buffer).pipe(uploadStream);
  });
}

async function uploadToImageKit(buffer, folder) {
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const result = await imagekit.upload({
    file: buffer,
    fileName,
    folder: `/${folder}`,
  });
  return `${result.url}?ik-fileId=${result.fileId}`;
}

/**
 * Uploads an image buffer. Preferring Cloud808 (when `options.site` is
 * given and configured), then Cloudinary, then ImageKit.
 * @param {Buffer} buffer
 * @param {string} folder - e.g. 'rap-blog', 'koveralls-articles/thumbnails'
 * @param {Object} [options]
 * @param {'cry808'|'2koveralls'} [options.site] - enables the Cloud808
 *   attempt for this upload, and picks which bucket/public URL to use.
 *   Omit to keep the pre-Cloud808 behavior (Cloudinary -> ImageKit) exactly
 *   as it was.
 * @param {string} [options.filename] - original filename, used only to
 *   preserve the file extension.
 * @param {string} [options.contentType] - MIME type, stored as the
 *   object's Content-Type and used as an extension fallback.
 * @returns {Promise<string>} the resulting public URL
 */
export async function uploadImage(buffer, folder, options = {}) {
  const { site, filename, contentType } = options;

  if (site && isCloud808Configured(site)) {
    try {
      const url = await uploadToCloud808(buffer, folder, site, { filename, contentType });
      console.log(`[storage] Uploaded to Cloud808 (${site}): ${url}`);
      return url;
    } catch (cloud808Error) {
      console.warn(`[storage] Cloud808 upload failed for site "${site}", falling back to Cloudinary: ${cloud808Error.message}`);
      // fall through to Cloudinary below
    }
  }

  try {
    const result = await uploadToCloudinaryRaw(buffer, folder);
    console.log(`[storage] Uploaded to Cloudinary: ${result.secure_url}`);
    return result.secure_url;
  } catch (cloudinaryError) {
    console.warn(`[storage] Cloudinary upload failed, falling back to ImageKit: ${cloudinaryError.message}`);
    const url = await uploadToImageKit(buffer, folder);
    console.log(`[storage] Uploaded to ImageKit: ${url}`);
    return url;
  }
}

/**
 * Deletes an image from whichever provider actually stored it, inferred
 * from the URL. Never throws -- a failed cleanup delete shouldn't fail the
 * database write it's attached to.
 * @param {string} url
 */
export async function deleteImage(url) {
  if (!url) return;

  for (const site of ['cry808', '2koveralls']) {
    if (!isCloud808Configured(site)) continue;
    const { bucket, publicUrlBase } = getCloud808SiteConfig(site);
    if (!url.startsWith(`${publicUrlBase.replace(/\/$/, '')}/${bucket}/`)) continue;

    try {
      const key = url.slice(`${publicUrlBase.replace(/\/$/, '')}/${bucket}/`.length).split(/[?#]/)[0];
      await getCloud808Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } catch (error) {
      console.error(`[storage] Error deleting Cloud808 (${site}) object:`, error.message);
    }
    return;
  }

  if (url.includes('cloudinary.com')) {
    try {
      const urlParts = url.split('/');
      const uploadIndex = urlParts.indexOf('upload');
      if (uploadIndex === -1 || uploadIndex + 2 >= urlParts.length) return;
      const publicIdWithFolder = urlParts.slice(uploadIndex + 2).join('/');
      const publicId = publicIdWithFolder.split('.')[0];
      await cloudinary.uploader.destroy(publicId);
    } catch (error) {
      console.error('[storage] Error deleting Cloudinary image:', error.message);
    }
    return;
  }

  if (url.includes('ik.imagekit.io')) {
    try {
      const fileId = new URL(url).searchParams.get('ik-fileId');
      if (!fileId) {
        console.warn('[storage] ImageKit URL missing ik-fileId, cannot delete:', url);
        return;
      }
      await imagekit.deleteFile(fileId);
    } catch (error) {
      console.error('[storage] Error deleting ImageKit image:', error.message);
    }
  }
}
