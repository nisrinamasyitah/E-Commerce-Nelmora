import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useStore } from '../store';
import { api, rm, waLink, useTitle } from '../lib';

const STEPS = ['new', 'processing', 'shipped', 'completed'];
const LABEL = { new: 'Order received', processing: 'Preparing', shipped: 'Shipped', completed: 'Delivered', cancelled: 'Cancelled' };

export default function Order() {
  useTitle('Your Order');
  const { code } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { config } = useStore();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [lookup, setLookup] = useState({ code: code || '', email: '' });
  const [loading, setLoading] = useState(false);
  const t = params.get('t');

  useEffect(() => {
    if (!code || !t) return;
    setLoading(true);
    api(`/orders/${code}?t=${encodeURIComponent(t)}`)
      .then(setOrder).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [code, t]);

  async function find(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const c = lookup.code.trim().toUpperCase();
      const o = await api(`/orders/${encodeURIComponent(c)}?email=${encodeURIComponent(lookup.email.trim())}`);
      setOrder(o);
      navigate(`/order/${o.code}`, { replace: true });
    } catch (err) { setError(err.message); }
    setLoading(false);
  }

  if (loading && !order) return <div className="container narrow section center muted">Loading your order…</div>;

  if (!order) {
    return (
      <div className="container narrow section">
        <header className="page-head center"><p className="eyebrow">Order status</p><h1>Track your order</h1></header>
        <form className="card-form" onSubmit={find}>
          <label className="field"><span>Order number</span>
            <input value={lookup.code} onChange={(e) => setLookup({ ...lookup, code: e.target.value })} placeholder="NM-XXXXXX" required />
          </label>
          <label className="field"><span>Email used at checkout</span>
            <input type="email" value={lookup.email} onChange={(e) => setLookup({ ...lookup, email: e.target.value })} required />
          </label>
          {error && <p className="alert">{error}</p>}
          <button className="btn btn-block">Find my order</button>
        </form>
      </div>
    );
  }

  const isNew = params.get('new') || params.get('paid');
  const stepIdx = STEPS.indexOf(order.status);
  const needsTransfer = order.payment_method === 'transfer' && order.payment_status === 'unpaid' && order.status !== 'cancelled';
  const waText = `Hi Nelmora! I've placed order ${order.code} (${rm(order.total)}). Here is my payment receipt:`;

  return (
    <div className="container narrow section">
      <header className="page-head center">
        {isNew && <p className="script big">Thank you</p>}
        <h1>Order {order.code}</h1>
        <p className="muted">Placed {new Date(order.created_at.replace(' ', 'T') + 'Z').toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' })}</p>
      </header>

      {order.status === 'cancelled' ? (
        <p className="alert center">This order was cancelled. If you think this is a mistake, please contact us.</p>
      ) : (
        <ol className="steps">
          {STEPS.map((s, i) => <li key={s} className={i <= stepIdx ? 'done' : ''}><span />{LABEL[s]}</li>)}
        </ol>
      )}

      {order.payment_status === 'paid' && order.status !== 'cancelled' && (
        <p className="notice">Payment received. We’ll email {order.email} when your parcel ships.</p>
      )}
      {order.payment_method === 'stripe' && order.payment_status === 'unpaid' && order.status !== 'cancelled' && (
        <p className="notice">We’re waiting for confirmation of your online payment. This page updates when you reload it.</p>
      )}

      {needsTransfer && config && (
        <section className="pay-box">
          <h3>Complete your payment</h3>
          <p>Please transfer <strong>{rm(order.total)}</strong> to:</p>
          <dl className="bank">
            <dt>Bank</dt><dd>{config.bank.name}</dd>
            <dt>Account name</dt><dd>{config.bank.accountName}</dd>
            <dt>Account no.</dt><dd className="mono">{config.bank.accountNo}
              <button className="link-btn small" onClick={() => navigator.clipboard?.writeText(config.bank.accountNo.replace(/\s/g, ''))}>Copy</button></dd>
            <dt>Reference</dt><dd className="mono">{order.code}</dd>
          </dl>
          <p className="muted small">Your items are reserved for you. We ship as soon as we confirm your payment.</p>
          {config.whatsapp && <a className="btn btn-block" href={waLink(config.whatsapp, waText)} target="_blank" rel="noreferrer">Send receipt on WhatsApp</a>}
        </section>
      )}

      {order.tracking && <p className="notice">Tracking number: <strong className="mono">{order.tracking}</strong></p>}

      <section className="order-box">
        <ul className="sum-items">
          {order.items.map((it) => (
            <li key={it.id}>
              <span className="sum-thumb">{it.image && <img src={it.image} alt="" />}<b>{it.qty}</b></span>
              <span className="sum-name">{it.name}<span className="muted small">{it.size}</span></span>
              <span>{rm(it.price * it.qty)}</span>
            </li>
          ))}
        </ul>
        <div className="sum-row"><span>Subtotal</span><span>{rm(order.subtotal)}</span></div>
        <div className="sum-row"><span>Shipping</span><span>{order.shipping ? rm(order.shipping) : 'Free'}</span></div>
        <div className="sum-row total"><span>Total</span><strong>{rm(order.total)}</strong></div>
        <div className="ship-to">
          <div className="field-label">Shipping to</div>
          <p>{order.name}<br />{order.address1}{order.address2 && <>, {order.address2}</>}<br />{order.postcode} {order.city}, {order.state}<br />{order.phone}</p>
        </div>
      </section>
      <p className="muted small center">Save this page or your order number <strong>{order.code}</strong> to check your status any time.</p>
    </div>
  );
}
