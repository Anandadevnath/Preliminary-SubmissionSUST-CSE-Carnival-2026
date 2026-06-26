import { v2 as cloudinary } from "cloudinary";

/**
 * Lazily configured Cloudinary client. Reads creds from env at first use so
 * the app can still boot when they're missing.
 *
 * Required env:
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 *
 * Optional:
 *   CLOUDINARY_FOLDER   (defaults to "hackathon-uploads")
 */
let configured = false;

function ensureConfigured() {
  if (configured) return;
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error(
      "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in .env.local."
    );
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });
  configured = true;
}

/**
 * Upload an image buffer (or base64 data URI) to Cloudinary.
 *
 * @param {Buffer | string} input - Raw image bytes, or a `data:image/...;base64,...` string.
 * @param {object} [opts]
 * @param {string} [opts.folder] - Override CLOUDINARY_FOLDER for this upload.
 * @returns {Promise<{ url: string, publicId: string, width: number, height: number, format: string }>}
 */
export async function uploadImage(input, opts = {}) {
  ensureConfigured();

  const folder = opts.folder || process.env.CLOUDINARY_FOLDER || "hackathon-uploads";

  // For buffers we use upload_stream; for base64 data URIs we use upload.
  if (Buffer.isBuffer(input)) {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: "image",
          // Resize on upload so we don't blow past Claude's dimension limits.
          transformation: [
            { width: Number(process.env.MAX_IMAGE_DIMENSION) || 1568, height: Number(process.env.MAX_IMAGE_DIMENSION) || 1568, crop: "limit" },
            { quality: "auto", fetch_format: "auto" },
          ],
        },
        (err, result) => {
          if (err) return reject(err);
          resolve({
            url: result.secure_url,
            publicId: result.public_id,
            width: result.width,
            height: result.height,
            format: result.format,
          });
        }
      );
      stream.end(input);
    });
  }

  const result = await cloudinary.uploader.upload(input, {
    folder,
    resource_type: "image",
    transformation: [
      { width: Number(process.env.MAX_IMAGE_DIMENSION) || 1568, height: Number(process.env.MAX_IMAGE_DIMENSION) || 1568, crop: "limit" },
      { quality: "auto", fetch_format: "auto" },
    ],
  });

  return {
    url: result.secure_url,
    publicId: result.public_id,
    width: result.width,
    height: result.height,
    format: result.format,
  };
}

/**
 * Read upload limits from env so the API route can validate before uploading.
 */
export function getUploadLimits() {
  const maxMb = Number(process.env.MAX_IMAGE_MB) || 5;
  const allowed = (process.env.ALLOWED_IMAGE_TYPES ||
    "image/jpeg,image/png,image/webp,image/gif")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return { maxBytes: maxMb * 1024 * 1024, allowedTypes: allowed };
}