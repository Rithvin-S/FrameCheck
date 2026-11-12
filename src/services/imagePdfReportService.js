import {
  createFrameCheckPdfDoc,
  drawAnnotationList,
  drawMetadataCard,
  drawReportBanner,
  drawRunningHeader,
  drawStorageImageIntoPdf,
  formatReportTimestamp,
  sanitizePdfFilename,
  stampPageNumbersAndFooters,
} from './pdfReportHelpers.js';

/**
 * Generates and downloads a PDF review report for a single batch image,
 * keeping the original image clean and listing open + resolved annotations separately.
 */
export async function downloadImageReviewReport({
  batch,
  image,
  annotations = [],
}) {
  if (!batch?.id) {
    throw new Error('Batch details are required to generate an image report.');
  }
  if (!image?.id) {
    throw new Error('Select an image before downloading an image report.');
  }

  const generatedAt = new Date();
  const generatedLabel = formatReportTimestamp(generatedAt);

  const imageAnnotations = annotations
    .filter((ann) => ann && ann.imageId === image.id)
    .slice()
    .sort((a, b) => Number(a.annotationNumber) - Number(b.annotationNumber));

  const openCount = imageAnnotations.filter(
    (ann) => ann.status !== 'resolved'
  ).length;
  const resolvedCount = imageAnnotations.length - openCount;
  const imageReviewStatus = image.is_completed ? 'Completed' : 'In Review';

  const headerMeta = {
    reportLabel: 'Image Review Report',
    contextLabel: image.original_filename,
  };

  const doc = await createFrameCheckPdfDoc();
  drawRunningHeader(doc, headerMeta);

  let y = 24;
  y = drawReportBanner(doc, y, {
    title: 'FrameCheck Image Review Report',
    subtitle: `${batch.name} - ${image.original_filename}`,
  });

  const metadataRows = [
    { label: 'Batch Name', value: batch.name },
    { label: 'Batch ID', value: batch.id },
    {
      label: 'Image Filename',
      value: image.relative_path
        ? `${image.original_filename} (${image.relative_path})`
        : image.original_filename,
    },
    { label: 'Image Review Status', value: imageReviewStatus },
    {
      label: 'Total Annotations',
      value: `${imageAnnotations.length} (${openCount} Open, ${resolvedCount} Resolved)`,
    },
    { label: 'Report Generated', value: generatedLabel },
  ];

  y = drawMetadataCard(doc, y, metadataRows, headerMeta);

  const imageResult = await drawStorageImageIntoPdf(doc, {
    storagePath: image.storage_path,
    filename: image.original_filename,
    startY: y,
    headerMeta,
    throwOnError: true,
  });
  y = imageResult.nextY;

  drawAnnotationList(doc, imageAnnotations, y, headerMeta);
  stampPageNumbersAndFooters(doc, generatedLabel);

  const filename = sanitizePdfFilename(
    `framecheck-${batch.name}-${image.original_filename}-report`,
    'framecheck-image-report'
  );
  doc.save(filename);

  return {
    filename,
    annotationCount: imageAnnotations.length,
  };
}

