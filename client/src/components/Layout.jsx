import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useStore } from '../store';
import { rm } from '../lib';
import CartDrawer from './CartDrawer';
import SearchOverlay from './SearchOverlay';
import Newsletter from './Newsletter';
import WelcomePopup from './WelcomePopup';

function Wordmark({ small, light }) {
  return (
    <Link to="/" className={`wordmark${small ? ' small' : ''}${light ? ' light' : ''}`} aria-label="Nelmora Parfums home">
      <span className="wm-main">NELMORA</span>
      <span className="wm-script">Parfums</span>
    </Link>
  );
}

const Icon = {
  search: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></svg>,
  bag: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M5 8h14l-1.2 12.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8L5 8Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></svg>,
  user: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M4 20l1.4-4.2A2 2 0 0 1 7.3 14.5h9.4a2 2 0 0 1 1.9 1.3L20 20" /><circle cx="12" cy="8" r="3.5" /></svg>,
};

function Announcement({ config }) {
  const messages = useMemo(() => [
    config?.announcement,
    'Ships within 1–2 working days',
    config?.stripeEnabled ? 'Pay securely with FPX, card or GrabPay' : 'Pay easily by bank transfer or DuitNow',
  ].filter(Boolean), [config]);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (messages.length < 2) return;
    const t = setInterval(() => setI((n) => (n + 1) % messages.length), 4500);
    return () => clearInterval(t);
  }, [messages.length]);
  if (!config) return <div className="announce">&nbsp;</div>;
  return <div className="announce" aria-live="polite"><span key={i} className="announce-msg">{messages[i % messages.length]}</span></div>;
}

export const PAYMENTS = ['FPX', 'Visa', 'Mastercard', 'GrabPay', 'DuitNow'];

export default function Layout() {
  const { config, count, setBagOpen, loadError, reload } = useStore();
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { pathname, search: qs } = useLocation();
  const shopFor = new URLSearchParams(qs).get('for') || '';
  const isHome = pathname === '/';

  useEffect(() => { window.scrollTo(0, 0); setMenu(false); setSearch(false); }, [pathname]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const active = (cond) => () => (cond ? 'active' : '');
  const payments = config?.stripeEnabled ? PAYMENTS : ['Bank transfer', 'DuitNow'];

  return (
    <div className="site">
      <Announcement config={config} />
      <header className={`header${isHome && !scrolled && !menu ? ' over' : ''}${scrolled ? ' scrolled' : ''}`}>
        <div className="header-inner">
          <button className="icon-btn menu-btn" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            <span className={`burger${menu ? ' x' : ''}`} />
          </button>
          <nav className={`nav${menu ? ' open' : ''}`}>
            <NavLink to="/shop" className={active(pathname === '/shop' && !shopFor)}>Fragrances</NavLink>
            <NavLink to="/shop?for=Women" className={active(pathname === '/shop' && shopFor === 'Women')}>For Her</NavLink>
            <NavLink to="/shop?for=Men" className={active(pathname === '/shop' && shopFor === 'Men')}>For Him</NavLink>
            <NavLink to="/finder">Scent Finder</NavLink>
            <NavLink to="/about">Maison</NavLink>
            <div className="nav-mobile-extra">
              <NavLink to="/order">Track order</NavLink>
              <NavLink to="/contact">Contact</NavLink>
            </div>
          </nav>
          <Wordmark />
          <div className="header-right">
            <button className="icon-btn" onClick={() => setSearch(true)} aria-label="Search">{Icon.search}</button>
            <NavLink to="/order" className="icon-btn nav-desktop-only" aria-label="Track order" title="Track order">{Icon.user}</NavLink>
            <button className="bag-btn" onClick={() => setBagOpen(true)} aria-label={`Bag, ${count} items`}>
              {Icon.bag}
              {count > 0 && <span className="bag-count">{count}</span>}
            </button>
          </div>
        </div>
      </header>

      <main className={isHome ? 'main-home' : ''}>
        {loadError ? (
          <div className="container narrow center pad-xl">
            <p>{loadError}</p>
            <button className="btn" onClick={reload}>Try again</button>
          </div>
        ) : <Outlet />}
      </main>

      <Newsletter />

      <footer className="footer">
        <div className="container footer-grid">
          <div className="footer-brand">
            <Wordmark small light />
            <p className="footer-blurb">Eau de parfum, thoughtfully composed and bottled in Malaysia. Made to be worn every day.</p>
            <div className="socials">
              {config?.instagram && <a href={`https://instagram.com/${config.instagram}`} target="_blank" rel="noreferrer">Instagram</a>}
              {config?.whatsapp && <a href={`https://wa.me/${config.whatsapp}`} target="_blank" rel="noreferrer">WhatsApp</a>}
            </div>
          </div>
          <div>
            <h4>Shop</h4>
            <Link to="/shop">All fragrances</Link>
            <Link to="/shop?for=Women">For her</Link>
            <Link to="/shop?for=Men">For him</Link>
            <Link to="/shop?size=10ml">Travel size 10ml</Link>
            <Link to="/finder">Scent finder</Link>
          </div>
          <div>
            <h4>Client care</h4>
            <Link to="/order">Track your order</Link>
            <Link to="/policies/shipping">Shipping & returns</Link>
            <Link to="/contact">Contact us</Link>
            {config?.email && <a href={`mailto:${config.email}`}>{config.email}</a>}
          </div>
          <div>
            <h4>Maison</h4>
            <Link to="/about">Our story</Link>
            <Link to="/policies/privacy">Privacy policy</Link>
            <Link to="/policies/terms">Terms of sale</Link>
          </div>
        </div>
        <div className="container footer-base">
          <span>© {new Date().getFullYear()} Nelmora Parfums. All rights reserved.</span>
          <span className="footer-ship">{config?.shipping.freeMin ? `Complimentary shipping in Malaysia on orders ${rm(config.shipping.freeMin)}+` : 'Shipping across Malaysia'}</span>
          <ul className="pay-marks" aria-label="Accepted payment methods">{payments.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      </footer>

      <CartDrawer />
      <SearchOverlay open={search} onClose={() => setSearch(false)} />
      <WelcomePopup />
    </div>
  );
}
