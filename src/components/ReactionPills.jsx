import { useEffect, useRef, useState } from 'react';
import {
  ALLOWED_REACTIONS,
  summarizeReactions,
} from '../services/mentionReactionService.js';
import './ReactionPills.css';

/**
 * Interactive reaction bar for annotation comments with count badges and emoji popover picker.
 */
export function ReactionPills({
  annotationId,
  reactions = [],
  currentUserId,
  onToggleReaction,
  disabled = false,
}) {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const pickerRef = useRef(null);

  const summary = summarizeReactions(reactions, currentUserId);
  const activeEmojis = ALLOWED_REACTIONS.filter((emoji) => summary[emoji].count > 0);

  // Close picker on outside click
  useEffect(() => {
    if (!isPickerOpen) return;

    const handleDocumentClick = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        setIsPickerOpen(false);
      }
    };

    document.addEventListener('pointerdown', handleDocumentClick);
    return () => document.removeEventListener('pointerdown', handleDocumentClick);
  }, [isPickerOpen]);

  const handleEmojiClick = (emoji) => {
    if (disabled || !currentUserId) return;
    onToggleReaction?.(annotationId, emoji);
    setIsPickerOpen(false);
  };

  return (
    <div className="fc-reactions-container">
      {/* Existing Reaction Badges */}
      <div className="fc-reaction-pills-list">
        {activeEmojis.map((emoji) => {
          const item = summary[emoji];
          return (
            <button
              key={emoji}
              type="button"
              className={`fc-reaction-pill ${item.hasReacted ? 'active' : ''}`}
              onClick={() => handleEmojiClick(emoji)}
              disabled={disabled || !currentUserId}
              title={
                item.hasReacted
                  ? `You and ${item.count - 1} other(s) reacted with ${emoji}. Click to remove.`
                  : `${item.count} reviewer(s) reacted with ${emoji}. Click to add.`
              }
            >
              <span className="fc-reaction-emoji">{emoji}</span>
              <span className="fc-reaction-count">{item.count}</span>
            </button>
          );
        })}

        {/* Add Reaction Button */}
        {currentUserId && !disabled && (
          <div className="fc-reaction-picker-wrapper" ref={pickerRef}>
            <button
              type="button"
              className="fc-add-reaction-btn"
              onClick={() => setIsPickerOpen((prev) => !prev)}
              title="Add reaction"
              aria-label="Add reaction"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path
                  d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="fc-add-reaction-plus">+</span>
            </button>

            {/* Emoji Popover */}
            {isPickerOpen && (
              <div className="fc-emoji-popover" role="dialog" aria-label="Reaction options">
                {ALLOWED_REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className={`fc-popover-emoji-btn ${
                      summary[emoji].hasReacted ? 'reacted' : ''
                    }`}
                    onClick={() => handleEmojiClick(emoji)}
                    title={`React with ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

