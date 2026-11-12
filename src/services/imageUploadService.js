import { insertBatchImage } from './batchService.js';
import { supabase } from './supabaseClient.js';

export const STORAGE_BUCKET = 'framecheck-images';
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB (Supabase Storage bucket limit)
export const FILE_ACCEPT_ATTRIBUTE =
  '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';

const ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const EXTENSION_TO_MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const MIME_LABELS = {
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WEBP',
};

const SIGNED_URL_TTL_SECONDS = 3600;
const SIGNED_URL_REFRESH_BUFFER_MS = 5 * 60 * 1000;

const signedUrlCache = new Map();
const inFlightUrlRequests = new Map();
let signedUrlCacheEpoch = 0;

function getClientOrThrow() {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.'
    );
  }
  return supabase;
}

export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

export function getFormatLabel(mimeType) {
  return MIME_LABELS[mimeType] ?? mimeType ?? 'Image';
}

function getFileExtension(filename) {
  const idx = filename.lastIndexOf('.');
  if (idx === -1 || idx === filename.length - 1) return '';
  return filename.slice(idx + 1).toLowerCase();
}

function normalizeMimeType(rawType) {
  const cleaned = (rawType ?? '').trim().toLowerCase();
  if (cleaned === 'image/jpg') return 'image/jpeg';
  return cleaned;
}

function detectImageFormatFromMagicBytes(bytes) {
  if (bytes.length < 12) return null;

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }

  // WEBP: "RIFF".... "WEBP"
  const isRiff =
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46;
  const isWebp =
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50;
  if (isRiff && isWebp) {
    return 'image/webp';
  }

  return null;
}

/**
 * Validates extension, MIME type, file size, and header bytes without reading the full file.
 * @param {File} file
 */
export async function validateImageFile(file) {
  const extension = getFileExtension(file.name);
  if (!extension || !ALLOWED_EXTENSIONS.has(extension)) {
    return {
      valid: false,
      extension,
      mimeType: normalizeMimeType(file.type),
      reason: `Unsupported file format${extension ? ` (.${extension})` : ''}. Allowed: JPG, JPEG, PNG, WEBP.`,
    };
  }

  if (file.size <= 0) {
    return {
      valid: false,
      extension,
      mimeType: normalizeMimeType(file.type),
      reason: 'File is empty (0 bytes).',
    };
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      extension,
      mimeType: normalizeMimeType(file.type),
      reason: `File exceeds the ${formatFileSize(MAX_FILE_SIZE_BYTES)} maximum size limit.`,
    };
  }

  const reportedMime = normalizeMimeType(file.type);
  if (reportedMime && !ALLOWED_MIME_TYPES.has(reportedMime)) {
    return {
      valid: false,
      extension,
      mimeType: reportedMime,
      reason: `Unsupported MIME type (${reportedMime}). Allowed: image/jpeg, image/png, image/webp.`,
    };
  }

  const expectedMimeForExt = EXTENSION_TO_MIME[extension];
  let detectedMime = null;
  try {
    const headerBuffer = await file.slice(0, 12).arrayBuffer();
    detectedMime = detectImageFormatFromMagicBytes(new Uint8Array(headerBuffer));
  } catch {
    return {
      valid: false,
      extension,
      mimeType: reportedMime || expectedMimeForExt,
      reason: 'Unable to read file header for validation.',
    };
  }

  if (!detectedMime) {
    return {
      valid: false,
      extension,
      mimeType: reportedMime || expectedMimeForExt,
      reason: 'File contents do not match a valid JPEG, PNG, or WEBP image.',
    };
  }

  if (detectedMime !== expectedMimeForExt) {
    return {
      valid: false,
      extension,
      mimeType: detectedMime,
      reason: `File extension (.${extension}) does not match actual image format (${getFormatLabel(detectedMime)}).`,
    };
  }

  if (reportedMime && reportedMime !== detectedMime) {
    return {
      valid: false,
      extension,
      mimeType: reportedMime,
      reason: `Reported MIME type (${reportedMime}) does not match actual image format (${getFormatLabel(detectedMime)}).`,
    };
  }

  return {
    valid: true,
    extension,
    mimeType: detectedMime,
    reason: '',
  };
}

function normalizeRelativePath(file) {
  const raw = (file.webkitRelativePath ?? '').trim().replaceAll('\\', '/');
  if (!raw || raw === file.name) return null;
  return raw.length > 512 ? raw.slice(0, 512) : raw;
}

/**
 * Validates and builds staged upload items from a FileList/Array, flagging duplicate filenames.
 */
export async function prepareStagedFiles(
  fileList,
  existingBatchFilenames = [],
  existingStagedItems = []
) {
  const incomingFiles = Array.from(fileList ?? []);
  const existingKeys = new Set(
    existingStagedItems.map(
      (item) => `${item.relativePath ?? item.originalFilename}::${item.size}::${item.lastModified}`
    )
  );

  const uniqueIncoming = incomingFiles.filter((file) => {
    const rel = normalizeRelativePath(file);
    const key = `${rel ?? file.name}::${file.size}::${file.lastModified}`;
    if (existingKeys.has(key)) {
      return false;
    }
    existingKeys.add(key);
    return true;
  });

  const validated = await Promise.all(
    uniqueIncoming.map(async (file) => {
      const check = await validateImageFile(file);
      return {
        id: crypto.randomUUID(),
        file,
        originalFilename: file.name,
        relativePath: normalizeRelativePath(file),
        size: file.size,
        lastModified: file.lastModified,
        extension: check.extension,
        mimeType: check.mimeType,
        status: check.valid ? 'ready' : 'invalid',
        error: check.valid ? '' : check.reason,
        isDuplicateName: false,
        uploadedRecord: null,
      };
    })
  );

  const combined = [...existingStagedItems, ...validated];
  return recomputeDuplicateFlags(combined, existingBatchFilenames);
}

