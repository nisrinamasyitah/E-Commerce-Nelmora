import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { StoreProvider } from './store';
import Layout from './components/Layout';
import Home from './pages/Home';
import Shop from './pages/Shop';
import Product from './pages/Product';
import Checkout from './pages/Checkout';
import Order from './pages/Order';
import About from './pages/About';
import Contact from './pages/Contact';
import NotFound from './pages/NotFound';
import Finder from './pages/Finder';
import Policies from './pages/Policies';
import './styles.css';

const Admin = lazy(() => import('./admin/Admin'));

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/admin/*" element={<Suspense fallback={<div className="admin-loading">Loading…</div>}><Admin /></Suspense>} />
        <Route element={<StoreProvider><Layout /></StoreProvider>}>
          <Route index element={<Home />} />
          <Route path="shop" element={<Shop />} />
          <Route path="shop/:slug" element={<Product />} />
          <Route path="checkout" element={<Checkout />} />
          <Route path="order" element={<Order />} />
          <Route path="order/:code" element={<Order />} />
          <Route path="about" element={<About />} />
          <Route path="finder" element={<Finder />} />
          <Route path="policies/:slug" element={<Policies />} />
          <Route path="contact" element={<Contact />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
