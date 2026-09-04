import sqlite3, hashlib, os, time, json
from flask import Flask, request, jsonify, send_from_directory
from datetime import datetime, timedelta

app = Flask(__name__, static_folder='.', static_url_path='')
DB = 'checkip.db'

# ─── Database ─────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    db = get_db()
    db.executescript('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            plan TEXT DEFAULT 'free',
            credits INTEGER DEFAULT 10,
            credits_reset DATE DEFAULT CURRENT_DATE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS queries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            query TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    ''')
    db.commit()
    db.close()

init_db()

# ─── Auth Helpers ──────────────────────────────────────────
def hash_pw(pw): return hashlib.sha256(pw.encode()).hexdigest()

def get_user(user_id):
    db = get_db()
    user = db.execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()
    db.close()
    return dict(user) if user else None

def reset_credits_if_needed(user):
    today = datetime.now().date().isoformat()
    if user['credits_reset'] != today:
        limits = {'free': 10, 'starter': 50, 'premium': 200, 'enterprise': -1}
        db = get_db()
        db.execute('UPDATE users SET credits = ?, credits_reset = ? WHERE id = ?',
                   (limits.get(user['plan'], 10), today, user['id']))
        db.commit()
        db.close()
        user['credits'] = limits.get(user['plan'], 10)
        user['credits_reset'] = today
    return user

# ─── Static ────────────────────────────────────────────────
@app.route('/')
def index(): return send_from_directory('.', 'index.html')

@app.route('/auth')
def auth_page(): return send_from_directory('.', 'auth.html')

@app.route('/pricing')
def pricing_page(): return send_from_directory('.', 'pricing.html')

@app.route('/dashboard')
def dashboard_page(): return send_from_directory('.', 'dashboard.html')

@app.route('/css/<path:p>')
def css(p): return send_from_directory('css', p)

@app.route('/js/<path:p>')
def js(p): return send_from_directory('js', p)

@app.route('/images/<path:p>')
def img(p): return send_from_directory('images', p)

# ─── Auth API ──────────────────────────────────────────────
@app.route('/api/register', methods=['POST'])
def register():
    data = request.json
    email = data.get('email', '').strip().lower()
    pw = data.get('password', '')
    if not email or not pw or len(pw) < 6:
        return jsonify({'error': 'Email and password (min 6 chars) required'}), 400
    db = get_db()
    try:
        db.execute('INSERT INTO users (email, password) VALUES (?, ?)', (email, hash_pw(pw)))
        db.commit()
        user = db.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
        db.close()
        return jsonify({'ok': True, 'user': dict(user)})
    except sqlite3.IntegrityError:
        db.close()
        return jsonify({'error': 'Email already registered'}), 409

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    email = data.get('email', '').strip().lower()
    pw = data.get('password', '')
    db = get_db()
    user = db.execute('SELECT * FROM users WHERE email = ? AND password = ?', (email, hash_pw(pw))).fetchone()
    db.close()
    if not user:
        return jsonify({'error': 'Invalid credentials'}), 401
    user = dict(user)
    user = reset_credits_if_needed(user)
    return jsonify({'ok': True, 'user': user})

# ─── Credits API ───────────────────────────────────────────
@app.route('/api/credits', methods=['GET'])
def get_credits():
    uid = request.headers.get('X-User-Id')
    if not uid: return jsonify({'error': 'No auth'}), 401
    user = get_user(int(uid))
    if not user: return jsonify({'error': 'User not found'}), 404
    user = reset_credits_if_needed(user)
    limits = {'free': 10, 'starter': 50, 'premium': 200, 'enterprise': -1}
    return jsonify({
        'credits': user['credits'],
        'limit': limits.get(user['plan'], 10),
        'plan': user['plan']
    })

@app.route('/api/credits/use', methods=['POST'])
def use_credit():
    uid = request.headers.get('X-User-Id')
    if not uid: return jsonify({'error': 'No auth'}), 401
    user = get_user(int(uid))
    if not user: return jsonify({'error': 'User not found'}), 404
    user = reset_credits_if_needed(user)
    if user['plan'] != 'enterprise' and user['credits'] <= 0:
        return jsonify({'error': 'No credits left', 'upgrade': True}), 403
    db = get_db()
    if user['plan'] != 'enterprise':
        db.execute('UPDATE users SET credits = credits - 1 WHERE id = ?', (user['id'],))
    db.execute('INSERT INTO queries (user_id, query) VALUES (?, ?)', (user['id'], request.json.get('query', '')))
    db.commit()
    db.close()
    return jsonify({'ok': True, 'remaining': max(0, user['credits'] - 1) if user['plan'] != 'enterprise' else -1})

# ─── IP Lookup API ─────────────────────────────────────────
@app.route('/api/lookup')
def lookup():
    uid = request.headers.get('X-User-Id')
    if not uid: return jsonify({'error': 'Login required'}), 401
    user = get_user(int(uid))
    if not user: return jsonify({'error': 'User not found'}), 404
    user = reset_credits_if_needed(user)
    if user['plan'] != 'enterprise' and user['credits'] <= 0:
        return jsonify({'error': 'No credits left', 'upgrade': True}), 403

    q = request.args.get('q', '').strip()
    if not q: return jsonify({'error': 'Query required'}), 400

    import urllib.request, urllib.parse

    # 1. IP Geolocation
    is_ip = bool(__import__('re').match(r'^[\d.:]+$', q))
    ip = q

    if not is_ip:
        try:
            dns_url = f'https://dns.google/resolve?name={urllib.parse.quote(q)}&type=A'
            dns_res = json.loads(urllib.request.urlopen(dns_url, timeout=5).read())
            if dns_res.get('Answer'):
                ip = next((a['data'] for a in dns_res['Answer'] if a.get('type') == 1), dns_res['Answer'][0]['data'])
        except: pass

    geo = {}
    try:
        geo_url = f'http://ip-api.com/json/{ip}?fields=66846719'
        geo = json.loads(urllib.request.urlopen(geo_url, timeout=5).read())
    except: pass

    # 2. WHOIS / RDAP (abuse + registration)
    whois = {}
    plan = user['plan']
    if plan in ('starter', 'premium', 'enterprise'):
        try:
            rdap_url = f'https://rdap.org/ip/{ip}'
            rdap_data = json.loads(urllib.request.urlopen(rdap_url, timeout=5).read())
            whois = {
                'name': rdap_data.get('name', ''),
                'handle': rdap_data.get('handle', ''),
                'start': next((e.get('start','') for e in rdap_data.get('events',[]) if e.get('status',[])==['last changed']), rdap_data.get('events',[{}])[0].get('start','') if rdap_data.get('events') else ''),
                'country': rdap_data.get('country', ''),
                'abuse': next((c.get('vcard',[[]])[1][3] for c in rdap_data.get('entities',[]) if 'abuse' in str(c.get('roles',[])).lower()), ''),
                'network': rdap_data.get('name', ''),
            }
        except: pass

    # 3. BGP / ASN details
    bgp = {}
    if plan in ('premium', 'enterprise'):
        try:
            bgp_url = f'https://api.iptoasn.com/v1/as/ip/{ip}'
            bgp_data = json.loads(urllib.request.urlopen(bgp_url, timeout=5).read())
            bgp = {
                'asn': bgp_data.get('as_number', ''),
                'as_name': bgp_data.get('as_description', ''),
                'as_country': bgp_data.get('as_country_code', ''),
                'prefix': bgp_data.get('as_prefix', ''),
                'first_seen': bgp_data.get('as_first_seen', ''),
                'last_seen': bgp_data.get('as_last_seen', ''),
            }
        except: pass

    # 4. Reverse DNS
    reverse = ''
    try:
        rev_url = f'https://dns.google/resolve?name={urllib.parse.quote(ip + ".in-addr.arpa.")}&type=PTR'
        rev_data = json.loads(urllib.request.urlopen(rev_url, timeout=5).read())
        if rev_data.get('Answer'):
            reverse = rev_data['Answer'][0]['data']
    except: pass

    # 5. Related IPs (same /24)
    related = []
    if is_ip:
        parts = ip.split('.')
        if len(parts) == 4:
            base = '.'.join(parts[:3])
            own = int(parts[3])
            candidates = [1,2,3,4,5,10,20,50,100,200,254,255]
            for c in candidates:
                if c != own:
                    related.append({'ip': f'{base}.{c}', 'tag': 'gateway' if c == 1 else 'broadcast' if c == 255 else 'host'})
            related.insert(0, {'ip': ip, 'tag': 'target'})

    # 6. DNS records
    dns = []
    if not is_ip:
        for t in ['A','AAAA','MX','NS','TXT']:
            try:
                d_url = f'https://dns.google/resolve?name={urllib.parse.quote(q)}&type={t}'
                d_data = json.loads(urllib.request.urlopen(d_url, timeout=5).read())
                if d_data.get('Answer'):
                    for a in d_data['Answer']:
                        type_map = {'A':1,'AAAA':28,'MX':15,'NS':2,'TXT':16}
                        if a.get('type') == type_map.get(t):
                            dns.append({'type': t, 'value': a['data']})
            except: pass

    # Deduct credit
    db = get_db()
    if user['plan'] != 'enterprise':
        db.execute('UPDATE users SET credits = credits - 1 WHERE id = ?', (user['id'],))
    db.execute('INSERT INTO queries (user_id, query) VALUES (?, ?)', (user['id'], q))
    db.commit()
    db.close()

    return jsonify({
        'geo': geo, 'whois': whois, 'bgp': bgp, 'reverse': reverse,
        'related': related[:12], 'dns': dns,
        'remaining': max(0, user['credits'] - 1) if user['plan'] != 'enterprise' else -1
    })

# ─── History ───────────────────────────────────────────────
@app.route('/api/history')
def history():
    uid = request.headers.get('X-User-Id')
    if not uid: return jsonify([]), 200
    db = get_db()
    rows = db.execute('SELECT query, created_at FROM queries WHERE user_id = ? ORDER BY id DESC LIMIT 50', (int(uid),)).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])

# ─── Plans ─────────────────────────────────────────────────
@app.route('/api/plans')
def plans():
    return jsonify([
        {'id': 'free', 'name': 'Free', 'price': 0, 'credits': 10, 'features': ['10 lookups/day', 'Basic geolocation', 'ISP & location', 'DNS records']},
        {'id': 'starter', 'name': 'Starter', 'price': 5, 'credits': 50, 'features': ['50 lookups/day', 'Everything in Free', 'WHOIS data', 'Abuse contacts', 'Related IPs', 'Priority speed']},
        {'id': 'premium', 'name': 'Premium', 'price': 10, 'credits': 200, 'features': ['200 lookups/day', 'Everything in Starter', 'BGP/ASN data', 'IP change history', 'Network prefix info', 'API access', 'Export results']},
        {'id': 'enterprise', 'name': 'Enterprise', 'price': 20, 'credits': -1, 'features': ['Unlimited lookups', 'Everything in Premium', 'Bulk lookup API', 'Custom rate limits', 'White-label ready', 'Dedicated support', 'SLA guarantee']},
    ])

@app.route('/api/upgrade', methods=['POST'])
def upgrade():
    uid = request.headers.get('X-User-Id')
    if not uid: return jsonify({'error': 'Login required'}), 401
    data = request.json
    plan = data.get('plan', '')
    if plan not in ('starter', 'premium', 'enterprise'):
        return jsonify({'error': 'Invalid plan'}), 400
    db = get_db()
    db.execute('UPDATE users SET plan = ? WHERE id = ?', (plan, int(uid)))
    db.commit()
    db.close()
    return jsonify({'ok': True, 'plan': plan})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
