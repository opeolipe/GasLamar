import { useState, useEffect } from 'react';
import { TRUST_MESSAGES } from '@/lib/analysisUtils';

export default function TrustRotator() {
  const [idx,     setIdx]     = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const id = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIdx(i => (i + 1) % TRUST_MESSAGES.length);
        setVisible(true);
      }, 150);
    }, 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className="text-center text-[0.78rem] text-slate-400 my-5 transition-opacity duration-150 px-2"
      style={{ opacity: visible ? 1 : 0 }}
    >
      {TRUST_MESSAGES[idx]}
    </div>
  );
}
