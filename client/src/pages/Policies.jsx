import { Link, NavLink, useParams } from 'react-router-dom';
import { useStore } from '../store';
import { rm, useTitle } from '../lib';
import NotFound from './NotFound';

// STARTER POLICY TEXT: review and adjust to match how Nelmora actually operates before going live.
function content(slug, c) {
  const email = c?.email || 'our email';
  if (slug === 'shipping') return {
    title: 'Shipping & Returns',
    body: (
      <>
        <h2>Shipping</h2>
        <p>We currently ship within Malaysia only.</p>
        <ul>
          <li>Peninsular Malaysia: {rm(c?.shipping.west)}</li>
          <li>Sabah, Sarawak & Labuan: {rm(c?.shipping.east)}</li>
          {c?.shipping.freeMin > 0 && <li>Free shipping on orders of {rm(c.shipping.freeMin)} and above</li>}
        </ul>
        <p>Orders are packed and dispatched within 1–2 working days of payment being confirmed. Delivery usually takes 2–5 working days depending on your location. You’ll receive a tracking number once your parcel ships, and you can check your order status any time on our <Link to="/order">order tracking page</Link>.</p>
        <h2>Returns</h2>
        <p>For hygiene reasons, we cannot accept returns of fragrances that have been opened or used.</p>
        <p>If your order arrives damaged, leaking or incorrect, please contact us within 7 days of delivery with your order number and photos (an unboxing video helps us resolve it quickly). We’ll arrange a replacement or refund.</p>
        <h2>Cancellations</h2>
        <p>You can cancel an order before it has been shipped by contacting us at {email} or on WhatsApp.</p>
      </>
    ),
  };
  if (slug === 'privacy') return {
    title: 'Privacy Policy',
    body: (
      <>
        <p>Nelmora Parfums respects your privacy and handles your personal data in line with Malaysia’s Personal Data Protection Act 2010 (PDPA).</p>
        <h2>What we collect</h2>
        <p>When you order, we collect your name, email, phone number and delivery address. When you contact us or subscribe to our newsletter, we collect the details you provide.</p>
        <h2>How we use it</h2>
        <ul>
          <li>To process, deliver and support your orders</li>
          <li>To reply to your messages</li>
          <li>To send our newsletter, only if you subscribed (you can unsubscribe any time)</li>
        </ul>
        <p>We never sell your personal data. We share it only with the services needed to fulfil your order, such as our courier and, for online payments, our payment provider. Card details are handled by the payment provider and never stored by us.</p>
        <h2>Your rights</h2>
        <p>You may ask to access, correct or delete your personal data by contacting us at {email}.</p>
      </>
    ),
  };
  if (slug === 'terms') return {
    title: 'Terms of Sale',
    body: (
      <>
        <p>By placing an order on this website you agree to these terms.</p>
        <h2>Prices & payment</h2>
        <p>All prices are in Malaysian Ringgit (RM). Shipping is calculated at checkout. Orders paid by bank transfer are confirmed once payment is received; unpaid orders may be cancelled.</p>
        <h2>Products</h2>
        <p>Our fragrances are eaux de parfum for external use only. Please test on a small area of skin if you have sensitivities, and discontinue use if irritation occurs. Product photos are for illustration; packaging may vary slightly.</p>
        <h2>Availability</h2>
        <p>All orders are subject to availability. If an item becomes unavailable after you order, we will contact you and offer a refund.</p>
        <h2>Contact</h2>
        <p>Questions about these terms? Contact us at {email}.</p>
      </>
    ),
  };
  return null;
}

export default function Policies() {
  const { slug } = useParams();
  const { config } = useStore();
  const page = content(slug, config);
  useTitle(page?.title || 'Not found');
  if (!page) return <NotFound />;
  return (
    <div className="container section policy">
      <nav className="policy-nav">
        <NavLink to="/policies/shipping">Shipping & Returns</NavLink>
        <NavLink to="/policies/privacy">Privacy</NavLink>
        <NavLink to="/policies/terms">Terms of Sale</NavLink>
      </nav>
      <article className="policy-body">
        <p className="eyebrow">Client care</p>
        <h1>{page.title}</h1>
        {page.body}
      </article>
    </div>
  );
}
