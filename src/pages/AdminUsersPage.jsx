import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import {
  ROLE_OPTIONS,
  ROLES,
  fetchAllUsersForAdmin,
  formatRoleLabel,
  updateUserRoleAsAdmin,
} from '../services/profileService.js';
import './DashboardPage.css';
import './AdminUsersPage.css';

function formatDate(isoString) {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Admin-only user and role management page.
 * Enforces self-role protection and last-Admin safeguard both in UI and PostgreSQL RPC.
 */
export function AdminUsersPage() {
  const { profile } = useAuth();

  const [users, setUsers] = useState([]);
  const [draftRoles, setDraftRoles] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setErrorMessage('');

    try {
      const rows = await fetchAllUsersForAdmin();
      setUsers(rows);
      const nextDrafts = {};
      for (const row of rows) {
        nextDrafts[row.id] = row.role;
      }
      setDraftRoles(nextDrafts);
    } catch (error) {
      setErrorMessage(error?.message || 'Unable to load registered users.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const counts = useMemo(() => {
    const summary = {
      total: users.length,
      uploader: 0,
      reviewer: 0,
      admin: 0,
    };

    for (const userRow of users) {
      if (userRow.role in summary) {
        summary[userRow.role] += 1;
      }
    }

    return summary;
  }, [users]);

  const handleDraftChange = (userId, nextRole) => {
    setDraftRoles((prev) => ({
      ...prev,
      [userId]: nextRole,
    }));
    setErrorMessage('');
    setSuccessMessage('');
  };

  const handleRoleUpdate = async (userRow) => {
    const nextRole = draftRoles[userRow.id];
    if (!nextRole || nextRole === userRow.role) return;

    setErrorMessage('');
    setSuccessMessage('');
    setSavingUserId(userRow.id);

    try {
      const updated = await updateUserRoleAsAdmin({
        targetUserId: userRow.id,
        newRole: nextRole,
      });

      const resolvedRole = updated?.role ?? nextRole;

      setUsers((prev) =>
        prev.map((item) =>
          item.id === userRow.id
            ? {
                ...item,
                role: resolvedRole,
                updated_at: updated?.updated_at ?? item.updated_at,
              }
            : item
        )
      );
      setDraftRoles((prev) => ({
        ...prev,
        [userRow.id]: resolvedRole,
      }));
      setSuccessMessage(
        `Updated ${userRow.display_name}'s role to ${formatRoleLabel(resolvedRole)}.`
      );
    } catch (error) {
      setErrorMessage(error?.message || 'Unable to update user role.');
      setDraftRoles((prev) => ({
        ...prev,
        [userRow.id]: userRow.role,
      }));
    } finally {
      setSavingUserId(null);
    }
  };

  return (
    <main className="fc-page-main">
      <div className="fc-page-header">
        <div className="fc-page-title-group">
          <h1 className="fc-page-title">User &amp; Role Management</h1>
          <p className="fc-page-subtitle">
            Assign or revoke Reviewer and Admin roles for registered FrameCheck users.
          </p>
        </div>

        <button
          type="button"
          className="fc-btn fc-btn-secondary"
          onClick={loadUsers}
          disabled={loading || Boolean(savingUserId)}
        >
          {loading ? 'Refreshing…' : 'Refresh List'}
        </button>
      </div>

      <section className="fc-summary-bar" aria-label="User role summary">
        <div className="fc-summary-card">
          <span className="fc-summary-label">Total Users</span>
          <span className="fc-summary-value">{counts.total}</span>
        </div>
        <div className="fc-summary-card">
          <span className="fc-summary-label">Uploaders</span>
          <span className="fc-summary-value">{counts.uploader}</span>
        </div>
        <div className="fc-summary-card">
          <span className="fc-summary-label">Reviewers</span>
          <span className="fc-summary-value">{counts.reviewer}</span>
        </div>
        <div className="fc-summary-card">
          <span className="fc-summary-label">Admins</span>
          <span className="fc-summary-value">{counts.admin}</span>
        </div>
      </section>

      {errorMessage ? (
        <div className="fc-alert fc-alert-error" role="alert">
          {errorMessage}
        </div>
      ) : null}

      {successMessage ? (
        <div className="fc-alert fc-alert-success" role="status">
          {successMessage}
        </div>
      ) : null}

      <section className="fc-table-panel" aria-label="Registered users">
        {loading ? (
          <div className="fc-table-state" aria-busy="true">
            <div className="fc-spinner-row">
              <span className="fc-spinner" aria-hidden="true" />
              <span>Loading registered users…</span>
            </div>
          </div>
        ) : users.length === 0 ? (
          <div className="fc-table-state">No registered users found.</div>
        ) : (
          <div className="fc-table-scroll">
            <table className="fc-users-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Current Role</th>
                  <th>Joined</th>
                  <th>Assign Role</th>
                </tr>
              </thead>
              <tbody>
                {users.map((userRow) => {
                  const isSelf = userRow.id === profile.id;
                  const isLastAdmin =
                    userRow.role === ROLES.ADMIN && counts.admin <= 1;
                  const isRowSaving = savingUserId === userRow.id;
                  const draftRole = draftRoles[userRow.id] ?? userRow.role;
                  const hasPendingChange = draftRole !== userRow.role;
                  const isRoleLocked = isSelf || isLastAdmin;

                  return (
                    <tr key={userRow.id}>
                      <td>
                        <div className="fc-user-cell">
                          <span>{userRow.display_name}</span>
                          {isSelf ? <span className="fc-you-tag">You</span> : null}
                        </div>
                      </td>
                      <td className="fc-email-cell">{userRow.email || '—'}</td>
                      <td>
                        <span className={`fc-role-badge fc-role-${userRow.role}`}>
                          {formatRoleLabel(userRow.role)}
                        </span>
                      </td>
                      <td>{formatDate(userRow.created_at)}</td>
                      <td>
                        {isRoleLocked ? (
                          <span className="fc-protected-note">
                            {isSelf
                              ? 'Own role cannot be modified'
                              : 'Last remaining Admin cannot be demoted'}
                          </span>
                        ) : (
                          <div className="fc-role-control">
                            <select
                              aria-label={`Role for ${userRow.display_name}`}
                              className="fc-select"
                              value={draftRole}
                              onChange={(event) =>
                                handleDraftChange(userRow.id, event.target.value)
                              }
                              disabled={isRowSaving}
                            >
                              {ROLE_OPTIONS.map((roleOption) => (
                                <option key={roleOption} value={roleOption}>
                                  {formatRoleLabel(roleOption)}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="fc-btn fc-btn-primary fc-btn-sm"
                              onClick={() => handleRoleUpdate(userRow)}
                              disabled={!hasPendingChange || isRowSaving}
                            >
                              {isRowSaving ? 'Saving…' : 'Update'}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

