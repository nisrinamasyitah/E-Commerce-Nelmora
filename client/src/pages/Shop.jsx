import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useStore } from '../store';
import ProductCard from '../components/ProductCard';
import { MOODS, inMood, useTitle } from '../lib';

const FOR = [['', 'All'], ['Women', 'For Her'], ['Men', 'For Him']];
const SIZES = [['', 'All sizes'], ['10ml', '10ml'], ['30ml', '30ml']];
const SORTS = [['', 'Featured'], ['az', 'Name A–Z'], ['price', 'Price, low to high'], ['price-desc', 'Price, high to low']];

export default function Shop() {
  const { products } = useStore();
  const [params, setParams] = useSearchParams();
  const gender = params.get('for') || '';
  const size = params.get('size') || '';
  const family = params.get('family') || '';
  const sort = params.get('sort') || '';
  const q = params.get('q') || '';

  const set = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  };

  const list = useMemo(() => {
    let l = products || [];
    if (gender) l = l.filter((p) => p.gender === gender || p.gender === 'Unisex');
    if (size) l = l.filter((p) => p.variants.some((v) => v.size === size));
    if (family) l = l.filter((p) => inMood(p, family));
    if (q) {
      const s = q.toLowerCase();
      l = l.filter((p) => `${p.name} ${p.notes} ${p.family}`.toLowerCase().includes(s));
    }
    const min = (p) => Math.min(...p.variants.map((v) => v.price));
    if (sort === 'az') l = [...l].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'price') l = [...l].sort((a, b) => min(a) - min(b));
    if (sort === 'price-desc') l = [...l].sort((a, b) => min(b) - min(a));
    return l;
  }, [products, gender, size, family, sort, q]);

  const mood = MOODS.find((m) => m.key === family);
  const title = mood ? mood.label : gender === 'Women' ? 'For Her' : gender === 'Men' ? 'For Him' : 'All Fragrances';
  const intro = mood ? `${mood.blurb}. Our ${mood.label.toLowerCase()} eaux de parfum.`
    : gender === 'Women' ? 'Sweet, floral and fruity compositions with a soft, lasting trail.'
      : gender === 'Men' ? 'Fresh, woody and amber compositions with quiet confidence.'
        : 'Twelve signature eaux de parfum, each available in 10ml and 30ml.';
  useTitle(q ? `Search: ${q}` : title, q ? undefined : `${title}: ${intro}`);

  return (
    <>
      <header className="page-banner">
        <div className="container">
          <p className="eyebrow light">The collection</p>
          <h1>{q ? `“${q}”` : title}</h1>
          <p>{q ? 'Search results' : intro}</p>
        </div>
      </header>

      <div className="filter-bar">
        <div className="container filters">
          <div className="seg" role="group" aria-label="Filter by who it's for">
            {FOR.map(([v, l]) => <button key={v} className={gender === v ? 'on' : ''} onClick={() => set('for', v)}>{l}</button>)}
          </div>
          <select value={family} onChange={(e) => set('family', e.target.value)} aria-label="Scent family">
            <option value="">All scent families</option>
            {MOODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          <select value={size} onChange={(e) => set('size', e.target.value)} aria-label="Size">
            {SIZES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <span className="count muted">{products ? `${list.length} ${list.length === 1 ? 'fragrance' : 'fragrances'}` : ''}</span>
          <select value={sort} onChange={(e) => set('sort', e.target.value)} aria-label="Sort" className="sort">
            {SORTS.map(([v, l]) => <option key={v} value={v}>Sort: {l}</option>)}
          </select>
        </div>
      </div>

      <div className="container section-sm">
        {q && <p className="muted">Showing results for “{q}”. <button className="link-btn" onClick={() => set('q', '')}>Clear search</button></p>}
        {!products ? (
          <div className="grid">{Array.from({ length: 6 }, (_, i) => <div key={i} className="card ph-card" />)}</div>
        ) : list.length ? (
          <div className="grid">{list.map((p) => <ProductCard key={p.id} product={p} />)}</div>
        ) : (
          <div className="empty">
            <p>No fragrances match those filters.</p>
            <button className="btn btn-ghost" onClick={() => setParams({})}>Clear filters</button>
          </div>
        )}
      </div>
    </>
  );
}
