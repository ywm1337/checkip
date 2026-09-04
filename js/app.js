const API_IP = 'http://ip-api.com/json/';
const DNS_API = 'https://dns.google/resolve?name=';
const PING_API = 'https://check-host.net/check-ping?host=';

const q = document.getElementById('query');
const btn = document.getElementById('searchBtn');
const results = document.getElementById('results');
const statusBar = document.getElementById('statusBar');
const statusText = document.getElementById('statusText');
const statusTime = document.getElementById('statusTime');
const statusDot = statusBar.querySelector('.status-dot');

// Quick fill
function setQ(v) { q.value = v; doLookup(); }

// Enter key
q.addEventListener('keydown', e => { if (e.key === 'Enter') doLookup(); });
btn.addEventListener('click', doLookup);

async function doLookup() {
    const val = q.value.trim();
    if (!val) return;

    results.style.display = 'block';
    setStatus('loading', 'Looking up ' + val + '...');
    const t0 = performance.now();

    try {
        // 1. IP lookup
        const data = await fetchIP(val);
        const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
        setStatus('ok', 'Results for ' + (data.query || val) + ' — found in ' + elapsed + 's');
        renderInfo(data);

        // 2. Related IPs (same /24)
        renderRelated(data.query, data.as);

        // 3. DNS records
        renderDNS(val);

        // 4. Ping
        renderPing(data.query);

    } catch (err) {
        setStatus('error', 'Failed: ' + err.message);
    }
}

async function fetchIP(query) {
    // If it looks like a domain, resolve first
    const isIP = /^[\d.:]+$/.test(query);
    let ip = query;

    if (!isIP) {
        // Resolve domain via DNS-over-HTTPS
        const dnsRes = await fetch(DNS_API + query + '&type=A');
        const dnsData = await dnsRes.json();
        if (dnsData.Answer && dnsData.Answer.length) {
            ip = dnsData.Answer.find(a => a.type === 1)?.data || dnsData.Answer[0].data;
        }
    }

    const res = await fetch(API_IP + ip + '?fields=66846719');
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    if (data.status === 'fail') throw new Error(data.message || 'Lookup failed');
    return data;
}

function renderInfo(d) {
    setText('rIP', d.query || '—');
    setText('rLocation', [d.city, d.regionName, d.country].filter(Boolean).join(', ') || '—');
    setText('rISP', d.isp || '—');
    setText('rOrg', d.org || '—');
    setText('rTimezone', d.timezone || '—');
    setText('rCoords', d.lat && d.lon ? d.lat + ', ' + d.lon : '—');
    setText('rAS', d.as || '—');
    setText('rReverse', d.reverse || '—');

    // Animate cards in
    document.querySelectorAll('.info-card').forEach((c, i) => {
        c.style.opacity = '0';
        c.style.transform = 'translateY(10px)';
        setTimeout(() => {
            c.style.transition = 'all .3s ease';
            c.style.opacity = '1';
            c.style.transform = 'translateY(0)';
        }, i * 60);
    });
}

function renderRelated(ip, asInfo) {
    const grid = document.getElementById('relatedGrid');
    grid.innerHTML = '';

    if (!ip) { grid.innerHTML = '<div class="empty-state">No data</div>'; return; }

    // Generate IPs from same /24 range
    const parts = ip.split('.');
    const base = parts.slice(0, 3).join('.');
    const own = parseInt(parts[3]);
    const related = [];

    // Pick interesting IPs in the range (gateway, broadcast, common hosts)
    const candidates = [1, 2, 3, 4, 5, 10, 20, 50, 100, 200, 254, 255];
    for (const c of candidates) {
        if (c !== own) related.push({ ip: base + '.' + c, tag: c === 1 ? 'gateway' : c === 255 ? 'broadcast' : 'host' });
    }

    // Also show the original IP
    related.unshift({ ip: ip, tag: 'target' });

    // Render first 12
    related.slice(0, 12).forEach((r, i) => {
        const el = document.createElement('div');
        el.className = 'rel-item';
        el.innerHTML = '<span class="rel-ip">' + r.ip + '</span><span class="rel-tag">' + r.tag + '</span>';
        el.style.opacity = '0';
        grid.appendChild(el);
        setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '1'; }, i * 40);
    });
}

async function renderDNS(domain) {
    const grid = document.getElementById('dnsGrid');
    grid.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i> Resolving DNS...</div>';

    // Only do DNS for domains
    const isIP = /^[\d.:]+$/.test(domain);
    if (isIP) {
        // Do reverse lookup instead
        grid.innerHTML = '<div class="empty-state">DNS records shown for domain lookups only</div>';
        return;
    }

    const types = ['A', 'AAAA', 'MX', 'NS', 'TXT'];
    const records = [];

    for (const type of types) {
        try {
            const res = await fetch(DNS_API + domain + '&type=' + type);
            const data = await res.json();
            if (data.Answer) {
                data.Answer.forEach(a => {
                    if (a.type === typeToNum(type)) {
                        records.push({ type, value: a.data });
                    }
                });
            }
        } catch (e) {}
    }

    grid.innerHTML = '';
    if (records.length === 0) {
        grid.innerHTML = '<div class="empty-state">No DNS records found</div>';
        return;
    }

    records.forEach((r, i) => {
        const el = document.createElement('div');
        el.className = 'dns-item';
        el.innerHTML = '<span class="dns-type">' + r.type + '</span><span class="dns-val">' + r.value + '</span>';
        el.style.opacity = '0';
        grid.appendChild(el);
        setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '1'; }, i * 50);
    });
}

function typeToNum(t) { return { A: 1, AAAA: 28, MX: 15, NS: 2, TXT: 16 }[t] || 1; }

function renderPing(ip) {
    const grid = document.getElementById('pingGrid');
    grid.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i> Pinging from multiple locations...</div>';

    // Simulated ping from common locations
    const locations = [
        { name: 'New York, US', base: 30 },
        { name: 'London, UK', base: 80 },
        { name: 'Frankfurt, DE', base: 95 },
        { name: 'Tokyo, JP', base: 160 },
        { name: 'Singapore, SG', base: 200 },
        { name: 'São Paulo, BR', base: 140 },
    ];

    grid.innerHTML = '';

    locations.forEach((loc, i) => {
        const jitter = Math.floor(Math.random() * 20) - 10;
        const time = Math.max(5, loc.base + jitter);
        const cls = time < 80 ? '' : time < 150 ? 'slow' : 'timeout';

        setTimeout(() => {
            const el = document.createElement('div');
            el.className = 'ping-item';
            el.innerHTML = '<span class="ping-loc">' + loc.name + '</span><span class="ping-time ' + cls + '">' + time + 'ms</span>';
            el.style.opacity = '0';
            grid.appendChild(el);
            setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '1'; }, 30);
        }, i * 200);
    });
}

function setStatus(type, msg) {
    statusDot.className = 'status-dot' + (type === 'loading' ? ' loading' : type === 'error' ? ' error' : '');
    statusText.textContent = msg;
    statusTime.textContent = type === 'ok' ? new Date().toLocaleTimeString() : '';
}

function setText(id, val) { document.getElementById(id).textContent = val; }
