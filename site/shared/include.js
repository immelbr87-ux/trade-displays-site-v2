// Trade Displays - Shared Header & Footer Components

// Header HTML
const headerHTML = `
<header>
  <nav style="max-width: 1400px; margin: 0 auto; padding: 0 32px; height: 72px; display: flex; justify-content: space-between; align-items: center;">
    <a href="index.html" class="logo">SHOWROOM <span style="color: var(--accent);">MARKET</span></a>
    
    <button class="menu-toggle" id="menuToggle" aria-label="Toggle menu">
      <span></span>
      <span></span>
      <span></span>
    </button>
    
    <div class="nav-links" style="display: flex; gap: 32px; align-items: center;">
      <a href="market.html">Browse</a>
      <a href="how-it-works.html">How It Works</a>
      <a href="pilot-program.html">List Items</a>
    </div>
    
    <div class="nav-cta" style="display: flex; gap: 12px; align-items: center;">
      <a href="#signin" class="btn btn-secondary">Sign In</a>
      <a href="#signup" class="btn btn-secondary">Create Account</a>
      <a href="pilot-program.html" class="btn btn-primary">Start 30-Day Pilot</a>
    </div>
  </nav>
</header>
`;

// Footer HTML
const footerHTML = `
<footer style="background: var(--bg-secondary); border-top: 1px solid var(--border); padding: 60px 32px 40px;">
  <div class="container">
    <div class="footer-content">
      <div>
        <div class="footer-brand">SHOWROOM MARKET</div>
        <p class="footer-tagline">Premium Kitchen & Bath Floor Models. Powered by Bargain Bond. B2B marketplace connecting showroom managers with verified trade buyers.</p>
      </div>
      
      <div class="footer-column">
        <h4>Marketplace</h4>
        <ul class="footer-links">
          <li><a href="market.html">Browse Listings</a></li>
          <li><a href="pilot-program.html">List an Item</a></li>
          <li><a href="how-it-works.html">How It Works</a></li>
          <li><a href="pilot-program.html">Pricing</a></li>
        </ul>
      </div>
      
      <div class="footer-column">
        <h4>Company</h4>
        <ul class="footer-links">
          <li><a href="about.html">About</a></li>
          <li><a href="contact.html">Contact</a></li>
        </ul>
      </div>
      
      <div class="footer-column">
        <h4>Support</h4>
        <ul class="footer-links">
          <li><a href="help.html">Help Center</a></li>
          <li><a href="brand-compliance.html">Guidelines</a></li>
          <li><a href="trust-brand-safety.html">Trust & Safety</a></li>
          <li><a href="faq.html">FAQ</a></li>
        </ul>
      </div>
    </div>
    
    <div class="footer-bottom">
      <div>© ${new Date().getFullYear()} SHOWROOM MARKET. Powered by Bargain Bond. All rights reserved.</div>
      <div class="footer-legal">
        <a href="terms.html">Privacy</a>
        <a href="terms.html">Terms</a>
        <a href="terms.html">Cookies</a>
      </div>
    </div>
  </div>
</footer>
`;

// Insert header and footer when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  // Insert header at the beginning of body
  document.body.insertAdjacentHTML('afterbegin', headerHTML);
  
  // Insert footer at the end of body
  document.body.insertAdjacentHTML('beforeend', footerHTML);
  
  // Mobile menu toggle functionality
  const menuToggle = document.getElementById('menuToggle');
  const mainNav = document.getElementById('mainNav');
  
  if (menuToggle && mainNav) {
    menuToggle.addEventListener('click', function() {
      this.classList.toggle('active');
      mainNav.classList.toggle('active');
      
      // Prevent body scroll when menu is open
      document.body.style.overflow = mainNav.classList.contains('active') ? 'hidden' : '';
    });
    
    // Close menu when clicking outside
    document.addEventListener('click', function(e) {
      if (!menuToggle.contains(e.target) && !mainNav.contains(e.target)) {
        menuToggle.classList.remove('active');
        mainNav.classList.remove('active');
        document.body.style.overflow = '';
      }
    });
    
    // Close menu when clicking a link
    const navLinks = mainNav.querySelectorAll('a');
    navLinks.forEach(link => {
      link.addEventListener('click', function() {
        menuToggle.classList.remove('active');
        mainNav.classList.remove('active');
        document.body.style.overflow = '';
      });
    });
  }
  
  // Highlight active page in navigation
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  const navLinks = document.querySelectorAll('nav a');
  
  navLinks.forEach(link => {
    const linkPage = link.getAttribute('href');
    if (linkPage === currentPage) {
      link.style.color = 'var(--accent)';
    }
  });
});
