// Analytics CTA tracking — delegated listener replaces inline onclick handlers.
// Elements carry data-cta-location and optionally data-tier-hint attributes.
document.addEventListener('click', function(e) {
  const el = e.target.closest('[data-cta-location]');
  if (!el || !window.Analytics) return;
  const props = { cta_location: el.dataset.ctaLocation };
  if (el.dataset.tierHint) props.tier_hint = el.dataset.tierHint;
  Analytics.track('landing_cta_clicked', props);
});
