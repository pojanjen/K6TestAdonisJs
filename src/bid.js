import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';

// ===== ENV =====
const BASE_URL        = __ENV.BASE_URL || 'http://localhost:3333';
const USER_LOGIN_PATH = __ENV.USER_LOGIN_PATH || '/auth/login';
const BID_PATH        = __ENV.BID_PATH || '/pembeli/pengajuan-lelang';

const LELANG_ID   = Number(__ENV.LELANG_ID);
const USER_PREFIX = __ENV.USER_PREFIX || 'k6buyer';
const USER_DOMAIN = __ENV.USER_DOMAIN || 'example.com';
const USER_PASS   = __ENV.USER_PASSWORD || 'Password123!';
const USER_COUNT  = Number(__ENV.USER_COUNT || 100);
const USER_EMAIL_SUFFIX = __ENV.USER_EMAIL_SUFFIX ? `-${__ENV.USER_EMAIL_SUFFIX}` : '';
const USER_INDEX_MIN = Number(__ENV.USER_INDEX_MIN || 1);
const USER_INDEX_MAX = Number(__ENV.USER_INDEX_MAX || USER_COUNT);
const USER_PACE_MS   = Number(__ENV.USER_PACE_MS || 5000); // jeda minimal per user (ms)

const LOGIN_TIMEOUT = __ENV.LOGIN_TIMEOUT || '120s';
const REQ_TIMEOUT   = __ENV.REQ_TIMEOUT   || '30s';

const MIN_BID  = Number(__ENV.MIN_BID  || 250);
const MAX_BID  = Number(__ENV.MAX_BID  || 10000000);
const BID_STEP = Number(__ENV.BID_STEP || 250);

export const bids_success = new Counter('bids_success');
export const bids_failed  = new Counter('bids_failed');
export const bid_ok       = new Rate('bid_ok');

// ===== OPTIONS: ramping VUs pakai stages =====
export const options = {
  stages: [
    { duration: '5s',  target: 10  },
    { duration: '10s', target: 50  },
    { duration: '20s', target: 100 },
    { duration: '10s', target: 0   },
  ],
  thresholds: { http_req_failed: ['rate<0.05'] },
};

// ===== utils =====
function extractToken(res) {
  return (
    res.json('data.access_token') ||
    res.json('data.accessToken')  ||
    res.json('data.token')        ||
    res.json('access_token')      ||
    res.json('token')             ||
    res.json('authorization.token') ||
    null
  );
}
function apiLogin(path, email, password) {
  const res = http.post(`${BASE_URL}${path}`, JSON.stringify({ email, password }), {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    timeout: LOGIN_TIMEOUT,
  });
  const token = extractToken(res);
  check(res, { 'login ok': (r) => r.status === 200 && !!token });
  return token;
}
function randStep(min, max, step) {
  const start = Math.ceil(min / step) * step;
  const end   = Math.floor(max / step) * step;
  if (end < start) return start;
  const steps = Math.floor((end - start) / step);
  const k = Math.floor(Math.random() * (steps + 1));
  return start + k * step;
}
function emailForIndex(idx) {
  return `${USER_PREFIX}${String(idx).padStart(3, '0')}${USER_EMAIL_SUFFIX}@${USER_DOMAIN}`;
}
function postBid(token, payload) {
  return http.post(`${BASE_URL}${BID_PATH}`, JSON.stringify(payload), {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    timeout: REQ_TIMEOUT,
  });
}

// ===== per-VU state =====
let lastBidAtMs = 0;

export default function () {
  if (!BASE_URL) throw new Error('Set -e BASE_URL');
  if (!LELANG_ID) throw new Error('Set -e LELANG_ID');

  // pacing per user (1 VU ≈ 1 user)
  const now = Date.now();
  const remaining = Math.max(0, USER_PACE_MS - (now - (lastBidAtMs || 0)));
  if (remaining > 0) sleep(remaining / 1000);

  // map 1 VU -> 1 user index stabil
  const span = (USER_INDEX_MAX - USER_INDEX_MIN + 1);
  const idx  = USER_INDEX_MIN + ((__VU - 1) % span);
  const email = emailForIndex(idx);

  // login sekali tiap iterasi (tanpa retry/caching)
  const token = apiLogin(USER_LOGIN_PATH, email, USER_PASS);
  if (!token) {
    console.warn(`Login gagal untuk ${email}`);
    return;
  }

  // jitter kecil
  sleep(Math.random() * 0.03);

  // payload snake_case sesuai validator backend
  const payload = {
    lelang_id: LELANG_ID,
    harga_penawaran: randStep(MIN_BID, MAX_BID, BID_STEP),
  };

  const res = postBid(token, payload);

  const ok = !!res && res.status >= 200 && res.status < 300;
  bid_ok.add(ok);
  ok ? bids_success.add(1) : bids_failed.add(1);

  check(res, { 'bid ok': (r) => r && [200, 201, 202].includes(r.status) });
  if (!res || res.status >= 400) {
    console.warn(`Bid gagal idx=${idx} status=${res && res.status} body=${String(res && res.body).slice(0,200)}`);
  }

  lastBidAtMs = Date.now();
  sleep(0.1);
}
