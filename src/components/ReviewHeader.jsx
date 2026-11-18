import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { NotificationBell } from './NotificationBell.jsx';
import { WorkspaceLayoutMenu } from './WorkspaceLayoutMenu.jsx';
import { calculatePopoverCoords } from './popoverPositioning.js';
import { REVIEW_STATUS_LABELS } from '../services/batchService.js';
import { formatRoleLabel } from '../services/profileService.js';
import './Header.css';
import './ReviewHeader.css';

/**
 * Modern Review Workspace Header for FrameCheck.
 *
 * Enforces predictable, dedicated layout boundaries across three groups:
 * 1. Workspace Identity (Brand -> Back to Batch -> Batch Name -> Review Status -> FigJam Workspace Switcher)
 * 2. Review Context (Image Position Pill, neatly centered)
 * 3. Workspace Actions (Figma Collaborator Presence -> Primary Actions [Present, Export] -> Layout Popover -> Secondary Utilities)
 */
export function ReviewHeader({
  batchId,
  batchName,
  batchReviewStatus = null,
  currentPosition,
  totalImages,
  activeReviewers = [],
  currentUserId = null,
  followingUserId = null,
  onFollowReviewer = null,
  onStopFollowing = null,
  canReview = false,
  images = [],
  onToggleFocusMode = null,
  panelLayout = 'default',
  onTogglePanelLayout = null,
  onResetPanelSizes = null,
  isThumbnailsVisible = true,
  onToggleThumbnailsVisible = null,
  isSidebarVisible = true,
  onToggleSidebarVisible = null,
  onShowAllPanels = null,
  activeLayoutId = 'preset-default',
  activeLayoutName = 'Default',
  isLayoutModified = false,
  savedLayouts = [],
  onApplyLayout = null,
  onSaveLayout = null,
  onDeleteLayout = null,
  onOpenPreferences = null,
  onTogglePresentationMode = null,
  onOpenExportModal = null,
  onOpenOnboarding = null,
}) {
  const { profile, signOut } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  // Collaborator presence popover state
  const [isCollabOpen, setIsCollabOpen] = useState(false);
  const [collabCoords, setCollabCoords] = useState(null);
  const collabBtnRef = useRef(null);
  const collabPopoverRef = useRef(null);

  // Calculate viewport-aware coordinates for Active Collaborators Popover
  const updateCollabCoords = useCallback(() => {
    if (!collabBtnRef.current) return;
    const coords = calculatePopoverCoords(collabBtnRef.current, {
      preferredWidth: 280,
      estimatedHeight: 280,
      maxLimitHeight: 400,
      margin: 12,
      gap: 8,
      align: 'left',
    });
    setCollabCoords(coords);
  }, []);

  useLayoutEffect(() => {
    if (isCollabOpen) {
      updateCollabCoords();
    }
  }, [isCollabOpen, updateCollabCoords]);

  // Keep popover coordinates aligned on resize or scroll
  useEffect(() => {
    if (!isCollabOpen) return;

    const handleUpdate = () => {
      updateCollabCoords();
    };

    window.addEventListener('resize', handleUpdate);
    window.addEventListener('scroll', handleUpdate, true);
    return () => {
      window.removeEventListener('resize', handleUpdate);
      window.removeEventListener('scroll', handleUpdate, true);
    };
  }, [isCollabOpen, updateCollabCoords]);

  // Close collaborator popover on click outside or Escape key
  useEffect(() => {
    if (!isCollabOpen) return;

    const handlePointerDown = (e) => {
      const isInsideBtn = collabBtnRef.current && collabBtnRef.current.contains(e.target);
      const isInsidePopover = collabPopoverRef.current && collabPopoverRef.current.contains(e.target);
      if (!isInsideBtn && !isInsidePopover) {
        setIsCollabOpen(false);
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsCollabOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isCollabOpen]);

  const handleToggleCollab = useCallback(() => {
    if (!isCollabOpen) {
      updateCollabCoords();
    }
    setIsCollabOpen((prev) => !prev);
  }, [isCollabOpen, updateCollabCoords]);

  const imageIndexMap = useMemo(() => {
    const map = new Map();
    if (Array.isArray(images)) {
      images.forEach((img, idx) => {
        if (img?.id) map.set(img.id, idx + 1);
      });
    }
    return map;
  }, [images]);

  const activeReviewersSummary = useMemo(() => {
    if (!activeReviewers || activeReviewers.length === 0) return '';
    return activeReviewers
      .map((r) => (r.userId === currentUserId ? `${r.displayName} (You)` : r.displayName))
      .join(', ');
  }, [activeReviewers, currentUserId]);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      navigate('/login', { replace: true });
    } catch {
      // Keep current workspace visible if sign-out fails so user can retry.
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <header className="fc-review-header">
      {/* 1. Workspace Identity */}
      <div className="fc-review-identity-group">
        <Link to="/dashboard" className="fc-brand" title="Go to Dashboard" aria-label="FrameCheck Dashboard">
          <span className="fc-brand-mark" aria-hidden="true">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <rect
                x="3"
                y="3"
                width="18"
                height="18"
                rx="4"
                stroke="currentColor"
                strokeWidth="2"
              />
              <circle
                cx="12"
                cy="12"
                r="4.5"
                stroke="currentColor"
                strokeWidth="2"
              />
            </svg>
          </span>
          <span className="fc-brand-name">FrameCheck</span>
        </Link>

        <span className="fc-review-crumb-sep" aria-hidden="true">/</span>

        <Link
          to={`/batches/${batchId}`}
          className="fc-review-back-link"
          title="Return to Batch Details"
          aria-label="Return to Batch Details"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M10 13L5 8l5-5" />
          </svg>
          <span>Back to Batch</span>
        </Link>

        {batchReviewStatus && REVIEW_STATUS_LABELS[batchReviewStatus] ? (
          <span
            className={`fc-review-status-badge fc-review-status-${batchReviewStatus}`}
            title={`Status: ${REVIEW_STATUS_LABELS[batchReviewStatus]}`}
          >
            <span className="fc-status-dot" aria-hidden="true" />
            {REVIEW_STATUS_LABELS[batchReviewStatus]}
          </span>
        ) : null}

        {batchId ? (
          <nav className="fc-workspace-nav-switcher" aria-label="Batch workspaces">
            <span
              className="fc-workspace-tab fc-workspace-tab-active"
              aria-current="page"
              title="Currently viewing Review Workspace"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="2" y="2" width="12" height="12" rx="2" />
                <circle cx="5.5" cy="5.5" r="1.5" />
                <path d="M14 11l-3.5-3.5-5 5" />
              </svg>
              <span>Review</span>
            </span>
            <Link
              to={`/batches/${batchId}/whiteboard`}
              className="fc-workspace-tab fc-workspace-tab-link"
              title="Switch to Collaborative Whiteboard"
              aria-label="Collaborative Whiteboard"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="2" y="2" width="12" height="10" rx="1.5" />
                <line x1="2" y1="14" x2="14" y2="14" />
              </svg>
              <span>Whiteboard</span>
            </Link>
          </nav>
        ) : null}
      </div>

      {/* 2. Review Context / Collaborators (Center) */}
      <div className="fc-review-context-group">
        <div className="fc-collab-presence-container">
          <button
            ref={collabBtnRef}
            type="button"
            className={`fc-collab-trigger-btn${isCollabOpen ? ' fc-collab-trigger-active' : ''}`}
            onClick={handleToggleCollab}
            title={`Active Collaborators (${activeReviewers?.length || 1}): ${activeReviewersSummary}. Click to view details.`}
            aria-label={`Collaborators: ${activeReviewers?.length || 1} active. Click to view list and follow reviewers.`}
            aria-expanded={isCollabOpen}
            aria-haspopup="dialog"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M11 14v-1.5a2.5 2.5 0 0 0-2.5-2.5h-3A2.5 2.5 0 0 0 3 12.5V14" />
              <circle cx="7" cy="5" r="2.5" />
              <path d="M14 14v-1.5a2.5 2.5 0 0 0-1.8-2.4" />
              <path d="M10.5 2.6a2.5 2.5 0 0 1 0 4.8" />
            </svg>
            <span>Collaborators ({activeReviewers?.length > 0 ? activeReviewers.length : 1})</span>
          </button>

          {isCollabOpen && typeof document !== 'undefined' && document.body
            ? createPortal(
                <div
                  ref={collabPopoverRef}
                  className="fc-collab-popover"
                  role="dialog"
                  aria-label="Active Collaborators"
                  style={
                    collabCoords
                      ? {
                          left: `${collabCoords.left}px`,
                          top: collabCoords.top === 'auto' ? 'auto' : `${collabCoords.top}px`,
                          bottom: collabCoords.bottom === 'auto' ? 'auto' : `${collabCoords.bottom}px`,
                          width: `${collabCoords.width}px`,
                          maxHeight: `${collabCoords.maxHeight}px`,
                        }
                      : undefined
                  }
                >
                  <div className="fc-collab-popover-header">
                    <div className="fc-collab-popover-title-row">
                      <span className="fc-collab-popover-title">Active Collaborators</span>
                      <span className="fc-collab-count-badge">{activeReviewers?.length || 1}</span>
                    </div>
                    <span className="fc-collab-popover-subtitle">
                      Real-time collaborators in this batch
                    </span>
                  </div>

                  <div className="fc-collab-popover-list" role="list">
                    {(activeReviewers && activeReviewers.length > 0
                      ? activeReviewers
                      : [{ userId: currentUserId || 'self', displayName: 'You', color: '#6366f1' }]
                    ).map((r) => {
                      const isSelf = r.userId === currentUserId || r.userId === 'self';
                      const isFollowed = r.userId === followingUserId;
                      const imgPos = r.selectedImageId
                        ? imageIndexMap.get(r.selectedImageId)
                        : null;
                      const initials = (r.displayName || 'R').slice(0, 2).toUpperCase();

                      return (
                        <div
                          key={r.userId}
                          className={`fc-collab-entry${isFollowed ? ' fc-collab-entry-followed' : ''}${
                            isSelf ? ' fc-collab-entry-self' : ''
                          }`}
                          role="listitem"
                        >
                          <span
                            className="fc-collab-entry-avatar"
                            style={{ backgroundColor: r.color }}
                            aria-hidden="true"
                          >
                            {initials}
                          </span>

                          <div className="fc-collab-entry-info">
                            <div className="fc-collab-entry-name-row">
                              <span className="fc-collab-entry-name">{r.displayName}</span>
                              {isSelf ? (
                                <span className="fc-collab-you-badge">You</span>
                              ) : null}
                              {isFollowed ? (
                                <span className="fc-collab-following-badge">Following</span>
                              ) : null}
                            </div>
                            <span className="fc-collab-entry-status">
                              {imgPos
                                ? `Viewing Image ${imgPos}`
                                : r.followingUserId
                                ? 'Following a reviewer'
                                : 'Active in batch'}
                            </span>
                          </div>

                          {canReview && !isSelf ? (
                            <div className="fc-collab-entry-action">
                              {isFollowed ? (
                                <button
                                  type="button"
                                  className="fc-collab-action-btn fc-collab-stop-btn"
                                  onClick={() => {
                                    onStopFollowing?.();
                                  }}
                                  title={`Stop following ${r.displayName}`}
                                >
                                  Stop
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="fc-collab-action-btn fc-collab-follow-btn"
                                  onClick={() => {
                                    onFollowReviewer?.(r.userId);
                                  }}
                                  title={`Follow ${r.displayName}'s viewport and image navigation`}
                                >
                                  Follow
                                </button>
                              )}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>,
                document.body
              )
            : null}
        </div>
      </div>

      {/* 3. Workspace Actions */}
      <div className="fc-review-actions-group">
        {/* Primary review actions cluster */}
        <div className="fc-header-action-cluster" role="group" aria-label="Review workspace tools">
          {onTogglePresentationMode ? (
            <button
              type="button"
              className="fc-header-action-btn fc-header-present-btn fc-action-btn-present"
              onClick={onTogglePresentationMode}
              title="Start Presentation Mode (Clean showcase view)"
              aria-label="Presentation Mode"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
              <span className="fc-action-text">Present</span>
            </button>
          ) : null}

          {onOpenExportModal ? (
            <button
              type="button"
              className="fc-header-action-btn fc-header-export-btn"
              onClick={onOpenExportModal}
              title="Export / Download Annotated Image (PNG/JPEG)"
              aria-label="Export Annotated Image"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span className="fc-action-text">Export</span>
            </button>
          ) : null}
        </div>

        {/* Layout popover menu */}
        {onTogglePanelLayout ? (
          <WorkspaceLayoutMenu
            panelLayout={panelLayout}
            onTogglePanelLayout={onTogglePanelLayout}
            onResetPanelSizes={onResetPanelSizes}
            isThumbnailsVisible={isThumbnailsVisible}
            onToggleThumbnailsVisible={onToggleThumbnailsVisible}
            isSidebarVisible={isSidebarVisible}
            onToggleSidebarVisible={onToggleSidebarVisible}
            onShowAllPanels={onShowAllPanels}
            activeLayoutId={activeLayoutId}
            activeLayoutName={activeLayoutName}
            isModified={isLayoutModified}
            savedLayouts={savedLayouts}
            onApplyLayout={onApplyLayout}
            onSaveLayout={onSaveLayout}
            onDeleteLayout={onDeleteLayout}
            onOpenPreferences={onOpenPreferences}
          />
        ) : null}

        {/* Secondary utilities & user identity cluster */}
        <div className="fc-header-util-cluster" role="group" aria-label="Utilities and account">
          {onOpenPreferences ? (
            <button
              type="button"
              className="fc-header-util-btn fc-header-preferences-btn"
              onClick={onOpenPreferences}
              title="Reviewer Workspace Preferences"
              aria-label="Reviewer Workspace Preferences"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              <span className="fc-util-text">Preferences</span>
            </button>
          ) : null}

          {onOpenOnboarding ? (
            <button
              type="button"
              className="fc-header-util-btn fc-header-guide-btn"
              onClick={onOpenOnboarding}
              title="Onboarding & Workflow Guide"
              aria-label="Workflow Guide"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span className="fc-util-text">Guide</span>
            </button>
          ) : null}

          <button
            type="button"
            className="fc-theme-toggle-btn"
            onClick={toggleTheme}
            title={isDark ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
            aria-label={isDark ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
          >
            {isDark ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>

          <NotificationBell />

          {profile ? (
            <div className="fc-user-controls">
              <div
                className="fc-user-identity"
                title={`${profile.display_name} (${formatRoleLabel(profile.role)})`}
              >
                <span className="fc-user-avatar-initial" aria-hidden="true">
                  {(profile.display_name || 'U').slice(0, 1).toUpperCase()}
                </span>
                <span className="fc-user-name">{profile.display_name}</span>
                <span className={`fc-role-badge fc-role-${profile.role}`}>
                  {formatRoleLabel(profile.role)}
                </span>
              </div>
              <button
                type="button"
                className="fc-btn fc-btn-secondary fc-btn-sm fc-signout-btn"
                onClick={handleSignOut}
                disabled={signingOut}
                title="Sign out of FrameCheck"
              >
                {signingOut ? '…' : 'Sign Out'}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
