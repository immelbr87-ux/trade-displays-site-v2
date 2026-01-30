// site/admin-disputes-panel.js
// Showroom Market – Admin Dispute Dashboard Panel

async function loadDisputeDashboard() {
  const token = localStorage.getItem("admin_token");
  if (!token) return;

  try {
    const res = await fetch("/.netlify/functions/admin", {
      headers: { Authorization: `Bearer ${token}` }
    });

    const data = await res.json();
    if (!data.disputeDashboard) return;

    renderDisputeStats(data.disputeDashboard);
    renderBlockedPayouts(data.disputeDashboard.blockedPayouts);
    renderDisputeTable(data.disputeDashboard.disputes);

  } catch (err) {
    console.error("Failed to load dispute dashboard:", err);
  }
}

function renderDisputeStats(stats) {
  const el = document.getElementById("dispute-stats");
  if (!el) return;

  el.innerHTML = `
    <div class="admin-card danger">
      <h3>Total Disputes</h3>
      <div class="admin-big-number">${stats.totalDisputes}</div>
    </div>
    <div class="admin-card warning">
      <h3>Open Disputes</h3>
      <div class="admin-big-number">${stats.openDisputes}</div>
    </div>
    <div class="admin-card success">
      <h3>Won Disputes</h3>
      <div class="admin-big-number">${stats.wonDisputes}</div>
    </div>
    <div class="admin-card muted">
      <h3>Lost Disputes</h3>
      <div class="admin-big-number">${stats.lostDisputes}</div>
    </div>
  `;
}

function renderBlockedPayouts(blocked) {
  const el = document.getElementById("blocked-payouts");
  if (!el) return;

  if (!blocked.length) {
    el.innerHTML = `<p class="muted">No payouts currently blocked</p>`;
    return;
  }

  el.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th>Listing</th>
          <th>Seller</th>
          <th>Amount</th>
          <th>Reason</th>
        </tr>
      </thead>
      <tbody>
        ${blocked.map(b => `
          <tr>
            <td>${b.listing}</td>
            <td>${b.seller}</td>
            <td>$${Number(b.amount).toLocaleString()}</td>
            <td>${b.reason}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderDisputeTable(disputes) {
  const el = document.getElementById("dispute-table");
  if (!el) return;

  if (!disputes.length) {
    el.innerHTML = `<p class="muted">No disputes recorded</p>`;
    return;
  }

  el.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th>Listing</th>
          <th>Seller</th>
          <th>Amount</th>
          <th>Status</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody>
        ${disputes.map(d => `
          <tr>
            <td>${d.listing}</td>
            <td>${d.seller}</td>
            <td>$${Number(d.amount).toLocaleString()}</td>
            <td class="status-${d.disputeStatus}">${d.disputeStatus}</td>
            <td>${new Date(d.created).toLocaleDateString()}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

// Auto-load when admin page loads
document.addEventListener("DOMContentLoaded", loadDisputeDashboard);
