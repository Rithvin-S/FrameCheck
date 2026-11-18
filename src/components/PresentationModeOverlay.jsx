import React, { useState, useEffect, useCallback } from 'react';
import './PresentationModeOverlay.css';

export function PresentationModeOverlay({
  isOpen,
  onClose,
  currentImage,
  currentIndex = 0,
  totalImages = 0,
  onPrevImage,
  onNextImage,
  showAnnotations = true,
  onToggleAnnotations,
}) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isControlsVisible, setIsControlsVisible] = useState(true);

  // Monitor fullscreen change
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const handleToggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  // Keyboard navigation inside presentation mode
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        onNextImage?.();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        onPrevImage?.();
      } else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        onToggleAnnotations?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose, onNextImage, onPrevImage, onToggleAnnotations]);

  // Hide controls after 4s idle in presentation mode
  useEffect(() => {
    if (!isOpen) return;

    let timer = null;
    const handleMouseMove = () => {
      setIsControlsVisible(true);
      clearTimeout(timer);
      timer = setTimeout(() => {
        setIsControlsVisible(false);
      }, 4000);
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      clearTimeout(timer);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className={`fc-presentation-bar-wrap ${isControlsVisible ? 'is-visible' : 'is-faded'}`}>
      <div className="fc-presentation-bar" role="toolbar" aria-label="Presentation mode controls">
        {/* Left: Image Info */}
        <div className="fc-presentation-info">
          <span className="fc-presentation-badge">PRESENTATION</span>
          <span className="fc-presentation-pos">
            Image {currentIndex + 1} of {totalImages}
          </span>
          <span className="fc-presentation-divider" aria-hidden="true" />
          <span className="fc-presentation-filename" title={currentImage?.original_filename}>
            {currentImage?.original_filename || 'Untitled Image'}
          </span>
        </div>

        {/* Center: Image Navigation */}
        <div className="fc-presentation-nav">
          <button
            type="button"
            className="fc-presentation-btn"
            onClick={onPrevImage}
            disabled={currentIndex <= 0}
            title="Previous Image (Left Arrow / PageUp)"
            aria-label="Previous Image"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
            <span>Prev</span>
          </button>

          <button
            type="button"
            className="fc-presentation-btn"
            onClick={onNextImage}
            disabled={currentIndex >= totalImages - 1}
            title="Next Image (Right Arrow / Space / PageDown)"
            aria-label="Next Image"
          >
            <span>Next</span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>

        {/* Right: View Toggles & Exit */}
        <div className="fc-presentation-actions">
          <button
            type="button"
            className={`fc-presentation-btn ${showAnnotations ? 'is-active' : ''}`}
            onClick={onToggleAnnotations}
            title="Toggle Annotations Visibility (A)"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {showAnnotations ? (
                <>
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </>
              ) : (
                <>
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </>
              )}
            </svg>
            <span>{showAnnotations ? 'Markings On' : 'Markings Hidden'}</span>
          </button>

          <button
            type="button"
            className="fc-presentation-btn"
            onClick={handleToggleFullscreen}
            title="Toggle Fullscreen View"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {isFullscreen ? (
                <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
              ) : (
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
              )}
            </svg>
            <span>{isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}</span>
          </button>

          <button
            type="button"
            className="fc-presentation-btn fc-presentation-exit-btn"
            onClick={onClose}
            title="Exit Presentation Mode (Esc)"
          >
            <span>Exit</span>
            <kbd className="fc-presentation-kbd">Esc</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}

