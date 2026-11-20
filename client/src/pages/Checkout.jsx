import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useStore } from '../store';
import { api, rm, useTitle } from '../lib';

const EMPTY = { name: '', email: '', phone: '', address1: '', address2: '', postcode: '', city: '', state: '', note: '' };
const SAVED_KEY = 'nelmora.customer.v1';

export default function Checkout() {
  useTitle('Checkout');
  const { cart, config, clear, replaceFromQuote } = useStore();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [form, setForm] = useState(() => {
    let f = EMPTY;
    try { f = { ...EMPTY, ...JSON.parse(localStorage.getItem(SAVED_KEY)) }; } catch { /* none saved */ }
    try { if (!f.email) f.email = JSON.parse(localStorage.getItem('nelmora.offer'))?.email || ''; } catch { /* none */ }
    return f;
  });
  const [method, setMethod] = useState('transfer');
  const [quote, setQuote] = useState(null);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(params.get('cancelled') ? 'Payment was cancelled. Your order was not paid; you can try again or choose bank transfer.' : '');
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState(() => { try { return JSON.parse(localStorage.getItem('nelmora.offer'))?.code || ''; } catch { return ''; } });

  useEffect(() => { if (config?.stripeEnabled) setMethod('stripe'); }, [config?.stripeEnabled]);

  const itemsKey = JSON.stringify(cart.map((c) => [c.variantId, c.qty]));
  useEffect(() => {
    if (!cart.length) { setQuote(null); return; }
    let live = true;
    const t = setTimeout(() => {
      api('/quote', { method: 'POST', body: { items: cart.map(({ variantId, qty }) => ({ variantId, qty })), state: form.state, code: code.trim(), email: form.email } })
        .then((q) => live && setQuote(q))
        .catch(() => live && setError('Could not check prices. Please refresh.'));
    }, 350);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey, form.state, form.email, code]);

  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setErrors((er) => ({ ...er, [k]: undefined })); };

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      try { localStorage.setItem(SAVED_KEY, JSON.stringify({ ...form, note: '' })); } catch { /* ignore */ }
      const res = await api('/orders', {
        method: 'POST',
        body: { customer: form, items: cart.map(({ variantId, qty }) => ({ variantId, qty })), paymentMethod: method, code: code.trim() },
      });
      clear();
      if (quote?.discount > 0) { try { localStorage.removeItem('nelmora.offer'); } catch { /* ignore */ } }
      if (res.redirect) { window.location.href = res.redirect; return; }
      navigate(`/order/${res.code}?t=${res.token}&new=1`);
    } catch (err) {
      setError(err.message);
      if (err.data?.fields) setErrors(err.data.fields);
      if (err.data?.problems) {
        const q = await api('/quote', { method: 'POST', body: { items: cart, state: form.state } }).catch(() => null);
        if (q) setQuote(q);
      }
      setBusy(false);
    }
  }

  if (!cart.length) {
    return (
      <div className="container narrow center section">
        <h1>Checkout</h1>
        {error && <p className="alert">{error}</p>}
        <p className="muted">Your bag is empty.</p>
        <Link to="/shop" className="btn">Continue shopping</Link>
      </div>
    );
  }

  const F = ({ k, label, type = 'text', auto, half, ...rest }) => (
    <label className={`field${half ? ' half' : ''}`}>
      <span>{label}</span>
      <input type={type} value={form[k]} onChange={set(k)} autoComplete={auto} aria-invalid={!!errors[k]} {...rest} />
      {errors[k] && <em className="err">{errors[k]}</em>}
    </label>
  );

  return (
    <div className="container section">
      <h1 className="checkout-title">Checkout</h1>
      <div className="checkout">
        <form className="checkout-form" onSubmit={submit} noValidate>
          <fieldset>
            <legend>Contact</legend>
            <div className="fields">
              {F({ k: 'name', label: 'Full name', auto: 'name', required: true })}
              {F({ k: 'email', label: 'Email', type: 'email', auto: 'email', half: true, required: true })}
              {F({ k: 'phone', label: 'Phone (WhatsApp)', type: 'tel', auto: 'tel', half: true, placeholder: '012-345 6789', required: true })}
            </div>
          </fieldset>

          <fieldset>
            <legend>Delivery address</legend>
            <div className="fields">
              {F({ k: 'address1', label: 'Address', auto: 'address-line1', required: true })}
              {F({ k: 'address2', label: 'Apartment, unit, etc. (optional)', auto: 'address-line2' })}
              {F({ k: 'postcode', label: 'Postcode', auto: 'postal-code', half: true, inputMode: 'numeric', maxLength: 5, required: true })}
              {F({ k: 'city', label: 'City', auto: 'address-level2', half: true, required: true })}
              <label className="field">
                <span>State</span>
                <select value={form.state} onChange={set('state')} aria-invalid={!!errors.state} required>
                  <option value="">Choose state</option>
                  {config?.states.map((s) => <option key={s}>{s}</option>)}
                </select>
                {errors.state && <em className="err">{errors.state}</em>}
              </label>
              <label className="field">
                <span>Order note (optional)</span>
                <textarea rows="2" value={form.note} onChange={set('note')} placeholder="Gift message, delivery instructions…" />
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend>Payment</legend>
            <div className="pay-options">
              {config?.stripeEnabled && (
                <label className={`pay-opt${method === 'stripe' ? ' on' : ''}`}>
                  <input type="radio" name="pay" checked={method === 'stripe'} onChange={() => setMethod('stripe')} />
                  <div><strong>Pay online</strong><span className="muted small">FPX online banking, credit/debit card, GrabPay. Secured by Stripe.</span></div>
                </label>
              )}
              <label className={`pay-opt${method === 'transfer' ? ' on' : ''}`}>
                <input type="radio" name="pay" checked={method === 'transfer'} onChange={() => setMethod('transfer')} />
                <div><strong>Bank transfer / DuitNow</strong><span className="muted small">We’ll show our account details after you place the order. Send us the receipt on WhatsApp.</span></div>
              </label>
            </div>
          </fieldset>

          {error && <p className="alert" role="alert">{error}</p>}
          <button className="btn btn-block btn-lg" disabled={busy || !quote?.lines.length}>
            {busy ? 'Placing order…' : method === 'stripe' ? `Continue to payment · ${rm(quote?.total)}` : `Place order · ${rm(quote?.total)}`}
          </button>
          <p className="muted small center">By placing your order you agree to our terms. Your details are only used to deliver your order.</p>
        </form>

        <aside className="summary">
          <h3>Order summary</h3>
          {quote?.problems.length > 0 && (
            <div className="alert">
              {quote.problems.map((p) => <div key={p.variantId}>{p.error}</div>)}
              <button className="link-btn" onClick={() => replaceFromQuote(quote.lines)}>Update my bag</button>
            </div>
          )}
          <ul className="sum-items">
            {(quote?.lines || cart.map((c) => ({ ...c, lineTotal: c.price * c.qty }))).map((l) => (
              <li key={l.variantId}>
                <span className="sum-thumb"><img src={l.image} alt="" /><b>{l.qty}</b></span>
                <span className="sum-name">{l.name}<span className="muted small">{l.size}</span></span>
                <span>{rm(l.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <div className="promo">
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Discount code" aria-label="Discount code" autoCapitalize="characters" spellCheck="false" />
            {quote?.discount > 0 && <span className="promo-ok">Applied</span>}
          </div>
          {code.trim() && quote?.codeMessage && <p className="promo-msg">{quote.codeMessage}</p>}
          <div className="sum-row"><span>Subtotal</span><span>{rm(quote?.subtotal)}</span></div>
          {quote?.discount > 0 && <div className="sum-row discount"><span>Discount ({quote.discountCode})</span><span>−{rm(quote.discount)}</span></div>}
          <div className="sum-row"><span>Shipping</span><span>{!form.state ? <span className="muted">Choose state</span> : quote?.shipping === 0 ? 'Free' : rm(quote?.shipping)}</span></div>
          <div className="sum-row total"><span>Total</span><strong>{rm(quote?.total)}</strong></div>
        </aside>
      </div>
    </div>
  );
}
