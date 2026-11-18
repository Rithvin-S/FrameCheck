import { useCallback, useEffect, useRef, useState } from 'react';
import { getReviewerColor } from '../services/annotationState.js';
import './MentionInput.css';

/**
 * Enhanced textarea with @mention autocomplete dropdown for authorized batch users.
 */
export function MentionInput({
  id,
  value = '',
  onChange,
  onKeyDown,
  placeholder = 'Explain what needs attention in this area…',
  maxLength = 1000,
  rows = 3,
  disabled = false,
  mentionableUsers = [],
  className = '',
  autoFocus = false,
}) {
  const textareaRef = useRef(null);
  const [mentionQuery, setMentionQuery] = useState(null); // string query or null
  const [mentionIndex, setMentionIndex] = useState(0); // selected index in dropdown
  const [mentionPos, setMentionPos] = useState({ start: 0, end: 0 }); // caret positions

  // Filter mentionable users based on query
  const filteredUsers = (mentionQuery !== null
    ? mentionableUsers.filter((u) => {
        const name = (u.displayName || '').toLowerCase();
        return name.includes(mentionQuery.toLowerCase());
      })
    : []
  ).slice(0, 6);

  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [autoFocus]);

  // Check text around cursor to see if user is currently typing a mention
  const checkMentionTrigger = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;

    const cursor = el.selectionStart;
    const textBefore = el.value.slice(0, cursor);

    // Look for @word immediately before cursor
    const lastAt = textBefore.lastIndexOf('@');
    if (lastAt !== -1) {
      // Check that @ is either at start or preceded by whitespace
      const charBeforeAt = lastAt > 0 ? textBefore[lastAt - 1] : ' ';
      if (/\s/.test(charBeforeAt) || lastAt === 0) {
        const query = textBefore.slice(lastAt + 1);
        // Only trigger if no newlines and query isn't excessively long
        if (!/[\n\r]/.test(query) && query.length <= 25) {
          setMentionQuery(query);
          setMentionPos({ start: lastAt, end: cursor });
          setMentionIndex(0);
          return;
        }
      }
    }

    setMentionQuery(null);
  }, []);

  const handleSelectUser = useCallback(
    (user) => {
      const el = textareaRef.current;
      if (!el || !user) return;

      const before = el.value.slice(0, mentionPos.start);
      const after = el.value.slice(mentionPos.end);
      const insertText = `@${user.displayName} `;
      const nextValue = before + insertText + after;

      onChange?.(nextValue);
      setMentionQuery(null);

      // Restore focus and position cursor right after the mention
      requestAnimationFrame(() => {
        if (el) {
          el.focus();
          const nextCursor = before.length + insertText.length;
          el.setSelectionRange(nextCursor, nextCursor);
        }
      });
    },
    [mentionPos, onChange]
  );

  const handleTextareaChange = (e) => {
    onChange?.(e.target.value);
    checkMentionTrigger();
  };

  const handleTextareaKeyDown = (e) => {
    // If mention dropdown is open, handle navigation keys
    if (mentionQuery !== null && filteredUsers.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((prev) => (prev + 1) % filteredUsers.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((prev) => (prev - 1 + filteredUsers.length) % filteredUsers.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        handleSelectUser(filteredUsers[mentionIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }

    onKeyDown?.(e);
  };

  return (
    <div className="fc-mention-input-wrapper">
      <textarea
        id={id}
        ref={textareaRef}
        className={`fc-sidebar-textarea ${className}`}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={handleTextareaChange}
        onKeyDown={handleTextareaKeyDown}
        onClick={checkMentionTrigger}
        onKeyUp={checkMentionTrigger}
      />

      {/* Autocomplete Dropdown */}
      {mentionQuery !== null && filteredUsers.length > 0 && (
        <div className="fc-mention-dropdown" role="listbox" aria-label="Mention users">
          <div className="fc-mention-dropdown-header">Mention authorized user</div>
          {filteredUsers.map((user, idx) => {
            const isSelected = idx === mentionIndex;
            const initials = (user.displayName || 'U').slice(0, 2).toUpperCase();
            const color = getReviewerColor(user.id || user.displayName);

            return (
              <div
                key={user.id}
                role="option"
                aria-selected={isSelected}
                className={`fc-mention-option ${isSelected ? 'active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault(); // prevent blur
                  handleSelectUser(user);
                }}
              >
                <span
                  className="fc-mention-avatar"
                  style={{ backgroundColor: color }}
                  aria-hidden="true"
                >
                  {initials}
                </span>
                <span className="fc-mention-name">{user.displayName}</span>
                <span className="fc-mention-role">{user.role}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

