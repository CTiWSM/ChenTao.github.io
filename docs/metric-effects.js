(function () {
  'use strict';

  const chips = Array.from(document.querySelectorAll('.venue-chip[data-effect="premium"]'));
  if (!chips.length) return;

  function setMotion(chip, running) {
    const motion = running ? 'running' : 'paused';
    if (chip.getAttribute('data-motion') !== motion) chip.setAttribute('data-motion', motion);
  }

  chips.forEach(function (chip) { setMotion(chip, false); });
  if (typeof window.IntersectionObserver !== 'function' || typeof window.matchMedia !== 'function') return;

  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const intersections = new Map(chips.map(function (chip) { return [chip, false]; }));

  function refresh() {
    const allowed = !document.hidden && !preference.matches;
    chips.forEach(function (chip) { setMotion(chip, allowed && intersections.get(chip)); });
  }

  if (typeof preference.addEventListener === 'function') {
    preference.addEventListener('change', refresh);
  } else if (typeof preference.addListener === 'function') {
    preference.addListener(refresh);
  } else {
    return;
  }

  const observer = new window.IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (intersections.has(entry.target)) {
        intersections.set(entry.target, entry.isIntersecting && entry.intersectionRatio > 0);
      }
    });
    refresh();
  }, {
    // A positive threshold also detects moving beyond an initial zero-area edge contact.
    threshold: [0, Number.EPSILON]
  });

  document.addEventListener('visibilitychange', refresh);
  chips.forEach(function (chip) { observer.observe(chip); });
}());
