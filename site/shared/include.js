(function(){
  const headerMount = document.getElementById('bb-header');
  const footerMount = document.getElementById('bb-footer');

  const path = (location.pathname || '/').replace(/\/$/, '') || '/';
  const norm = (p) => (p || '/').replace(/\/$/, '') || '/';
  const isActive = (href) => {
    const h = norm(href);
    return norm(path) === h || (h !== '/' && norm(path).startsWith(h));
  };

  const headerHTML = `
    <header>
      <nav>
        <a class="brand" href="/" aria-label="Trade Displays Home">
          <span class="brand-mark" aria-hidden="true">T</span>
          <span class="brand-text">
            <span class="brand-name">TRADE <span style="color: var(--accent);">DISPLAYS</span></span>
            <span class="brand-sub">by Bargain Bond</span>
          </span>
        </a>

        <div class="searchbar" style="flex:1; max-width: 520px;">
          <input id="bbSiteSearch" class="input" type="search" placeholder="Search for floor models..." autocomplete="off" style="height: 42px; border-radius: 999px; padding: 0 16px;" />
        </div>

        <div class="navlinks" role="navigation" aria-label="Primary">
          <a href="/market" class="${isActive('/market') ? 'active' : ''}">Browse</a>
          <a href="/how-it-works" class="${isActive('/how-it-works') ? 'active' : ''}">How It Works</a>
          <a href="/for-showrooms" class="${isActive('/for-showrooms') ? 'active' : ''}">List Items</a>
        </div>

        <div class="navcta">
          <a class="btn btn-secondary btn-pill" href="/sign-in">Sign In</a>
          <a class="btn btn-secondary btn-pill" href="/create-account">Create Account</a>
          <a class="btn btn-primary btn-pill" href="/pilot">Start 30-Day Pilot</a>
        </div>
      </nav>
    </header>
  `;

  const footerHTML = `
    <footer>
      <div class="footer-content">
        <div>
          <div class="footer-brand">TRADE DISPLAYS</div>
          <p class="footer-tagline">The verified marketplace for showroom floor models. Pickup-only. Escrow protected. Built for clean trades.</p>
        </div>
        <div class="footer-column">
          <h4>Marketplace</h4>
          <a href="/market">Browse Listings</a>
          <a href="/list-a-display">List an Item</a>
          <a href="/how-it-works">How It Works</a>
          <a href="/pilot">Pricing</a>
        </div>
        <div class="footer-column">
          <h4>Company</h4>
          <a href="/about">About</a>
          <a href="/for-showrooms">For Showrooms</a>
          <a href="/contact">Contact</a>
        </div>
        <div class="footer-column">
          <h4>Support</h4>
          <a href="/faq">Help Center</a>
          <a href="/trust">Trust & Safety</a>
          <a href="/terms">Terms</a>
        </div>
      </div>
      <div class="footer-bottom">
        <div>© ${new Date().getFullYear()} Trade Displays by Bargain Bond. All rights reserved.</div>
        <div class="footer-legal">
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="/contact">Contact</a>
        </div>
      </div>
    </footer>
  `;

  if(headerMount) headerMount.innerHTML = headerHTML;
  if(footerMount) footerMount.innerHTML = footerHTML;

  // Lightweight site search
  const input = document.getElementById('bbSiteSearch');
  if(input){
    const url = new URL(location.href);
    const preset = url.searchParams.get('q') || '';
    if(preset) input.value = preset;

    const go = () => {
      const q = (input.value || '').trim();
      const dest = new URL(location.origin + '/market');
      if(q) dest.searchParams.set('q', q);
      
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
