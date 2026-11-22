import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useStore } from '../store';
import { rm, useTitle } from '../lib';

export default function About() {
  useTitle('Our Story', 'The story behind Nelmora Parfums: a Malaysian fragrance house making long-lasting eau de parfum, one scent at a time.');
  const { config } = useStore();
  const { hash } = useLocation();
  useEffect(() => { if (hash) document.querySelector(hash)?.scrollIntoView(); }, [hash]);

  return (
    <>
      <section className="container section about-hero">
        <div>
          <p className="eyebrow">Our story</p>
          <h1>Fragrance for every day, not just special days.</h1>
          <p className="lead">Nelmora Parfums began with a simple idea: everyone deserves a scent they love, one that lasts, feels personal, and doesn’t cost a fortune.</p>
          <p>Each of our twelve fragrances is blended at eau de parfum strength so it carries through long, warm Malaysian days. From the comforting sweetness of <Link to="/shop/elara">Elara</Link> to the smoky tea of <Link to="/shop/delusion">Delusion</Link>, every scent is created to become someone’s signature.</p>
          <p>We bottle in two sizes: a 10ml to discover and carry everywhere, and a 30ml for the scent you can’t live without.</p>
        </div>
        <img src="/images/products/citrus-muse.jpg" alt="Citrus Muse eau de parfum on a stone plinth" loading="lazy" />
      </section>

      <section className="section alt" id="shipping">
        <div className="container info-grid">
          <div>
            <h3>Shipping</h3>
            <p>Peninsular Malaysia: {rm(config?.shipping.west)}<br />Sabah, Sarawak & Labuan: {rm(config?.shipping.east)}</p>
            {config?.shipping.freeMin > 0 && <p>Free shipping on orders {rm(config.shipping.freeMin)} and above.</p>}
            <p className="muted">Orders are packed within 1–2 working days after payment. Delivery usually takes 2–5 working days.</p>
          </div>
          <div>
            <h3>Payment</h3>
            <p>{config?.stripeEnabled ? 'Pay online with FPX, card or GrabPay, or ' : 'Pay by '}bank transfer / DuitNow. Bank details are shown right after you order.</p>
          </div>
          <div>
            <h3>Questions?</h3>
            <p>We’re happy to help you pick a scent. <Link to="/contact">Get in touch</Link>.</p>
          </div>
        </div>
      </section>
    </>
  );
}
