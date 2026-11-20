import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { rm } from '../lib';
import { useLoad, fmtDate, StatusPill } from './Admin';

export default function Dashboard() {
  const { data, error, reload } = useLoad('/admin/summary');
  useEffect(() => { reload(); }, [reload]);
  if (error) return <p className="alert">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  return (
    <>
      <h1>Dashboard</h1>
      <div className="a-tiles">
        <div className="a-tile"><span>Today (paid)</span><strong>{rm(data.today.revenue)}</strong><em>{data.today.orders} orders</em></div>
        <div className="a-tile"><span>This month (paid)</span><strong>{rm(data.month.revenue)}</strong><em>{data.month.orders} orders</em></div>
        <Link to="/admin/orders?status=new" className="a-tile action"><span>Paid, to ship</span><strong>{data.toShip}</strong><em>new + processing</em></Link>
        <Link to="/admin/orders?status=new" className="a-tile"><span>Awaiting payment</span><strong>{data.awaitingPayment}</strong><em>check bank / WhatsApp</em></Link>
      </div>

      <div className="a-cols">
        <section className="a-panel">
          <div className="a-panel-head"><h2>Recent orders</h2><Link to="/admin/orders">All orders →</Link></div>
          {data.recent.length === 0 ? <p className="muted">No orders yet.</p> : (
            <table className="a-table">
              <tbody>
                {data.recent.map((o) => (
                  <tr key={o.id}>
                    <td><Link to={`/admin/orders/${o.id}`} className="mono">{o.code}</Link><div className="muted small">{fmtDate(o.created_at)}</div></td>
                    <td>{o.name}</td>
                    <td><StatusPill status={o.status} /> {o.payment_status !== 'paid' && <span className="pill s-unpaid">{o.payment_status}</span>}</td>
                    <td className="num">{rm(o.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <div>
          <section className="a-panel">
            <div className="a-panel-head"><h2>Low stock</h2><Link to="/admin/products">Manage →</Link></div>
            {data.lowStock.length === 0 ? <p className="muted">Everything is well stocked.</p> : (
              <ul className="a-list">{data.lowStock.map((s) => <li key={s.name + s.size}><span>{s.name} {s.size}</span><b className={s.stock === 0 ? 'neg' : ''}>{s.stock === 0 ? 'Sold out' : `${s.stock} left`}</b></li>)}</ul>
            )}
          </section>
          <section className="a-panel">
            <h2>Top sellers</h2>
            {data.topSellers.length === 0 ? <p className="muted">No paid sales yet.</p> : (
              <ul className="a-list">{data.topSellers.map((s) => <li key={s.name + s.size}><span>{s.name} {s.size}</span><b>{s.qty}</b></li>)}</ul>
            )}
          </section>
          {data.unreadMessages > 0 && <Link to="/admin/messages" className="notice block">{data.unreadMessages} new message(s) →</Link>}
        </div>
      </div>
    </>
  );
}
