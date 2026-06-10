// React wrapper for <proposal-studio>.
//
//   npm install proposal-studio
//
// React 19+ passes unknown props/events to custom elements natively. For React
// 18 and below, bind imperatively via a ref (shown here) — works on every
// React version.
import { useEffect, useRef } from 'react';
import 'proposal-studio'; // registers the <proposal-studio> element

export default function ProposalStudio({ value, onChange, onReady, style }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const handleChange = (e) => onChange && onChange(e.detail.html);
    const handleReady = () => onReady && onReady(el);

    el.addEventListener('change', handleChange);
    el.addEventListener('ready', handleReady);
    return () => {
      el.removeEventListener('change', handleChange);
      el.removeEventListener('ready', handleReady);
    };
  }, [onChange, onReady]);

  // Push controlled value into the element once it is ready.
  useEffect(() => {
    const el = ref.current;
    if (el && value != null) el.whenReady().then(() => el.setHtml(value));
  }, [value]);

  return <proposal-studio ref={ref} style={style} />;
}

// Usage:
//
//   import ProposalStudio from './ProposalStudio';
//
//   function App() {
//     const [html, setHtml] = useState('<h1>Edit me</h1>');
//     return (
//       <ProposalStudio
//         value={html}
//         onChange={setHtml}
//         onReady={() => console.log('ready')}
//         style={{ display: 'block', minHeight: 600 }}
//       />
//     );
//   }
