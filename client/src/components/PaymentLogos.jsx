import { useId } from 'react';
import { ICON_PATHS } from './paymentIcons';

// "We accept" strip. `methods` is the list from the server (/api/config -> paymentLogos), so a logo only
// appears for something the shop can really take. Each tile is 62x40.
function Tile({ name, bg = '#fff', border = true, children }) {
  return (
    <li className="pay-logo" style={{ background: bg, borderColor: border ? undefined : 'transparent' }} role="img" aria-label={name} title={name}>
      <svg viewBox="0 0 62 40" width="100%" height="100%" aria-hidden="true">{children}</svg>
    </li>
  );
}

// single-colour brand mark centred in the tile; `w` is its width inside the 62-wide tile
const Mark = ({ d, w, fill, h = w }) => (
  <svg x={(62 - w) / 2} y={(40 - h) / 2} width={w} height={h} viewBox="0 0 24 24"><path d={d} fill={fill} /></svg>
);

function Mastercard() {
  const id = useId();
  return (
    <Tile name="Mastercard" bg="#1a1a1a" border={false}>
      <defs><clipPath id={id}><circle cx="25" cy="20" r="10" /></clipPath></defs>
      <circle cx="25" cy="20" r="10" fill="#eb001b" />
      <circle cx="37" cy="20" r="10" fill="#f79e1b" />
      <circle cx="37" cy="20" r="10" fill="#ff5f00" clipPath={`url(#${id})`} />
    </Tile>
  );
}

const LOGO = {
  visa: () => <Tile name="Visa" bg="#1434cb" border={false}><Mark d={ICON_PATHS.visa} w={44} h={44} fill="#fff" /></Tile>,
  mastercard: Mastercard,
  amex: () => <Tile name="American Express" bg="#016fd0" border={false}><Mark d={ICON_PATHS.amex} w={42} h={42} fill="#fff" /></Tile>,
  applepay: () => <Tile name="Apple Pay" bg="#fff"><Mark d={ICON_PATHS.applepay} w={46} h={46} fill="#111" /></Tile>,
  googlepay: () => <Tile name="Google Pay"><Mark d={ICON_PATHS.googlepay} w={42} h={42} fill="#3c4043" /></Tile>,
  fpx: () => (
    <Tile name="FPX">
      <path d="M12 13l-5 7 5 7" fill="none" stroke="#1b2c7a" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <text x="35" y="26" textAnchor="middle" fontSize="15" fontWeight="800" fontFamily="Jost, Arial, sans-serif" fill="#1b2c7a" letterSpacing=".5">FPX</text>
    </Tile>
  ),
  duitnow: () => (
    <Tile name="DuitNow">
      <circle cx="31" cy="14" r="7.5" fill="#ed2e67" />
      <text x="31" y="18" textAnchor="middle" fontSize="11" fontWeight="800" fontFamily="Jost, Arial, sans-serif" fill="#fff">D</text>
      <text x="31" y="33" textAnchor="middle" fontSize="8.5" fontWeight="700" fontFamily="Jost, Arial, sans-serif" fill="#3b3b3b">DuitNow</text>
    </Tile>
  ),
  grabpay: () => <Tile name="GrabPay" bg="#00b14f" border={false}><Mark d={ICON_PATHS.grab} w={44} h={44} fill="#fff" /></Tile>,
};

export default function PaymentLogos({ methods }) {
  const list = (methods || []).filter((m) => LOGO[m]);
  if (!list.length) return <span className="pay-text">Bank transfer</span>;
  return (
    <ul className="pay-logos" aria-label="Accepted payment methods">
      {list.map((m) => { const L = LOGO[m]; return <L key={m} />; })}
    </ul>
  );
}
