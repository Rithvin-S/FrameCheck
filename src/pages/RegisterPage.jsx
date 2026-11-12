import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import './AuthPages.css';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 6;

/**
 * User registration page for FrameCheck.
 * All newly registered accounts receive the Uploader role server-side.
 */
export function RegisterPage() {
  const { isConfigured, register } = useAuth();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const validate = () => {
    const trimmedName = displayName.trim();
    const trimmedEmail = email.trim();

    if (!trimmedName) {
      return 'Display name is required.';
    }
    if (trimmedName.length > 100) {
      return 'Display name must be 100 characters or fewer.';
    }
    if (!trimmedEmail) {
      return 'Email address is required.';
    }
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      return 'Enter a valid email address.';
    }
    if (!password) {
      return 'Password is required.';
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (!confirmPassword) {
      return 'Please confirm your password.';
    }
    if (password !== confirmPassword) {
      return 'Passwords do not match.';
    }
    return '';
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorMessage('');
    setInfoMessage('');

    if (!isConfigured) {
      setErrorMessage(
        'Supabase environment variables are missing. Configure .env before registering.'
      );
      return;
    }

    const validationError = validate();
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setSubmitting(true);
    try {
      const result = await register({
        email,
        password,
        displayName,
      });

      if (result.requiresEmailConfirmation) {
        setInfoMessage(
          'Account created with the Uploader role. Check your email for a confirmation link before signing in.'
        );
        setPassword('');
        setConfirmPassword('');
        return;
      }

      navigate('/dashboard', { replace: true });
    } catch (error) {
      setErrorMessage(error?.message || 'Unable to create your account.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="fc-auth-main">
      <section className="fc-auth-card" aria-labelledby="fc-register-title">
        <div className="fc-auth-header">
          <h1 id="fc-register-title" className="fc-auth-title">
            Create a FrameCheck account
          </h1>
          <p className="fc-auth-subtitle">
            New accounts are automatically assigned the Uploader role.
          </p>
        </div>

        {!isConfigured ? (
          <div className="fc-alert fc-alert-error" role="alert">
            Supabase is not configured. Add <code>VITE_SUPABASE_URL</code> and{' '}
            <code>VITE_SUPABASE_ANON_KEY</code> to <code>.env</code>.
          </div>
        ) : null}

        {errorMessage ? (
          <div className="fc-alert fc-alert-error" role="alert">
            {errorMessage}
          </div>
        ) : null}

        {infoMessage ? (
          <div className="fc-alert fc-alert-success" role="status">
            {infoMessage}
          </div>
        ) : null}

        <form className="fc-auth-form" onSubmit={handleSubmit} noValidate>
          <div className="fc-field">
            <label htmlFor="register-name" className="fc-label">
              Display name
            </label>
            <input
              id="register-name"
              type="text"
              className="fc-input"
              autoComplete="name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              disabled={submitting}
              maxLength={100}
              placeholder="Alex Rivera"
              required
            />
          </div>

          <div className="fc-field">
            <label htmlFor="register-email" className="fc-label">
              Email address
            </label>
            <input
              id="register-email"
              type="email"
              className="fc-input"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={submitting}
              placeholder="name@example.com"
              required
            />
          </div>

          <div className="fc-field">
            <label htmlFor="register-password" className="fc-label">
              Password
            </label>
            <input
              id="register-password"
              type="password"
              className="fc-input"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting}
              placeholder="At least 6 characters"
              required
            />
            <span className="fc-field-hint">
              Minimum {MIN_PASSWORD_LENGTH} characters.
            </span>
          </div>

          <div className="fc-field">
            <label htmlFor="register-confirm-password" className="fc-label">
              Confirm password
            </label>
            <input
              id="register-confirm-password"
              type="password"
              className="fc-input"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              disabled={submitting}
              placeholder="Re-enter your password"
              required
            />
          </div>

          <button
            type="submit"
            className="fc-btn fc-btn-primary fc-submit-btn"
            disabled={submitting || !isConfigured}
          >
            {submitting ? 'Creating account…' : 'Create Account'}
          </button>
        </form>

        <div className="fc-auth-footer">
          Already have an account? <Link to="/login">Sign in</Link>
        </div>
      </section>
    </main>
  );
}
