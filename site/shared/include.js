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

  // Mega menu behavior (desktop hover, mobile click)
  initMegaMenu();
});

function initMegaMenu() {
  const header = document.getElementById('siteHeader');
  const backdrop = document.getElementById('megaBackdrop');
  const triggers = Array.from(document.querySelectorAll('[data-mega-trigger]'));
  const panels = Array.from(document.querySelectorAll('[data-mega-panel]'));
  if (!header || !backdrop || triggers.length === 0 || panels.length === 0) return;

  const hoverCapable = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  let openKey = null;
  let closeTimer = null;

  function setOpen(key) {
    openKey = key;
    header.classList.toggle('mega-open', !!key);
    triggers.forEach(t => {
      t.classList.toggle('active', t.getAttribute('data-mega-trigger') === key);
      t.setAttribute('aria-expanded', t.getAttribute('data-mega-trigger') === key ? 'true' : 'false');
    });
    panels.forEach(p => {
      const isActive = p.getAttribute('data-mega-panel') === key;
      p.classList.toggle('active', isActive);
      p.setAttribute('aria-hidden', isActive ? 'false' : 'true');
    });
  }

  function open(key) {
    if (closeTimer) clearTimeout(closeTimer);
    setOpen(key);
  }

  function closeSoon(delay = 120) {
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = setTimeout(() => setOpen(null), delay);
  }

  function closeNow() {
    if (closeTimer) clearTimeout(closeTimer);
    setOpen(null);
  }

  // Hover behavior (desktop)
  if (hoverCapable) {
    triggers.forEach(t => {
      t.addEventListener('mouseenter', () => open(t.getAttribute('data-mega-trigger')));
      t.addEventListener('focus', () => open(t.getAttribute('data-mega-trigger')));
    });

    header.addEventListener('mouseleave', () => closeSoon(180));
    header.addEventListener('mouseenter', () => {
      if (closeTimer) clearTimeout(closeTimer);
    });
  } else {
    // Click behavior (mobile/tablet)
    triggers.forEach(t => {
      t.addEventListener('click', (e) => {
        e.preventDefault();
        const key = t.getAttribute('data-mega-trigger');
        if (openKey === key) closeNow();
        else open(key);
      });
    });
  }

  // Backdrop click closes
  backdrop.addEventListener('click', closeNow);

  // Esc closes
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeNow();
  });

  // Outside click closes
  document.addEventListener('click', (e) => {
    if (!openKey) return;
    if (!header.contains(e.target)) closeNow();
  });
}
