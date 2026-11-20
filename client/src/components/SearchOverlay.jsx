import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { rm } from '../lib';

const SUGGEST = ['Vanilla', 'Coffee', 'Citrus', 'Patchouli', 'Strawberry', 'Musk'];

export default function SearchOverlay({ open, onClose }) {
  const { products } = useStore();
  const [q, setQ] = useState('');
  const input = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    setQ('');
    setTimeout(() => input.current?.focus(), 50);
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const s = q.trim().toLowerCase();
  const results = s ? (products || []).filter((p) => `${p.name} ${p.notes} ${p.family}`.toLowerCase().includes(s)).slice(0, 6) : [];

  return (
    <div className={`search-ov${open ? ' open' : ''}`} aria-hidden={!open} role="dialog" aria-label="Search">
      <div className="search-panel">
        <div className="container">
          <form className="search-bar" onSubmit={(e) => { e.preventDefault(); if (s) { navigate(`/shop?q=${encodeURIComponent(q.trim())}`); onClose(); } }}>
            <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by scent or note" aria-label="Search fragrances" />
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close search">✕</button>
          </form>
          {!s && (
            <div className="search-suggest">
              <span className="label">Popular notes</span>
              {SUGGEST.map((t) => <button key={t} type="button" onClick={() => setQ(t)}>{t}</button>)}
            </div>
          )}
          {s && (
            results.length ? (
              <div className="search-results">
                {results.map((p) => (
                  <Link key={p.id} to={`/shop/${p.slug}`} onClick={onClose} className="search-hit">
                    <img src={p.cutout || p.image} alt="" />
                    <div><strong>{p.name}</strong><span>{p.notes}</span><em>from {rm(Math.min(...p.variants.map((v) => v.price)))}</em></div>
                  </Link>
                ))}
              </div>
            ) : <p className="muted search-none">No fragrances match “{q}”.</p>
          )}
        </div>
      </div>
      <div className="search-scrim" onClick={onClose} />
    </div>
  );
}
