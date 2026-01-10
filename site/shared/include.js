(function () {
  async function inject(id, url) {
    var el = document.getElementById(id);
    if (!el) return;
    try {
      var res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
      el.innerHTML = await res.text();
    } catch (e) {
      console.warn('Include failed:', url, e);
    }
  }
  inject('bb-header', '/shared/header.html');
  inject('bb-footer', '/shared/footer.html');
})();