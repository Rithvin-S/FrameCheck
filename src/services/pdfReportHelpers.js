import { STORAGE_BUCKET } from './imageUploadService.js';
import { supabase } from './supabaseClient.js';
import { calculateArrowheadPoints, calculateCalloutConnector } from './annotationState.js';

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

function drawCanvasRoundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arcTo(x + width, y, x + width, y + r, r);
  ctx.lineTo(x + width, y + height - r);
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
  ctx.lineTo(x + r, y + height);
  ctx.arcTo(x, y + height, x, y + height - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function drawCanvasBadge(ctx, x, y, labelText, color, isResolved, baseScale = 1, marker = null, markerColor = null) {
  const fontSize = Math.max(10, Math.round(11 * baseScale));
  ctx.save();
  ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  const textMetrics = ctx.measureText(labelText);
  const textW = textMetrics.width;
  const paddingX = Math.max(5, Math.round(5 * baseScale));
  const badgeW = Math.max(fontSize * 1.6, textW + paddingX * 2);
  const badgeH = Math.max(fontSize * 1.5, Math.round(18 * baseScale));
  const radius = Math.round(badgeH / 2);

  const drawX = x - badgeW / 2;
  const drawY = y - badgeH / 2;

  drawCanvasRoundedRect(ctx, drawX, drawY, badgeW, badgeH, radius);
  ctx.fillStyle = color || '#2563eb';
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1.5, Math.round(1.5 * baseScale));
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(labelText, x, y);

  if (marker) {
    const markerGlyphs = {
      star: '★',
      flag: '⚑',
      bug: '🪲',
      pin: '📌',
      warning: '⚠️',
    };
    const glyph = markerGlyphs[marker] || '★';
    const markerSize = badgeH;
    const markerX = drawX + badgeW + Math.round(3 * baseScale);
    const markerY = drawY;
    drawCanvasRoundedRect(ctx, markerX, markerY, markerSize, markerSize, Math.round(3 * baseScale));
    ctx.fillStyle = markerColor || '#f59e0b';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, Math.round(1 * baseScale));
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = `${Math.round(fontSize * 0.9)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, markerX + markerSize / 2, markerY + markerSize / 2);
  }

  ctx.restore();
}

/**
 * Renders all annotation types (circle, arrow, rectangle, pencil, callout) directly
 * onto the 2D export canvas so PDF reports visibly present markings on the image.
 */
export function drawAnnotationsOnCanvas(ctx, annotations, {
  fullImageWidth,
  fullImageHeight,
  srcX = 0,
  srcY = 0,
  srcW,
  srcH,
  destW,
  destH,
}) {
  if (!annotations || annotations.length === 0) return;

  const effectiveSrcW = srcW || fullImageWidth;
  const effectiveSrcH = srcH || fullImageHeight;
  const scaleX = destW / effectiveSrcW;
  const scaleY = destH / effectiveSrcH;
  const baseScale = Math.max(1, destW / 900);
  const defaultStrokeW = Math.max(2, Math.round(2.5 * baseScale));

  const toCanvasX = (normX) => (normX * fullImageWidth - srcX) * scaleX;
  const toCanvasY = (normY) => (normY * fullImageHeight - srcY) * scaleY;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, destW, destH);
  ctx.clip();

  for (const ann of annotations) {
    const isResolved = ann.status === 'resolved';
    const color = ann.color || '#2563eb';
    const labelText = `#${ann.annotationNumber}`;
    const type = ann.type || (ann.geometry?.type ? ann.geometry.type : 'circle');
    const style = ann.style || {};
    const strokeColor = style.strokeColor || color;

    const strokeW = style.strokeWidth
      ? Math.max(1, Math.round(style.strokeWidth * baseScale))
      : defaultStrokeW;
    const haloW = strokeW + Math.max(2, Math.round(2 * baseScale));
    const strokeOpacity = typeof style.strokeOpacity === 'number' ? style.strokeOpacity : 1;
    const lineStyle = style.lineStyle || 'solid';
    const fillEnabled = Boolean(style.fillEnabled);
    const fillColor = style.fillColor || color;
    const fillOpacity = typeof style.fillOpacity === 'number' ? style.fillOpacity : 0.2;
    const arrowHead = style.arrowHead || 'filled';
    const marker = style.marker || null;
    const markerColor = style.markerColor || '#f59e0b';

    const applyLineStyle = (c) => {
      if (lineStyle === 'dashed') {
        c.setLineDash([Math.round(8 * baseScale), Math.round(4 * baseScale)]);
      } else if (lineStyle === 'dotted') {
        c.setLineDash([Math.round(2 * baseScale), Math.round(3 * baseScale)]);
      } else {
        c.setLineDash([]);
      }
    };

    if (type === 'marker' || ann.geometry?.tool === 'marker') {
      const geom = {
        cx: ann.geometry?.cx ?? ann.geometry?.circle?.cx ?? ann.cx ?? 0.5,
        cy: ann.geometry?.cy ?? ann.geometry?.circle?.cy ?? ann.cy ?? 0.5,
      };
      const cx = toCanvasX(geom.cx);
      const cy = toCanvasY(geom.cy);
      const pinR = Math.max(12, Math.round(14 * baseScale));
      const headCy = cy - pinR * 1.8;

      ctx.save();
      // Drop pin needle and head
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.bezierCurveTo(cx - pinR * 0.4, cy - pinR * 0.7, cx - pinR, headCy + pinR * 0.6, cx - pinR, headCy);
      ctx.arc(cx, headCy, pinR, Math.PI, 0, false);
      ctx.bezierCurveTo(cx + pinR, headCy + pinR * 0.6, cx + pinR * 0.4, cy - pinR * 0.7, cx, cy);
      ctx.closePath();

      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1.5, Math.round(2 * baseScale));
      ctx.stroke();

      // Pin center dot
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(2, Math.round(2.5 * baseScale)), 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();

      // Pin number text
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.max(9, Math.round(10.5 * baseScale))}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(labelText, cx, headCy);
      ctx.restore();
      continue;
    }

    if (type === 'circle') {
      const geom = {
        cx: ann.geometry?.cx ?? ann.geometry?.circle?.cx ?? ann.cx ?? 0.5,
        cy: ann.geometry?.cy ?? ann.geometry?.circle?.cy ?? ann.cy ?? 0.5,
        r: ann.geometry?.r ?? ann.geometry?.circle?.r ?? ann.r ?? 0.1,
      };
      const cx = toCanvasX(geom.cx);
      const cy = toCanvasY(geom.cy);
      const r = geom.r * Math.min(fullImageWidth, fullImageHeight) * Math.min(scaleX, scaleY);

      if (fillEnabled) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.globalAlpha = fillOpacity;
        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.restore();
      }

      // Halo
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = haloW;
      applyLineStyle(ctx);
      ctx.stroke();

      // Colored circle
      ctx.strokeStyle = color;
      ctx.lineWidth = strokeW;
      ctx.globalAlpha = strokeOpacity;
      applyLineStyle(ctx);
      ctx.stroke();
      ctx.restore();

      const badgeX = cx - r * Math.SQRT1_2;
      const badgeY = cy - r * Math.SQRT1_2;
      drawCanvasBadge(ctx, badgeX, badgeY, labelText, color, isResolved, baseScale, marker, markerColor);
    } else if (type === 'arrow') {
      const geom = ann.geometry?.arrow ?? ann.geometry;
      if (!geom || geom.startX === undefined || geom.endX === undefined) continue;
      const sx = toCanvasX(geom.startX);
      const sy = toCanvasY(geom.startY);
      const ex = toCanvasX(geom.endX);
      const ey = toCanvasY(geom.endY);

      const headLen = Math.max(12, Math.round(14 * baseScale));
      const ahPoints = calculateArrowheadPoints({
        startXPx: sx,
        startYPx: sy,
        endXPx: ex,
        endYPx: ey,
        headLength: headLen,
        arrowHead,
      });

      ctx.save();
      // Halo shaft
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = haloW;
      applyLineStyle(ctx);
      ctx.stroke();

      // Halo head(s)
      const drawHeadHalo = (hp) => {
        if (!hp) return;
        ctx.beginPath();
        if (arrowHead === 'stealth' && hp.recess) {
          ctx.moveTo(hp.tip[0], hp.tip[1]);
          ctx.lineTo(hp.left[0], hp.left[1]);
          ctx.lineTo(hp.recess[0], hp.recess[1]);
          ctx.lineTo(hp.right[0], hp.right[1]);
          ctx.closePath();
          ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
          ctx.fill();
        } else if (arrowHead === 'standard') {
          ctx.moveTo(hp.left[0], hp.left[1]);
          ctx.lineTo(hp.tip[0], hp.tip[1]);
          ctx.lineTo(hp.right[0], hp.right[1]);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
          ctx.lineWidth = haloW;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.stroke();
        } else {
          ctx.moveTo(hp.tip[0], hp.tip[1]);
          ctx.lineTo(hp.left[0], hp.left[1]);
          ctx.lineTo(hp.right[0], hp.right[1]);
          ctx.closePath();
          ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
          ctx.fill();
        }
      };
      drawHeadHalo(ahPoints);
      if (arrowHead === 'double' && ahPoints.startArrowhead) {
        drawHeadHalo(ahPoints.startArrowhead);
      }

      // Colored shaft
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.strokeStyle = color;
      ctx.lineWidth = strokeW;
      ctx.globalAlpha = strokeOpacity;
      applyLineStyle(ctx);
      ctx.stroke();

      // Colored head(s)
      const drawHeadColored = (hp) => {
        if (!hp) return;
        ctx.beginPath();
        if (arrowHead === 'stealth' && hp.recess) {
          ctx.moveTo(hp.tip[0], hp.tip[1]);
          ctx.lineTo(hp.left[0], hp.left[1]);
          ctx.lineTo(hp.recess[0], hp.recess[1]);
          ctx.lineTo(hp.right[0], hp.right[1]);
          ctx.closePath();
          ctx.fillStyle = color;
          ctx.globalAlpha = strokeOpacity;
          ctx.fill();
        } else if (arrowHead === 'standard') {
          ctx.moveTo(hp.left[0], hp.left[1]);
          ctx.lineTo(hp.tip[0], hp.tip[1]);
          ctx.lineTo(hp.right[0], hp.right[1]);
          ctx.strokeStyle = color;
          ctx.lineWidth = strokeW;
          ctx.globalAlpha = strokeOpacity;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.stroke();
        } else {
          ctx.moveTo(hp.tip[0], hp.tip[1]);
          ctx.lineTo(hp.left[0], hp.left[1]);
          ctx.lineTo(hp.right[0], hp.right[1]);
          ctx.closePath();
          ctx.fillStyle = color;
          ctx.globalAlpha = strokeOpacity;
          ctx.fill();
        }
      };
      drawHeadColored(ahPoints);
      if (arrowHead === 'double' && ahPoints.startArrowhead) {
        drawHeadColored(ahPoints.startArrowhead);
      }
      ctx.restore();

      const badgeX = sx;
      const badgeY = sy - 14 * baseScale;
      drawCanvasBadge(ctx, badgeX, badgeY, labelText, color, isResolved, baseScale, marker, markerColor);
    } else if (type === 'rectangle') {
      const geom = ann.geometry?.rectangle ?? ann.geometry;
      if (!geom || geom.x === undefined || geom.width === undefined) continue;
      const rx = toCanvasX(geom.x);
      const ry = toCanvasY(geom.y);
      const rw = geom.width * fullImageWidth * scaleX;
      const rh = geom.height * fullImageHeight * scaleY;

      if (fillEnabled) {
        ctx.save();
        ctx.globalAlpha = fillOpacity;
        ctx.fillStyle = fillColor;
        ctx.fillRect(rx, ry, rw, rh);
        ctx.restore();
      }

      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = haloW;
      applyLineStyle(ctx);
      ctx.strokeRect(rx, ry, rw, rh);

      ctx.strokeStyle = color;
      ctx.lineWidth = strokeW;
      ctx.globalAlpha = strokeOpacity;
      applyLineStyle(ctx);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.restore();

      const badgeX = rx;
      const badgeY = ry - 14 * baseScale;
      drawCanvasBadge(ctx, badgeX, badgeY, labelText, color, isResolved, baseScale, marker, markerColor);
    } else if (type === 'pencil') {
      const geom = ann.geometry?.pencil ?? ann.geometry;
      const points = geom?.points;
      if (!Array.isArray(points) || points.length === 0) continue;
      const pts = points.map((pt) => {
        const nx = Array.isArray(pt) ? pt[0] : pt?.x;
        const ny = Array.isArray(pt) ? pt[1] : pt?.y;
        return [toCanvasX(Number(nx ?? 0)), toCanvasY(Number(ny ?? 0))];
      });

      ctx.save();
      if (pts.length === 1) {
        ctx.beginPath();
        ctx.arc(pts[0][0], pts[0][1], strokeW * 2, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = strokeOpacity;
        ctx.fill();
      } else {
        // Halo curve
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length - 1; i++) {
          const xc = (pts[i][0] + pts[i + 1][0]) / 2;
          const yc = (pts[i][1] + pts[i + 1][1]) / 2;
          ctx.quadraticCurveTo(pts[i][0], pts[i][1], xc, yc);
        }
        ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.lineWidth = haloW;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        applyLineStyle(ctx);
        ctx.stroke();

        // Colored curve
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length - 1; i++) {
          const xc = (pts[i][0] + pts[i + 1][0]) / 2;
          const yc = (pts[i][1] + pts[i + 1][1]) / 2;
          ctx.quadraticCurveTo(pts[i][0], pts[i][1], xc, yc);
        }
        ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
        ctx.strokeStyle = color;
        ctx.lineWidth = strokeW;
        ctx.globalAlpha = strokeOpacity;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        applyLineStyle(ctx);
        ctx.stroke();
      }
      ctx.restore();

      const badgeX = pts[0][0];
      const badgeY = pts[0][1] - 14 * baseScale;
      drawCanvasBadge(ctx, badgeX, badgeY, labelText, color, isResolved, baseScale, marker, markerColor);
    } else if (type === 'callout') {
      const geom = ann.geometry?.callout ?? ann.geometry;
      if (!geom || geom.pointerX === undefined || geom.boxX === undefined) continue;
      const pointerX = toCanvasX(geom.pointerX);
      const pointerY = toCanvasY(geom.pointerY);
      const boxX = toCanvasX(geom.boxX);
      const boxY = toCanvasY(geom.boxY);
      const boxW = geom.boxWidth * fullImageWidth * scaleX;
      const boxH = geom.boxHeight * fullImageHeight * scaleY;

      const connector = calculateCalloutConnector({
        pointerXPx: pointerX,
        pointerYPx: pointerY,
        boxXPx: boxX,
        boxYPx: boxY,
        boxWidthPx: boxW,
        boxHeightPx: boxH,
        headLength: Math.max(10, Math.round(12 * baseScale)),
      });

      ctx.save();
      // Dashed connector halo
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([Math.round(6 * baseScale), Math.round(4 * baseScale)]);
      ctx.moveTo(connector.attachXPx, connector.attachYPx);
      ctx.lineTo(connector.pointerXPx, connector.pointerYPx);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = haloW;
      ctx.stroke();

      // Colored dashed connector
      ctx.beginPath();
      ctx.moveTo(connector.attachXPx, connector.attachYPx);
      ctx.lineTo(connector.pointerXPx, connector.pointerYPx);
      ctx.strokeStyle = color;
      ctx.lineWidth = strokeW;
      ctx.stroke();
      ctx.restore();

      // Arrowhead at pointer
      const [tipX, tipY] = connector.arrowhead.tip;
      const [p1x, p1y] = connector.arrowhead.left;
      const [p2x, p2y] = connector.arrowhead.right;

      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(p1x, p1y);
      ctx.lineTo(p2x, p2y);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Pointer tip dot
      ctx.beginPath();
      ctx.arc(pointerX, pointerY, Math.max(3, Math.round(4 * baseScale)), 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Callout text box
      const boxRadius = Math.max(4, Math.round(4 * baseScale));
      drawCanvasRoundedRect(ctx, boxX, boxY, boxW, boxH, boxRadius);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.5, Math.round(1.5 * baseScale));
      ctx.stroke();

      // Header bar
      const headerH = Math.max(18, Math.round(20 * baseScale));
      ctx.save();
      ctx.beginPath();
      drawCanvasRoundedRect(ctx, boxX, boxY, boxW, boxH, boxRadius);
      ctx.clip();
      ctx.fillStyle = color;
      ctx.fillRect(boxX, boxY, boxW, headerH);

      const headerFontSize = Math.max(9, Math.round(10 * baseScale));
      ctx.font = `bold ${headerFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(labelText, boxX + 6 * baseScale, boxY + headerH / 2);
      ctx.restore();

      // Callout note text
      const rawText = geom.calloutText || '';
      if (rawText.trim()) {
        const textFontSize = style.fontSize
          ? Math.max(8, Math.round(style.fontSize * baseScale))
          : Math.max(9, Math.round(10 * baseScale));
        const fontWeight = style.fontWeight || 'normal';
        const fontStyle = style.fontStyle || 'normal';
        const fontFamily =
          style.fontFamily === 'serif'
            ? 'Georgia, serif'
            : style.fontFamily === 'monospace'
              ? 'monospace'
              : '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.font = `${fontStyle} ${fontWeight} ${textFontSize}px ${fontFamily}`;
        ctx.fillStyle = '#0f172a';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';

        const padX = 6 * baseScale;
        const maxTextW = boxW - padX * 2;
        const lineH = textFontSize * 1.35;
        const startTextY = boxY + headerH + 4 * baseScale;
        const maxTextH = boxH - headerH - 8 * baseScale;

        const words = rawText.split(/\s+/);
        let currLine = '';
        let lineY = startTextY;

        for (const word of words) {
          const testLine = currLine ? `${currLine} ${word}` : word;
          const testW = ctx.measureText(testLine).width;
          if (testW > maxTextW && currLine) {
            if (lineY + lineH <= startTextY + maxTextH) {
              ctx.fillText(currLine, boxX + padX, lineY);
            }
            currLine = word;
            lineY += lineH;
          } else {
            currLine = testLine;
          }
        }
        if (currLine && lineY + lineH <= startTextY + maxTextH) {
          ctx.fillText(currLine, boxX + padX, lineY);
        }
      }
      ctx.restore();
    } else if (type === 'line') {
      const geom = ann.geometry?.line ?? ann.geometry;
      if (!geom || geom.startX === undefined || geom.endX === undefined) continue;
      const sx = toCanvasX(geom.startX);
      const sy = toCanvasY(geom.startY);
      const ex = toCanvasX(geom.endX);
      const ey = toCanvasY(geom.endY);

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = haloW;
      applyLineStyle(ctx);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.strokeStyle = color;
      ctx.lineWidth = strokeW;
      ctx.globalAlpha = strokeOpacity;
      applyLineStyle(ctx);
      ctx.stroke();
      ctx.restore();

      const badgeX = sx;
      const badgeY = sy - 14 * baseScale;
      drawCanvasBadge(ctx, badgeX, badgeY, labelText, color, isResolved, baseScale, marker, markerColor);
    } else if (type === 'highlighter') {
      const geom = ann.geometry?.highlighter ?? ann.geometry;
      const points = geom?.points;
      if (!Array.isArray(points) || points.length === 0) continue;
      const pts = points.map((pt) => {
        const nx = Array.isArray(pt) ? pt[0] : pt?.x;
        const ny = Array.isArray(pt) ? pt[1] : pt?.y;
        return [toCanvasX(Number(nx ?? 0)), toCanvasY(Number(ny ?? 0))];
      });

      const hlW = Math.max(8, Math.round(12 * baseScale));
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length - 1; i++) {
        const xc = (pts[i][0] + pts[i + 1][0]) / 2;
        const yc = (pts[i][1] + pts[i + 1][1]) / 2;
        ctx.quadraticCurveTo(pts[i][0], pts[i][1], xc, yc);
      }
      ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      ctx.strokeStyle = color;
      ctx.lineWidth = hlW;
      ctx.globalAlpha = 0.45;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.restore();

      const badgeX = pts[0][0];
      const badgeY = pts[0][1] - 14 * baseScale;
      drawCanvasBadge(ctx, badgeX, badgeY, labelText, color, isResolved, baseScale, marker, markerColor);
    } else if (type === 'polygon') {
      const geom = ann.geometry?.polygon ?? ann.geometry;
      const points = geom?.points;
      if (!Array.isArray(points) || points.length === 0) continue;
      const pts = points.map((pt) => {
        const nx = Array.isArray(pt) ? pt[0] : pt?.x;
        const ny = Array.isArray(pt) ? pt[1] : pt?.y;
        return [toCanvasX(Number(nx ?? 0)), toCanvasY(Number(ny ?? 0))];
      });

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i][0], pts[i][1]);
      }
      ctx.closePath();

      if (fillEnabled) {
        ctx.fillStyle = fillColor;
        ctx.globalAlpha = fillOpacity;
        ctx.fill();
      } else {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.08;
        ctx.fill();
      }

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = haloW;
      applyLineStyle(ctx);
      ctx.stroke();

      ctx.strokeStyle = color;
      ctx.lineWidth = strokeW;
      ctx.globalAlpha = strokeOpacity;
      applyLineStyle(ctx);
      ctx.stroke();
      ctx.restore();

      const badgeX = pts[0][0];
      const badgeY = pts[0][1] - 14 * baseScale;
      drawCanvasBadge(ctx, badgeX, badgeY, labelText, color, isResolved, baseScale, marker, markerColor);
    } else if (type === 'cloud') {
      const geom = ann.geometry?.cloud ?? ann.geometry;
      if (!geom || geom.x === undefined || geom.width === undefined) continue;
      const rx = toCanvasX(geom.x);
      const ry = toCanvasY(geom.y);
      const rw = geom.width * fullImageWidth * scaleX;
      const rh = geom.height * fullImageHeight * scaleY;

      ctx.save();
      drawCanvasRoundedRect(ctx, rx, ry, rw, rh, Math.max(8, Math.round(10 * baseScale)));
      if (fillEnabled) {
        ctx.fillStyle = fillColor;
        ctx.globalAlpha = fillOpacity;
        ctx.fill();
      } else {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.08;
        ctx.fill();
      }

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = haloW;
      applyLineStyle(ctx);
      ctx.stroke();

      ctx.strokeStyle = color;
      ctx.lineWidth = strokeW;
      ctx.globalAlpha = strokeOpacity;
      applyLineStyle(ctx);
      ctx.stroke();
      ctx.restore();

      const badgeX = rx;
      const badgeY = ry - 14 * baseScale;
      drawCanvasBadge(ctx, badgeX, badgeY, labelText, color, isResolved, baseScale, marker, markerColor);
    } else if (type === 'textbox') {
      const geom = ann.geometry?.textbox ?? ann.geometry;
      if (!geom || geom.x === undefined || geom.width === undefined) continue;
      const rx = toCanvasX(geom.x);
      const ry = toCanvasY(geom.y);
      const rw = geom.width * fullImageWidth * scaleX;
      const rh = geom.height * fullImageHeight * scaleY;
      const boxRadius = Math.max(3, Math.round(4 * baseScale));

      ctx.save();
      drawCanvasRoundedRect(ctx, rx, ry, rw, rh, boxRadius);
      if (fillEnabled) {
        ctx.fillStyle = fillColor;
        ctx.globalAlpha = fillOpacity;
        ctx.fill();
      } else {
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      }

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeW;
      ctx.globalAlpha = strokeOpacity;
      applyLineStyle(ctx);
      ctx.stroke();

      const text = geom.text || ann.comment || '';
      if (text) {
        const textFontSize = style.fontSize
          ? Math.max(8, Math.round(style.fontSize * baseScale))
          : Math.max(9, Math.round(11 * baseScale));
        const fontWeight = style.fontWeight || '600';
        const fontStyle = style.fontStyle || 'normal';
        const fontFamily =
          style.fontFamily === 'serif'
            ? 'Georgia, serif'
            : style.fontFamily === 'monospace'
              ? 'monospace'
              : '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.font = `${fontStyle} ${fontWeight} ${textFontSize}px ${fontFamily}`;
        ctx.fillStyle = strokeColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, rx + rw / 2, ry + rh / 2, Math.max(10, rw - 8));
      }
      ctx.restore();

      const badgeX = rx;
      const badgeY = ry - 14 * baseScale;
      drawCanvasBadge(ctx, badgeX, badgeY, labelText, color, isResolved, baseScale, marker, markerColor);
    } else if (type === 'blur') {
      const geom = ann.geometry?.blur ?? ann.geometry;
      if (!geom || geom.x === undefined || geom.width === undefined) continue;
      const rx = toCanvasX(geom.x);
      const ry = toCanvasY(geom.y);
      const rw = geom.width * fullImageWidth * scaleX;
      const rh = geom.height * fullImageHeight * scaleY;

      ctx.save();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.fillRect(rx, ry, rw, rh);

      ctx.strokeStyle = 'rgba(100, 116, 139, 0.35)';
      ctx.lineWidth = 1;
      const step = 8 * baseScale;
      for (let x = rx - rh; x < rx + rw; x += step) {
        ctx.beginPath();
        ctx.moveTo(Math.max(rx, x), ry);
        ctx.lineTo(Math.min(rx + rw, x + rh), ry + rh);
        ctx.stroke();
      }

      ctx.strokeStyle = color;
      ctx.lineWidth = strokeW;
      ctx.setLineDash([Math.round(5 * baseScale), Math.round(3 * baseScale)]);
      ctx.strokeRect(rx, ry, rw, rh);

      const textFontSize = Math.max(8, Math.round(9 * baseScale));
      ctx.font = `700 ${textFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.fillStyle = '#64748b';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('[BLURRED]', rx + rw / 2, ry + rh / 2);
      ctx.restore();

      const badgeX = rx;
      const badgeY = ry - 14 * baseScale;
      drawCanvasBadge(ctx, badgeX, badgeY, labelText, color, isResolved, baseScale, marker, markerColor);
    }
  }

  ctx.restore();
}

