import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { getReviewerColor } from '../services/annotationState.js';
import {
  getUnreadNotificationCount,
  listUserNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  subscribeToUserNotifications,
} from '../services/notificationService.js';
import './NotificationBell.css';

function formatNotificationTime(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function getNotificationTypeIcon(type, data) {
  switch (type) {
    case 'mention':
      return <span className="fc-notif-type-icon fc-notif-mention">@</span>;
    case 'reaction':
      return <span className="fc-notif-type-icon fc-notif-reaction">{data?.emoji || '👍'}</span>;
    case 'status_change':
      return (
        <span className="fc-notif-type-icon fc-notif-status">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path
              d="M5 13l4 4L19 7"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      );
    default:
      return (
        <span className="fc-notif-type-icon fc-notif-default">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      );
  }
}

/**
 * Header Notification Bell with unread counter badge and expandable Notification Center popover.
 */
export function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filterUnread, setFilterUnread] = useState(false);
  const containerRef = useRef(null);

  const userId = user?.id ?? null;

  // Initial load of unread count and real-time subscription
  useEffect(() => {
    if (!userId) return;

    let disposed = false;

    getUnreadNotificationCount(userId).then((count) => {
      if (!disposed) setUnreadCount(count);
    });

    const unsubscribe = subscribeToUserNotifications({
      userId,
      onNewNotification: (newNotif) => {
        if (disposed) return;
        setNotifications((prev) => [newNotif, ...prev]);
        setUnreadCount((c) => c + 1);
      },
      onUnreadChange: () => {
        if (disposed) return;
        getUnreadNotificationCount(userId).then((count) => {
          if (!disposed) setUnreadCount(count);
        });
      },
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [userId]);

  // Load notifications list when panel opens or filter changes
  useEffect(() => {
    if (!isOpen || !userId) return;

    setLoading(true);
    listUserNotifications({
      userId,
      limit: 20,
      offset: 0,
      unreadOnly: filterUnread,
    })
      .then((res) => {
        setNotifications(res.notifications);
        setTotalCount(res.total);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [isOpen, userId, filterUnread]);

  // Close panel on outside click or Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('pointerdown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleMarkOneRead = async (notif) => {
    if (!notif.isRead) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === notif.id ? { ...n, isRead: true } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
      await markNotificationAsRead(notif.id);
    }
  };

  const handleNotificationClick = async (notif) => {
    await handleMarkOneRead(notif);
    setIsOpen(false);

    // Deep navigate to relevant image & annotation review workspace
    if (notif.batchId && notif.imageId && notif.annotationId) {
      navigate(`/batches/${notif.batchId}/review?image=${notif.imageId}&annotation=${notif.annotationId}`);
    } else if (notif.batchId && notif.imageId) {
      navigate(`/batches/${notif.batchId}/review?image=${notif.imageId}`);
    } else if (notif.batchId) {
      navigate(`/batches/${notif.batchId}`);
    }
  };

  const handleMarkAllRead = async () => {
    if (!userId || unreadCount === 0) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
    await markAllNotificationsAsRead(userId);
  };

  const handleLoadMore = async () => {
    if (loading || notifications.length >= totalCount || !userId) return;
    setLoading(true);
    try {
      const res = await listUserNotifications({
        userId,
        limit: 20,
        offset: notifications.length,
        unreadOnly: filterUnread,
      });
      setNotifications((prev) => [...prev, ...res.notifications]);
      setTotalCount(res.total);
    } finally {
      setLoading(false);
    }
  };

  if (!userId) return null;

  return (
    <div className="fc-notification-bell-container" ref={containerRef}>
      <button
        type="button"
        className={`fc-notification-bell-btn ${isOpen ? 'active' : ''}`}
        onClick={() => setIsOpen((prev) => !prev)}
        title={unreadCount > 0 ? `${unreadCount} unread notification(s)` : 'Notifications'}
        aria-label={unreadCount > 0 ? `Open notifications, ${unreadCount} unread` : 'Open notifications'}
        aria-expanded={isOpen}
      >
        <span className="fc-bell-icon-wrapper">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="fc-bell-icon"
            aria-hidden="true"
          >
            <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 01-3.46 0" />
          </svg>

          {unreadCount > 0 && (
            <span
              className="fc-notification-indicator-dot"
              aria-label={`${unreadCount} unread notification(s)`}
              title={`${unreadCount} unread notification(s)`}
              role="status"
            />
          )}
        </span>

        {unreadCount > 0 && (
          <span className="fc-notification-badge" aria-label={`${unreadCount} unread`}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Popover Notification Panel */}
      {isOpen && (
        <div className="fc-notification-panel" role="dialog" aria-label="Notifications panel">
          <div className="fc-notif-panel-header">
            <div className="fc-notif-title-row">
              <h2 className="fc-notif-header-title">Notifications</h2>
              {unreadCount > 0 && (
                <span className="fc-notif-header-pill">{unreadCount} new</span>
              )}
            </div>

            <div className="fc-notif-header-actions">
              <div className="fc-notif-tabs">
                <button
                  type="button"
                  className={`fc-notif-tab ${!filterUnread ? 'active' : ''}`}
                  onClick={() => setFilterUnread(false)}
                >
                  All
                </button>
                <button
                  type="button"
                  className={`fc-notif-tab ${filterUnread ? 'active' : ''}`}
                  onClick={() => setFilterUnread(true)}
                >
                  Unread
                </button>
              </div>

              {unreadCount > 0 && (
                <button
                  type="button"
                  className="fc-notif-mark-all-btn"
                  onClick={handleMarkAllRead}
                >
                  Mark all as read
                </button>
              )}
            </div>
          </div>

          <div className="fc-notif-panel-body">
            {loading && notifications.length === 0 ? (
              <div className="fc-notif-empty-state" aria-busy="true">
                <span className="fc-spinner" aria-hidden="true" />
                <span>Loading notifications…</span>
              </div>
            ) : notifications.length === 0 ? (
              <div className="fc-notif-empty-state">
                <span className="fc-notif-empty-icon">🔔</span>
                <p className="fc-notif-empty-title">
                  {filterUnread ? 'No unread notifications' : 'No notifications yet'}
                </p>
                <p className="fc-notif-empty-subtitle">
                  {filterUnread
                    ? 'You have caught up with all your notifications.'
                    : 'When you are mentioned or receive reactions, they will show up here.'}
                </p>
              </div>
            ) : (
              <div className="fc-notif-list" role="list">
                {notifications.map((notif) => {
                  const avatarColor = getReviewerColor(notif.actorId || notif.actorName);
                  const initials = (notif.actorName || 'R').slice(0, 2).toUpperCase();

                  return (
                    <article
                      key={notif.id}
                      role="listitem"
                      className={`fc-notif-item ${notif.isRead ? 'read' : 'unread'}`}
                      onClick={() => handleNotificationClick(notif)}
                    >
                      <div className="fc-notif-avatar-col">
                        <span
                          className="fc-notif-avatar"
                          style={{ backgroundColor: avatarColor }}
                          aria-hidden="true"
                        >
                          {initials}
                        </span>
                        {getNotificationTypeIcon(notif.type, notif.data)}
                      </div>

                      <div className="fc-notif-content-col">
                        <div className="fc-notif-row-top">
                          <span className="fc-notif-item-title">{notif.title}</span>
                          <time className="fc-notif-item-time">
                            {formatNotificationTime(notif.createdAt)}
                          </time>
                        </div>

                        {notif.message && (
                          <p className="fc-notif-item-snippet">{notif.message}</p>
                        )}
                      </div>

                      {!notif.isRead && (
                        <div
                          className="fc-notif-unread-dot"
                          title="Unread notification"
                          aria-label="Unread"
                        />
                      )}
                    </article>
                  );
                })}

                {notifications.length < totalCount && (
                  <div className="fc-notif-load-more">
                    <button
                      type="button"
                      className="fc-btn fc-btn-secondary fc-btn-sm"
                      onClick={handleLoadMore}
                      disabled={loading}
                    >
                      {loading ? 'Loading…' : 'Load earlier notifications'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

