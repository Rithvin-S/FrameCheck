import { STORAGE_BUCKET } from './imageUploadService.js';
import { supabase } from './supabaseClient.js';

export const PDF_LAYOUT = {
  pageWidth: 210,
  pageHeight: 297,
  marginX: 15,
  contentWidth: 180,
  topStartY: 22,
  bottomLimitY: 277,
  footerRuleY: 282,
  footerTextY: 288,
};

export const PDF_COLORS = {
  textPrimary: [15, 23, 42],
  textSecondary: [71, 85, 105],
  textMuted: [100, 116, 139],
  border: [226, 232, 240],
  borderStrong: [203, 213, 225],
  surfaceSubtle: [248, 250, 252],
  surfaceMuted: [241, 245, 249],
  white: [255, 255, 255],
  accent: [37, 99, 235],
  accentSoft: [239, 246, 255],
  success: [21, 128, 61],
  successSoft: [240, 253, 244],
  warning: [180, 83, 9],
  warningSoft: [255, 251, 235],
  danger: [220, 38, 38],
  dangerSoft: [254, 242, 242],
};

const MAX_RASTER_DIMENSION_PX = 1800;

/**
 * Normalizes strings into WinAnsi-safe ASCII/Latin-1 text so jsPDF built-in fonts
 * measure and wrap long lines accurately without garbled glyphs.
 */
export function toPdfSafeText(value, fallback = '—') {
  if (value === null || value === undefined) return fallback;
  const raw = String(value);
  if (!raw.trim()) return fallback;

  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u2022/g, '*')
    .replace(/\u2192/g, '->')
    .replace(/\u2713/g, '[Done]')
    .replace(/[^\x09\x0A\x20-\xFF]/g, '?');
}

export function formatReportTimestamp(isoOrDate) {
  if (!isoOrDate) return '—';
  const date = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(date.getTime())) return '—';
  return toPdfSafeText(
    date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  );
}

