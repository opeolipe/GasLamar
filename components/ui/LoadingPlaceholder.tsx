export default function LoadingPlaceholder({ text = 'Memuat...' }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-slate-500">
      <div
        className="w-8 h-8 rounded-full border-2 border-blue-200 border-t-blue-600 mb-3"
        style={{ animation: 'spin 0.8s linear infinite' }}
      />
      <p className="text-sm">{text}</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
