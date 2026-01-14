// Trade Displays - Shared Header & Footer Components

// Header HTML
const headerHTML = `
<header>
  <div class="header-container">
    <a href="index.html" class="logo">TRADE <span style="color: var(--accent);">DISPLAYS</span></a>
    
    <button class="menu-toggle" id="menuToggle" aria-label="Toggle menu">
      <span></span>
      <span></span>
      <span></span>
    </button>
    
    <nav id="mainNav">
      <a href="market.html">Browse Displays</a>
      <a href="how-it-works.html">How It Works</a>
      <a href="pilot-program.html">Sell Your Display</a>
      <a href="contact.html">Contact</a>
      <a href="pilot-program.html" class="nav-cta">Join Pilot Program</a>
    </nav>
  </div>
</header>
`;

// Footer HTML
const footerHTML = `
<footer>
  <div class="container">
    <div class="footer-content">
      <div class="footer-section">
        <h4>TRADE DISPLAYS</h4>
        <p style="color: rgba(255, 255, 255, 0.7); margin-top: 1rem;">
          The premier marketplace for renting and selling trade show displays. 
          Buy, sell, and rent with confidence.
        </p>
      </div>
      
      <div class="footer-section">
        <h4>Marketplace</h4>
        <ul class="footer-links">
          <li><a href="market.html">Browse Displays</a></li>
          <li><a href="market.html?filter=buy">Buy Displays</a></li>
          <li><a href="market.html?filter=rent">Rent Displays</a></li>
          <li><a href="pilot-program.html">Sell Your Display</a></li>
        </ul>
      </div>
      
      <div class="footer-section">
        <h4>Learn More</h4>
        <ul class="footer-links">
          <li><a href="how-it-works.html">How It Works</a></li>
          <li><a href="pilot-program.html">Pilot Program</a></li>
          <li><a href="contact.html">Contact Us</a></li>
          <li><a href="faq.html">FAQ</a></li>
        </ul>
      </div>
      
      <div class="footer-section">
        <h4>Legal</h4>
        <ul class="footer-links">
          <li><a href="terms.html">Terms of Service</a></li>
          <li><a href="brand-compliance.html">Brand Compliance</a></li>
          <li><a href="condition-standards.html">Condition Standards</a></li>
        </ul>
      </div>
    </div>
    
    <div class="footer-bottom">
      <p>&copy; ${new Date().getFullYear()} Trade Displays. All rights reserved.</p>
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
