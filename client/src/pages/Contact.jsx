import { useState } from 'react';
import { useStore } from '../store';
import { api, waLink, useTitle } from '../lib';

export default function Contact() {
  useTitle('Contact');
  const { config } = useStore();
  const [form, setForm] = useState({ name: '', email: '', message: '' });
  const [state, setState] = useState({ busy: false, sent: false, error: '' });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setState({ busy: true, sent: false, error: '' });
    try {
      await api('/contact', { method: 'POST', body: form });
      setState({ busy: false, sent: true, error: '' });
      setForm({ name: '', email: '', message: '' });
    } catch (err) { setState({ busy: false, sent: false, error: err.message }); }
  }

  return (
    <div className="container section contact">
      <div>
        <p className="eyebrow">Contact</p>
        <h1>We’d love to hear from you.</h1>
        <p className="lead">Need help choosing a scent, have a question about your order, or interested in becoming an agent? Send us a message.</p>
        <div className="contact-ways">
          {config?.whatsapp && <a className="btn" href={waLink(config.whatsapp, 'Hi Nelmora! ')} target="_blank" rel="noreferrer">Chat on WhatsApp</a>}
          {config?.email && <a className="btn btn-ghost" href={`mailto:${config.email}`}>{config.email}</a>}
        </div>
        {config?.instagram && <p className="muted">Instagram: <a href={`https://instagram.com/${config.instagram}`} target="_blank" rel="noreferrer">@{config.instagram}</a></p>}
      </div>
      <form className="card-form" onSubmit={submit}>
        <label className="field"><span>Name</span><input value={form.name} onChange={set('name')} required autoComplete="name" /></label>
        <label className="field"><span>Email</span><input type="email" value={form.email} onChange={set('email')} required autoComplete="email" /></label>
        <label className="field"><span>Message</span><textarea rows="5" value={form.message} onChange={set('message')} required /></label>
        {state.error && <p className="alert">{state.error}</p>}
        {state.sent && <p className="notice">Thank you! We’ll get back to you soon.</p>}
        <button className="btn btn-block" disabled={state.busy}>{state.busy ? 'Sending…' : 'Send message'}</button>
      </form>
    </div>
  );
}
