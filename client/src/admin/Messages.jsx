import { useEffect, useState } from 'react';
import { useAdmin, useLoad, fmtDate } from './Admin';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const birthday = (b) => (b ? `${Number(b.slice(3))} ${MONTHS[Number(b.slice(0, 2)) - 1]}` : '');

function Subscribers() {
  const { call } = useAdmin();
  const { data, setData, error, reload } = useLoad('/admin/subscribers');
  const [copied, setCopied] = useState(false);
  useEffect(() => { reload(); }, [reload]);

  async function remove(s) {
    if (!confirm(`Remove ${s.email} from the list?`)) return;
    await call(`/admin/subscribers/${s.id}`, { method: 'DELETE' });
    setData((l) => l.filter((x) => x.id !== s.id));
  }
  const copyAll = () => { navigator.clipboard?.writeText(data.map((s) => s.email).join(', ')); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  const used = data?.filter((s) => s.used_order).length || 0;
  const today = new Date();
  const thisMonth = data?.filter((s) => s.birthday && Number(s.birthday.slice(0, 2)) === today.getMonth() + 1).length || 0;

  return (
    <section className="a-panel flush">
      <div className="a-panel-head pad">
        <h2>Subscribers {data && <span className="muted small">({data.length} · {used} used their welcome code{thisMonth ? ` · ${thisMonth} birthday${thisMonth > 1 ? 's' : ''} this month` : ''})</span>}</h2>
        {data?.length > 0 && <button className="btn btn-sm btn-ghost" onClick={copyAll}>{copied ? 'Copied' : 'Copy all emails'}</button>}
      </div>
      {error && <p className="alert">{error}</p>}
      {!data ? <p className="muted pad">Loading…</p> : data.length === 0 ? <p className="muted pad">No subscribers yet. They sign up from the welcome popup and the box above the footer.</p> : (
        <table className="a-table">
          <thead><tr><th>Name / email</th><th>Phone</th><th>Birthday</th><th>For</th><th>Welcome code</th><th /></tr></thead>
          <tbody>
            {data.map((s) => (
              <tr key={s.id}>
                <td><strong>{s.name || '-'}</strong><div className="muted small">{s.email}</div><div className="muted small">{fmtDate(s.created_at)}{s.source ? ` · ${s.source}` : ''}</div></td>
                <td>{s.phone || <span className="muted">-</span>}</td>
                <td>{birthday(s.birthday) || <span className="muted">-</span>}</td>
                <td>{s.gender || <span className="muted">-</span>}</td>
                <td><span className="mono small">{s.code}</span> <span className={`pill ${s.used_order ? 's-completed' : 's-new'}`}>{s.used_order ? 'used' : 'available'}</span></td>
                <td><button className="link-btn small" onClick={() => remove(s)}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
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
