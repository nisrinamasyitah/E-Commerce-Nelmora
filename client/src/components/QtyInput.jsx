// In the bag min is 0 (going below 1 removes the item); on the product page min is 1.
export default function QtyInput({ value, onChange, min = 1, max = 99, small }) {
  return (
    <div className={`qty${small ? ' small' : ''}`}>
      <button type="button" aria-label="Decrease quantity" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}>−</button>
      <span aria-live="polite">{value}</span>
      <button type="button" aria-label="Increase quantity" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}>+</button>
    </div>
  );
}
