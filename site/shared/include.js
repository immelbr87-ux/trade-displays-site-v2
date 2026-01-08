(function () {
  async function inject(id, url) {
    var el = document.getElementById(id);
    if (!el) return;
    try {
      var res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      el.innerHTML = await res.text();
    } catch (e) {
      // Fail quietly — page still renders without global chrome.
      console.warn('Shared include failed:', url, e);
    }
  }
  inject('bb-header', '/shared/header.html');
  inject('bb-footer', '/shared/footer.html');
})();