import { createContext, useCallback, useContext, useState } from 'react';
import { NavLink, Route, Routes, Link } from 'react-router-dom';
import { api } from '../lib';
import Dashboard from './Dashboard';
import Orders from './Orders';
import Products from './Products';
import Messages from './Messages';
import Settings from './Settings';
import './admin.css';

const KEY = 'nelmora.admin.token';
const AdminCtx = createContext(null);
export const useAdmin = () => useContext(AdminCtx);

function Login({ onToken }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try { const { token } = await api('/admin/login', { method: 'POST', body: { password } }); onToken(token); }
    catch (err) { setError(err.message); setBusy(false); }
  }
  return (
    <div className="a-login">
      <form onSubmit={submit}>
        <div className="a-brand">NELMORA <span>admin</span></div>
        <label className="field"><span>Password</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus /></label>
        {error && <p className="alert">{error}</p>}
        <button className="btn btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <Link to="/" className="muted small">← Back to shop</Link>
      </form>
    </div>
  );
}

export default function Admin() {
  const [token, setToken] = useState(() => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } });
  const save = (t) => { setToken(t); try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch { /* ignore */ } };
  const call = useCallback(async (path, opts = {}) => {
    try { return await api(path, { ...opts, token }); }
    catch (e) { if (e.status === 401) save(''); throw e; }
  }, [token]);

  if (!token) return <Login onToken={save} />;

  return (
    <AdminCtx.Provider value={{ call, token }}>
      <div className="a-shell">
        <aside className="a-side">
          <div className="a-brand">NELMORA <span>admin</span></div>
          <nav>
            <NavLink end to="/admin">Dashboard</NavLink>
            <NavLink to="/admin/orders">Orders</NavLink>
            <NavLink to="/admin/products">Products & stock</NavLink>
            <NavLink to="/admin/messages">Messages</NavLink>
            <NavLink to="/admin/settings">Settings</NavLink>
          </nav>
          <div className="a-side-foot">
            <a href="/" target="_blank" rel="noreferrer">View shop ↗</a>
            <button className="link-btn" onClick={() => save('')}>Sign out</button>
          </div>
        </aside>
        <main className="a-main">
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="orders" element={<Orders />} />
            <Route path="orders/:id" element={<Orders />} />
            <Route path="products" element={<Products />} />
            <Route path="messages" element={<Messages />} />
            <Route path="settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </AdminCtx.Provider>
  );
}

export function useLoad(path) {
  const { call } = useAdmin();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const reload = useCallback(() => {
    setError('');
    return call(path).then(setData).catch((e) => setError(e.message));
  }, [call, path]);
  return { data, setData, error, reload };
}

export const fmtDate = (s) => new Date(String(s).replace(' ', 'T') + 'Z').toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' });
export const StatusPill = ({ status }) => <span className={`pill s-${status}`}>{status}</span>;
