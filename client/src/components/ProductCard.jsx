import { Link } from 'react-router-dom';
import { useStore } from '../store';
import { rm } from '../lib';

export default function ProductCard({ product }) {
  const { add } = useStore();
  const prices = product.variants.map((v) => v.price);
  const from = prices.length ? Math.min(...prices) : 0;
  const soldOut = product.variants.every((v) => !v.inStock);
  const addVariant = (v) => add({ variantId: v.id, name: product.name, size: v.size, price: v.price, image: product.cutout || product.image, slug: product.slug });

  return (
    <article className="card">
      <div className="card-media">
        <Link to={`/shop/${product.slug}`} className="card-link" aria-label={product.name}>
          <img src={product.image} alt={`${product.name} eau de parfum`} loading="lazy" className="img-main" />
          {product.cutout && <span className="img-alt"><img src={product.cutout} alt="" loading="lazy" /></span>}
        </Link>
        {soldOut ? <span className="badge">Sold out</span> : product.featured && <span className="badge light">Bestseller</span>}
        {!soldOut && (
          <div className="quick-add" role="group" aria-label={`Quick add ${product.name}`}>
            {product.variants.map((v) => (
              <button key={v.id} disabled={!v.inStock} onClick={() => addVariant(v)}>
                <span>Add {v.size}</span><b>{v.inStock ? rm(v.price) : 'Sold out'}</b>
              </button>
            ))}
          </div>
        )}
      </div>
      <Link to={`/shop/${product.slug}`} className="card-body">
        <span className="card-family">{product.family}</span>
        <span className="card-name">{product.name}</span>
        <span className="card-notes">{product.notes}</span>
        <span className="card-price">From {rm(from)}</span>
      </Link>
    </article>
  );
}
