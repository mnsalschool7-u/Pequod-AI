const ordersList = document.getElementById("orders-list");
const ordersMeta = document.getElementById("orders-meta");
const ordersStatus = document.getElementById("orders-status");
const refreshOrdersButton = document.getElementById("refresh-orders-button");
const availabilityToggleButton = document.getElementById("availability-toggle-button");
const logoutButton = document.getElementById("logout-button");
const adminLoginCard = document.getElementById("admin-login-card");
const adminLoginForm = document.getElementById("admin-login-form");
const adminPasswordInput = document.getElementById("admin-password");
let currentAvailabilityOpen = true;

function setAuthenticatedView(authenticated) {
  adminLoginCard.classList.toggle("hidden", authenticated);
  ordersList.classList.toggle("hidden", !authenticated);
  refreshOrdersButton.classList.toggle("hidden", !authenticated);
  availabilityToggleButton.classList.toggle("hidden", !authenticated);
  logoutButton.classList.toggle("hidden", !authenticated);
  ordersMeta.classList.toggle("hidden", !authenticated);
}

function renderAvailabilityButton() {
  availabilityToggleButton.textContent = currentAvailabilityOpen
    ? "Set Grabbit closed"
    : "Set Grabbit open";
}

function formatCurrency(amountTotal, currency) {
  if (typeof amountTotal !== "number") {
    return "N/A";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency || "usd").toUpperCase(),
  }).format(amountTotal / 100);
}

function formatDate(value) {
  if (!value) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function setStatus(message) {
  ordersStatus.textContent = message;
  ordersStatus.classList.toggle("hidden", !message);
}

function renderEmptyState() {
  ordersList.innerHTML = `
    <article class="order-card order-card-empty">
      <p class="order-card-title">No orders yet</p>
      <p class="order-card-copy">New submitted orders will show up here automatically.</p>
    </article>
  `;
}

function renderOrders(orders) {
  if (!orders.length) {
    renderEmptyState();
    return;
  }

  ordersList.innerHTML = orders
    .map(
      (order) => `
        <article class="order-card">
          <div class="order-card-header">
            <div>
              <p class="order-card-label">Customer</p>
              <h2 class="order-card-title">${order.customerName || "Unknown customer"}</h2>
            </div>
            <span class="order-status-pill">${order.paymentStatus || "unknown"}</span>
          </div>

          <div class="order-grid">
            <div>
              <p class="order-card-label">Amount</p>
              <p class="order-card-copy">${formatCurrency(order.amountTotal, order.currency)}</p>
            </div>
            <div>
              <p class="order-card-label">Payment</p>
              <p class="order-card-copy">${order.paymentMethod || "N/A"}</p>
            </div>
            <div>
              <p class="order-card-label">Pickup</p>
              <p class="order-card-copy">${order.orderedFrom || "N/A"}</p>
            </div>
            <div>
              <p class="order-card-label">Phone</p>
              <p class="order-card-copy">${order.phone || "N/A"}</p>
            </div>
            <div class="order-grid-wide">
              <p class="order-card-label">Delivery location</p>
              <p class="order-card-copy">${order.locationSummary || "N/A"}</p>
            </div>
            <div class="order-grid-wide">
              <p class="order-card-label">Delivery type</p>
              <p class="order-card-copy">${
                order.deliveryDetails
                  ? `${order.deliveryType} - ${order.deliveryDetails}`
                  : (order.deliveryType || "N/A")
              }</p>
            </div>
            <div class="order-grid-wide">
              <p class="order-card-label">Order screenshot</p>
              <p class="order-card-copy">${
                order.screenshotPath
                  ? `<a class="order-link" href="${order.screenshotPath}" target="_blank" rel="noreferrer">Open screenshot</a>`
                  : "No screenshot uploaded"
              }</p>
            </div>
            <div>
              <p class="order-card-label">Created</p>
              <p class="order-card-copy">${formatDate(order.createdAt)}</p>
            </div>
            <div>
              <p class="order-card-label">Session ID</p>
              <p class="order-card-copy order-mono">${order.sessionId || "N/A"}</p>
            </div>
          </div>
        </article>
      `
    )
    .join("");
}

async function loadOrders() {
  setStatus("Loading orders...");
  refreshOrdersButton.disabled = true;

  try {
    const response = await fetch("/api/orders");
    const orders = await response.json();

    if (response.status === 401) {
      setAuthenticatedView(false);
      ordersMeta.textContent = "Locked";
      ordersList.innerHTML = "";
      setStatus("Admin login required.");
      return;
    }

    if (!response.ok) {
      throw new Error(orders.error || "Unable to load orders.");
    }

    setAuthenticatedView(true);
    renderOrders(orders);
    ordersMeta.textContent = `${orders.length} order${orders.length === 1 ? "" : "s"}`;
    setStatus("");
  } catch (error) {
    ordersMeta.textContent = "Orders unavailable";
    ordersList.innerHTML = "";
    setStatus(error.message || "Unable to load orders.");
  } finally {
    refreshOrdersButton.disabled = false;
  }
}

async function loadAvailability() {
  try {
    const response = await fetch("/api/status");
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Unable to load availability.");
    }

    currentAvailabilityOpen = Boolean(payload.isOpen);
    renderAvailabilityButton();
  } catch (_error) {
    currentAvailabilityOpen = false;
    renderAvailabilityButton();
  }
}

async function checkSession() {
  try {
    const response = await fetch("/api/admin/session");
    const payload = await response.json();
    setAuthenticatedView(Boolean(payload.authenticated));

    if (payload.authenticated) {
      loadAvailability();
      loadOrders();
      return;
    }

    ordersMeta.textContent = "Locked";
    setStatus("Admin login required.");
  } catch (error) {
    setAuthenticatedView(false);
    ordersMeta.textContent = "Unavailable";
    setStatus("Unable to verify admin session.");
  }
}

adminLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("Unlocking orders...");

  try {
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: adminPasswordInput.value }),
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Unable to log in.");
    }

    adminPasswordInput.value = "";
    setAuthenticatedView(true);
    setStatus("");
    loadAvailability();
    loadOrders();
  } catch (error) {
    setAuthenticatedView(false);
    setStatus(error.message || "Unable to log in.");
  }
});

logoutButton.addEventListener("click", async () => {
  await fetch("/api/admin/logout", { method: "POST" });
  ordersList.innerHTML = "";
  setAuthenticatedView(false);
  ordersMeta.textContent = "Locked";
  setStatus("Logged out.");
});

availabilityToggleButton.addEventListener("click", async () => {
  availabilityToggleButton.disabled = true;
  setStatus("Updating live availability...");

  try {
    const response = await fetch("/api/admin/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isOpen: !currentAvailabilityOpen }),
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Unable to update live availability.");
    }

    currentAvailabilityOpen = Boolean(payload.isOpen);
    renderAvailabilityButton();
    setStatus(`Grabbit is now ${currentAvailabilityOpen ? "open" : "closed"}.`);
  } catch (error) {
    setStatus(error.message || "Unable to update live availability.");
  } finally {
    availabilityToggleButton.disabled = false;
  }
});

refreshOrdersButton.addEventListener("click", loadOrders);

checkSession();
