import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useStore } from '../store';
import { rm, notesList, noteImage, useTitle } from '../lib';
import PaymentLogos from '../components/PaymentLogos';
import QtyInput from '../components/QtyInput';
import Reviews from '../components/Reviews';
import ProductCard from '../components/ProductCard';
import NotFound from './NotFound';

export default function Product() {
  const { slug } = useParams();
  const { products, add, config } = useStore();
  const product = products?.find((p) => p.slug === slug);
  const [variantId, setVariantId] = useState(null);
  const [qty, setQty] = useState(1);
  const [view, setView] = useState('photo');
  const [showSticky, setShowSticky] = useState(false);
  const buyRef = useRef(null);
  useTitle(product ? `${product.name} Eau de Parfum` : '', product ? `${product.name} eau de parfum by Nelmora. ${product.tagline} Notes of ${notesList(product.notes).join(', ')}. Available in 10ml and 30ml. Made in Malaysia.` : undefined);

  useEffect(() => {
    if (!product) return;
    const best = [...product.variants].reverse().find((v) => v.inStock) || product.variants[0];
    setVariantId(best?.id ?? null);
    setQty(1);
    setView('photo');
  }, [product]);

  // sticky add-to-bag bar once the main button scrolls out of view
  useEffect(() => {
    const el = buyRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setShowSticky(!e.isIntersecting && e.boundingClientRect.top < 0));
    io.observe(el);
    return () => io.disconnect();
  }, [product]);

  if (!products) return <div className="container section"><div className="pdp ph-pdp" /></div>;
  if (!product) return <NotFound />;

  const variant = product.variants.find((v) => v.id === variantId) || product.variants[0];
  const related = products.filter((p) => p.id !== product.id && p.gender === product.gender).slice(0, 3);
  const addToBag = () => add({ variantId: variant.id, name: product.name, size: variant.size, price: variant.price, image: product.cutout || product.image, slug: product.slug }, qty);
  const forLabel = product.gender === 'Men' ? 'For Him' : product.gender === 'Women' ? 'For Her' : 'Unisex';
  const notes = notesList(product.notes);
  const freeMin = config?.shipping.freeMin;

  return (
    <>
      <div className="container pdp-wrap">
        <nav className="crumbs" aria-label="Breadcrumb"><Link to="/">Home</Link><span>/</span><Link to={`/shop?for=${product.gender}`}>{forLabel}</Link><span>/</span>{product.name}</nav>
        <div className="pdp">
          <div className="pdp-media">
            {product.cutout && (
              <div className="thumbs">
                <button className={view === 'photo' ? 'on' : ''} onClick={() => setView('photo')} aria-label="Show photo"><img src={product.image} alt="" /></button>
                <button className={view === 'bottle' ? 'on' : ''} onClick={() => setView('bottle')} aria-label="Show bottle"><img src={product.cutout} alt="" className="contain" /></button>
              </div>
            )}
            <div className={`pdp-main${view === 'bottle' ? ' bottle' : ''}`}>
              <img src={view === 'photo' ? product.image : product.cutout} alt={`${product.name} eau de parfum`} />
            </div>
          </div>

          <div className="pdp-info">
            <p className="eyebrow">{product.family} · {forLabel}</p>
            <h1>{product.name}</h1>
            <p className="tagline">{product.tagline}</p>
            <p className="pdp-type">Eau de Parfum{variant ? ` · ${variant.size}` : ''}</p>
            <div className="pdp-price">{variant ? rm(variant.price) : ''}</div>

            <div className="field-label">Select size</div>
            <div className="sizes-pick">
              {product.variants.map((v) => (
                <button key={v.id} className={`size-opt${v.id === variant?.id ? ' on' : ''}`} disabled={!v.inStock} onClick={() => setVariantId(v.id)}>
                  <strong>{v.size}</strong>
                  <span>{v.inStock ? rm(v.price) : 'Sold out'}</span>
                  <em>{v.size === '10ml' ? 'Travel & discovery' : v.size === '30ml' ? 'Signature bottle' : ''}</em>
                </button>
              ))}
            </div>
            {variant?.lowStock && <p className="low">Only a few left in stock</p>}

            <div className="buy-row" ref={buyRef}>
              <QtyInput value={qty} onChange={setQty} />
              <button className="btn btn-grow" disabled={!variant?.inStock} onClick={addToBag}>
                {variant?.inStock ? `Add to bag · ${rm(variant.price * qty)}` : 'Sold out'}
              </button>
            </div>

            <ul className="perks">
              <li><Dot />{freeMin ? (variant && variant.price * qty >= freeMin ? 'This order ships free' : `Free shipping on orders from ${rm(freeMin)}`) : 'Shipping across Malaysia'}</li>
              <li><Dot />Dispatched within 1–2 working days</li>
              <li><Dot />Arrives gift boxed</li>
            </ul>

            <div className="pdp-section">
              <h3>The scent</h3>
              <p className="pdp-desc">{product.description}</p>
            </div>

            <div className="pdp-section">
              <h3>Key notes</h3>
              <ul className="notes-list">
                {notes.map((n, i) => {
                  const pic = noteImage(n);
                  return (
                    <li key={n}>
                      <span className="note-num">{String(i + 1).padStart(2, '0')}</span>
                      <span className="note-name">{n}</span>
                      {pic && <img className="note-pic" src={pic} alt={n} loading="lazy" />}
                    </li>
                  );
                })}
              </ul>
            </div>

            <details className="acc">
              <summary>How to wear</summary>
              <p>Spray on pulse points: wrists, neck and behind the ears, from about 15cm away. Let it dry naturally rather than rubbing. A light mist on clothing helps it last even longer.</p>
            </details>
            <details className="acc">
              <summary>Shipping & returns</summary>
              <p>Peninsular Malaysia {rm(config?.shipping.west)}, Sabah, Sarawak & Labuan {rm(config?.shipping.east)}.{freeMin ? ` Free on orders from ${rm(freeMin)}.` : ''} For hygiene reasons, opened fragrances cannot be returned. <Link to="/policies/shipping">Read the full policy</Link>.</p>
            </details>
            <div className="pdp-pay">
              <span className="muted small">Secure payment</span>
              <PaymentLogos methods={config?.paymentLogos} />
            </div>
          </div>
        </div>
      </div>

      <section className="pdp-banner">
        <div className="container pdp-banner-inner">
          <img src={product.cutout} alt="" loading="lazy" />
          <div>
            <p className="eyebrow light">{product.family}</p>
            <p className="pdp-quote">“{product.tagline}”</p>
            <p className="pdp-banner-notes">{notes.join('  ·  ')}</p>
          </div>
        </div>
      </section>

      <Reviews slug={product.slug} productName={product.name} title={`Reviews for ${product.name}`} />

      {related.length > 0 && (
        <section className="section">
          <div className="container">
            <div className="section-head centered"><p className="eyebrow">Complete your wardrobe</p><h2>You may also like</h2></div>
            <div className="grid">{related.map((p) => <ProductCard key={p.id} product={p} />)}</div>
          </div>
        </section>
      )}

      <div className={`sticky-buy${showSticky ? ' show' : ''}`} aria-hidden={!showSticky}>
        <div className="container sticky-buy-inner">
          <img src={product.cutout || product.image} alt="" />
          <div className="sticky-name"><strong>{product.name}</strong><span>{variant?.size} · {variant ? rm(variant.price) : ''}</span></div>
          <button className="btn" disabled={!variant?.inStock} onClick={addToBag} tabIndex={showSticky ? 0 : -1}>{variant?.inStock ? 'Add to bag' : 'Sold out'}</button>
        </div>
      </div>
    </>
  );
}

const Dot = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>;