export function sanitizePdfFilename(rawName, fallback = 'framecheck-report') {
  const cleaned = String(rawName || '')
    .trim()
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${cleaned || fallback}.pdf`;
}

export async function createFrameCheckPdfDoc() {
  const { jsPDF } = await import('jspdf');
  return new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });
}

export function drawRunningHeader(doc, { reportLabel, contextLabel }) {
  const { marginX, pageWidth } = PDF_LAYOUT;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...PDF_COLORS.accent);
  doc.text('FrameCheck', marginX, 11);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...PDF_COLORS.textMuted);
  doc.text(toPdfSafeText(reportLabel, 'Review Report'), marginX + 22, 11);

  if (contextLabel) {
    const maxCtxWidth = 85;
    let rightText = toPdfSafeText(contextLabel, '');
    while (rightText.length > 4 && doc.getTextWidth(rightText) > maxCtxWidth) {
      rightText = `${rightText.slice(0, -4)}...`;
    }
    doc.text(rightText, pageWidth - marginX, 11, { align: 'right' });
  }

  doc.setDrawColor(...PDF_COLORS.border);
  doc.setLineWidth(0.3);
  doc.line(marginX, 14.5, pageWidth - marginX, 14.5);
}

export function addReportPage(doc, headerMeta) {
  doc.addPage();
  drawRunningHeader(doc, headerMeta);
  return PDF_LAYOUT.topStartY;
}

export function ensurePageSpace(doc, currentY, neededHeight, headerMeta) {
  if (currentY + neededHeight <= PDF_LAYOUT.bottomLimitY) {
    return currentY;
  }
  return addReportPage(doc, headerMeta);
}

export function stampPageNumbersAndFooters(doc, generatedLabel) {
  const totalPages = doc.getNumberOfPages();
  const { marginX, pageWidth, footerRuleY, footerTextY } = PDF_LAYOUT;
  const safeGenerated = toPdfSafeText(generatedLabel, '');

  for (let pageIndex = 1; pageIndex <= totalPages; pageIndex += 1) {
    doc.setPage(pageIndex);
    doc.setDrawColor(...PDF_COLORS.border);
    doc.setLineWidth(0.3);
    doc.line(marginX, footerRuleY, pageWidth - marginX, footerRuleY);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...PDF_COLORS.textMuted);
    doc.text(`Generated ${safeGenerated}`, marginX, footerTextY);
    doc.text(
      `Page ${pageIndex} of ${totalPages}`,
      pageWidth - marginX,
      footerTextY,
      { align: 'right' }
    );
  }
}

export function drawReportBanner(doc, startY, { title, subtitle }) {
  const { marginX, contentWidth } = PDF_LAYOUT;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...PDF_COLORS.textPrimary);
  const titleLines = doc.splitTextToSize(toPdfSafeText(title), contentWidth);
  doc.text(titleLines, marginX, startY);

  let nextY = startY + titleLines.length * 7;

  if (subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...PDF_COLORS.textSecondary);
    const subLines = doc.splitTextToSize(toPdfSafeText(subtitle), contentWidth);
    doc.text(subLines, marginX, nextY);
    nextY += subLines.length * 4.8;
  }

  doc.setDrawColor(...PDF_COLORS.accent);
  doc.setLineWidth(0.7);
  doc.line(marginX, nextY + 1, marginX + 28, nextY + 1);

  return nextY + 7;
}

/**
 * Renders a 2-column bordered metadata key/value grid with dynamic height wrapping.
 */
export function drawMetadataCard(doc, startY, rows, headerMeta) {
  const { marginX, contentWidth } = PDF_LAYOUT;
  const colGap = 6;
  const colWidth = (contentWidth - colGap - 10) / 2;
  const lineH = 4.3;

  const preparedRows = [];
  for (let i = 0; i < rows.length; i += 2) {
    const left = rows[i];
    const right = rows[i + 1] ?? null;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    const leftValLines = doc.splitTextToSize(
      toPdfSafeText(left.value),
      colWidth
    );
    const rightValLines = right
      ? doc.splitTextToSize(toPdfSafeText(right.value), colWidth)
      : [];
    const maxValLines = Math.max(leftValLines.length, rightValLines.length, 1);

    preparedRows.push({
      left,
      right,
      leftValLines,
      rightValLines,
      height: 4.5 + maxValLines * lineH + 3.5,
    });
  }

  const totalHeight =
    6 + preparedRows.reduce((sum, item) => sum + item.height, 0);
  const y = ensurePageSpace(doc, startY, totalHeight, headerMeta);

  doc.setFillColor(...PDF_COLORS.surfaceSubtle);
  doc.setDrawColor(...PDF_COLORS.border);
  doc.setLineWidth(0.35);
  doc.roundedRect(marginX, y, contentWidth, totalHeight, 2, 2, 'FD');

  let cursorY = y + 5.5;
  for (const row of preparedRows) {
    const leftX = marginX + 5;
    const rightX = marginX + 5 + colWidth + colGap;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...PDF_COLORS.textMuted);
    doc.text(toPdfSafeText(row.left.label).toUpperCase(), leftX, cursorY);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...PDF_COLORS.textPrimary);
    doc.text(row.leftValLines, leftX, cursorY + 4.3);

    if (row.right) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...PDF_COLORS.textMuted);
      doc.text(toPdfSafeText(row.right.label).toUpperCase(), rightX, cursorY);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(...PDF_COLORS.textPrimary);
      doc.text(row.rightValLines, rightX, cursorY + 4.3);
    }

    cursorY += row.height;
  }

  return y + totalHeight + 6;
}

function renderCanvasSliceToJpeg({
  source,
  srcX,
  srcY,
  srcW,
  srcH,
  destW,
  destH,
}) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(destW));
  canvas.height = Math.max(1, Math.round(destH));

  try {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      throw new Error('Browser canvas 2D context is unavailable for PDF image export.');
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, srcX, srcY, srcW, srcH, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.88);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

async function decodeImageBlob(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => bitmap.close?.(),
      };
    } catch {
      // Fall back to HTMLImageElement decoding below if createImageBitmap rejects.
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Image failed to decode.'));
      el.src = objectUrl;
    });
    return {
      source: img,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      cleanup: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

function drawUnavailableImageBox(doc, startY, message, headerMeta) {
  const { marginX, contentWidth } = PDF_LAYOUT;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  const lines = doc.splitTextToSize(
    toPdfSafeText(message, 'Image could not be loaded.'),
    contentWidth - 12
  );
  const boxHeight = Math.max(18, 12 + lines.length * 4.5);
  const y = ensurePageSpace(doc, startY, boxHeight, headerMeta);

  doc.setFillColor(...PDF_COLORS.dangerSoft);
  doc.setDrawColor(...PDF_COLORS.danger);
  doc.setLineWidth(0.35);
  doc.roundedRect(marginX, y, contentWidth, boxHeight, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...PDF_COLORS.danger);
  doc.text('Original Image Unavailable', marginX + 6, y + 6.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(lines, marginX + 6, y + 12);

  return y + boxHeight + 6;
}

/**
 * Downloads a single private storage image using the user's authenticated Supabase
 * session, renders it sequentially into the PDF (preserving aspect ratio and slicing
 * ultra-tall images across pages), and immediately disposes decoded bitmaps.
 */
export async function drawStorageImageIntoPdf(
  doc,
  { storagePath, filename, startY, headerMeta, throwOnError = false }
) {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }
  if (!storagePath) {
    const msg = `Missing storage path for image "${filename || 'unknown'}".`;
    if (throwOnError) throw new Error(msg);
    return {
      nextY: drawUnavailableImageBox(doc, startY, msg, headerMeta),
      warning: msg,
    };
  }

  let blob = null;
  let decoded = null;

  try {
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .download(storagePath);

    if (error || !data) {
      throw new Error(
        error?.message ||
          `Unable to download image "${filename || storagePath}" from private storage.`
      );
    }
    blob = data;
    decoded = await decodeImageBlob(blob);

    if (!decoded.width || !decoded.height) {
      throw new Error(`Image "${filename || storagePath}" has invalid dimensions.`);
    }

    const { marginX, contentWidth, bottomLimitY } = PDF_LAYOUT;
    const aspectRatio = decoded.height / decoded.width;

    // Ultra-tall images (e.g., long stitched screenshots) span pages in crisp strips
    // instead of shrinking to an unreadable narrow column.
    if (aspectRatio > 2.15) {
      let y = startY;
      if (bottomLimitY - y < 65) {
        y = addReportPage(doc, headerMeta);
      }

      const targetDrawWidthPx = Math.min(decoded.width, MAX_RASTER_DIMENSION_PX);
      const scaleToPx = targetDrawWidthPx / decoded.width;
      const totalPdfHeightMm = contentWidth * aspectRatio;
      const mmPerSrcPx = totalPdfHeightMm / decoded.height;

      let srcOffsetY = 0;
      while (srcOffsetY < decoded.height) {
        const availableMm = bottomLimitY - y - 4;
        if (availableMm < 30) {
          y = addReportPage(doc, headerMeta);
          continue;
        }

        const remainingSrcPx = decoded.height - srcOffsetY;
        const maxSliceSrcPx = Math.floor(availableMm / mmPerSrcPx);
        const sliceSrcPx = Math.max(1, Math.min(remainingSrcPx, maxSliceSrcPx));
        const sliceMm = sliceSrcPx * mmPerSrcPx;

        const dataUrl = renderCanvasSliceToJpeg({
          source: decoded.source,
          srcX: 0,
          srcY: srcOffsetY,
          srcW: decoded.width,
          srcH: sliceSrcPx,
          destW: targetDrawWidthPx,
          destH: Math.max(1, Math.round(sliceSrcPx * scaleToPx)),
        });

        doc.setDrawColor(...PDF_COLORS.border);
        doc.setLineWidth(0.35);
        doc.rect(marginX, y, contentWidth, sliceMm, 'S');
        doc.addImage(dataUrl, 'JPEG', marginX, y, contentWidth, sliceMm, undefined, 'FAST');

        srcOffsetY += sliceSrcPx;
        y += sliceMm + 3;

        if (srcOffsetY < decoded.height) {
          y = addReportPage(doc, headerMeta);
        }
      }

      return { nextY: y + 4, warning: null };
    }

    // Standard proportions: fit cleanly within remaining space or full page frame
    let y = startY;
    const maxSinglePageHeight = 148;
    let availableHeight = bottomLimitY - y - 4;
    const desiredHeightAtFullWidth = contentWidth * aspectRatio;
    const targetBoxMaxHeight = Math.min(
      maxSinglePageHeight,
      desiredHeightAtFullWidth
    );

    if (availableHeight < Math.min(targetBoxMaxHeight, 75)) {
      y = addReportPage(doc, headerMeta);
      availableHeight = bottomLimitY - y - 4;
    }

    const fitHeight = Math.min(
      availableHeight,
      aspectRatio > 1.25 ? Math.min(205, availableHeight) : maxSinglePageHeight
    );
    const widthScale = contentWidth / decoded.width;
    const heightScale = fitHeight / decoded.height;
    const mmScale = Math.min(widthScale, heightScale);

    const renderW = decoded.width * mmScale;
    const renderH = decoded.height * mmScale;
    const renderX = marginX + (contentWidth - renderW) / 2;

    const rasterScale = Math.min(
      1,
      MAX_RASTER_DIMENSION_PX / Math.max(decoded.width, decoded.height)
    );
    const dataUrl = renderCanvasSliceToJpeg({
      source: decoded.source,
      srcX: 0,
      srcY: 0,
      srcW: decoded.width,
      srcH: decoded.height,
      destW: Math.max(1, Math.round(decoded.width * rasterScale)),
      destH: Math.max(1, Math.round(decoded.height * rasterScale)),
    });

    doc.setFillColor(...PDF_COLORS.surfaceSubtle);
    doc.setDrawColor(...PDF_COLORS.border);
    doc.setLineWidth(0.35);
    doc.rect(marginX, y, contentWidth, renderH + 4, 'FD');
    doc.addImage(
      dataUrl,
      'JPEG',
      renderX,
      y + 2,
      renderW,
      renderH,
      undefined,
      'FAST'
    );

    return { nextY: y + renderH + 10, warning: null };
  } catch (error) {
    const reason =
      error?.message ||
      `Unable to include image "${filename || storagePath}" in the report.`;
    if (throwOnError) {
      throw new Error(reason);
    }
    return {
      nextY: drawUnavailableImageBox(doc, startY, reason, headerMeta),
      warning: reason,
    };
  } finally {
    decoded?.cleanup?.();
    decoded = null;
    blob = null;
  }
}

function getAnnotationMetaLines(doc, ann, width) {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);

  const isResolved = ann.status === 'resolved';
  const metaParts = [
    `Created: ${formatReportTimestamp(ann.createdAt)}`,
    `Updated: ${formatReportTimestamp(ann.updatedAt)}`,
  ];
  if (isResolved && ann.resolvedAt) {
    metaParts.push(`Resolved: ${formatReportTimestamp(ann.resolvedAt)}`);
  }

  return doc.splitTextToSize(metaParts.join('  |  '), width);
}

function drawAnnotationHeaderRow(doc, ann, metaLines, x, y) {
  const badgeText = `#${ann.annotationNumber}`;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  const badgeW = Math.max(11, doc.getTextWidth(badgeText) + 6);

  doc.setFillColor(...PDF_COLORS.accent);
  doc.roundedRect(x, y - 4, badgeW, 5.5, 1.5, 1.5, 'F');
  doc.setTextColor(...PDF_COLORS.white);
  doc.text(badgeText, x + badgeW / 2, y, { align: 'center' });

  const isResolved = ann.status === 'resolved';
  const statusLabel = isResolved ? 'Resolved' : 'Open';
  const statusW = Math.max(17, doc.getTextWidth(statusLabel) + 7);
  const statusX = x + badgeW + 3;

  doc.setFillColor(
    ...(isResolved ? PDF_COLORS.successSoft : PDF_COLORS.warningSoft)
  );
  doc.setDrawColor(
    ...(isResolved ? PDF_COLORS.success : PDF_COLORS.warning)
  );
  doc.setLineWidth(0.25);
  doc.roundedRect(statusX, y - 4, statusW, 5.5, 1.5, 1.5, 'FD');
  doc.setTextColor(...(isResolved ? PDF_COLORS.success : PDF_COLORS.warning));
  doc.text(statusLabel, statusX + statusW / 2, y, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...PDF_COLORS.textPrimary);
  const reviewerText = `Reviewer: ${toPdfSafeText(ann.creatorName, 'Reviewer')}`;
  doc.text(reviewerText, statusX + statusW + 4, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...PDF_COLORS.textMuted);
  doc.text(metaLines, x, y + 5.5);

  return 5.5 + metaLines.length * 3.8 + 3;
}

