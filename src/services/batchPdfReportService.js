import {
  REVIEW_STATUS_LABELS,
  deriveBatchReviewStatus,
} from './batchService.js';
import {
  PDF_COLORS,
  PDF_LAYOUT,
  addReportPage,
  createFrameCheckPdfDoc,
  drawAnnotationList,
  drawMetadataCard,
  drawReportBanner,
  drawRunningHeader,
  drawStorageImageIntoPdf,
  ensurePageSpace,
  formatReportTimestamp,
  sanitizePdfFilename,
  stampPageNumbersAndFooters,
  toPdfSafeText,
} from './pdfReportHelpers.js';

function drawImageSectionHeader(
  doc,
  startY,
  { image, index, totalImages, annotationStats }
) {
  const { marginX, contentWidth } = PDF_LAYOUT;
  const isCompleted = Boolean(image.is_completed);
  const statusLabel = isCompleted ? 'Completed' : 'In Review';

  const titleText = `Image ${index + 1} of ${totalImages}: ${toPdfSafeText(
    image.original_filename
  )}`;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  const titleLines = doc.splitTextToSize(titleText, contentWidth - 40);

  const subParts = [];
  if (image.relative_path) {
    subParts.push(`Path: ${toPdfSafeText(image.relative_path)}`);
  }
  subParts.push(
    `Annotations: ${annotationStats.total} (${annotationStats.open} Open, ${annotationStats.resolved} Resolved)`
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const subLines = doc.splitTextToSize(subParts.join('  |  '), contentWidth - 12);

  const boxHeight =
    8 + titleLines.length * 5.2 + subLines.length * 4 + 3;

  doc.setFillColor(...PDF_COLORS.surfaceMuted);
  doc.setDrawColor(...PDF_COLORS.borderStrong);
  doc.setLineWidth(0.35);
  doc.roundedRect(marginX, startY, contentWidth, boxHeight, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...PDF_COLORS.textPrimary);
  doc.text(titleLines, marginX + 5, startY + 7);

  doc.setFontSize(8.5);
  const pillW = Math.max(20, doc.getTextWidth(statusLabel) + 8);
  const pillX = marginX + contentWidth - pillW - 5;
  const pillY = startY + 3.5;

  doc.setFillColor(
    ...(isCompleted ? PDF_COLORS.successSoft : PDF_COLORS.accentSoft)
  );
  doc.setDrawColor(
    ...(isCompleted ? PDF_COLORS.success : PDF_COLORS.accent)
  );
  doc.setLineWidth(0.25);
  doc.roundedRect(pillX, pillY, pillW, 5.5, 1.5, 1.5, 'FD');
  doc.setTextColor(...(isCompleted ? PDF_COLORS.success : PDF_COLORS.accent));
  doc.text(statusLabel, pillX + pillW / 2, pillY + 3.9, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...PDF_COLORS.textSecondary);
  doc.text(subLines, marginX + 5, startY + 7 + titleLines.length * 5.2);

  return startY + boxHeight + 6;
}

function drawBatchIndexSummary(doc, startY, images, annotationsByImage, headerMeta) {
  const { marginX, contentWidth } = PDF_LAYOUT;
  let y = ensurePageSpace(doc, startY, 22, headerMeta);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.setTextColor(...PDF_COLORS.textPrimary);
  doc.text('Batch Images Overview', marginX, y);
  y += 5;

  if (images.length === 0) {
    doc.setFillColor(...PDF_COLORS.surfaceSubtle);
    doc.setDrawColor(...PDF_COLORS.border);
    doc.roundedRect(marginX, y, contentWidth, 13, 2, 2, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...PDF_COLORS.textMuted);
    doc.text('No images have been uploaded to this batch yet.', marginX + 6, y + 8);
    return y + 18;
  }

  for (let i = 0; i < images.length; i += 1) {
    const img = images[i];
    const anns = annotationsByImage.get(img.id) ?? [];
    const openCount = anns.filter((ann) => ann.status !== 'resolved').length;
    const statusText = img.is_completed ? 'Completed' : 'In Review';

    y = ensurePageSpace(doc, y, 7.5, headerMeta);

    if (i % 2 === 0) {
      doc.setFillColor(...PDF_COLORS.surfaceSubtle);
      doc.rect(marginX, y, contentWidth, 6.8, 'F');
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.8);
    doc.setTextColor(...PDF_COLORS.textPrimary);

    let nameText = `${i + 1}. ${toPdfSafeText(img.original_filename)}`;
    while (nameText.length > 8 && doc.getTextWidth(nameText) > 102) {
      nameText = `${nameText.slice(0, -4)}...`;
    }
    doc.text(nameText, marginX + 3, y + 4.6);

    doc.setTextColor(
      ...(img.is_completed ? PDF_COLORS.success : PDF_COLORS.accent)
    );
    doc.text(statusText, marginX + 112, y + 4.6);

    doc.setTextColor(...PDF_COLORS.textSecondary);
    doc.text(
      `${anns.length} ann (${openCount} open)`,
      marginX + contentWidth - 3,
      y + 4.6,
      { align: 'right' }
    );

    y += 7;
  }

  return y + 4;
}

/**
 * Generates and downloads a combined PDF review report for an entire batch.
 * Processes images strictly sequentially so large batches never hold all
 * full-resolution images in browser memory simultaneously.
 */
export async function downloadBatchReviewReport({
  batch,
  images = [],
  annotations = [],
  onProgress,
}) {
  if (!batch?.id) {
    throw new Error('Batch details are required to generate a batch report.');
  }

  const generatedAt = new Date();
  const generatedLabel = formatReportTimestamp(generatedAt);

  const annotationsByImage = new Map();
  for (const ann of annotations) {
    if (!ann?.imageId) continue;
    if (!annotationsByImage.has(ann.imageId)) {
      annotationsByImage.set(ann.imageId, []);
    }
    annotationsByImage.get(ann.imageId).push(ann);
  }
  for (const list of annotationsByImage.values()) {
    list.sort((a, b) => Number(a.annotationNumber) - Number(b.annotationNumber));
  }

  const completedImageCount = images.filter((img) => img.is_completed).length;
  const pendingImageCount = images.length - completedImageCount;
  const openAnnotationCount = annotations.filter(
    (ann) => ann.status !== 'resolved'
  ).length;
  const resolvedAnnotationCount = annotations.length - openAnnotationCount;

  const reviewStatusKey = deriveBatchReviewStatus({
    imageCount: images.length,
    completedImageCount,
    totalAnnotationCount: annotations.length,
    openAnnotationCount,
  });
  const batchReviewStatusLabel =
    REVIEW_STATUS_LABELS[reviewStatusKey] ?? 'Not Started';

  const headerMeta = {
    reportLabel: 'Batch Review Report',
    contextLabel: batch.name,
  };

  const doc = await createFrameCheckPdfDoc();
  drawRunningHeader(doc, headerMeta);

  let y = 24;
  y = drawReportBanner(doc, y, {
    title: 'FrameCheck Batch Review Report',
    subtitle: `Batch summary and image-by-image annotation breakdown for "${batch.name}"`,
  });

  const summaryRows = [
    { label: 'Batch Name', value: batch.name },
    { label: 'Batch ID', value: batch.id },
    { label: 'Batch Owner', value: batch.ownerName || 'Unknown' },
    { label: 'Overall Batch Status', value: batchReviewStatusLabel },
    { label: 'Report Generated', value: generatedLabel },
    { label: 'Total Images', value: String(images.length) },
    { label: 'Completed Images', value: String(completedImageCount) },
    { label: 'Pending Images', value: String(pendingImageCount) },
    { label: 'Total Annotations', value: String(annotations.length) },
    {
      label: 'Open / Resolved Annotations',
      value: `${openAnnotationCount} Open  |  ${resolvedAnnotationCount} Resolved`,
    },
  ];

  y = drawMetadataCard(doc, y, summaryRows, headerMeta);
  drawBatchIndexSummary(doc, y, images, annotationsByImage, headerMeta);

  const warnings = [];

  if (images.length > 0) {
    onProgress?.({
      current: 0,
      total: images.length,
      filename: '',
    });
  }

  for (let i = 0; i < images.length; i += 1) {
    const image = images[i];

    // Yield to browser event loop between images so progress UI renders and GC can run.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const imageAnnotations = annotationsByImage.get(image.id) ?? [];
    const imageOpenCount = imageAnnotations.filter(
      (ann) => ann.status !== 'resolved'
    ).length;

    let sectionY = addReportPage(doc, headerMeta);
    sectionY = drawImageSectionHeader(doc, sectionY, {
      image,
      index: i,
      totalImages: images.length,
      annotationStats: {
        total: imageAnnotations.length,
        open: imageOpenCount,
        resolved: imageAnnotations.length - imageOpenCount,
      },
    });

    const imageResult = await drawStorageImageIntoPdf(doc, {
      storagePath: image.storage_path,
      filename: image.original_filename,
      startY: sectionY,
      headerMeta,
      throwOnError: false,
      annotations: imageAnnotations,
    });
    if (imageResult.warning) {
      warnings.push(imageResult.warning);
    }

    drawAnnotationList(doc, imageAnnotations, imageResult.nextY, headerMeta);

    onProgress?.({
      current: i + 1,
      total: images.length,
      filename: image.original_filename,
    });
  }

  stampPageNumbersAndFooters(doc, generatedLabel);

  const filename = sanitizePdfFilename(
    `framecheck-${batch.name}-batch-report`,
    'framecheck-batch-report'
  );
  doc.save(filename);

  return {
    filename,
    imageCount: images.length,
    annotationCount: annotations.length,
    warnings,
  };
}

