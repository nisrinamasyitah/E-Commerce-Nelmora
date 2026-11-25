import { useEffect, useState } from 'react';
import { useAdmin, useLoad } from './Admin';

const SOURCES = ['Instagram', 'WhatsApp', 'TikTok', 'Shopee', 'Facebook', 'In person', 'Website'];
const today = () => new Date().toISOString().slice(0, 10);
const BLANK = { product_id: '', name: '', rating: 5, body: '', source: 'Instagram', reviewed_at: today(), published: true };
const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

export default function Reviews() {
  const { call } = useAdmin();
  const { data, error, reload } = useLoad('/admin/reviews');
  const { data: products } = useLoad('/admin/products');
  const [form, setForm] = useState(null); // null = closed, otherwise the review being added or edited
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { reload(); }, [reload]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  async function save(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const body = { ...form, product_id: form.product_id || null, published: !!form.published };
      await call(form.id ? `/admin/reviews/${form.id}` : '/admin/reviews', { method: form.id ? 'PUT' : 'POST', body });
      setForm(null);
      await reload();
    } catch (ex) { setErr(ex.message); }
    setBusy(false);
  }
  async function remove(r) {
    if (!confirm(`Delete the review from ${r.name}?`)) return;
    await call(`/admin/reviews/${r.id}`, { method: 'DELETE' });
    reload();
  }
  async function toggle(r) {
    await call(`/admin/reviews/${r.id}`, { method: 'PUT', body: { ...r, product_id: r.product_id, published: !r.published } });
    reload();
  }

  return (
    <>
      <div className="a-head">
        <h1>Reviews</h1>
        {!form && <button className="btn" onClick={() => { setErr(''); setForm({ ...BLANK }); }}>+ Add review</button>}
      </div>
      <p className="muted small" style={{ maxWidth: '60ch' }}>
        Add only real feedback from real customers, with their permission, and use first names only. Keep their own words, including Malay.
        Reviews appear on the scent page they belong to, and on the home page.
      </p>

      {form && (
        <form className="a-panel a-form" onSubmit={save}>
          <h2>{form.id ? 'Edit review' : 'New review'}</h2>
          <label className="field half"><span>Scent</span>
            <select value={form.product_id ?? ''} onChange={(e) => set('product_id', e.target.value)}>
              <option value="">Whole shop (no specific scent)</option>
              {products?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="field half"><span>Customer first name</span><input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength="60" /></label>
          <label className="field half"><span>Stars</span>
            <select value={form.rating} onChange={(e) => set('rating', Number(e.target.value))}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} {stars(n)}</option>)}<option value={0}>No stars (quote only)</option></select>
          </label>
          <label className="field half"><span>Where it came from</span>
            <select value={form.source} onChange={(e) => set('source', e.target.value)}><option value="">(not shown)</option>{SOURCES.map((s) => <option key={s}>{s}</option>)}</select>
          </label>
          <label className="field"><span>Review (their own words)</span><textarea rows="4" maxLength="1000" value={form.body} onChange={(e) => set('body', e.target.value)} /></label>
          <label className="field half"><span>Date they wrote it</span><input type="date" value={form.reviewed_at} onChange={(e) => set('reviewed_at', e.target.value)} /></label>
          <label className="check"><input type="checkbox" checked={!!form.published} onChange={(e) => set('published', e.target.checked)} /> Show on the website</label>
          {err && <p className="alert">{err}</p>}
          <div className="quick">
            <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save review'}</button>
            <button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      )}

      {error && <p className="alert">{error}</p>}
      <section className="a-panel flush">
        {!data ? <p className="muted pad">Loading…</p> : data.length === 0 ? <p className="muted pad">No reviews yet. Click “Add review” and paste in a real customer’s feedback.</p> : (
          <table className="a-table">
            <thead><tr><th>Customer</th><th>Scent</th><th>Review</th><th /></tr></thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id} className={r.published ? '' : 'dim'}>
                  <td><strong>{r.name}</strong>{r.rating > 0 && <div className="muted small">{stars(r.rating)}</div>}<div className="muted small">{r.reviewed_at}{r.source ? ` · ${r.source}` : ''}</div></td>
                  <td>{r.product_name || <span className="muted">Whole shop</span>}</td>
                  <td style={{ maxWidth: '46ch' }}>{r.body}</td>
                  <td className="num">
                    <button className="link-btn small" onClick={() => setForm({ ...r, product_id: r.product_id ?? '', published: !!r.published })}>Edit</button>{' · '}
                    <button className="link-btn small" onClick={() => toggle(r)}>{r.published ? 'Hide' : 'Show'}</button>{' · '}
                    <button className="link-btn small" onClick={() => remove(r)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
