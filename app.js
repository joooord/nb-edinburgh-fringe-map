/* Northern Belle Edinburgh Fringe Day-Planner Map
 * --------------------------------------------------
 * Vanilla JS + Leaflet 1.9. Loads three small static JSON datasets,
 * paints them onto an OpenStreetMap base layer warmed into the NB
 * cream-and-claret palette, and provides three views (Explore,
 * Day plans, My day) over the same canvas.
 *
 * No build step. All state held in module-scoped vars, with the
 * shortlist persisted to localStorage so guests can come back later.
 */

(function () {
  'use strict';

  // -------- Constants --------------------------------------------------
  const WAVERLEY = { lat: 55.9521, lng: -3.1894 };
  const MAP_CENTRE = [55.9476, -3.1905];
  const MAP_ZOOM = 15;
  const TRIP_WINDOW_MIN = 310; // 12:10 -> 17:20 = 5h 10m
  const RING_MINUTES = [5, 10, 15, 20];
  const METRES_PER_MIN = 80; // relaxed pace
  const STORAGE_KEY = 'nb-fringe-shortlist-v1';

  // -------- State -------------------------------------------------------
  let venuesData = null;
  let eatsData = null;
  let itinerariesData = null;
  let map = null;
  let markers = {};
  let layers = {
    rings: null,
    planPath: null,
  };
  let activeFilter = 'all';
  let activeTab = 'explore';
  let activePlanId = null;
  let shortlist = loadShortlist();

  // -------- Bootstrap ---------------------------------------------------
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      [venuesData, eatsData, itinerariesData] = await Promise.all([
        fetch('data/venues.json').then(r => r.json()),
        fetch('data/eats.json').then(r => r.json()),
        fetch('data/itineraries.json').then(r => r.json()),
      ]);
      initMap();
      initMarkers();
      initRings();
      renderVenueList();
      renderPlanList();
      renderShortlist();
      wireTabs();
      wireFilters();
      wireMobile();
    } catch (err) {
      console.error('Failed to load data', err);
      document.getElementById('venue-list').innerHTML =
        '<li class="nb-list-item">Map data could not be loaded. Please refresh.</li>';
    }
  });

  // -------- Map ---------------------------------------------------------
  function initMap() {
    map = L.map('map', {
      zoomControl: true,
      scrollWheelZoom: true,
      attributionControl: true,
    }).setView(MAP_CENTRE, MAP_ZOOM);

    L.control.attribution({ prefix: false }).addTo(map);
    map.attributionControl.setPosition('bottomleft');

    L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
      }
    ).addTo(map);
  }

  // -------- Walking rings ----------------------------------------------
  function initRings() {
    const ringLayer = L.layerGroup();
    RING_MINUTES.forEach((minutes) => {
      const radiusMetres = minutes * METRES_PER_MIN;
      L.circle([WAVERLEY.lat, WAVERLEY.lng], {
        radius: radiusMetres,
        color: '#b8893b',
        weight: 1,
        opacity: 0.45,
        dashArray: '3 4',
        fillColor: '#b8893b',
        fillOpacity: 0.03,
        interactive: false,
      }).addTo(ringLayer);

      // Label the ring on its eastern edge
      const labelLatLng = offset(WAVERLEY.lat, WAVERLEY.lng, radiusMetres, 90);
      L.marker([labelLatLng.lat, labelLatLng.lng], {
        icon: L.divIcon({
          className: 'ring-label-icon',
          html: `<span class="ring-label">${minutes} min walk</span>`,
          iconSize: [70, 18],
          iconAnchor: [35, 9],
        }),
        interactive: false,
        keyboard: false,
      }).addTo(ringLayer);
    });

    // Inject ring-label CSS once
    const style = document.createElement('style');
    style.textContent = `
      .ring-label {
        display: inline-block;
        background: rgba(250, 246, 239, 0.85);
        color: #6f1932;
        font: 500 10px 'Inter', sans-serif;
        letter-spacing: 0.06em;
        padding: 2px 6px;
        border-radius: 2px;
        border: 1px solid #d6b377;
        white-space: nowrap;
      }
    `;
    document.head.appendChild(style);

    ringLayer.addTo(map);
    layers.rings = ringLayer;
  }

  // -------- Markers -----------------------------------------------------
  function initMarkers() {
    // Anchor: Waverley
    const anchor = venuesData.anchor;
    markers[anchor.id] = addMarker(
      anchor,
      'anchor',
      `<h3 class="popup-name">${anchor.name}</h3>
       <div class="popup-meta"><span class="pill">Northern Belle anchor</span></div>
       <p class="popup-blurb"><strong>Arrive 12:10 &middot; Depart 17:20</strong>. The Northern Belle pulls in directly under Princes Street, two minutes from the foot of the Royal Mile.</p>`
    );

    // Venues
    venuesData.venues.forEach((v) => {
      markers[v.id] = addMarker(v, v.tier, venuePopupHTML(v));
    });

    // Eats
    eatsData.places.forEach((e) => {
      markers[e.id] = addMarker(e, 'eats', eatsPopupHTML(e));
    });
  }

  function addMarker(item, tierClass, popupHTML) {
    const initial = item.name
      .replace(/^(The )/i, '')
      .charAt(0)
      .toUpperCase();
    const isAnchor = tierClass === 'anchor';
    const html = `<div class="nb-marker tier-${tierClass}${shortlist.includes(item.id) ? ' in-shortlist' : ''}" data-id="${item.id}">${isAnchor ? '★' : initial}</div>`;

    const icon = L.divIcon({
      className: 'nb-marker-wrap',
      html: html,
      iconSize: isAnchor ? [44, 44] : [28, 28],
      iconAnchor: isAnchor ? [22, 22] : [14, 14],
      popupAnchor: [0, isAnchor ? -24 : -16],
    });

    const marker = L.marker([item.lat, item.lng], { icon: icon }).addTo(map);
    marker.bindPopup(popupHTML, { maxWidth: 320, minWidth: 260, closeButton: true });
    marker.on('popupopen', () => wirePopupButtons(item));
    marker.itemRef = item;
    marker.tierRef = tierClass;
    return marker;
  }

  function venuePopupHTML(v) {
    const bestFor = v.best_for && v.best_for.length
      ? `<div class="popup-best">Best for: ${v.best_for.join(' &middot; ')}</div>`
      : '';
    const tierLabel = {
      'big-four': 'Big Four',
      'flagship': 'Flagship',
      'specialist': 'Specialist',
      'free': 'Free Fringe',
    }[v.tier] || v.tier;
    const starred = shortlist.includes(v.id);
    return `
      <h3 class="popup-name">${v.name}</h3>
      <div class="popup-meta">
        <span class="pill">${tierLabel}</span>
        <span class="pill">${v.walk_min} min walk</span>
      </div>
      <p class="popup-blurb">${v.blurb}</p>
      ${bestFor}
      <div class="popup-actions">
        <a href="${v.edfringe_search}" target="_blank" rel="noopener">View shows</a>
        <button class="secondary star-btn ${starred ? 'active' : ''}" data-id="${v.id}">${starred ? '✓ In my day' : '☆ Add to my day'}</button>
      </div>
    `;
  }

  function eatsPopupHTML(e) {
    const starred = shortlist.includes(e.id);
    return `
      <h3 class="popup-name">${e.name}</h3>
      <div class="popup-meta">
        <span class="pill">Eats &amp; drinks</span>
        <span class="pill">${e.walk_min} min walk</span>
      </div>
      <p class="popup-blurb">${e.blurb}</p>
      <div class="popup-best">Good for: ${e.good_for.join(' &middot; ')}</div>
      <div class="popup-actions">
        <button class="secondary star-btn ${starred ? 'active' : ''}" data-id="${e.id}">${starred ? '✓ In my day' : '☆ Add to my day'}</button>
      </div>
    `;
  }

  function wirePopupButtons(item) {
    const btn = document.querySelector('.leaflet-popup .star-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      toggleShortlist(item.id);
      // Refresh popup content so the button reflects new state
      const m = markers[item.id];
      if (m) {
        const html = item.spaces !== undefined || item.tier
          ? venuePopupHTML(itemAsVenue(item))
          : eatsPopupHTML(item);
        m.setPopupContent(html);
        wirePopupButtons(item);
      }
    });
  }

  function itemAsVenue(item) {
    // If a venue was passed (has tier), keep it; otherwise treat as eats.
    if (item.tier) return item;
    return null;
  }

  // -------- Filters -----------------------------------------------------
  function wireFilters() {
    document.querySelectorAll('.nb-filter').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.nb-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeFilter = btn.dataset.filter;
        applyFilter();
        renderVenueList();
      });
    });
  }

  function applyFilter() {
    Object.values(markers).forEach((m) => {
      const tier = m.tierRef;
      const item = m.itemRef;
      if (item.id === 'waverley') {
        map.addLayer(m);
        return;
      }
      let show = false;
      if (activeFilter === 'all') show = true;
      else if (activeFilter === 'eats') show = tier === 'eats';
      else show = tier === activeFilter;

      if (show) map.addLayer(m);
      else map.removeLayer(m);
    });
  }

  // -------- Venue list (Explore panel) ---------------------------------
  function renderVenueList() {
    const list = document.getElementById('venue-list');
    const items = combinedItems().filter(i => itemMatchesFilter(i));
    if (!items.length) {
      list.innerHTML = '<li class="nb-list-item">Nothing in this filter. Try "All".</li>';
      return;
    }
    list.innerHTML = items
      .sort((a, b) => (a.walk_min || 0) - (b.walk_min || 0))
      .map(item => listItemHTML(item))
      .join('');

    list.querySelectorAll('.nb-list-item').forEach((el) => {
      const id = el.dataset.id;
      el.addEventListener('click', (ev) => {
        if (ev.target.closest('.nb-list-star')) return;
        focusItem(id);
      });
      el.querySelector('.nb-list-star').addEventListener('click', (ev) => {
        ev.stopPropagation();
        toggleShortlist(id);
      });
    });
  }

  function combinedItems() {
    return [
      ...venuesData.venues,
      ...eatsData.places.map(e => ({ ...e, tier: 'eats' })),
    ];
  }

  function itemMatchesFilter(item) {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'eats') return item.tier === 'eats';
    return item.tier === activeFilter;
  }

  function listItemHTML(item) {
    const starred = shortlist.includes(item.id);
    const tierLabel = {
      'big-four': 'Big Four',
      'flagship': 'Flagship',
      'specialist': 'Specialist',
      'free': 'Free Fringe',
      'eats': 'Eats &amp; drinks',
    }[item.tier] || '';
    return `
      <li class="nb-list-item" data-id="${item.id}">
        <button class="nb-list-star ${starred ? 'active' : ''}" aria-label="Add to my day">${starred ? '★' : '☆'}</button>
        <div class="nb-list-name">${item.name}</div>
        <div class="nb-list-meta">
          <span class="nb-list-walk">${item.walk_min} min</span>
          <span class="nb-list-tier">${tierLabel}</span>
        </div>
      </li>
    `;
  }

  function focusItem(id) {
    const m = markers[id];
    if (!m) return;
    map.setView(m.getLatLng(), Math.max(map.getZoom(), 16), { animate: true });
    m.openPopup();
    // On mobile, close the sidebar so the map is visible
    document.getElementById('side').classList.remove('open');
  }

  // -------- Day plans ---------------------------------------------------
  function renderPlanList() {
    const wrap = document.getElementById('plans-list');
    wrap.innerHTML = itinerariesData.plans.map(p => `
      <div class="nb-plan-card" data-plan="${p.id}">
        <h3 class="nb-plan-title">${p.title}</h3>
        <p class="nb-plan-tagline">${p.tagline}</p>
      </div>
    `).join('');
    wrap.querySelectorAll('.nb-plan-card').forEach((card) => {
      card.addEventListener('click', () => showPlan(card.dataset.plan));
    });

    document.getElementById('plan-back').addEventListener('click', backToPlans);
  }

  function showPlan(planId) {
    const plan = itinerariesData.plans.find(p => p.id === planId);
    if (!plan) return;
    activePlanId = planId;
    document.getElementById('plans-list').classList.add('hidden');
    document.getElementById('plan-detail').classList.remove('hidden');
    document.getElementById('plan-detail-title').textContent = plan.title;
    document.getElementById('plan-detail-tagline').textContent = plan.tagline;

    const stepsEl = document.getElementById('plan-detail-steps');
    stepsEl.innerHTML = plan.steps.map(s => {
      const loc = resolveLocation(s.location);
      return `
        <li class="nb-step kind-${s.kind}">
          <div class="nb-step-time">${s.time}</div>
          <div class="nb-step-body">
            <div class="nb-step-label">${s.label}</div>
            <div class="nb-step-location">${loc ? loc.name : ''}</div>
          </div>
        </li>
      `;
    }).join('');

    // Draw the plan path on the map
    drawPlanPath(plan);
  }

  function backToPlans() {
    activePlanId = null;
    document.getElementById('plans-list').classList.remove('hidden');
    document.getElementById('plan-detail').classList.add('hidden');
    clearPlanPath();
  }

  function drawPlanPath(plan) {
    clearPlanPath();
    const coords = plan.steps
      .map(s => resolveLocation(s.location))
      .filter(loc => loc)
      .map(loc => [loc.lat, loc.lng]);
    if (coords.length < 2) return;

    const polyline = L.polyline(coords, {
      color: '#6f1932',
      weight: 3,
      opacity: 0.7,
      dashArray: '6 6',
    });

    const stopMarkers = plan.steps.map((s, idx) => {
      const loc = resolveLocation(s.location);
      if (!loc) return null;
      return L.marker([loc.lat, loc.lng], {
        icon: L.divIcon({
          className: 'plan-stop-wrap',
          html: `<div class="plan-stop">${idx + 1}</div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
        interactive: false,
      });
    }).filter(Boolean);

    const group = L.layerGroup([polyline, ...stopMarkers]);
    group.addTo(map);
    layers.planPath = group;

    // Inject plan-stop CSS once
    if (!document.getElementById('plan-stop-style')) {
      const s = document.createElement('style');
      s.id = 'plan-stop-style';
      s.textContent = `
        .plan-stop {
          background: #b8893b;
          color: #4f0f22;
          width: 22px;
          height: 22px;
          border-radius: 50%;
          font: 600 11px 'Inter', sans-serif;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 2px solid #faf6ef;
          box-shadow: 0 1px 4px rgba(0,0,0,0.25);
        }
      `;
      document.head.appendChild(s);
    }

    // Fit bounds
    map.fitBounds(polyline.getBounds().pad(0.15));
  }

  function clearPlanPath() {
    if (layers.planPath) {
      map.removeLayer(layers.planPath);
      layers.planPath = null;
    }
  }

  function resolveLocation(id) {
    if (id === 'waverley') return venuesData.anchor;
    const v = venuesData.venues.find(x => x.id === id);
    if (v) return v;
    const e = eatsData.places.find(x => x.id === id);
    if (e) return e;
    return null;
  }

  // -------- Shortlist ---------------------------------------------------
  function loadShortlist() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveShortlist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(shortlist));
    } catch (e) { /* ignore quota errors */ }
  }

  function toggleShortlist(id) {
    const idx = shortlist.indexOf(id);
    if (idx >= 0) shortlist.splice(idx, 1);
    else shortlist.push(id);
    saveShortlist();
    refreshMarkersForShortlist();
    renderVenueList();
    renderShortlist();
  }

  function refreshMarkersForShortlist() {
    Object.values(markers).forEach((m) => {
      const el = m.getElement && m.getElement();
      if (!el) return;
      const dot = el.querySelector('.nb-marker');
      if (!dot) return;
      const id = dot.dataset.id;
      if (shortlist.includes(id)) dot.classList.add('in-shortlist');
      else dot.classList.remove('in-shortlist');
    });
  }

  function renderShortlist() {
    const countEl = document.getElementById('shortlist-count');
    countEl.textContent = shortlist.length;

    const list = document.getElementById('shortlist-list');
    if (!shortlist.length) {
      list.innerHTML = '<li class="nb-list-item" style="cursor:default;">Your day is empty. Star venues on the map or in the Explore list to start building it.</li>';
    } else {
      list.innerHTML = shortlist
        .map(id => resolveLocation(id))
        .filter(Boolean)
        .map(item => listItemHTML(item))
        .join('');

      list.querySelectorAll('.nb-list-item').forEach((el) => {
        const id = el.dataset.id;
        el.addEventListener('click', (ev) => {
          if (ev.target.closest('.nb-list-star')) return;
          focusItem(id);
        });
        el.querySelector('.nb-list-star').addEventListener('click', (ev) => {
          ev.stopPropagation();
          toggleShortlist(id);
        });
      });
    }

    // Stats: total walking time
    const stops = shortlist.length;
    let walkMin = 0;
    if (stops > 0) {
      // Start and end at Waverley; visit each stop in shortlist order
      let prev = venuesData.anchor;
      shortlist.forEach((id) => {
        const next = resolveLocation(id);
        if (next) {
          walkMin += minutesBetween(prev, next);
          prev = next;
        }
      });
      walkMin += minutesBetween(prev, venuesData.anchor);
    }

    document.getElementById('ss-stops').textContent = stops;
    document.getElementById('ss-walk').textContent = Math.round(walkMin);
    const remaining = TRIP_WINDOW_MIN - walkMin;
    const remH = Math.floor(remaining / 60);
    const remM = Math.max(0, remaining - remH * 60);
    const buf = document.getElementById('ss-buffer');
    buf.textContent = remaining > 0 ? `${remH}h ${remM}m` : 'Over!';
    buf.parentElement.classList.toggle('nb-stat-warn', remaining < 60);
  }

  document.getElementById('shortlist-clear')?.addEventListener('click', () => {
    if (!shortlist.length) return;
    shortlist = [];
    saveShortlist();
    refreshMarkersForShortlist();
    renderVenueList();
    renderShortlist();
  });

  function minutesBetween(a, b) {
    const km = haversineKm(a.lat, a.lng, b.lat, b.lng);
    return (km * 1000) / METRES_PER_MIN;
  }

  function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function offset(lat, lng, distanceMetres, bearingDeg) {
    // Move from (lat,lng) by `distanceMetres` along bearing (deg from north).
    const R = 6378137;
    const brng = (bearingDeg * Math.PI) / 180;
    const lat1 = (lat * Math.PI) / 180;
    const lng1 = (lng * Math.PI) / 180;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(distanceMetres / R) +
      Math.cos(lat1) * Math.sin(distanceMetres / R) * Math.cos(brng)
    );
    const lng2 = lng1 + Math.atan2(
      Math.sin(brng) * Math.sin(distanceMetres / R) * Math.cos(lat1),
      Math.cos(distanceMetres / R) - Math.sin(lat1) * Math.sin(lat2)
    );
    return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI };
  }

  // -------- Tabs --------------------------------------------------------
  function wireTabs() {
    document.querySelectorAll('.nb-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const which = tab.dataset.tab;
        activeTab = which;
        document.querySelectorAll('.nb-tab').forEach((t) => {
          t.classList.toggle('active', t.dataset.tab === which);
          t.setAttribute('aria-selected', t.dataset.tab === which ? 'true' : 'false');
        });
        document.querySelectorAll('.nb-panel').forEach((p) => {
          p.classList.add('hidden');
        });
        document.getElementById('panel-' + which).classList.remove('hidden');

        // When leaving the Plans tab, clear any drawn plan path
        if (which !== 'plans') clearPlanPath();
        if (which === 'plans') backToPlans();
      });
    });
  }

  // -------- Mobile sidebar toggle ---------------------------------------
  function wireMobile() {
    const side = document.getElementById('side');
    const toggle = document.getElementById('mobile-toggle');
    toggle.addEventListener('click', () => {
      side.classList.toggle('open');
      toggle.textContent = side.classList.contains('open') ? 'Hide planner' : 'Show planner';
    });
  }
})();
