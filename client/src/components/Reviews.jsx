import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib';

const Stars = ({ n }) => <span className="stars" role="img" aria-label={`${n} out of 5 stars`}>{'★'.repeat(n)}<i>{'★'.repeat(5 - n)}</i></span>;
const when = (d) => { try { return new Date(`${d}T00:00:00`).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } };
const Check = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>;

function Card({ r, showScent }) {
  return (
    <figure className="review">
      <div className="review-top">
        <span className="review-avatar" aria-hidden="true">{r.name.trim().charAt(0).toUpperCase()}</span>
        <div className="review-who">
          <strong>{r.name}</strong>
          {r.verified && <span className="review-verified"><Check /> Verified buyer</span>}
        </div>
        {r.rating > 0 && <Stars n={r.rating} />}
      </div>
      <blockquote>{r.body}</blockquote>
      <figcaption>
        <span>{[r.source, when(r.date)].filter(Boolean).join(' · ')}</span>
        {showScent && r.slug && <Link to={`/shop/${r.slug}`}>{r.product}</Link>}
      </figcaption>
    </figure>
  );
}

function Summary({ data, onWrite }) {
  const { rated, average, dist, count } = data;
  return (
    <div className="rv-summary">
      <div className="rv-score">
        {rated > 0 ? (
          <>
            <div className="rv-big">{average.toFixed(1)}</div>
            <Stars n={Math.round(average)} />
            <p>{count} review{count > 1 ? 's' : ''}{rated < count ? ` · ${rated} rated` : ''}</p>
          </>
        ) : (
          <>
            <div className="rv-big rv-count">{count}</div>
            <p>customer {count === 1 ? 'message' : 'messages'}</p>
          </>
        )}
      </div>
      {rated > 0 && (
        <ul className="rv-bars" aria-label="Rating breakdown">
          {[5, 4, 3, 2, 1].map((s) => (
            <li key={s}><span>{s}</span><div><i style={{ width: `${(dist[s] / rated) * 100}%` }} /></div><em>{dist[s]}</em></li>
          ))}
        </ul>
      )}
      {onWrite && <button className="btn rv-write" onClick={onWrite}>Write a review</button>}
    </div>
  );
}

function ReviewForm({ slug, productName, onClose }) {
  const [f, setF] = useState({ name: '', rating: 0, body: '', email: '', order: '', website: '' });
  const [state, setState] = useState({ busy: false, error: '', done: null });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  async function submit(e) {
    e.preventDefault();
    if (!f.rating) return setState({ busy: false, error: 'Please choose your star rating.', done: null });
    setState({ busy: true, error: '', done: null });
    try { const r = await api('/reviews', { method: 'POST', body: { ...f, product: slug } }); setState({ busy: false, error: '', done: r }); }
    catch (err) { setState({ busy: false, error: err.message, done: null }); }
  }
  if (state.done) {
    return (
      <div className="rv-form rv-thanks" role="status">
        <h3>Terima kasih! Thank you.</h3>
        <p>Your review of {productName} is now live.{f.email && f.order && !state.done.verified ? ' We could not match that order number, so it will not carry the Verified buyer label.' : ''}</p>
        <button className="btn btn-ghost" onClick={onClose}>Close</button>
      </div>
    );
  }
  return (
    <form className="rv-form" onSubmit={submit}>
      <h3>Write a review{productName ? ` for ${productName}` : ''}</h3>
      <div className="field">
        <span>Your rating</span>
        <div className="rv-pick" role="radiogroup" aria-label="Star rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button type="button" key={n} role="radio" aria-checked={f.rating === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} className={n <= f.rating ? 'on' : ''} onClick={() => set('rating', n)}>★</button>
          ))}
        </div>
      </div>
      <label className="field"><span>Your name</span><input value={f.name} onChange={(e) => set('name', e.target.value)} maxLength="60" placeholder="First name is fine" required /></label>
      <label className="field"><span>Your review</span>
        <textarea rows="5" value={f.body} onChange={(e) => set('body', e.target.value)} maxLength="1000" required placeholder="Ceritakan pengalaman anda: wangi, tahan lama, packaging… / Tell us how it wears." />
        <em className="rv-count-hint">{f.body.length}/1000</em>
      </label>
      <details className="rv-verify">
        <summary>Bought from us? Get a Verified buyer label</summary>
        <div className="rv-verify-grid">
          <label className="field"><span>Order number</span><input value={f.order} onChange={(e) => set('order', e.target.value)} placeholder="NM-XXXXXX" /></label>
          <label className="field"><span>Email used for the order</span><input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></label>
        </div>
        <p className="muted small">We only use this to check your order. Your email is never shown.</p>
      </details>
      <input className="rv-hp" tabIndex="-1" autoComplete="off" aria-hidden="true" value={f.website} onChange={(e) => set('website', e.target.value)} name="website" />
      {state.error && <p className="alert">{state.error}</p>}
      <div className="rv-actions">
        <button className="btn" disabled={state.busy}>{state.busy ? 'Sending…' : 'Submit review'}</button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

// Customer reviews. `slug` = one scent (always shown there, so people can write one); no slug = latest across the shop
// (home page), hidden until there is at least one. Reviews are entered by the owner in Admin or submitted by customers and approved.
export default function Reviews({ slug, productName, limit, title = 'What customers say', eyebrow = 'Reviews' }) {
  const [data, setData] = useState(null);
  const [writing, setWriting] = useState(false);
  const [all, setAll] = useState(false);
  useEffect(() => {
    let live = true;
    api(`/reviews${slug ? `?product=${encodeURIComponent(slug)}` : ''}`).then((d) => live && setData(d)).catch(() => {});
    return () => { live = false; };
  }, [slug]);
  if (!data) return null;
  if (!data.count && !slug) return null;
  const cap = limit || (all ? 100 : 6);
  const list = data.reviews.slice(0, cap);

  return (
    <section className="section reviews" id="reviews">
      <div className="container">
        <div className="section-head centered">
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        {data.count > 0 ? <Summary data={data} onWrite={slug ? () => setWriting(true) : null} /> : (
          <div className="rv-empty">
            <p>No reviews yet. Be the first to share how {productName || 'it'} wears.</p>
            <button className="btn" onClick={() => setWriting(true)}>Write a review</button>
          </div>
        )}
        {writing && slug && <ReviewForm slug={slug} productName={productName} onClose={() => setWriting(false)} />}
        {data.count > 0 && (
          <div className="review-grid">{list.map((r) => <Card key={r.id} r={r} showScent={!slug} />)}</div>
        )}
        {!limit && data.count > 6 && !all && <div className="center mt-lg"><button className="btn btn-ghost" onClick={() => setAll(true)}>Show all {data.count} reviews</button></div>}
      </div>
    </section>
  );
}
