(function(){
  const headerMount = document.getElementById('bb-header');
  const footerMount = document.getElementById('bb-footer');

  const path = (location.pathname || '/').replace(/\/$/, '') || '/';
  const norm = (p) => (p || '/').replace(/\/$/, '') || '/';
  const isActive = (href) => {
    const h = norm(href);
    return norm(path) === h || (h !== '/' && norm(path).startsWith(h));
  };

  const nav = [
    { href: '/market', label: 'Market' },
    { href: '/for-showrooms', label: 'For Showrooms' },
    { href: '/how-it-works', label: 'How it works' },
    { href: '/trust', label: 'Trust & Brand Safety' },
    { href: '/faq', label: 'FAQ' },
  ];

  const headerHTML = `
    <div class="topbar">
      <div class="container topbar-inner">
        <a class="brand" href="/">
          <div class="logo" aria-hidden="true">B</div>
          <div>
            <div>Trade Displays</div>
            <small>by Bargain Bond</small>
          </div>
        </a>

        <div class="searchbar" style="flex:1; max-width: 520px;">
          <div class="searchicon">
            <input id="bbSiteSearch" class="input" type="search" placeholder="Search the market (title, brand, category)" autocomplete="off" />
          </div>
        </div>

        <div class="navlinks" role="navigation" aria-label="Primary">
          <a href="/market" class="${isActive('/market') ? 'active' : ''}">Market</a>
          <a href="/for-showrooms" class="${isActive('/for-showrooms') ? 'active' : ''}">For Showrooms</a>
          <a href="/how-it-works" class="${isActive('/how-it-works') ? 'active' : ''}">How it works</a>
          <a href="/trust" class="${isActive('/trust') ? 'active' : ''}">Trust</a>
          <a href="/faq" class="${isActive('/faq') ? 'active' : ''}">FAQ</a>
        </div>

        <div class="navcta">
          <a class="btn btn-pill" href="/list-a-display">List a Floor Model</a>
          <a class="btn btn-primary btn-pill" href="/pilot">Start a Pilot</a>
        </div>
      </div>
    </div>
  `;

  const footerHTML = `
    <div class="footer" style="margin-top: 46px; padding: 26px 0 46px; border-top: 1px solid var(--line2); background: rgba(255,255,255,.55);">
      <div class="container">
        <div class="footerbar">
          <a class="footer-brand" href="/">
            <div class="logo" aria-hidden="true">B</div>
            <div>
              <div style="font-weight:850;">Trade Displays</div>
              <div class="muted2 small">Pickup-only marketplace for showroom floor models</div>
            </div>
          </a>

          <div class="footer-nav">
            <a href="/market">Market</a>
            <a href="/for-showrooms">For Showrooms</a>
            <a href="/how-it-works">How it works</a>
            <a href="/trust">Trust & Brand Safety</a>
            <a href="/terms">Terms</a>
            <a href="/contact">Contact</a>
          </div>
        </div>

        <div class="hr"></div>
        <div class="small muted2" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between;">
          <div>© ${new Date().getFullYear()} Bargain Bond. Trade Displays is a pilot program.</div>
          <div>Safety Green is reserved for <strong>Verified</strong> and <strong>In Stock</strong> signals.</div>
        </div>
      </div>
    </div>
  `;

  if(headerMount) headerMount.innerHTML = headerHTML;
  if(footerMount) footerMount.innerHTML = footerHTML;

  // Lightweight site search:
  // - If you are on /market, it forwards the query into the market filter.
  // - Otherwise it routes to /market?q=...
  const input = document.getElementById('bbSiteSearch');
  if(input){
    const url = new URL(location.href);
    const preset = url.searchParams.get('q') || '';
    if(preset) input.value = preset;

    const go = () => {
      const q = (input.value || '').trim();
      const dest = new URL(location.origin + '/market');
      if(q) dest.searchParams.set('q', q);
      // If already on market, just update params without a full reload.
      if(norm(path) === '/market' || norm(path) === '/market.html'){
        history.replaceState({}, '', dest.pathname + dest.search);
        window.dispatchEvent(new CustomEvent('bb:search', { detail: { q } }));
      } else {
        location.href = dest.pathname + dest.search;
      }
    };

    input.addEventListener('keydown', (e) => {
      if(e.key === 'Enter') go();
    });
  }
})();