function renderCanvasSliceToJpeg({
  source,
  srcX,
  srcY,
  srcW,
  srcH,
  destW,
  destH,
  annotations = [],
  fullImageWidth,
  fullImageHeight,
  sliceOffsetY = 0,
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

    if (annotations && annotations.length > 0) {
      drawAnnotationsOnCanvas(ctx, annotations, {
        fullImageWidth: fullImageWidth || srcW,
        fullImageHeight: fullImageHeight || srcH,
        srcX,
        srcY: srcY !== undefined ? srcY : sliceOffsetY,
        srcW,
        srcH,
        destW: canvas.width,
        destH: canvas.height,
      });
    }

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
  { storagePath, filename, startY, headerMeta, throwOnError = false, annotations = [] }
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
          annotations,
          fullImageWidth: decoded.width,
          fullImageHeight: decoded.height,
          sliceOffsetY: srcOffsetY,
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
      annotations,
      fullImageWidth: decoded.width,
      fullImageHeight: decoded.height,
      sliceOffsetY: 0,
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

/**
 * Returns a human-readable geometry summary for an annotation to render in PDF reports.
 */
export function formatAnnotationGeometrySummary(ann) {
  if (!ann) return 'Unknown';
  const type = ann.type || (ann.geometry?.type ? ann.geometry.type : 'circle');

  if (type === 'circle') {
    const cx = ann.geometry?.cx ?? ann.geometry?.circle?.cx ?? ann.cx ?? 0;
    const cy = ann.geometry?.cy ?? ann.geometry?.circle?.cy ?? ann.cy ?? 0;
    const r = ann.geometry?.r ?? ann.geometry?.circle?.r ?? ann.r ?? 0;
    return `Circle: Center (${(cx * 100).toFixed(1)}%, ${(cy * 100).toFixed(1)}%), Radius ${(r * 100).toFixed(1)}%`;
  }

  if (type === 'arrow') {
    const arrow = ann.geometry?.arrow ?? ann.geometry;
    if (!arrow || arrow.startX === undefined) return 'Arrow';
    const sx = (arrow.startX * 100).toFixed(1);
    const sy = (arrow.startY * 100).toFixed(1);
    const ex = (arrow.endX * 100).toFixed(1);
    const ey = (arrow.endY * 100).toFixed(1);
    return `Arrow: (${sx}%, ${sy}%) -> (${ex}%, ${ey}%)`;
  }

  if (type === 'line') {
    const line = ann.geometry?.line ?? ann.geometry;
    if (!line || line.startX === undefined) return 'Line';
    const sx = (line.startX * 100).toFixed(1);
    const sy = (line.startY * 100).toFixed(1);
    const ex = (line.endX * 100).toFixed(1);
    const ey = (line.endY * 100).toFixed(1);
    return `Line: (${sx}%, ${sy}%) -> (${ex}%, ${ey}%)`;
  }

  if (type === 'rectangle') {
    const rect = ann.geometry?.rectangle ?? ann.geometry;
    if (!rect || rect.x === undefined) return 'Rectangle';
    const x = (rect.x * 100).toFixed(1);
    const y = (rect.y * 100).toFixed(1);
    const w = (rect.width * 100).toFixed(1);
    const h = (rect.height * 100).toFixed(1);
    return `Rectangle: (${x}%, ${y}%), Size ${w}% × ${h}%`;
  }

  if (type === 'cloud') {
    const cloud = ann.geometry?.cloud ?? ann.geometry;
    if (!cloud || cloud.x === undefined) return 'Revision Cloud';
    const x = (cloud.x * 100).toFixed(1);
    const y = (cloud.y * 100).toFixed(1);
    const w = (cloud.width * 100).toFixed(1);
    const h = (cloud.height * 100).toFixed(1);
    return `Revision Cloud: (${x}%, ${y}%), Size ${w}% × ${h}%`;
  }

  if (type === 'textbox') {
    const tb = ann.geometry?.textbox ?? ann.geometry;
    if (!tb || tb.x === undefined) return 'Text Box';
    const x = (tb.x * 100).toFixed(1);
    const y = (tb.y * 100).toFixed(1);
    const w = (tb.width * 100).toFixed(1);
    const h = (tb.height * 100).toFixed(1);
    return `Text Box: (${x}%, ${y}%), Size ${w}% × ${h}%`;
  }

  if (type === 'blur') {
    const blur = ann.geometry?.blur ?? ann.geometry;
    if (!blur || blur.x === undefined) return 'Blur Area';
    const x = (blur.x * 100).toFixed(1);
    const y = (blur.y * 100).toFixed(1);
    const w = (blur.width * 100).toFixed(1);
    const h = (blur.height * 100).toFixed(1);
    return `Blur Area: (${x}%, ${y}%), Size ${w}% × ${h}%`;
  }

  if (type === 'pencil') {
    const points = ann.geometry?.pencil?.points ?? ann.geometry?.points;
    const count = Array.isArray(points) ? points.length : 0;
    return `Pencil: Freehand stroke (${count} points)`;
  }

  if (type === 'highlighter') {
    const points = ann.geometry?.highlighter?.points ?? ann.geometry?.points;
    const count = Array.isArray(points) ? points.length : 0;
    return `Highlighter: Freehand stroke (${count} points)`;
  }

  if (type === 'polygon') {
    const points = ann.geometry?.polygon?.points ?? ann.geometry?.points;
    const count = Array.isArray(points) ? points.length : 0;
    return `Polygon: Closed boundary (${count} vertices)`;
  }

  if (type === 'callout') {
    const callout = ann.geometry?.callout ?? ann.geometry;
    if (!callout || callout.pointerX === undefined) return 'Callout';
    const px = (callout.pointerX * 100).toFixed(1);
    const py = (callout.pointerY * 100).toFixed(1);
    const bx = (callout.boxX * 100).toFixed(1);
    const by = (callout.boxY * 100).toFixed(1);
    const bw = (callout.boxWidth * 100).toFixed(1);
    const bh = (callout.boxHeight * 100).toFixed(1);
    return `Callout: Pointer (${px}%, ${py}%), Box (${bx}%, ${by}%), Size ${bw}% × ${bh}%`;
  }

  return `Annotation (${type})`;
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

  const timestampLines = doc.splitTextToSize(metaParts.join('  |  '), width);

  const geomSummary = formatAnnotationGeometrySummary(ann);
  const geomLines = doc.splitTextToSize(`Geometry: ${toPdfSafeText(geomSummary)}`, width);

  // Phase 19: Layer & Labels
  const layerAndLabels = [];
  if (ann.layerId && ann.layerId !== 'default') {
    layerAndLabels.push(`Layer: ${ann.layerId}`);
  }
  if (Array.isArray(ann.labels) && ann.labels.length > 0) {
    const labelNames = ann.labels
      .map((l) => (typeof l === 'string' ? l : l.name || l.text))
      .filter(Boolean);
    if (labelNames.length > 0) {
      layerAndLabels.push(`Labels: ${labelNames.join(', ')}`);
    }
  }
  const layerLabelLines =
    layerAndLabels.length > 0
      ? doc.splitTextToSize(layerAndLabels.join('  |  '), width)
      : [];

  // Phase 19: Custom Properties
  let customPropsLines = [];
  if (Array.isArray(ann.customProperties) && ann.customProperties.length > 0) {
    const propParts = ann.customProperties.map((p) => {
      const val = p.type === 'boolean' ? (p.value ? 'Yes' : 'No') : String(p.value ?? '—');
      return `${p.name}: ${val}`;
    });
    customPropsLines = doc.splitTextToSize(`Properties: ${propParts.join('  |  ')}`, width);
  }

  let calloutNoteLines = [];
  const calloutText = ann.geometry?.calloutText ?? ann.geometry?.callout?.calloutText;
  if (ann.type === 'callout' && calloutText) {
    calloutNoteLines = doc.splitTextToSize(
      `Callout Note: "${toPdfSafeText(calloutText)}"`,
      width
    );
  }

  const totalLines =
    timestampLines.length +
    geomLines.length +
    layerLabelLines.length +
    customPropsLines.length +
    calloutNoteLines.length;
  const headerHeight = 5.5 + totalLines * 3.8 + 3;

  return {
    timestampLines,
    geomLines,
    layerLabelLines,
    customPropsLines,
    calloutNoteLines,
    headerHeight,
  };
}

function drawAnnotationHeaderRow(doc, ann, metaInfo, x, y) {
  const badgeText = `#${ann.annotationNumber}`;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  const badgeW = Math.max(11, doc.getTextWidth(badgeText) + 6);

  // 1. Badge
  doc.setFillColor(...PDF_COLORS.accent);
  doc.roundedRect(x, y - 4, badgeW, 5.5, 1.5, 1.5, 'F');
  doc.setTextColor(...PDF_COLORS.white);
  doc.text(badgeText, x + badgeW / 2, y, { align: 'center' });

  // 2. Type pill
  const typeLabels = {
    circle: 'Circle',
    arrow: 'Arrow',
    rectangle: 'Rectangle',
    pencil: 'Pencil',
    callout: 'Callout',
    line: 'Line',
    polygon: 'Polygon',
    cloud: 'Cloud',
    highlighter: 'Highlighter',
    textbox: 'Text',
    blur: 'Blur',
    marker: 'Marker',
  };
  const rawType = ann.geometry?.tool === 'marker' ? 'marker' : (ann.type || (ann.geometry?.type ? ann.geometry.type : 'circle'));
  const typeLabel = typeLabels[rawType] || 'Circle';
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  const typeW = Math.max(16, doc.getTextWidth(typeLabel) + 6);
  const typeX = x + badgeW + 3;

  doc.setFillColor(...PDF_COLORS.surfaceMuted);
  doc.setDrawColor(...PDF_COLORS.borderStrong);
  doc.setLineWidth(0.25);
  doc.roundedRect(typeX, y - 4, typeW, 5.5, 1.5, 1.5, 'FD');
  doc.setTextColor(...PDF_COLORS.textSecondary);
  doc.text(typeLabel, typeX + typeW / 2, y, { align: 'center' });

  // 3. Status pill
  const isResolved = ann.status === 'resolved';
  const statusLabel = isResolved ? 'Resolved' : 'Open';
  const statusW = Math.max(17, doc.getTextWidth(statusLabel) + 7);
  const statusX = typeX + typeW + 3;

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

  // 4. Marker pill (if any)
  let currentPillX = statusX + statusW + 3;
  if (ann.style?.marker) {
    const markerIcons = { star: '★', flag: '⚑', bug: '🪲', pin: '📌', warning: '⚠️' };
    const markerGlyph = markerIcons[ann.style.marker] || '★';
    const markerLabel = `${markerGlyph} ${ann.style.marker}`;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    const markerW = Math.max(14, doc.getTextWidth(markerLabel) + 6);
    doc.setFillColor(245, 158, 11);
    doc.roundedRect(currentPillX, y - 4, markerW, 5.5, 1.5, 1.5, 'F');
    doc.setTextColor(...PDF_COLORS.white);
    doc.text(markerLabel, currentPillX + markerW / 2, y, { align: 'center' });
    currentPillX += markerW + 3;
  }

  // Stamp pill (if any)
  if (ann.style?.stamp) {
    const stampConfig = {
      priority: { icon: '⚡', label: 'Priority', color: [239, 68, 68] },
      warning: { icon: '⚠️', label: 'Warning', color: [245, 158, 11] },
      suggestion: { icon: '💡', label: 'Suggestion', color: [6, 182, 212] },
      issue: { icon: '🪲', label: 'Issue', color: [139, 92, 246] },
    };
    const sInfo = stampConfig[ann.style.stamp] || { icon: '⚡', label: ann.style.stamp, color: [239, 68, 68] };
    const stampLabel = `${sInfo.icon} ${sInfo.label}`;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    const stampW = Math.max(14, doc.getTextWidth(stampLabel) + 6);
    doc.setFillColor(...sInfo.color);
    doc.roundedRect(currentPillX, y - 4, stampW, 5.5, 1.5, 1.5, 'F');
    doc.setTextColor(...PDF_COLORS.white);
    doc.text(stampLabel, currentPillX + stampW / 2, y, { align: 'center' });
    currentPillX += stampW + 3;
  }

  // 5. Reviewer text
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...PDF_COLORS.textPrimary);
  const reviewerText = `Reviewer: ${toPdfSafeText(ann.creatorName, 'Reviewer')}`;
  doc.text(reviewerText, currentPillX + 1, y);

  // 6. Metadata lines below pill row
  let metaCursorY = y + 5.5;

  // Timestamps
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...PDF_COLORS.textMuted);
  doc.text(metaInfo.timestampLines, x, metaCursorY);
  metaCursorY += metaInfo.timestampLines.length * 3.8;

  // Layer & Labels (if any)
  if (metaInfo.layerLabelLines && metaInfo.layerLabelLines.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...PDF_COLORS.accent);
    doc.text(metaInfo.layerLabelLines, x, metaCursorY);
    metaCursorY += metaInfo.layerLabelLines.length * 3.8;
  }

  // Custom Properties (if any)
  if (metaInfo.customPropsLines && metaInfo.customPropsLines.length > 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...PDF_COLORS.textPrimary);
    doc.text(metaInfo.customPropsLines, x, metaCursorY);
    metaCursorY += metaInfo.customPropsLines.length * 3.8;
  }

  // Geometry Summary
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...PDF_COLORS.textSecondary);
  doc.text(metaInfo.geomLines, x, metaCursorY);
  metaCursorY += metaInfo.geomLines.length * 3.8;

  // Callout Note (if any)
  if (metaInfo.calloutNoteLines.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...PDF_COLORS.accent);
    doc.text(metaInfo.calloutNoteLines, x, metaCursorY);
    metaCursorY += metaInfo.calloutNoteLines.length * 3.8;
  }

  return metaInfo.headerHeight;
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
    const metaInfo = getAnnotationMetaLines(doc, ann, textWidth);
    const measuredHeaderHeight = metaInfo.headerHeight;

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
        metaInfo,
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
          metaInfo,
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
