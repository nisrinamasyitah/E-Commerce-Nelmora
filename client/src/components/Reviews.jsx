import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib';

const Stars = ({ n }) => <span className="stars" role="img" aria-label={`${n} out of 5 stars`}>{'★'.repeat(n)}<i>{'★'.repeat(5 - n)}</i></span>;
const when = (d) => { try { return new Date(`${d}T00:00:00`).toLocaleDateString('en-MY', { month: 'short', year: 'numeric' }); } catch { return ''; } };

// Real customer reviews, entered by the shop owner in Admin. Renders nothing until at least one exists.
// `slug` = reviews for one scent; no slug = latest across the shop (home page, capped by `limit`).
export default function Reviews({ slug, limit, title = 'What customers say', eyebrow = 'Reviews' }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let live = true;
    api(`/reviews${slug ? `?product=${encodeURIComponent(slug)}` : ''}`).then((d) => live && setData(d)).catch(() => {});
    return () => { live = false; };
  }, [slug]);
  if (!data || !data.count) return null;
  const list = limit ? data.reviews.slice(0, limit) : data.reviews;
  return (
    <section className="section reviews">
      <div className="container">
        <div className="section-head centered">
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
          <p className="reviews-sum"><Stars n={Math.round(data.average)} /> <strong>{data.average.toFixed(1)}</strong> from {data.count} review{data.count > 1 ? 's' : ''}</p>
        </div>
        <div className="review-grid">
          {list.map((r) => (
            <figure key={r.id} className="review">
              <Stars n={r.rating} />
              <blockquote>{r.body}</blockquote>
              <figcaption>
                <strong>{r.name}</strong>
                <span>{[r.source, when(r.date)].filter(Boolean).join(' · ')}</span>
                {!slug && r.slug && <Link to={`/shop/${r.slug}`}>{r.product}</Link>}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
