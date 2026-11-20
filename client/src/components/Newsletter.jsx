import { useState } from 'react';
import { api } from '../lib';

export default function Newsletter() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState({ busy: false, done: false, error: '' });

  async function submit(e) {
    e.preventDefault();
    setState({ busy: true, done: false, error: '' });
    try {
      await api('/subscribe', { method: 'POST', body: { email } });
      setState({ busy: false, done: true, error: '' });
      setEmail('');
    } catch (err) { setState({ busy: false, done: false, error: err.message }); }
  }

  return (
    <section className="newsletter">
      <div className="container newsletter-inner">
        <div>
          <p className="eyebrow light">The Nelmora letter</p>
          <h2>First to know.</h2>
          <p className="newsletter-sub">New scents, restocks and subscriber-only offers, delivered occasionally to your inbox.</p>
        </div>
        {state.done ? (
          <p className="newsletter-done">Thank you. You’re on the list.</p>
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
