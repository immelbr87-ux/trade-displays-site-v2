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
  
  // Mega Menu Functionality
  const megaNavItems = document.querySelectorAll('.mega-nav-item');
  
  megaNavItems.forEach(item => {
    const trigger = item.querySelector('.mega-nav-trigger');
    const dropdown = item.querySelector('.mega-dropdown');
    let timeout;
    
    if (trigger && dropdown) {
      // Show dropdown on hover
      item.addEventListener('mouseenter', function() {
        clearTimeout(timeout);
        // Close other dropdowns
        document.querySelectorAll('.mega-dropdown').forEach(d => {
          if (d !== dropdown) d.classList.remove('active');
        });
        dropdown.classList.add('active');
      });
      
      // Hide dropdown on leave (with delay)
      item.addEventListener('mouseleave', function() {
        timeout = setTimeout(() => {
          dropdown.classList.remove('active');
        }, 150);
      });
      
      // Click to toggle on mobile
      trigger.addEventListener('click', function(e) {
        e.preventDefault();
        const isActive = dropdown.classList.contains('active');
        
        // Close all dropdowns
        document.querySelectorAll('.mega-dropdown').forEach(d => {
          d.classList.remove('active');
        });
        
        // Toggle current if it wasn't active
        if (!isActive) {
          dropdown.classList.add('active');
        }
      });
    }
  });
  
  // Close dropdowns when clicking outside
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.mega-nav-item')) {
      document.querySelectorAll('.mega-dropdown').forEach(d => {
        d.classList.remove('active');
      });
    }
  });
});
