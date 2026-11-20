import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useStore } from '../store';
import { api, rm } from '../lib';

const KEY = 'nelmora.welcome';      // { state: 'done' | 'closed', at: timestamp }
export const OFFER_KEY = 'nelmora.offer'; // { code, email }, read by checkout
const DELAY_MS = 5000;
const REASK_MS = 7 * 24 * 3600 * 1000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const read = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
const write = (state) => { try { localStorage.setItem(KEY, JSON.stringify({ state, at: Date.now() })); } catch { /* private mode */ } };

export default function WelcomePopup() {
  const { config } = useStore();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '', month: '', day: '', gender: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const first = useRef(null);
  const amount = config?.welcome?.amount || 0;
  const quiet = pathname.startsWith('/checkout') || pathname.startsWith('/order');

  // appear once, a few seconds after the first visit (and again after a week if it was closed)
  useEffect(() => {
    if (!amount || quiet) return;
    const seen = read();
    if (seen && (seen.state === 'done' || Date.now() - seen.at < REASK_MS)) return;
    const t = setTimeout(() => setOpen(true), DELAY_MS);
    return () => clearTimeout(t);
  }, [amount, quiet]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    setTimeout(() => first.current?.focus(), 60);
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    if (!result) write('closed');
    setOpen(false);
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await api('/subscribe', { method: 'POST', body: { ...form, source: 'popup' } });
      write('done');
      if (r.code) { try { localStorage.setItem(OFFER_KEY, JSON.stringify({ code: r.code, email: form.email.trim().toLowerCase() })); } catch { /* ignore */ } }
      setResult(r);
    } catch (err) { setError(err.message); }
    setBusy(false);
  }

  if (!open) return null;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const minSpend = config?.welcome?.minSpend || 0;

  return (
    <div className="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="welcome-scrim" onClick={close} />
      <div className="welcome-card">
        <div className="welcome-media"><img src="/images/products/aura.jpg" alt="" /></div>
        <div className="welcome-body">
          <button className="welcome-close" onClick={close} aria-label="Close">✕</button>

          {!result ? (
            <form onSubmit={submit}>
              <p className="eyebrow">Welcome to Nelmora</p>
              <h2 id="welcome-title">Save {rm(amount)}!</h2>
              <p className="welcome-sub">Enjoy {rm(amount)} off your first order{minSpend ? ` over ${rm(minSpend)}` : ''}. It’s on us.</p>

              <input ref={first} placeholder="First name" value={form.name} onChange={set('name')} autoComplete="given-name" aria-label="First name" />
              <input type="email" required placeholder="Email" value={form.email} onChange={set('email')} autoComplete="email" aria-label="Email" />
              <div className="welcome-phone">
                <span>🇲🇾 +60</span>
                <input type="tel" placeholder="Phone (optional)" value={form.phone} onChange={set('phone')} autoComplete="tel-national" aria-label="Phone number" />
              </div>
              <div className="welcome-row">
                <label>Birthday <em>(optional, for a birthday treat)</em></label>
                <div className="welcome-two">
                  <select value={form.month} onChange={set('month')} aria-label="Birth month"><option value="">Month</option>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
                  <select value={form.day} onChange={set('day')} aria-label="Birth day"><option value="">Day</option>{Array.from({ length: 31 }, (_, i) => <option key={i + 1}>{i + 1}</option>)}</select>
                </div>
              </div>
              <div className="welcome-row">
                <label>Shopping for <em>(optional)</em></label>
                <select value={form.gender} onChange={set('gender')} aria-label="Gender">
                  <option value="">Choose</option><option>Women</option><option>Men</option><option>Prefer not to say</option>
                </select>
              </div>

              {error && <p className="alert" role="alert">{error}</p>}
              <button className="btn btn-block" disabled={busy}>{busy ? 'Please wait…' : `Get my ${rm(amount)} code`}</button>
              <p className="welcome-fine">By signing up you agree to receive emails from Nelmora and can unsubscribe any time. See our <Link to="/policies/privacy" onClick={close}>Privacy policy</Link>.</p>
            </form>
          ) : (
            <div className="welcome-done">
              <p className="script big">Thank you{form.name ? `, ${form.name}` : ''}</p>
              {result.code ? (
                <>
                  <p>Here is your {rm(result.amount)} code. It is saved to your bag and applied automatically at checkout with <strong>{form.email}</strong>.</p>
                  <div className="welcome-code">
                    <span>{result.code}</span>
                    <button type="button" className="link-btn" onClick={() => { navigator.clipboard?.writeText(result.code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? 'Copied' : 'Copy'}</button>
                  </div>
                  {result.minSpend > 0 && <p className="muted small">Valid once, on your first order over {rm(result.minSpend)}.</p>}
                </>
              ) : (
                <p>{result.used ? 'This email has already used its welcome offer.' : 'You are on the list.'} We’ll keep you posted on new scents.</p>
              )}
              <Link to="/shop" className="btn btn-block" onClick={() => setOpen(false)}>Start shopping</Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
