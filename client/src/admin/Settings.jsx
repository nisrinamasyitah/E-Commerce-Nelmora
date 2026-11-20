import { useEffect, useState } from 'react';
import { useAdmin, useLoad } from './Admin';

const MONEY = ['shipping_west', 'shipping_east', 'free_shipping_min', 'welcome_discount', 'welcome_min_spend'];

export default function Settings() {
  const { call, token } = useAdmin();
  const { data, error, reload } = useLoad('/admin/settings');
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    if (data) setForm(Object.fromEntries(Object.entries(data).map(([k, v]) => [k, MONEY.includes(k) ? v / 100 : v])));
  }, [data]);

  async function save(e) {
    e.preventDefault();
    setMsg('');
    try {
      const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, MONEY.includes(k) ? Math.round(Number(v) * 100) : v]));
      await call('/admin/settings', { method: 'PUT', body });
      setMsg('Saved'); reload();
    } catch (er) { setMsg(er.message); }
  }

  async function backup() {
    const res = await fetch('/api/admin/backup', { headers: { Authorization: `Bearer ${token}` } });
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement('a'), { href: url, download: `nelmora-shop-${new Date().toISOString().slice(0, 10)}.json` }).click();
    URL.revokeObjectURL(url);
  }

  if (error) return <p className="alert">{error}</p>;
  if (!form) return <p className="muted">Loading…</p>;
  const F = (k, label, props = {}) => (
    <label className={`field${props.half ? ' half' : ''}`}><span>{label}</span>
      <input value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} {...props} half={undefined} />
    </label>
  );

  return (
    <>
      <h1>Settings</h1>
      <form className="a-panel a-form settings" onSubmit={save}>
        <h2>Shipping (RM)</h2>
        {F('shipping_west', 'Peninsular Malaysia', { type: 'number', step: '0.01', min: 0, half: true })}
        {F('shipping_east', 'Sabah, Sarawak, Labuan', { type: 'number', step: '0.01', min: 0, half: true })}
        {F('free_shipping_min', 'Free shipping from (0 = never free)', { type: 'number', step: '0.01', min: 0 })}

        <h2>Welcome offer (popup, RM)</h2>
        {F('welcome_discount', 'RM off the first order (0 = turn the offer and popup off)', { type: 'number', step: '0.01', min: 0, half: true })}
        {F('welcome_min_spend', 'Minimum order for the offer', { type: 'number', step: '0.01', min: 0, half: true })}

        <h2>Bank transfer details (shown to customers)</h2>
        {F('bank_name', 'Bank', { half: true })}
        {F('bank_account_name', 'Account name', { half: true })}
        {F('bank_account_no', 'Account number')}

        <h2>Contact</h2>
        {F('whatsapp', 'WhatsApp number (with country code, e.g. 60123456789)', { half: true })}
        {F('contact_email', 'Email', { half: true, type: 'email' })}
        {F('instagram', 'Instagram username', { half: true })}
        {F('announcement', 'Announcement bar (leave empty to hide)')}

        {msg && <p className={msg === 'Saved' ? 'notice' : 'alert'}>{msg}</p>}
        <button className="btn">Save settings</button>
      </form>

      <section className="a-panel">
        <h2>Backup</h2>
        <p className="muted">Download a copy of all shop data (products, orders, messages, subscribers) as a file. Keep one somewhere safe every week.</p>
        <button className="btn btn-ghost" onClick={backup}>Download backup</button>
      </section>
    </>
  );
}