/**
 * Renders an annotation card cleanly, keeping standard cards intact on one page
 * and wrapping very long comments safely across pages without clipping.
 */
export function drawAnnotationList(doc, annotations, startY, headerMeta) {
  const { marginX, contentWidth, topStartY, bottomLimitY } = PDF_LAYOUT;

  let y = ensurePageSpace(doc, startY, 16, headerMeta);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.setTextColor(...PDF_COLORS.textPrimary);
  doc.text(`Annotations (${annotations.length})`, marginX, y);
  y += 5;

  if (annotations.length === 0) {
    y = ensurePageSpace(doc, y, 16, headerMeta);
    doc.setFillColor(...PDF_COLORS.surfaceSubtle);
    doc.setDrawColor(...PDF_COLORS.border);
    doc.setLineWidth(0.3);
    doc.roundedRect(marginX, y, contentWidth, 13, 2, 2, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...PDF_COLORS.textMuted);
    doc.text('No annotations recorded for this image.', marginX + 6, y + 8);
    return y + 18;
  }

  const innerPadding = 5;
  const textWidth = contentWidth - innerPadding * 2;
  const lineH = 4.6;
  const maxSinglePageHeight = bottomLimitY - topStartY - 4;

  for (const ann of annotations) {
    const metaLines = getAnnotationMetaLines(doc, ann, textWidth);
    const measuredHeaderHeight = 5.5 + metaLines.length * 3.8 + 3;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    const commentLines = doc.splitTextToSize(
      toPdfSafeText(ann.comment, '—'),
      textWidth
    );
    const totalCardHeight =
      8 + measuredHeaderHeight + commentLines.length * lineH + 2;

    // Case 1: Fits on one page — avoid splitting card across page boundary.
    if (totalCardHeight <= maxSinglePageHeight) {
      y = ensurePageSpace(doc, y, totalCardHeight, headerMeta);

      doc.setFillColor(...PDF_COLORS.white);
      doc.setDrawColor(...PDF_COLORS.borderStrong);
      doc.setLineWidth(0.3);
      doc.roundedRect(marginX, y, contentWidth, totalCardHeight, 2, 2, 'FD');

      const headerHeight = drawAnnotationHeaderRow(
        doc,
        ann,
        metaLines,
        marginX + innerPadding,
        y + 8
      );

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(...PDF_COLORS.textPrimary);
      doc.text(
        commentLines,
        marginX + innerPadding,
        y + 8 + headerHeight
      );

      y += totalCardHeight + 4;
      continue;
    }

    // Case 2: Very long comment exceeding one page — stream wrapped lines across pages cleanly.
    y = ensurePageSpace(doc, y, 42, headerMeta);
    let lineCursor = 0;
    let isFirstChunk = true;

    while (lineCursor < commentLines.length) {
      if (bottomLimitY - y < 34) {
        y = addReportPage(doc, headerMeta);
      }

      const available = bottomLimitY - y;
      const chunkTopOffset = isFirstChunk ? 8 + measuredHeaderHeight : 12;
      const linesThatFit = Math.max(
        1,
        Math.floor((available - chunkTopOffset - 3) / lineH)
      );
      const slice = commentLines.slice(lineCursor, lineCursor + linesThatFit);
      const chunkHeight = chunkTopOffset + slice.length * lineH + 2;

      doc.setFillColor(...PDF_COLORS.white);
      doc.setDrawColor(...PDF_COLORS.borderStrong);
      doc.setLineWidth(0.3);
      doc.roundedRect(marginX, y, contentWidth, chunkHeight, 2, 2, 'FD');

      if (isFirstChunk) {
        drawAnnotationHeaderRow(
          doc,
          ann,
          metaLines,
          marginX + innerPadding,
          y + 8
        );
      } else {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...PDF_COLORS.textMuted);
        doc.text(
          `#${ann.annotationNumber} (continued)`,
          marginX + innerPadding,
          y + 6.5
        );
      }

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(...PDF_COLORS.textPrimary);
      doc.text(slice, marginX + innerPadding, y + chunkTopOffset);

      lineCursor += slice.length;
      isFirstChunk = false;

      if (lineCursor < commentLines.length) {
        y = addReportPage(doc, headerMeta);
      } else {
        y += chunkHeight + 4;
      }
    }
  }

  return y;
}
