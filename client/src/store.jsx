import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './lib';

// Store-wide state: site config, product catalogue, and the shopping bag.
const StoreCtx = createContext(null);
const CART_KEY = 'nelmora.cart.v1';

const readCart = () => {
  try { const c = JSON.parse(localStorage.getItem(CART_KEY)); return Array.isArray(c) ? c : []; } catch { return []; }
};

export function StoreProvider({ children }) {
  const [config, setConfig] = useState(null);
  const [products, setProducts] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [cart, setCart] = useState(readCart);
  const [bagOpen, setBagOpen] = useState(false);

  const reload = useCallback(() => {
    setLoadError('');
    Promise.all([api('/config'), api('/products')])
      .then(([c, p]) => { setConfig(c); setProducts(p); })
      .catch(() => setLoadError('We could not load the shop. Please refresh the page.'));
  }, []);
  useEffect(reload, [reload]);

  useEffect(() => {
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch { /* private mode */ }
  }, [cart]);

  // Item snapshot: { variantId, qty, name, size, price, image, slug }. Prices are re-checked by the server.
  const add = useCallback((item, qty = 1) => {
    setCart((c) => {
      const found = c.find((x) => x.variantId === item.variantId);
      if (found) return c.map((x) => (x.variantId === item.variantId ? { ...x, qty: Math.min(99, x.qty + qty) } : x));
      return [...c, { ...item, qty }];
    });
    setBagOpen(true);
  }, []);
  const setQty = useCallback((variantId, qty) => {
    setCart((c) => (qty <= 0 ? c.filter((x) => x.variantId !== variantId) : c.map((x) => (x.variantId === variantId ? { ...x, qty: Math.min(99, qty) } : x))));
  }, []);
  const clear = useCallback(() => setCart([]), []);
  const replaceFromQuote = useCallback((lines) => {
    setCart(lines.map((l) => ({ variantId: l.variantId, qty: l.qty, name: l.name, size: l.size, price: l.price, image: l.image, slug: l.slug })));
  }, []);

  const count = cart.reduce((a, x) => a + x.qty, 0);
  const subtotal = cart.reduce((a, x) => a + x.qty * x.price, 0);

  const value = useMemo(() => ({
    config, products, loadError, reload, cart, add, setQty, clear, replaceFromQuote, count, subtotal, bagOpen, setBagOpen,
  }), [config, products, loadError, reload, cart, add, setQty, clear, replaceFromQuote, count, subtotal, bagOpen]);

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export const useStore = () => useContext(StoreCtx);
