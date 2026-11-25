import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store';
import ProductCard from '../components/ProductCard';
import Reviews from '../components/Reviews';
import { rm, MOODS, inMood, useTitle } from '../lib';

const TABS = [['best', 'Bestsellers'], ['Women', 'For Her'], ['Men', 'For Him']];
const VALUES = ['Eau de Parfum concentration', 'Composed for tropical climates', 'Bottled in Malaysia', 'Gift boxed', 'Ships in 1–2 working days'];

export default function Home() {
  useTitle('');
  const { products, config } = useStore();
  const [tab, setTab] = useState('best');
  const list = (products || []).filter((p) => (tab === 'best' ? p.featured : p.gender === tab)).slice(0, tab === 'best' ? 4 : 3);

  return (
    <>
      {/* ---------- campaign hero ---------- */}
      <section className="hero">
        <div className="hero-bg" />
        <div className="container hero-grid">
          <div className="hero-copy">
            <p className="eyebrow light">The Signature Collection</p>
            <h1>The art of a<br /><em>lasting impression.</em></h1>
            <p className="hero-lead">Twelve eaux de parfum, composed to stay with you from the first spray to the last hour of the day.</p>
            <div className="hero-actions">
              <Link to="/shop" className="btn btn-light">Discover the collection</Link>
              <Link to="/finder" className="btn btn-outline-light">Find your scent</Link>
            </div>
          </div>
          <div className="hero-bottles" aria-hidden="true">
            <img src="/images/products/onyx-bottle.png" alt="" className="hb hb-l" />
            <img src="/images/products/elara-bottle.png" alt="" className="hb hb-r" />
            <img src="/images/products/caffe-latte-bottle.png" alt="" className="hb hb-c" />
          </div>
        </div>
        <a href="#collection" className="hero-scroll" aria-label="Scroll to collection"><span /></a>
      </section>

      {/* ---------- values marquee ---------- */}
      <div className="marquee" aria-label="Why Nelmora">
        <div className="marquee-track">
          {[...VALUES, ...VALUES].map((v, i) => <span key={i}>{v}</span>)}
        </div>
      </div>

      {/* ---------- collection tabs ---------- */}
      <section className="section" id="collection">
        <div className="container">
          <div className="section-head centered">
            <p className="eyebrow">The collection</p>
            <h2>Signature scents</h2>
            <div className="tabs" role="tablist">
              {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
            </div>
          </div>
          <div className={`grid${tab === 'best' ? ' grid-4' : ''}`}>
            {products ? list.map((p) => <ProductCard key={p.id} product={p} />) : Array.from({ length: 3 }, (_, i) => <div key={i} className="card ph-card" />)}
          </div>
          <div className="center mt-lg"><Link to={tab === 'best' ? '/shop' : `/shop?for=${tab}`} className="btn btn-ghost">View all fragrances</Link></div>
        </div>
      </section>

      {/* ---------- editorial ---------- */}
      <section className="editorial">
        <div className="editorial-media">
          <img src="/images/products/delusion.jpg" alt="Delusion eau de parfum on a travertine plinth" loading="lazy" />
        </div>
        <div className="editorial-copy">
          <p className="eyebrow">The Maison</p>
          <h2>Luxury you wear every day.</h2>
          <p>At Nelmora, we believe a fine fragrance shouldn’t wait for special occasions. Each scent is blended at eau de parfum strength and composed with the warmth of a tropical day in mind, so it carries from morning to night.</p>
          <p>From the smoky black tea of <Link to="/shop/delusion">Delusion</Link> to the spun-sugar softness of <Link to="/shop/elara">Elara</Link>, every bottle is made to become someone’s signature.</p>
          <Link to="/about" className="link-arrow">Discover our story</Link>
        </div>
      </section>

      {/* ---------- shop by family ---------- */}
      <section className="section">
        <div className="container">
          <div className="section-head centered">
            <p className="eyebrow">Explore</p>
            <h2>Shop by scent family</h2>
          </div>
          <div className="families">
            {MOODS.map((m) => (
              <Link key={m.key} to={`/shop?family=${m.key}`} className="family">
                <div className="family-media"><img src={`/images/products/${m.image}-bottle.png`} alt="" loading="lazy" /></div>
                <strong>{m.label}</strong>
                <span>{m.blurb}</span>
                <em>{products ? `${products.filter((p) => inMood(p, m.key)).length} scents` : ' '}</em>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- finder banner ---------- */}
      <section className="finder-banner">
        <div className="container finder-banner-inner">
          <div>
            <p className="eyebrow light">Scent Finder</p>
            <h2>Not sure where to begin?</h2>
            <p>Answer three quick questions and we’ll match you with the Nelmora scents made for you.</p>
          </div>
          <Link to="/finder" className="btn btn-light">Take the quiz</Link>
        </div>
      </section>

      {/* ---------- formats ---------- */}
      <section className="section">
        <div className="container">
          <div className="section-head centered">
            <p className="eyebrow">Formats</p>
            <h2>Two ways to wear Nelmora</h2>
          </div>
          <div className="formats">
            <Link to="/shop?size=10ml" className="format">
              <img src="/images/products/aura-bottle.png" alt="" loading="lazy" />
              <div>
                <span className="format-size">10ml</span>
                <h3>The Discovery</h3>
                <p>Pocket-sized and perfect for travel, for trying something new, or for gifting.</p>
                <span className="format-price">{rm(2500)} <u>Shop 10ml</u></span>
              </div>
            </Link>
            <Link to="/shop?size=30ml" className="format">
              <img src="/images/products/valentus-bottle.png" alt="" loading="lazy" />
              <div>
                <span className="format-size">30ml</span>
                <h3>The Signature</h3>
                <p>The full bottle for the scent you can’t live without. Months of daily wear.</p>
                <span className="format-price">{rm(6500)} <u>Shop 30ml</u></span>
              </div>
            </Link>
          </div>
        </div>
      </section>

      <Reviews limit={4} />

      {/* ---------- service ---------- */}
      <section className="service">
        <div className="container service-grid">
          <div><Svc d="M3 7h11v9H3zM14 10h4l3 3v3h-7z" /><strong>{config?.shipping.freeMin ? `Free shipping from ${rm(config.shipping.freeMin)}` : 'Nationwide shipping'}</strong><span>Across Malaysia, packed within 1–2 working days</span></div>
          <div><Svc d="M4 9h16v11H4zM12 9v11M4 9l2-4h12l2 4M9 5c0 2 3 4 3 4s3-2 3-4" /><strong>Gift boxed</strong><span>Every bottle arrives in its Nelmora box</span></div>
          <div><Svc d="M6 11V8a6 6 0 0 1 12 0v3M5 11h14v9H5z" /><strong>Secure checkout</strong><span>{config?.stripeEnabled ? 'FPX, card, GrabPay or bank transfer' : 'Bank transfer or DuitNow'}</span></div>
          <div><Svc d="M4 5h16v11H8l-4 4z" /><strong>Personal advice</strong><span><Link to="/contact">Talk to us</Link> on WhatsApp or email</span></div>
        </div>
      </section>
    </>
  );
}

const Svc = ({ d }) => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
