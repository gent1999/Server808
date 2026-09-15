import ImageKit from 'imagekit';
import { Readable } from 'stream';
import cloudinary from '../config/cloudinary.js';

/**
 * Shared image storage: Cloudinary is primary, ImageKit is the fallback.
 *
 * There's no documented, stable way to detect "quota exceeded" specifically
 * from Cloudinary's Node SDK (checked -- no reliable error code/message to
 * key on), so uploadImage() falls back to ImageKit on ANY Cloudinary upload
 * failure -- quota, outage, whatever. Same practical effect, no fragile
 * error-message matching. Every fallback is logged so it's visible in
 * Vercel's logs whether/how often it's actually firing.
 *
 * ImageKit deletion needs a fileId, not a URL (unlike Cloudinary, where the
 * public_id can be parsed out of the URL path) -- rather than a database
 * migration to store it separately, the fileId is embedded as a query
 * param on the URL itself (?ik-fileId=...), which doesn't affect how the
 * URL displays as an <img src>.
 */

const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
});

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
 * Uploads an image buffer, preferring Cloudinary and falling back to
 * ImageKit on any failure.
 * @param {Buffer} buffer
 * @param {string} folder - e.g. 'rap-blog', 'koveralls-articles/thumbnails'
 * @returns {Promise<string>} the resulting public URL
 */
export async function uploadImage(buffer, folder) {
  try {
    const result = await uploadToCloudinaryRaw(buffer, folder);
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
