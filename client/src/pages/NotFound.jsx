import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="container narrow center section">
      <p className="script big">Oops</p>
      <h1>We couldn’t find that page.</h1>
      <Link to="/shop" className="btn">Browse fragrances</Link>
    </div>
  );
}
