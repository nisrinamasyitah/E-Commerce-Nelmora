import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { rm } from '../lib';
import QtyInput from './QtyInput';

export default function CartDrawer() {
  const { cart, setQty, subtotal, bagOpen, setBagOpen, config } = useStore();
  const navigate = useNavigate();
  const close = () => setBagOpen(false);

  useEffect(() => {
    if (!bagOpen) return;
    const onKey = (e) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  });

  const freeMin = config?.shipping.freeMin || 0;
  const toFree = freeMin > 0 ? Math.max(0, freeMin - subtotal) : null;

  return (
    <>
      <div className={`scrim${bagOpen ? ' show' : ''}`} onClick={close} />
      <aside className={`drawer${bagOpen ? ' open' : ''}`} aria-hidden={!bagOpen} aria-label="Shopping bag">
        <div className="drawer-head">
          <h3>Your bag</h3>
          <button className="icon-btn" onClick={close} aria-label="Close bag">✕</button>
        </div>

        {cart.length === 0 ? (
          <div className="drawer-empty">
            <p className="muted">Your bag is empty.</p>
            <Link to="/shop" className="btn" onClick={close}>Discover the collection</Link>
          </div>
        ) : (
          <>
            {toFree !== null && (
              <div className="free-ship">
                {toFree > 0 ? <>You are <strong>{rm(toFree)}</strong> away from free shipping</> : <>You have unlocked <strong>free shipping</strong></>}
                <div className="free-bar"><span style={{ width: `${Math.min(100, (subtotal / freeMin) * 100)}%` }} /></div>
              </div>
            )}
            <ul className="drawer-items">
              {cart.map((it) => (
                <li key={it.variantId} className="bag-line">
                  <Link to={`/shop/${it.slug}`} onClick={close} className="bag-thumb"><img src={it.image} alt="" /></Link>
                  <div className="bag-info">
                    <Link to={`/shop/${it.slug}`} onClick={close} className="bag-name">{it.name}</Link>
                    <div className="muted small">{it.size} · Eau de Parfum</div>
                    <div className="bag-row">
                      <QtyInput value={it.qty} onChange={(q) => setQty(it.variantId, q)} min={0} small />
                      <button className="link-btn small" onClick={() => setQty(it.variantId, 0)}>Remove</button>
                    </div>
                  </div>
                  <div className="bag-price">{rm(it.price * it.qty)}</div>
                </li>
              ))}
            </ul>
            <div className="drawer-foot">
              <div className="sum-row"><span>Subtotal</span><strong>{rm(subtotal)}</strong></div>
              <p className="muted small">Shipping is calculated at checkout.</p>
              <button className="btn btn-block" onClick={() => { close(); navigate('/checkout'); }}>Checkout</button>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
