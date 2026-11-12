import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import './AuthPages.css';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Email and password login page for FrameCheck.
 */
export function LoginPage() {
  const { isConfigured, signIn } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const validate = () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      return 'Email address is required.';
    }
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      return 'Enter a valid email address.';
    }
    if (!password) {
      return 'Password is required.';
    }
    return '';
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorMessage('');

    if (!isConfigured) {
      setErrorMessage(
        'Supabase environment variables are missing. Configure .env before signing in.'
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
      await signIn({ email, password });
      navigate('/dashboard', { replace: true });
    } catch (error) {
      setErrorMessage(error?.message || 'Unable to sign in. Check your credentials.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="fc-auth-main">
      <section className="fc-auth-card" aria-labelledby="fc-login-title">
        <div className="fc-auth-header">
          <h1 id="fc-login-title" className="fc-auth-title">
            Sign in to FrameCheck
          </h1>
          <p className="fc-auth-subtitle">
            Enter your account email and password to access your workspace.
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

        <form className="fc-auth-form" onSubmit={handleSubmit} noValidate>
          <div className="fc-field">
            <label htmlFor="login-email" className="fc-label">
              Email address
            </label>
            <input
              id="login-email"
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
            <label htmlFor="login-password" className="fc-label">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              className="fc-input"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting}
              placeholder="Enter your password"
              required
            />
          </div>

          <button
            type="submit"
            className="fc-btn fc-btn-primary fc-submit-btn"
            disabled={submitting || !isConfigured}
          >
            {submitting ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <div className="fc-auth-footer">
          Need an account? <Link to="/register">Register here</Link>
        </div>
      </section>
    </main>
  );
}
