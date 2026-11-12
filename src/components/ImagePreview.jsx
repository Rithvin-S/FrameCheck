import { useCallback, useEffect, useState } from 'react';
import {
  formatFileSize,
  getFormatLabel,
  getSignedImageUrl,
} from '../services/imageUploadService.js';
import './ImagePreview.css';

/**
 * Large preview stage for the currently selected batch image.
 * Fetches and renders only the selected image while preserving original aspect ratio.
 * Wraps the image in an exact-fit container with an overlay slot prepared for future annotations.
 */
export function ImagePreview({
  image,
  imageIndex,
  totalImages,
  onPrev,
  onNext,
  variant = 'default',
  prepareAnnotationLayer = false,
  headerActions = null,
  toolbarSlot = null,
  annotationOverlay = null,
}) {
  const [signedUrl, setSignedUrl] = useState('');
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [decodingImage, setDecodingImage] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [dimensions, setDimensions] = useState(null);

  const loadSignedUrl = useCallback(async (storagePath, forceRefresh = false) => {
    setLoadingUrl(true);
    setDecodingImage(true);
    setErrorMessage('');
    setDimensions(null);
    setSignedUrl('');

    try {
      const nextUrl = await getSignedImageUrl(storagePath, { forceRefresh });
      return nextUrl;
    } catch (error) {
      setDecodingImage(false);
      throw error;
    } finally {
      setLoadingUrl(false);
    }
  }, []);

  useEffect(() => {
    if (!image?.storage_path) return undefined;

    let cancelled = false;

    loadSignedUrl(image.storage_path, false)
      .then((nextUrl) => {
        if (!cancelled) {
          setSignedUrl(nextUrl);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setErrorMessage(error?.message || 'Unable to load image preview.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [image?.storage_path, loadSignedUrl]);

  const handleRetry = () => {
    if (!image?.storage_path) return;
    loadSignedUrl(image.storage_path, true)
      .then((nextUrl) => {
        setSignedUrl(nextUrl);
      })
      .catch((error) => {
        setErrorMessage(error?.message || 'Unable to load image preview.');
      });
  };

  if (!image) {
    return null;
  }

  const isLoading = (loadingUrl || decodingImage) && !errorMessage;
  const isWorkspace = variant === 'workspace';

  return (
    <section
      className={`fc-preview-panel${isWorkspace ? ' fc-preview-workspace' : ''}`}
      aria-label="Selected image preview"
    >
      <div className="fc-preview-toolbar">
        <div className="fc-preview-title-group">
          <span className="fc-preview-counter">
            Image {imageIndex + 1} of {totalImages}
          </span>
          <h2 className="fc-preview-filename">{image.original_filename}</h2>
          {image.relative_path ? (
            <span className="fc-preview-relpath">{image.relative_path}</span>
          ) : null}
        </div>

        <div className="fc-preview-nav">
          {headerActions}
          <button
            type="button"
            className="fc-btn fc-btn-secondary fc-btn-sm"
            onClick={onPrev}
            disabled={imageIndex <= 0}
          >
            Previous
          </button>
          <button
            type="button"
            className="fc-btn fc-btn-secondary fc-btn-sm"
            onClick={onNext}
            disabled={imageIndex >= totalImages - 1}
          >
            Next
          </button>
        </div>
      </div>

      {toolbarSlot}

      <div className="fc-preview-stage">
        <div className="fc-preview-stage-inner">
          {isLoading ? (
            <div className="fc-preview-state" aria-busy="true">
              <div className="fc-spinner-row">
                <span className="fc-spinner" aria-hidden="true" />
                <span>Loading image…</span>
              </div>
            </div>
          ) : null}

          {errorMessage ? (
            <div className="fc-preview-state" role="alert">
              <p className="fc-preview-error-text">{errorMessage}</p>
              <button
                type="button"
                className="fc-btn fc-btn-secondary fc-btn-sm"
                onClick={handleRetry}
              >
                Retry Preview
              </button>
            </div>
          ) : signedUrl ? (
            <div
              className={`fc-canvas-frame${
                decodingImage ? ' fc-preview-img-hidden' : ''
              }`}
            >
              <img
                key={image.id}
                src={signedUrl}
                alt={image.original_filename}
                className="fc-preview-img"
                draggable={false}
                decoding="async"
                onLoad={(event) => {
                  setDecodingImage(false);
                  setDimensions({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  });
                }}
                onError={() => {
                  setDecodingImage(false);
                  setErrorMessage('Image failed to load from storage.');
                }}
              />
              {!decodingImage && annotationOverlay
                ? annotationOverlay
                : prepareAnnotationLayer && !decodingImage ? (
                    <div
                      className="fc-annotation-layer"
                      data-annotation-layer="ready"
                      aria-hidden="true"
                    />
                  ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="fc-preview-meta">
        <span>Format: {getFormatLabel(image.mime_type)}</span>
        <span>Size: {formatFileSize(image.file_size)}</span>
        {dimensions ? (
          <span>
            Dimensions: {dimensions.width} × {dimensions.height} px
          </span>
        ) : null}
      </div>
    </section>
  );
}
