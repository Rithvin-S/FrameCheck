import { useEffect, useRef, useState } from 'react';
import { getSignedImageUrl } from '../services/imageUploadService.js';
import './ThumbnailFilmstrip.css';

function LazyThumbnail({ image, index, isSelected, onSelect, scrollRootRef }) {
  const itemRef = useRef(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const node = itemRef.current;
    if (!node || shouldLoad) return undefined;

    if (typeof IntersectionObserver === 'undefined') {
      setShouldLoad(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      {
        root: scrollRootRef.current ?? null,
        rootMargin: '240px',
      }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [scrollRootRef, shouldLoad]);

  useEffect(() => {
    if (!shouldLoad || url) return undefined;

    let cancelled = false;
    setLoading(true);
    setHasError(false);

    getSignedImageUrl(image.storage_path)
      .then((signedUrl) => {
        if (!cancelled) {
          setUrl(signedUrl);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHasError(true);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [image.storage_path, shouldLoad, url]);

  useEffect(() => {
    if (isSelected && itemRef.current) {
      itemRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      });
    }
  }, [isSelected]);

  return (
    <button
      ref={itemRef}
      type="button"
      className={`fc-thumb-btn${isSelected ? ' fc-thumb-btn-selected' : ''}`}
      onClick={() => onSelect(image.id)}
      title={image.relative_path || image.original_filename}
      aria-current={isSelected ? 'true' : undefined}
    >
      <div className="fc-thumb-frame">
        {!shouldLoad || (loading && !hasError) ? (
          <div className="fc-thumb-placeholder" aria-hidden="true">
            <span className="fc-thumb-skeleton" />
          </div>
        ) : null}

        {hasError ? (
          <div className="fc-thumb-error">Unavailable</div>
        ) : url ? (
          <img
            src={url}
            alt={image.original_filename}
            className={`fc-thumb-img${loading ? ' fc-thumb-img-hidden' : ''}`}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setHasError(true);
            }}
          />
        ) : null}

        <span className="fc-thumb-index">#{index + 1}</span>
        {image.is_completed ? (
          <span
            className="fc-thumb-completed-badge"
            title="Image marked as completed"
            aria-label="Completed"
          >
            ✓
          </span>
        ) : null}
      </div>
      <span className="fc-thumb-caption">{image.original_filename}</span>
    </button>
  );
}

/**
 * Horizontally scrollable thumbnail filmstrip using lazy IntersectionObserver loading
 * so large batches do not download or decode every image into memory at once.
 */
export function ThumbnailFilmstrip({
  images,
  selectedImageId,
  onSelectImage,
  variant = 'default',
}) {
  const stripRef = useRef(null);

  if (images.length === 0) {
    return null;
  }

  return (
    <section
      className={`fc-filmstrip-section${
        variant === 'workspace' ? ' fc-filmstrip-workspace' : ''
      }`}
      aria-label="Batch image thumbnails"
    >
      <div ref={stripRef} className="fc-filmstrip-scroll">
        {images.map((image, index) => (
          <LazyThumbnail
            key={image.id}
            image={image}
            index={index}
            isSelected={image.id === selectedImageId}
            onSelect={onSelectImage}
            scrollRootRef={stripRef}
          />
        ))}
      </div>
    </section>
  );
}

