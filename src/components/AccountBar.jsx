import { useEffect, useRef, useState } from 'react';
import { signIn, signOut, currentUser, onAuthChange, backendAvailable } from '../lib/api.js';

/**
 * Sign-in lives in the topbar and is entirely optional: without it the app is
 * the local-file tool it has always been. Signing in adds saving and sharing.
 */
export default function AccountBar({ onSignedIn }) {
  const [user, setUser] = useState(currentUser());
  const [available, setAvailable] = useState(null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef(null);

  useEffect(() => {
    backendAvailable().then(setAvailable);
    return onAuthChange(setUser);
  }, []);

  useEffect(() => {
    if (open && emailRef.current) emailRef.current.focus();
  }, [open]);

  // Nothing to offer if the app is served without a backend.
  if (available === false) return null;

  if (user) {
    return (
      <div className="account">
        <span className="account-who" title={user.email}>{user.email}</span>
        <button onClick={() => signOut()}>Sign out</button>
      </div>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await signIn(email.trim(), password);
      setOpen(false);
      setPassword('');
      if (onSignedIn) onSignedIn(u);
    } catch (err) {
      setError(err.status === 400 ? 'Wrong email or password.' : err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="account">
      <button onClick={() => setOpen((v) => !v)} className={open ? 'on' : ''}>Sign in</button>
      {open && (
        <form className="signin-pop" onSubmit={submit}>
          <label>
            <span>Email</span>
            <input ref={emailRef} type="email" value={email} autoComplete="username"
                   onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            <span>Password</span>
            <input type="password" value={password} autoComplete="current-password"
                   onChange={(e) => setPassword(e.target.value)} required />
          </label>
          {error && <div className="signin-error">{error}</div>}
          <button type="submit" className="btn-primary full" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      )}
    </div>
  );
}
