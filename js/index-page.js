// Analytics CTA tracking — delegated listener replaces inline onclick handlers.
// Elements carry data-cta-location and optionally data-tier-hint attributes.
document.addEventListener('click', function(e) {
  const el = e.target.closest('[data-cta-location]');
  if (!el) return;

  // Analytics (non-blocking — skipped gracefully if library not loaded)
  if (window.Analytics) {
    const props = { cta_location: el.dataset.ctaLocation };
    if (el.dataset.tierHint) props.tier_hint = el.dataset.tierHint;
    Analytics.track('landing_cta_clicked', props);
  }

  // Visual click feedback — text changes just before browser navigates
  if (el.dataset.ctaLocation === 'pricing' && el.tagName === 'A') {
    el.textContent = 'Upload CV Dulu →';
    el.style.opacity = '0.7';
  }
});
