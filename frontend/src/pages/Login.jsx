import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { verifyPasswordApi, loginApi, getCaptchaApi } from '../lib/api.js';
import { GraduationCap, Loader, RefreshCw, ArrowLeft, ShieldCheck } from 'lucide-react';

const STEP_PASSWORD = 1;
const STEP_CAPTCHA = 2;

export default function Login() {
  const [step, setStep] = useState(STEP_PASSWORD);
  const [form, setForm] = useState({ username: '', password: '' });
  const [challenge, setChallenge] = useState('');
  const [captcha, setCaptcha] = useState(null); // { captcha_id, image }
  const [captchaText, setCaptchaText] = useState('');
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  // ── Step 1: verify password (captcha only appears if this succeeds) ──
  async function handlePasswordSubmit(e) {
    e.preventDefault();
    setError('');
    const username = form.username.trim();
    const password = form.password;
    if (!username || !password) {
      setError('Username and password required');
      return;
    }
    setLoading(true);
    try {
      const data = await verifyPasswordApi(username, password);
      setChallenge(data.challenge);
      setCaptcha(data.captcha);
      setCaptchaText('');
      setStep(STEP_CAPTCHA);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function refreshCaptcha() {
    setError('');
    setCaptchaLoading(true);
    setCaptchaText('');
    try {
      setCaptcha(await getCaptchaApi());
    } catch (err) {
      setError(err.message);
    } finally {
      setCaptchaLoading(false);
    }
  }

  // ── Step 2: verify captcha → sign in ──
  async function handleCaptchaSubmit(e) {
    e.preventDefault();
    setError('');
    if (!captchaText.trim()) {
      setError('Please enter the captcha');
      return;
    }
    setLoading(true);
    try {
      const data = await loginApi({
        challenge,
        captcha_id: captcha.captcha_id,
        captcha_text: captchaText,
      });
      login(data.token, data.username, data.role);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err.message);
      if (/expired|session/i.test(err.message)) {
        // Challenge expired — send the user back to the password step.
        setStep(STEP_PASSWORD);
        setChallenge('');
        setCaptcha(null);
      } else {
        refreshCaptcha(); // captcha is single-use — get a fresh one
      }
    } finally {
      setLoading(false);
    }
  }

  function backToPassword() {
    setStep(STEP_PASSWORD);
    setError('');
    setChallenge('');
    setCaptcha(null);
    setCaptchaText('');
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="login-brand-mark">
            <GraduationCap size={20} color="#fff" />
          </div>
          <div>
            <h1>School TT Allotment</h1>
            <p>{step === STEP_PASSWORD ? 'Sign in to your account' : 'Security check'}</p>
          </div>
        </div>

        <div className="login-steps" aria-hidden="true">
          <span className={`login-step-dot ${step >= STEP_PASSWORD ? 'active' : ''}`} />
          <span className="login-step-line" />
          <span className={`login-step-dot ${step >= STEP_CAPTCHA ? 'active' : ''}`} />
        </div>

        {error && <div className="alert alert-red">{error}</div>}

        {step === STEP_PASSWORD ? (
          <form onSubmit={handlePasswordSubmit}>
            <div className="form-group">
              <label className="form-label">Username</label>
              <input
                className="form-input"
                name="username"
                autoComplete="username"
                autoFocus
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                placeholder="admin"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                className="form-input"
                name="password"
                type="password"
                autoComplete="current-password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="••••••••"
              />
            </div>
            <button className="btn btn-primary btn-block" type="submit" disabled={loading}>
              {loading ? <><Loader size={14} className="spinner" /> Checking…</> : 'Continue'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleCaptchaSubmit}>
            <div className="login-verified">
              <ShieldCheck size={14} /> Password verified — enter the captcha to continue
            </div>
            <div className="form-group">
              <label className="form-label">Captcha</label>
              <div className="captcha-row">
                {captcha?.image
                  ? <img src={captcha.image} alt="captcha" className="captcha-img" />
                  : <div className="captcha-img captcha-img-loading"><Loader size={16} className="spinner" /></div>}
                <button
                  type="button"
                  className="btn btn-outline btn-icon"
                  title="New captcha"
                  onClick={refreshCaptcha}
                  disabled={captchaLoading}
                >
                  {captchaLoading ? <Loader size={15} className="spinner" /> : <RefreshCw size={15} />}
                </button>
              </div>
              <input
                className="form-input captcha-input"
                name="captcha"
                autoComplete="off"
                autoFocus
                value={captchaText}
                onChange={(e) => setCaptchaText(e.target.value)}
                placeholder="Enter the letters above"
              />
            </div>
            <button className="btn btn-primary btn-block" type="submit" disabled={loading}>
              {loading ? <><Loader size={14} className="spinner" /> Signing in…</> : 'Sign in'}
            </button>
            <button type="button" className="btn btn-ghost btn-block login-back" onClick={backToPassword}>
              <ArrowLeft size={13} /> Back
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
