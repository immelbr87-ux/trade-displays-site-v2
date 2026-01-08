/* shared/include.js
   Simple HTML includes:
   - <div data-include="shared/header.html"></div>
   - <div data-include="shared/footer.html"></div>
*/
(async function () {
  const nodes = document.querySelectorAll('[data-include]');
  for (const node of nodes) {
    const path = node.getAttribute('data-include');
    try {
      const res = await fetch(path, { cache: 'no-cache' });
      const html = await res.text();
      node.outerHTML = html;
    } catch (e) {
      console.warn('Include failed:', path, e);
    }
  }

  // mark active nav item based on path
  const here = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  document.querySelectorAll('[data-nav]').forEach(a => {
    const href = (a.getAttribute('href') || '').toLowerCase();
    if (href === here) a.classList.add('active');
  });
})();


(function(){
  // Accordion
  document.querySelectorAll('[data-acc-btn]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-acc-btn');
      const panel = document.querySelector(`[data-acc-panel="${id}"]`);
      const icon = btn.querySelector('[data-acc-icon]');
      const open = panel.classList.toggle('open');
      if(icon) icon.textContent = open ? '–' : '+';
    });
  });

  // Example listing generator (client-side only)
  const form = document.querySelector('#exampleListingForm');
  if(form){
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      const out = document.querySelector('#exampleOutput');
      const card = document.querySelector('#exampleCard');
      if(!out || !card) return;

      const price = data.ask_price ? `$${Number(data.ask_price).toLocaleString()}` : '—';
      const pickup = data.pickup_window || 'Coordinated at checkout';
      const grade = data.condition_grade || 'Grade A';
      const asis = data.as_is === 'yes' ? 'As‑Is' : 'Verified';
      const title = data.item_title || 'Showroom Floor Model';
      const location = [data.city, data.state].filter(Boolean).join(', ') || '—';
      const notes = data.notes || '—';

      out.innerHTML = `
        <div class="card" style="margin-top:14px">
          <h3 style="margin:0 0 6px">${escapeHtml(title)}</h3>
          <div class="meta" style="margin-top:6px">
            <span class="pill">${escapeHtml(location)}</span>
            <span class="pill">${escapeHtml(grade)}</span>
            <span class="pill">${escapeHtml(asis)}</span>
            <span class="pill">Pickup: ${escapeHtml(pickup)}</span>
            <span class="pill">Ask: ${escapeHtml(price)}</span>
          </div>
          <p style="margin-top:10px; color:var(--muted)"><b style="color:var(--text)">Notes:</b> ${escapeHtml(notes)}</p>
          <p class="notice">This is an example preview only. Submissions on this site are not processed unless your form is connected to your own backend.</p>
        </div>
      `;
      card.style.display = 'block';
    });
  }

  function escapeHtml(str){
    return String(str ?? '')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'","&#039;");
  }
})();
