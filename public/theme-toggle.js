(function () {
  'use strict';

  var KEY = 'dartsTheme';

  function getTheme() {
    return localStorage.getItem(KEY) === 'new' ? 'new' : 'default';
  }

  // Enable/disable the DevOps theme by toggling the media attribute of its
  // <style id="theme-devops"> element. "not all" = inactive, "all" = active.
  function apply(theme) {
    var el = document.getElementById('theme-devops');
    if (el) el.media = theme === 'new' ? 'all' : 'not all';
  }

  // Apply as early as possible (this script runs in <head>, right after the
  // theme <style>), so default users never see a flash of the DevOps theme.
  apply(getTheme());

  function build() {
    apply(getTheme());
    if (document.getElementById('theme-switcher')) return;

    var style = document.createElement('style');
    style.textContent =
      '#theme-switcher{position:fixed;left:12px;bottom:12px;z-index:99999;display:flex;align-items:center;' +
      'gap:8px;background:rgba(15,17,26,0.9);border:1px solid rgba(255,255,255,0.14);border-radius:10px;' +
      'padding:7px 11px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#c9d1d9;' +
      'box-shadow:0 6px 20px rgba(0,0,0,0.45);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}' +
      '#theme-switcher label{font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#8b949e}' +
      '#theme-switcher select{background:#0d1117;color:#e6edf3;border:1px solid rgba(255,255,255,0.18);' +
      'border-radius:7px;padding:4px 8px;font-size:12px;font-family:inherit;cursor:pointer;outline:none}' +
      '#theme-switcher select:focus{border-color:#58a6ff}';
    document.head.appendChild(style);

    var wrap = document.createElement('div');
    wrap.id = 'theme-switcher';
    wrap.innerHTML =
      '<label for="theme-select">Theme</label>' +
      '<select id="theme-select">' +
      '<option value="default">Default</option>' +
      '<option value="new">New (DevOps)</option>' +
      '</select>';
    document.body.appendChild(wrap);

    var sel = wrap.querySelector('#theme-select');
    sel.value = getTheme();
    sel.addEventListener('change', function () {
      var value = sel.value === 'new' ? 'new' : 'default';
      localStorage.setItem(KEY, value);
      apply(value);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
