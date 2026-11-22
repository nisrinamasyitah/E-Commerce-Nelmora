import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store';
import { MOODS, inMood, useTitle, rm } from '../lib';

const QUESTIONS = [
  { key: 'who', q: 'Who is this fragrance for?', options: [['Women', 'For her'], ['Men', 'For him'], ['any', 'Surprise me']] },
  { key: 'mood', q: 'Which feels most like you?', options: MOODS.map((m) => [m.key, m.label, m.blurb]) },
  { key: 'when', q: 'When will you wear it most?', options: [['day', 'Daytime', 'Office, errands, sunshine'], ['night', 'Evenings', 'Dinners, dates, nights out'], ['always', 'Every day', 'One scent for everything']] },
];

function score(p, a) {
  let s = 0;
  if (a.who === 'any' || p.gender === a.who || p.gender === 'Unisex') s += 3; else s -= 10;
  if (inMood(p, a.mood)) s += 4;
  if (a.when === 'day' && (inMood(p, 'fresh') || inMood(p, 'fruity'))) s += 2;
  if (a.when === 'night' && (inMood(p, 'woody') || inMood(p, 'sweet'))) s += 2;
  if (p.featured) s += 1;
  if (p.variants.every((v) => !v.inStock)) s -= 5;
  return s;
}

export default function Finder() {
  useTitle('Scent Finder', 'Not sure which Nelmora scent to pick? Answer a few quick questions and find your perfect eau de parfum.');
  const { products, add } = useStore();
  const [answers, setAnswers] = useState({});
  const step = QUESTIONS.findIndex((q) => !answers[q.key]);
  const done = step === -1;
  const results = done && products ? [...products].sort((a, b) => score(b, answers) - score(a, answers)).slice(0, 3) : [];

  return (
    <div className="finder">
      <div className="container narrow">
        <header className="center finder-head">
          <p className="eyebrow">Scent Finder</p>
          <h1>{done ? 'Your Nelmora matches' : 'Find your signature'}</h1>
          {!done && <div className="finder-progress" aria-label={`Question ${step + 1} of 3`}>{QUESTIONS.map((q, i) => <span key={q.key} className={i <= step ? 'on' : ''} />)}</div>}
        </header>

        {!done && (
          <div className="finder-q" key={step}>
            <h2>{QUESTIONS[step].q}</h2>
            <div className={`finder-opts n${QUESTIONS[step].options.length}`}>
              {QUESTIONS[step].options.map(([v, label, sub]) => (
                <button key={v} onClick={() => setAnswers((a) => ({ ...a, [QUESTIONS[step].key]: v }))}>
                  <strong>{label}</strong>{sub && <span>{sub}</span>}
                </button>
              ))}
            </div>
            {step > 0 && <button className="link-btn" onClick={() => setAnswers((a) => { const n = { ...a }; delete n[QUESTIONS[step - 1].key]; return n; })}>← Back</button>}
          </div>
        )}
      </div>

      {done && (
        <div className="container finder-results">
          {results.map((p, i) => {
            const v = [...p.variants].reverse().find((x) => x.inStock);
            return (
              <article key={p.id} className={`match${i === 0 ? ' top' : ''}`}>
                {i === 0 && <span className="match-badge">Best match</span>}
                <Link to={`/shop/${p.slug}`} className="match-media"><img src={p.cutout || p.image} alt={p.name} /></Link>
                <p className="eyebrow">{p.family}</p>
                <h3><Link to={`/shop/${p.slug}`}>{p.name}</Link></h3>
                <p className="muted">{p.tagline}</p>
                <p className="match-notes">{p.notes}</p>
                <div className="match-actions">
                  {v && <button className="btn btn-sm" onClick={() => add({ variantId: v.id, name: p.name, size: v.size, price: v.price, image: p.cutout || p.image, slug: p.slug })}>Add {v.size} · {rm(v.price)}</button>}
                  <Link to={`/shop/${p.slug}`} className="link-arrow">Details</Link>
                </div>
              </article>
            );
          })}
          <div className="center finder-again">
            <p className="muted">Not quite right? Try a 10ml of each to discover your favourite.</p>
            <button className="btn btn-ghost" onClick={() => setAnswers({})}>Start again</button>
          </div>
        </div>
      )}
    </div>
  );
}
