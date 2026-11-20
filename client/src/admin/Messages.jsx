import { useEffect, useState } from 'react';
import { useAdmin, useLoad, fmtDate } from './Admin';

function Subscribers() {
  const { call } = useAdmin();
  const { data, setData, error, reload } = useLoad('/admin/subscribers');
  const [copied, setCopied] = useState(false);
  useEffect(() => { reload(); }, [reload]);

  async function remove(s) {
    if (!confirm(`Remove ${s.email} from the newsletter list?`)) return;
    await call(`/admin/subscribers/${s.id}`, { method: 'DELETE' });
    setData((l) => l.filter((x) => x.id !== s.id));
  }
  const copyAll = () => { navigator.clipboard?.writeText(data.map((s) => s.email).join(', ')); setCopied(true); setTimeout(() => setCopied(false), 1500); };

  return (
    <section className="a-panel">
      <div className="a-panel-head">
        <h2>Newsletter subscribers {data && <span className="muted small">({data.length})</span>}</h2>
        {data?.length > 0 && <button className="btn btn-sm btn-ghost" onClick={copyAll}>{copied ? 'Copied' : 'Copy all emails'}</button>}
      </div>
      {error && <p className="alert">{error}</p>}
      {!data ? <p className="muted">Loading…</p> : data.length === 0 ? <p className="muted">No subscribers yet. They sign up from the box above the website footer.</p> : (
        <ul className="a-list">
          {data.map((s) => <li key={s.id}><span>{s.email} <span className="muted small">· {fmtDate(s.created_at)}</span></span><button className="link-btn small" onClick={() => remove(s)}>Remove</button></li>)}
        </ul>
      )}
    </section>
  );
}

export default function Messages() {
  const { call } = useAdmin();
  const { data, setData, error, reload } = useLoad('/admin/messages');
  useEffect(() => { reload(); }, [reload]);

  async function toggle(m) {
    await call(`/admin/messages/${m.id}`, { method: 'PATCH', body: { handled: !m.handled } });
    setData((list) => list.map((x) => (x.id === m.id ? { ...x, handled: m.handled ? 0 : 1 } : x)));
  }

  return (
    <>
      <h1>Messages & subscribers</h1>
      {error && <p className="alert">{error}</p>}
      {!data ? <p className="muted">Loading…</p> : data.length === 0 ? <p className="muted">No messages yet. They appear here when someone uses the contact form.</p> : (
        <div className="a-msgs">
          {data.map((m) => (
            <article key={m.id} className={`a-panel${m.handled ? ' dim' : ''}`}>
              <div className="a-panel-head">
                <div><strong>{m.name}</strong> · <a href={`mailto:${m.email}?subject=Re: your message to Nelmora Parfums`}>{m.email}</a></div>
                <span className="muted small">{fmtDate(m.created_at)}</span>
              </div>
              <p className="pre">{m.message}</p>
              <button className="link-btn small" onClick={() => toggle(m)}>{m.handled ? 'Mark as new' : 'Mark as done'}</button>
            </article>
          ))}
        </div>
      )}
      <Subscribers />
    </>
  );
}
