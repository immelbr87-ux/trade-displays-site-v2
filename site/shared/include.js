document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll('.nav-item.has-mega').forEach(item => {
    item.addEventListener('mouseenter', () => {
      if (window.innerWidth > 768) item.classList.add('open');
    });

    item.addEventListener('mouseleave', () => {
      if (window.innerWidth > 768) item.classList.remove('open');
    });

    item.querySelector('button').addEventListener('click', e => {
      if (window.innerWidth <= 768) {
        e.preventDefault();
        item.classList.toggle('open');
      }
    });
  });

  document.addEventListener('click', e => {
    document.querySelectorAll('.nav-item.open').forEach(openItem => {
      if (!openItem.contains(e.target)) openItem.classList.remove('open');
    });
  });
});
