/**
 * FrameCheck - Annotated Image Export Service (Phase 22D)
 * Renders full-resolution images with vector annotations cleanly drawn onto an HTML5 canvas
 * and triggers immediate client-side downloads in PNG, JPEG, or WebP formats.
 */

import { drawAnnotationsOnCanvas } from './pdfReportHelpers.js';

export const EXPORT_FORMATS = Object.freeze({
  PNG: 'png',
  JPEG: 'jpeg',
  WEBP: 'webp',
});

export const MIME_TYPES = Object.freeze({
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
});

/**
 * Loads an HTMLImageElement safely from a URL with CORS support.
 */
function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => resolve(img);
    img.onerror = () => {
      // Retry without anonymous crossOrigin if local or same-origin
      const retryImg = new Image();
      retryImg.onload = () => resolve(retryImg);
      retryImg.onerror = () =>
        reject(new Error('Failed to load image. Check network connection or image storage permissions.'));
      retryImg.src = url;
    };

    img.src = url;
  });
}

/**
 * Strips extension from filename.
 */
function getBaseFilename(filename = 'image') {
  return filename.replace(/\.[^/.]+$/, '');
}

/**
 * Exports an image with all its visible annotations rendered at native dimensions.
 *
 * @param {Object} params
 * @param {Object} params.image The target image metadata object
 * @param {Array} params.annotations Annotations belonging to the image
 * @param {Object} [params.options]
 * @param {string} [params.options.format='png'] 'png' | 'jpeg' | 'webp'
 * @param {number} [params.options.quality=0.92] 0.1 to 1.0 (for jpeg/webp)
 * @param {boolean} [params.options.includeResolved=true] Whether resolved markings are drawn
 * @param {Set} [params.options.hiddenLayerIds] Layer IDs that should be excluded
 * @param {string} [params.options.customFilename] Optional custom download filename
 * @returns {Promise<{ success: boolean, filename: string, width: number, height: number }>}
 */
export async function exportAnnotatedImage({ image, annotations = [], options = {} }) {
  if (!image) {
    throw new Error('No target image provided for export.');
  }

  const imageUrl = image.signed_url || image.url;
  if (!imageUrl) {
    throw new Error('Image URL is missing or unavailable.');
  }

  const format = options.format && MIME_TYPES[options.format.toLowerCase()]
    ? options.format.toLowerCase()
    : EXPORT_FORMATS.PNG;
  const quality = typeof options.quality === 'number' && options.quality >= 0.1 && options.quality <= 1.0
    ? options.quality
    : 0.92;
  const includeResolved = options.includeResolved !== false;
  const hiddenLayerIds = options.hiddenLayerIds || new Set();

  // 1. Filter annotations to render
  const visibleAnnotations = (annotations || []).filter((ann) => {
    if (!includeResolved && ann.status === 'resolved') {
      return false;
    }
    const layerId = ann.layerId || 'default';
    if (hiddenLayerIds.has(layerId)) {
      return false;
    }
    return true;
  });

  // 2. Load source image element
  const imgElement = await loadImageElement(imageUrl);
  const width = imgElement.naturalWidth || imgElement.width || 1920;
  const height = imgElement.naturalHeight || imgElement.height || 1080;

  // 3. Create full-resolution export canvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d', { alpha: format === EXPORT_FORMATS.PNG });
  if (!ctx) {
    throw new Error('HTML5 Canvas 2D rendering context is not supported in this browser.');
  }

  try {
    // Fill white background for non-alpha formats like JPEG
    if (format === EXPORT_FORMATS.JPEG) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
    }

    // 4. Draw source image at 1:1 scale
    ctx.drawImage(imgElement, 0, 0, width, height);

    // 5. Render markings and vector labels
    if (visibleAnnotations.length > 0) {
      drawAnnotationsOnCanvas(ctx, visibleAnnotations, {
        fullImageWidth: width,
        fullImageHeight: height,
        srcX: 0,
        srcY: 0,
        srcW: width,
        srcH: height,
        destW: width,
        destH: height,
      });
    }

    // 6. Convert canvas to Blob and trigger browser download
    const mimeType = MIME_TYPES[format] || 'image/png';
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (b) resolve(b);
          else reject(new Error('Failed to encode image data. The canvas may be security-tainted.'));
        },
        mimeType,
        quality
      );
    });

    const baseName = getBaseFilename(image.original_filename || `image_${image.id || 'export'}`);
    const downloadFilename = options.customFilename
      ? options.customFilename
      : `${baseName}_annotated.${format}`;

    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = downloadFilename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();

    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);
    }, 2000);

    return {
      success: true,
      filename: downloadFilename,
      width,
      height,
      renderedCount: visibleAnnotations.length,
    };
  } finally {
    // Explicitly clear canvas memory
    canvas.width = 0;
    canvas.height = 0;
  }
}

