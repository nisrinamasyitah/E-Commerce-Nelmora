import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { rm, waLink } from '../lib';
import { useAdmin, useLoad, fmtDate, StatusPill } from './Admin';

const STATUSES = ['new', 'processing', 'shipped', 'completed', 'cancelled'];

function OrderDetail({ id, onChanged }) {
  const { call } = useAdmin();
  const navigate = useNavigate();
  const [o, setO] = useState(null);
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setO(null); setMsg('');
    call(`/admin/orders/${id}`).then((d) => { setO(d); setForm({ status: d.status, payment_status: d.payment_status, tracking: d.tracking, admin_note: d.admin_note }); })
      .catch((e) => setMsg(e.message));
  }, [id, call]);

  async function save(patch = {}) {
    setBusy(true); setMsg('');
    try {
      const d = await call(`/admin/orders/${id}`, { method: 'PATCH', body: { ...form, ...patch } });
      setO(d); setForm({ status: d.status, payment_status: d.payment_status, tracking: d.tracking, admin_note: d.admin_note });
      setMsg('Saved'); onChanged();
    } catch (e) { setMsg(e.message); }
    setBusy(false);
  }

  if (!o || !form) return <div className="a-detail"><p className="muted">{msg || 'Loading…'}</p></div>;
  const phone = o.phone.replace(/\D/g, '').replace(/^0/, '60');
  const shipMsg = `Hi ${o.name}, your Nelmora order ${o.code} has been shipped!${o.tracking ? ` Tracking number: ${o.tracking}` : ''} Thank you for shopping with us.`;

  return (
    <div className="a-detail">
      <div className="a-panel-head">
        <h2 className="mono">{o.code}</h2>
        <button className="link-btn" onClick={() => navigate('/admin/orders')}>Close ✕</button>
      </div>
      <p className="muted small">{fmtDate(o.created_at)} · {o.payment_method === 'stripe' ? 'Online (Stripe)' : 'Bank transfer'}</p>

      <div className="quick">
        {o.payment_status !== 'paid' && <button className="btn btn-sm" disabled={busy} onClick={() => save({ payment_status: 'paid', status: form.status === 'new' ? 'processing' : form.status })}>Mark paid</button>}
        {o.status !== 'shipped' && o.status !== 'cancelled' && o.status !== 'completed' && <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => save({ status: 'shipped' })}>Mark shipped</button>}
        <a className="btn btn-sm btn-ghost" href={waLink(phone, o.status === 'shipped' ? shipMsg : `Hi ${o.name}, this is Nelmora Parfums about your order ${o.code}.`)} target="_blank" rel="noreferrer">WhatsApp customer</a>
      </div>

      <ul className="a-items">
        {o.items.map((it) => <li key={it.id}><span>{it.qty} × {it.name} {it.size}</span><span>{rm(it.price * it.qty)}</span></li>)}
        {o.discount > 0 && <li className="muted"><span>Discount ({o.discount_code})</span><span>−{rm(o.discount)}</span></li>}
        <li className="muted"><span>Shipping ({o.region === 'east' ? 'East' : 'West'} Malaysia)</span><span>{rm(o.shipping)}</span></li>
        <li><strong>Total</strong><strong>{rm(o.total)}</strong></li>
      </ul>

      <div className="a-addr">
        <strong>{o.name}</strong><br />{o.phone} · <a href={`mailto:${o.email}`}>{o.email}</a><br />
        {o.address1}{o.address2 && `, ${o.address2}`}<br />{o.postcode} {o.city}, {o.state}
        {o.note && <p className="note">“{o.note}”</p>}
        <button className="link-btn small" onClick={() => navigator.clipboard?.writeText(`${o.name}\n${o.phone}\n${o.address1}${o.address2 ? ', ' + o.address2 : ''}\n${o.postcode} ${o.city}, ${o.state}`)}>Copy address</button>
      </div>

      <div className="a-form">
        <label className="field half"><span>Status</span>
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
        </label>
        <label className="field half"><span>Payment</span>
          <select value={form.payment_status} onChange={(e) => setForm({ ...form, payment_status: e.target.value })}>{['unpaid', 'paid', 'refunded'].map((s) => <option key={s}>{s}</option>)}</select>
        </label>
        <label className="field"><span>Tracking number</span><input value={form.tracking} onChange={(e) => setForm({ ...form, tracking: e.target.value })} placeholder="e.g. J&T / Pos Laju number" /></label>
        <label className="field"><span>Private note</span><textarea rows="2" value={form.admin_note} onChange={(e) => setForm({ ...form, admin_note: e.target.value })} /></label>
        {form.status === 'cancelled' && o.status !== 'cancelled' && <p className="muted small">Cancelling puts the items back into stock.</p>}
        <button className="btn btn-block" disabled={busy} onClick={() => save()}>{busy ? 'Saving…' : 'Save changes'}</button>
        {msg && <p className={msg === 'Saved' ? 'notice' : 'alert'}>{msg}</p>}
        <p className="muted small">Customer link: <a href={`/order/${o.code}?t=${o.token}`} target="_blank" rel="noreferrer">open order page</a></p>
      </div>
    </div>
  );
}

export default function Orders() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const [q, setQ] = useState('');
  const qs = new URLSearchParams({ ...(status && { status }), ...(q && { q }) }).toString();
  const { data, error, reload } = useLoad(`/admin/orders${qs ? '?' + qs : ''}`);
  const { token } = useAdmin();
  useEffect(() => { const t = setTimeout(reload, 200); return () => clearTimeout(t); }, [reload]);

  async function exportCsv() {
    const res = await fetch('/api/admin/orders.csv', { headers: { Authorization: `Bearer ${token}` } });
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement('a'), { href: url, download: 'nelmora-orders.csv' }).click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="a-head">
        <h1>Orders</h1>
        <button className="btn btn-sm btn-ghost" onClick={exportCsv}>Export CSV</button>
      </div>
      <div className="a-filters">
        <div className="seg">
          {['', ...STATUSES].map((s) => <button key={s} className={status === s ? 'on' : ''} onClick={() => setParams(s ? { status: s } : {})}>{s || 'all'}</button>)}
        </div>
        <input className="search" type="search" placeholder="Search order no., name, phone, email" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && <p className="alert">{error}</p>}
      <div className={`a-orders${id ? ' with-detail' : ''}`}>
        <div className="a-panel flush">
          {!data ? <p className="muted pad">Loading…</p> : data.length === 0 ? <p className="muted pad">No orders found.</p> : (
            <table className="a-table">
              <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Status</th><th className="num">Total</th></tr></thead>
              <tbody>
                {data.map((o) => (
                  <tr key={o.id} className={String(o.id) === id ? 'sel' : ''}>
                    <td><Link to={`/admin/orders/${o.id}${status ? `?status=${status}` : ''}`} className="mono">{o.code}</Link><div className="muted small">{fmtDate(o.created_at)}</div></td>
                    <td>{o.name}<div className="muted small">{o.state}</div></td>
                    <td>{o.items}</td>
                    <td><StatusPill status={o.status} /> <span className={`pill s-${o.payment_status}`}>{o.payment_status}</span></td>
                    <td className="num">{rm(o.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {id && <OrderDetail id={id} onChanged={reload} />}
      </div>
    </>
  );
}