/**
 * Marks items whose filename appears multiple times in the queue or already exists in the batch.
 */
export function recomputeDuplicateFlags(stagedItems, existingBatchFilenames = []) {
  const batchNameSet = new Set(
    existingBatchFilenames.map((name) => name.trim().toLowerCase())
  );
  const queueCounts = new Map();

  for (const item of stagedItems) {
    if (item.status === 'invalid') continue;
    const key = item.originalFilename.trim().toLowerCase();
    queueCounts.set(key, (queueCounts.get(key) ?? 0) + 1);
  }

  return stagedItems.map((item) => {
    if (item.status === 'invalid') {
      return item.isDuplicateName ? { ...item, isDuplicateName: false } : item;
    }
    const key = item.originalFilename.trim().toLowerCase();
    const isDuplicateName =
      batchNameSet.has(key) || (queueCounts.get(key) ?? 0) > 1;
    return item.isDuplicateName === isDuplicateName
      ? item
      : { ...item, isDuplicateName };
  });
}

function formatUploadErrorMessage(error) {
  const msg = error?.message || 'Upload failed.';
  if (/payload too large|entity too large|exceeded the maximum allowed size/i.test(msg)) {
    return 'File exceeds Supabase Storage per-file size limit.';
  }
  if (/quota|storage limit|insufficient storage/i.test(msg)) {
    return 'Supabase Storage quota reached. Free up space or upgrade storage capacity.';
  }
  if (/row-level security|not authorized|permission denied/i.test(msg)) {
    return 'You do not have permission to upload images to this batch.';
  }
  return msg;
}

/**
 * Uploads one original image to private Supabase Storage and records its metadata row.
 * Uses a UUID filename in storage so duplicate original filenames never overwrite files.
 */
async function uploadSingleStagedImage({ batchId, ownerId, item }) {
  const client = getClientOrThrow();
  const imageUuid = crypto.randomUUID();
  const storagePath = `${ownerId}/${batchId}/${imageUuid}.${item.extension}`;

  const { error: uploadError } = await client.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, item.file, {
      contentType: item.mimeType,
      upsert: false,
    });

  if (uploadError) {
    throw new Error(formatUploadErrorMessage(uploadError));
  }

  try {
    return await insertBatchImage({
      batchId,
      originalFilename: item.originalFilename,
      relativePath: item.relativePath,
      storagePath,
      mimeType: item.mimeType,
      fileSize: item.size,
    });
  } catch (dbError) {
    throw new Error(formatUploadErrorMessage(dbError));
  }
}

/**
 * Uploads staged ready/failed items with bounded concurrency.
 * Individual failures are reported per file without cancelling remaining uploads.
 */
export async function uploadBatchImages({
  batchId,
  ownerId,
  items,
  concurrency = 3,
  onItemUpdate,
}) {
  const targets = items.filter(
    (item) => item.status === 'ready' || item.status === 'failed'
  );

  if (targets.length === 0) {
    return { uploadedCount: 0, failedCount: 0 };
  }

  let cursor = 0;
  let uploadedCount = 0;
  let failedCount = 0;

  async function worker() {
    while (cursor < targets.length) {
      const current = targets[cursor];
      cursor += 1;

      onItemUpdate(current.id, { status: 'uploading', error: '' });

      try {
        const record = await uploadSingleStagedImage({
          batchId,
          ownerId,
          item: current,
        });
        uploadedCount += 1;
        onItemUpdate(current.id, {
          status: 'uploaded',
          error: '',
          uploadedRecord: record,
        });
      } catch (error) {
        failedCount += 1;
        onItemUpdate(current.id, {
          status: 'failed',
          error: error?.message || 'Upload failed.',
        });
      }
    }
  }

  const workerCount = Math.min(concurrency, targets.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return { uploadedCount, failedCount };
}

/**
 * Returns a cached private signed URL for a stored image object.
 */
export async function getSignedImageUrl(storagePath, { forceRefresh = false } = {}) {
  if (!storagePath) {
    throw new Error('Image storage path is missing.');
  }

  const now = Date.now();
  if (!forceRefresh) {
    const cached = signedUrlCache.get(storagePath);
    if (cached && cached.expiresAt - now > SIGNED_URL_REFRESH_BUFFER_MS) {
      return cached.url;
    }

    const pending = inFlightUrlRequests.get(storagePath);
    if (pending) {
      return pending;
    }
  }

  const client = getClientOrThrow();
  const requestEpoch = signedUrlCacheEpoch;
  const request = client.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS)
    .then(({ data, error }) => {
      if (error || !data?.signedUrl) {
        throw error || new Error('Unable to generate signed image URL.');
      }
      if (requestEpoch === signedUrlCacheEpoch) {
        signedUrlCache.set(storagePath, {
          url: data.signedUrl,
          expiresAt: Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
        });
      }
      return data.signedUrl;
    })
    .finally(() => {
      inFlightUrlRequests.delete(storagePath);
    });

  inFlightUrlRequests.set(storagePath, request);
  return request;
}

/**
 * Clears cached signed image URLs (for example, on user sign out).
 */
export function clearSignedUrlCache() {
  signedUrlCacheEpoch += 1;
  signedUrlCache.clear();
  inFlightUrlRequests.clear();
}
