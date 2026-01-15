// SHOWROOM MARKET - Shared Header & Footer Loader

// Load external HTML files
async function loadHTML(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return await response.text();
  } catch (error) {
    console.error('Error loading HTML:', error);
    return '';
  }
}

// Insert header and footer when DOM is ready
document.addEventListener('DOMContentLoaded', async function() {
  // Load and insert header
  const headerHTML = await loadHTML('shared/header.html');
  if (headerHTML) {
    document.body.insertAdjacentHTML('afterbegin', headerHTML);
  }
  
  // Load and insert footer
  const footerHTML = await loadHTML('shared/footer.html');
  if (footerHTML) {
    document.body.insertAdjacentHTML('beforeend', footerHTML);
  }
  
  // Mobile menu toggle functionality (if needed)
  const menuToggle = document.getElementById('menuToggle');
  const mainNav = document.getElementById('mainNav');
  
  if (menuToggle && mainNav) {
    menuToggle.addEventListener('click', function() {
      this.classList.toggle('active');
      mainNav.classList.toggle('active');
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
  const navLinks = document.querySelectorAll('nav a, .topnav a');
  
  navLinks.forEach(link => {
    const linkPage = link.getAttribute('href');
    if (linkPage === currentPage || linkPage === './' + currentPage) {
      link.style.color = '#00b85c';
    }
  });
});
