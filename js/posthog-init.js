// PostHog Analytics — stub + init. array.js is loaded via an explicit <script src> in each
// HTML file (see the <head> of index/upload/hasil/download/analyzing.html). Loading it there
// as a static tag means the browser never creates a dynamic script element, eliminating the
// source of the "inline script" CSP violation. The stub below queues method calls until
// array.js executes and replaces it with the real implementation.
!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]);t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}var u=e;for(a!==void 0?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+" (stub)"},o="init be q capture identify alias people.set people.set_once set_config unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled onFeatureFlags getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures getActiveMatchingSurveys getSurveys onSessionId setPersonPropertiesForFlags".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
posthog.init('phc_DmeD8QdyUMMGwZ4GUKnDurFXrquR3APqUKrcEuDbgy3X',{
  api_host:'https://eu.i.posthog.com',
  person_profiles:'identified_only',
  defaults:'2026-01-30',
  disable_surveys:true,
  disable_web_experiments:true,
  disable_session_recording:true,
  // Prevent PostHog from injecting dynamic <script> elements (would violate CSP script-src).
  // All PostHog JS is loaded via the static <script src="…/array.js"> tag instead.
  disable_external_dependency_loading:true,
  // Strip sensitive URL params (session token, email token) from all captured URLs.
  sanitize_properties: function(props) {
    var STRIP = ['session', 'token'];
    function scrub(url) {
      if (!url) return url;
      try {
        var u = new URL(url);
        var changed = false;
        STRIP.forEach(function(p) { if (u.searchParams.has(p)) { u.searchParams.delete(p); changed = true; } });
        return changed ? u.toString() : url;
      } catch(e) { return url; }
    }
    if (props.$current_url) props.$current_url = scrub(props.$current_url);
    if (props.$referrer)    props.$referrer    = scrub(props.$referrer);
    if (props.$initial_current_url) props.$initial_current_url = scrub(props.$initial_current_url);
    return props;
  },
});

// UTM capture — runs once per page load.
// If UTM params are in the URL (landing page), persist them to sessionStorage so they
// survive navigation to upload.html → hasil.html → download.html.
// Registers them as PostHog super properties so every subsequent event carries attribution.
(function() {
  var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
  var STORAGE_KEY = 'gaslamar_utm';
  var params = new URLSearchParams(location.search);

  // Pick up fresh UTMs from URL (landing hit)
  var fresh = {};
  UTM_KEYS.forEach(function(k) { var v = params.get(k); if (v) fresh[k] = v; });

  // Merge with any UTMs already stored for this session (first-touch wins)
  var stored = {};
  try { stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}'); } catch(e) {}

  // First-touch: only write to sessionStorage if we don't have anything yet
  if (Object.keys(fresh).length && !Object.keys(stored).length) {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(fresh)); } catch(e) {}
    stored = fresh;
  }

  if (Object.keys(stored).length) {
    posthog.register(stored);
  }
})();
