import { useState } from 'react';
import { api, rm } from '../lib';
import { OFFER_KEY } from './WelcomePopup';
import { useStore } from '../store';

export default function Newsletter() {
  const { config } = useStore();
  const [email, setEmail] = useState('');
  const [state, setState] = useState({ busy: false, done: null, error: '' });
  const amount = config?.welcome?.amount || 0;

  async function submit(e) {
    e.preventDefault();
    setState({ busy: true, done: null, error: '' });
    try {
      const r = await api('/subscribe', { method: 'POST', body: { email, source: 'footer' } });
      if (r.code) { try { localStorage.setItem(OFFER_KEY, JSON.stringify({ code: r.code, email: email.trim().toLowerCase() })); } catch { /* ignore */ } }
      setState({ busy: false, done: r, error: '' });
      setEmail('');
    } catch (err) { setState({ busy: false, done: null, error: err.message }); }
  }

  return (
    <section className="newsletter">
      <div className="container newsletter-inner">
        <div>
          <p className="eyebrow light">The Nelmora letter</p>
          <h2>First to know.</h2>
          <p className="newsletter-sub">New scents, restocks and subscriber-only offers{amount ? `, plus ${rm(amount)} off your first order` : ''}.</p>
        </div>
        {state.done ? (
          <p className="newsletter-done">
            Thank you. You’re on the list.
            {state.done.code && <span className="newsletter-code">Your code: <strong>{state.done.code}</strong></span>}
          </p>
        ) : (
          <form onSubmit={submit} className="newsletter-form">
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Your email address" aria-label="Email address" />
            <button className="btn btn-light" disabled={state.busy}>{state.busy ? '…' : 'Subscribe'}</button>
            {state.error && <p className="newsletter-err">{state.error}</p>}
          </form>
        )}
      </div>
    </section>
  );
}
