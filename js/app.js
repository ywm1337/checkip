const user = JSON.parse(localStorage.getItem('checkip_user') || 'null');

// Show credit bar if logged in
if (user) {
    const bar = document.getElementById('creditBar');
    if (bar) {
        bar.style.display = 'flex';
        loadCredits();
    }
    // Update nav
    const navAuth = document.getElementById('navAuth');
    if (navAuth) navAuth.innerHTML = '<a href="/dashboard" class="nav-btn">' + user.email.split('@')[0] + '</a>';
}

const q = document.getElementById('query');
const btn = document.getElementById('searchBtn');
const results = document.getElementById('results');
const statusBar = document.getElementById('statusBar');
const statusText = document.getElementById('statusText');
const statusTime = document.getElementById('statusTime');
const statusDot = statusBar ? statusBar.querySelector('.status-dot') : null;

function setQ(v) { q.value = v; doLookup(); }
if (q) {
    q.addEventListener('keydown', e => { if (e.key === 'Enter') doLookup(); });
    btn.addEventListener('click', doLookup);
}

async function loadCredits() {
    if (!user) return;
    try {
        const res = await fetch('/api/credits', { headers: { 'X-User-Id': user.id } });
        const d = await res.json();
        const count = document.getElementById('creditCount');
        const limit = document.getElementById('creditLimit');
        if (count) count.textContent = d.credits === -1 ? '∞' : d.credits;
        if (limit) limit.textContent = d.limit === -1 ? '∞' : d.limit;
    } catch (e) {}
}

async function doLookup() {
    if (!user) { location.href = '/auth'; return; }

    const val = q.value.trim();
    if (!val) return;

    results.style.display = 'block';
    setStatus('loading', 'Looking up ' + val + '...');
    const t0 = performance.now();

    try {
        const res = await fetch('/api/lookup?q=' + encodeURIComponent(val), {
            headers: { 'X-User-Id': user.id }
        });
        const data = await res.json();

        if (data.error) {
            if (data.upgrade) {
                setStatus('error', 'No credits left. Upgrade your plan.');
            } else {
                setStatus('error', data.error);
            }
            return;
        }

        const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
        setStatus('ok', 'Found in ' + elapsed + 's');
        user.credits = data.remaining;
        localStorage.setItem('checkip_user', JSON.stringify(user));
        loadCredits();

        renderInfo(data.geo);
        renderBGP(data.bgp);
        renderWHOIS(data.whois);
        renderRelated(data.related);
        renderDNS(data.dns);
        loadHistory();

    } catch (err) {
        setStatus('error', 'Connection error');
    }
}

function renderInfo(d) {
    const grid = document.getElementById('infoGrid');
    if (!d || !d.query) { grid.innerHTML = ''; return; }
    const items = [
        { label: 'IP Address', val: d.query },
        { label: 'Location', val: [d.city, d.regionName, d.country].filter(Boolean).join(', ') },
        { label: 'ISP', val: d.isp },
        { label: 'Org', val: d.org },
        { label: 'Timezone', val: d.timezone },
        { label: 'Coordinates', val: d.lat && d.lon ? d.lat + ', ' + d.lon : null },
        { label: 'AS', val: d.as },
        { label: 'Reverse DNS', val: document.getElementById('rReverse')?.textContent || '' },
    ];
    renderCardGrid(grid, items);
}

function renderBGP(d) {
    const grid = document.getElementById('bgpGrid');
    if (!d || !d.asn) { grid.innerHTML = '<div class="empty-state">Upgrade to Premium for BGP data</div>'; return; }
    renderCardGrid(grid, [
        { label: 'ASN', val: d.asn },
        { label: 'AS Name', val: d.as_name },
        { label: 'Country', val: d.as_country },
        { label: 'Prefix', val: d.prefix },
        { label: 'First Seen', val: d.first_seen ? new Date(d.first_seen).toLocaleDateString() : '' },
        { label: 'Last Seen', val: d.last_seen ? new Date(d.last_seen).toLocaleDateString() : '' },
    ]);
}

function renderWHOIS(d) {
    const grid = document.getElementById('whoisGrid');
    if (!d || !d.name) { grid.innerHTML = '<div class="empty-state">Upgrade to Starter for WHOIS data</div>'; return; }
    renderCardGrid(grid, [
        { label: 'Network', val: d.name },
        { label: 'Handle', val: d.handle },
        { label: 'Country', val: d.country },
        { label: 'Abuse Contact', val: d.abuse },
        { label: 'Last Changed', val: d.start },
    ]);
}

function renderCardGrid(grid, items) {
    grid.innerHTML = '';
    items.forEach((item, i) => {
        if (!item.val) return;
        const el = document.createElement('div');
        el.className = 'info-card';
        el.innerHTML = '<span class="info-label">' + item.label + '</span><span class="info-val">' + item.val + '</span>';
        el.style.opacity = '0';
        grid.appendChild(el);
        setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '1'; }, i * 50);
    });
}

function renderRelated(data) {
    const grid = document.getElementById('relatedGrid');
    grid.innerHTML = '';
    if (!data || !data.length) { grid.innerHTML = '<div class="empty-state">No related IPs</div>'; return; }
    data.forEach((r, i) => {
        const el = document.createElement('div');
        el.className = 'rel-item';
        el.innerHTML = '<span class="rel-ip">' + r.ip + '</span><span class="rel-tag">' + r.tag + '</span>';
        el.style.opacity = '0';
        grid.appendChild(el);
        setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '1'; }, i * 40);
    });
}

function renderDNS(data) {
    const grid = document.getElementById('dnsGrid');
    grid.innerHTML = '';
    if (!data || !data.length) { grid.innerHTML = '<div class="empty-state">No DNS records</div>'; return; }
    data.forEach((r, i) => {
        const el = document.createElement('div');
        el.className = 'dns-item';
        el.innerHTML = '<span class="dns-type">' + r.type + '</span><span class="dns-val">' + r.value + '</span>';
        el.style.opacity = '0';
        grid.appendChild(el);
        setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '1'; }, i * 50);
    });
}

async function loadHistory() {
    if (!user) return;
    try {
        const res = await fetch('/api/history', { headers: { 'X-User-Id': user.id } });
        const data = await res.json();
        const grid = document.getElementById('historyGrid');
        grid.innerHTML = '';
        data.slice(0, 10).forEach(h => {
            grid.innerHTML += '<div class="hist-item"><span class="mono">' + h.query + '</span><span class="mut">' + new Date(h.created_at).toLocaleString() + '</span></div>';
        });
    } catch (e) {}
}

function setStatus(type, msg) {
    if (!statusDot) return;
    statusDot.className = 'status-dot' + (type === 'loading' ? ' loading' : type === 'error' ? ' error' : '');
    statusText.textContent = msg;
    statusTime.textContent = type === 'ok' ? new Date().toLocaleTimeString() : '';
}
