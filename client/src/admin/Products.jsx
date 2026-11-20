import { useEffect, useState } from 'react';
import { rm } from '../lib';
import { useAdmin, useLoad } from './Admin';

const BLANK = { name: '', gender: 'Women', family: '', tagline: '', description: '', notes: '', image: '', cutout: '', featured: false, active: true, sort: 99,
  variants: [{ size: '10ml', price: 2500, stock: 0, active: true }, { size: '30ml', price: 6500, stock: 0, active: true }] };

function ImageField({ label, value, onChange }) {
  const { call } = useAdmin();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function upload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setErr('');
    try { const { url } = await call('/admin/upload', { method: 'POST', body: file, raw: file.type }); onChange(url); }
    catch (er) { setErr(er.message); }
    setBusy(false);
  }
  return (
    <div className="field img-field">
      <span>{label}</span>
      <div className="img-row">
        {value ? <img src={value} alt="" /> : <div className="img-ph" />}
        <div>
          <label className="btn btn-sm btn-ghost">{busy ? 'Uploading…' : 'Upload'}<input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={upload} /></label>
          <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="/images/…" />
          {err && <em className="err">{err}</em>}
        </div>
      </div>
    </div>
  );
}

function Editor({ product, onClose, onSaved }) {
  const { call } = useAdmin();
  const [p, setP] = useState(() => ({ ...product, variants: product.variants.map((v) => ({ ...v })) }));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setP((x) => ({ ...x, [k]: v }));
  const setV = (i, k, v) => setP((x) => ({ ...x, variants: x.variants.map((vv, j) => (j === i ? { ...vv, [k]: v } : vv)) }));

  async function save(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const body = { ...p, variants: p.variants.map((v) => ({ ...v, price: Math.round(Number(v.priceRm ?? v.price / 100) * 100) })) };
      const saved = p.id ? await call(`/admin/products/${p.id}`, { method: 'PUT', body }) : await call('/admin/products', { method: 'POST', body });
      onSaved(saved);
    } catch (er) { setErr(er.message); setBusy(false); }
  }

  return (
    <div className="a-modal" role="dialog" aria-modal="true">
      <form className="a-modal-card" onSubmit={save}>
        <div className="a-panel-head"><h2>{p.id ? `Edit ${product.name}` : 'New product'}</h2><button type="button" className="link-btn" onClick={onClose}>Close ✕</button></div>
        <div className="a-form grid2">
          <label className="field"><span>Name</span><input value={p.name} onChange={(e) => set('name', e.target.value)} required /></label>
          <label className="field half"><span>For</span>
            <select value={p.gender} onChange={(e) => set('gender', e.target.value)}><option value="Women">Women (for her)</option><option value="Men">Men (for him)</option><option>Unisex</option></select>
          </label>
          <label className="field half"><span>Scent family</span><input value={p.family} onChange={(e) => set('family', e.target.value)} placeholder="Gourmand, Fresh…" /></label>
          <label className="field"><span>Key notes (comma separated)</span><input value={p.notes} onChange={(e) => set('notes', e.target.value)} /></label>
          <label className="field"><span>Tagline</span><input value={p.tagline} onChange={(e) => set('tagline', e.target.value)} /></label>
          <label className="field"><span>Description</span><textarea rows="4" value={p.description} onChange={(e) => set('description', e.target.value)} /></label>
          <ImageField label="Main photo" value={p.image} onChange={(v) => set('image', v)} />
          <ImageField label="Bottle cut-out (transparent PNG)" value={p.cutout} onChange={(v) => set('cutout', v)} />

          <div className="field">
            <span>Sizes, prices & stock</span>
            <table className="a-table compact">
              <thead><tr><th>Size</th><th>Price (RM)</th><th>Stock</th><th>On sale</th><th /></tr></thead>
              <tbody>
                {p.variants.map((v, i) => (
                  <tr key={v.id || `n${i}`}>
                    <td><input value={v.size} onChange={(e) => setV(i, 'size', e.target.value)} /></td>
                    <td><input type="number" min="0" step="0.01" value={v.priceRm ?? v.price / 100} onChange={(e) => setV(i, 'priceRm', e.target.value)} /></td>
                    <td><input type="number" min="0" step="1" value={v.stock} onChange={(e) => setV(i, 'stock', e.target.value)} /></td>
                    <td><input type="checkbox" checked={v.active} onChange={(e) => setV(i, 'active', e.target.checked)} /></td>
                    <td><button type="button" className="link-btn small" onClick={() => setP((x) => ({ ...x, variants: x.variants.filter((_, j) => j !== i) }))}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" className="link-btn small" onClick={() => setP((x) => ({ ...x, variants: [...x.variants, { size: '', price: 0, stock: 0, active: true }] }))}>+ Add size</button>
          </div>

          <label className="check"><input type="checkbox" checked={p.featured} onChange={(e) => set('featured', e.target.checked)} /> Bestseller (shown on home page)</label>
          <label className="check"><input type="checkbox" checked={p.active} onChange={(e) => set('active', e.target.checked)} /> Visible in shop</label>
          <label className="field half"><span>Display order</span><input type="number" value={p.sort} onChange={(e) => set('sort', e.target.value)} /></label>
        </div>
        {err && <p className="alert">{err}</p>}
        <div className="a-modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save product'}</button>
        </div>
      </form>
    </div>
  );
}

export default function Products() {
  const { call } = useAdmin();
  const { data, setData, error, reload } = useLoad('/admin/products');
  const [editing, setEditing] = useState(null);
  const [stockMsg, setStockMsg] = useState('');
  useEffect(() => { reload(); }, [reload]);

  // quick inline stock edit
  async function setStock(product, variantId, stock) {
    const n = Math.max(0, Math.round(Number(stock)));
    if (!Number.isFinite(n)) return;
    const body = { ...product, variants: product.variants.map((v) => (v.id === variantId ? { ...v, stock: n } : v)) };
    try {
      const saved = await call(`/admin/products/${product.id}`, { method: 'PUT', body });
      setData((list) => list.map((p) => (p.id === saved.id ? saved : p)));
      setStockMsg(`Saved ${product.name}`); setTimeout(() => setStockMsg(''), 1500);
    } catch (e) { setStockMsg(e.message); }
  }

  return (
    <>
      <div className="a-head">
        <h1>Products & stock</h1>
        <button className="btn btn-sm" onClick={() => setEditing(BLANK)}>+ New product</button>
      </div>
      <p className="muted small">Type a new stock number and press Enter or click away to save it. Stock goes down automatically when an order is placed and back up if you cancel it. {stockMsg && <b className="ok">{stockMsg}</b>}</p>
      {error && <p className="alert">{error}</p>}
      <div className="a-panel flush">
        {!data ? <p className="muted pad">Loading…</p> : (
          <table className="a-table">
            <thead><tr><th /><th>Product</th>{['10ml', '30ml'].map((s) => <th key={s}>{s} stock</th>)}<th>Price</th><th /></tr></thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id} className={p.active ? '' : 'dim'}>
                  <td><img className="a-thumb" src={p.cutout || p.image} alt="" /></td>
                  <td><strong>{p.name}</strong>{p.featured && <span className="pill s-processing">bestseller</span>}{!p.active && <span className="pill s-cancelled">hidden</span>}<div className="muted small">{p.gender} · {p.family}</div></td>
                  {['10ml', '30ml'].map((s) => {
                    const v = p.variants.find((x) => x.size === s && x.active);
                    return (
                      <td key={s}>{v ? (
                        <input className={`stock-in${v.stock <= 3 ? ' low' : ''}`} type="number" min="0" defaultValue={v.stock} key={v.stock}
                          onBlur={(e) => Number(e.target.value) !== v.stock && setStock(p, v.id, e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} aria-label={`${p.name} ${s} stock`} />
                      ) : <span className="muted">—</span>}</td>
                    );
                  })}
                  <td className="muted small">{p.variants.filter((v) => v.active).map((v) => `${v.size} ${rm(v.price)}`).join(' · ')}</td>
                  <td><button className="link-btn" onClick={() => setEditing(p)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editing && <Editor product={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </>
  );
}
