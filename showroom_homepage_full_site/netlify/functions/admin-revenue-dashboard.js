const API = "/.netlify/functions/admin-get-commission-stats";
const ADMIN_TOKEN = localStorage.getItem("adminToken");

async function loadStats() {
  const res = await fetch(API, {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` }
  });
  const data = await res.json();

  document.getElementById("stat-gmv").textContent =
    `$${Number(data.total_gmv || 0).toLocaleString()}`;
  document.getElementById("stat-revenue").textContent =
    `$${Number(data.total_commission || 0).toLocaleString()}`;
  document.getElementById("stat-take-rate").textContent =
    `${data.avg_take_rate || 0}%`;
  document.getElementById("stat-orders").textContent =
    data.total_orders || 0;

  buildRevenueChart(data.daily);
  buildCommissionChart(data.tiers);
}

function buildRevenueChart(dailyData) {
  const ctx = document.getElementById("revenueChart");

  new Chart(ctx, {
    type: "line",
    data: {
      labels: dailyData.map(d => d.date),
      datasets: [
        {
          label: "Platform Revenue",
          data: dailyData.map(d => d.revenue),
          borderColor: "#00b85c",
          backgroundColor: "rgba(0,184,92,0.1)",
          tension: 0.3,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          ticks: {
            callback: value => `$${value}`
          }
        }
      }
    }
  });
}

function buildCommissionChart(tierData) {
  const ctx = document.getElementById("commissionChart");

  new Chart(ctx, {
    type: "bar",
    data: {
      labels: tierData.map(t => t.tier),
      datasets: [{
        label: "Revenue by Tier",
        data: tierData.map(t => t.revenue),
        backgroundColor: ["#16a34a", "#15803d", "#166534"]
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          ticks: {
            callback: value => `$${value}`
          }
        }
      }
    }
  });
}

loadStats();
