import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL;
const USER_LOGIN_PATH = __ENV.USER_LOGIN_PATH || '/auth/login';
// Match protected pembeli route (no /api prefix)
const BID_PATH = __ENV.BID_PATH || '/pembeli/pengajuan-lelang';

const LELANG_ID   = Number(__ENV.LELANG_ID);
const USER_PREFIX = __ENV.USER_PREFIX || 'k6buyer';
const USER_DOMAIN = __ENV.USER_DOMAIN || 'example.com';
const USER_PASS   = __ENV.USER_PASSWORD || 'Password123!';
const USER_COUNT  = Number(__ENV.USER_COUNT || 100);
const USER_EMAIL_SUFFIX = __ENV.USER_EMAIL_SUFFIX ? `-${__ENV.USER_EMAIL_SUFFIX}` : '';
const LOGIN_TIMEOUT = __ENV.LOGIN_TIMEOUT || '120s';
const REQ_TIMEOUT = __ENV.REQ_TIMEOUT || '30s';

const TOTAL_BIDS = Number(__ENV.TOTAL_BIDS || 1000);
const MIN_BID    = Number(__ENV.MIN_BID || 10000);
const MAX_BID    = Number(__ENV.MAX_BID || 100000);
const BID_STEP   = Number(__ENV.BID_STEP || 250);

export const options = {
  scenarios: {
    bidding: {
      executor: 'shared-iterations',
      vus: Math.min(50, TOTAL_BIDS),
      iterations: TOTAL_BIDS,
      maxDuration: '40m',
    },
  },
  thresholds: { http_req_failed: ['rate<0.05'] },
};

function extractToken(res) {
  return (
    res.json('data.accessToken') ||
    res.json('data.access_token') ||
    res.json('data.token') ||
    res.json('access_token') ||
    res.json('token') ||
    res.json('authorization.token') ||
    null
  );
}

function apiLogin(path, email, password) {
  const res = http.post(`${BASE_URL}${path}`, JSON.stringify({ email, password }), {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    timeout: LOGIN_TIMEOUT,
  });
  if (!res || res.status === 0) {
    return null;
  }
  let token = null;
  try { token = extractToken(res); } catch (_) { token = null; }
  check(res, { 'login 200 & token ada': (r) => r.status === 200 && !!token });
  return token;
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randStep(min, max, step) {
  // Round bounds to step multiples
  const minStep = Math.ceil(min / step) * step;
  const maxStep = Math.floor(max / step) * step;
  if (maxStep < minStep) {
    // if bounds invalid after rounding, fallback to nearest minStep
    return minStep;
  }
  const steps = Math.floor((maxStep - minStep) / step);
  const k = randInt(0, steps);
  return minStep + k * step;
}

export default function () {
  const idx = randInt(1, USER_COUNT);
  const email = `${USER_PREFIX}${String(idx).padStart(3, '0')}${USER_EMAIL_SUFFIX}@${USER_DOMAIN}`;
  let token = apiLogin(USER_LOGIN_PATH, email, USER_PASS);

  const payload = {
    lelang_id: LELANG_ID,
    harga_penawaran: randStep(MIN_BID, MAX_BID, BID_STEP),
  };

  let res = http.post(`${BASE_URL}${BID_PATH}`, JSON.stringify(payload), {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    timeout: REQ_TIMEOUT,
  });

  // Simple retry in case token is stale or rejected transiently
  if (res.status === 401) {
    token = apiLogin(USER_LOGIN_PATH, email, USER_PASS);
    res = http.post(`${BASE_URL}${BID_PATH}`, JSON.stringify(payload), {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: REQ_TIMEOUT,
    });
  }

  check(res, { 'bid 200/201/202': (r) => [200, 201, 202].includes(r.status) });

  if (res.status >= 400) {
    console.warn(`Bid gagal idx=${idx} status=${res.status} body=${res.body}`);
  }

  sleep(0.1);
}

function emailForIndex(idx) {
  return `${USER_PREFIX}${String(idx).padStart(3, '0')}${USER_EMAIL_SUFFIX}@${USER_DOMAIN}`;
}

export function setup() {
  const tokensByEmail = {};
  for (let i = 1; i <= USER_COUNT; i++) {
    const email = emailForIndex(i);
    const token = apiLogin(USER_LOGIN_PATH, email, USER_PASS);
    if (token) {
      tokensByEmail[email] = token;
    } else {
      // Small delay if the server is under pressure
      sleep(0.05);
    }
  }
  return { tokensByEmail };
}

export default function (data) {
  const idx = randInt(1, USER_COUNT);
  const email = emailForIndex(idx);
  let token = data?.tokensByEmail?.[email];
  if (!token) {
    // On-demand login fallback if missing, with brief backoff
    token = apiLogin(USER_LOGIN_PATH, email, USER_PASS);
    if (!token) {
      console.warn(`Login gagal untuk ${email}`);
      sleep(0.1);
      return;
    }
  }

  const payload = {
    lelang_id: LELANG_ID,
    harga_penawaran: randStep(MIN_BID, MAX_BID, BID_STEP),
  };

  let res = http.post(`${BASE_URL}${BID_PATH}`, JSON.stringify(payload), {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    timeout: REQ_TIMEOUT,
  });

  if (res.status === 401) {
    token = apiLogin(USER_LOGIN_PATH, email, USER_PASS);
    res = http.post(`${BASE_URL}${BID_PATH}`, JSON.stringify(payload), {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: REQ_TIMEOUT,
    });
  }

  check(res, { 'bid 200/201/202': (r) => [200, 201, 202].includes(r.status) });

  if (res.status >= 400) {
    console.warn(`Bid gagal idx=${idx} status=${res.status} body=${res.body}`);
  }

  sleep(0.1);
}
