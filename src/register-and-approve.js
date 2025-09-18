import http from 'k6/http';
import { check, sleep } from 'k6';

// ==== ENV ====
const BASE_URL = __ENV.BASE_URL;                        // ex: http://localhost:8000
// Match your Adonis routes (no /api prefix based on provided routes)
const ADMIN_LOGIN_PATH = __ENV.ADMIN_LOGIN_PATH || '/auth/login';
const REGISTER_PATH    = __ENV.REGISTER_PATH    || '/pembeli/register';
const USER_PROFILE_PATH= __ENV.USER_PROFILE_PATH|| '/auth/profile';

// Admin API (token-based)
const ADMIN_LIST_ALL   = __ENV.ADMIN_LIST_ALL   || '/admin/pembeli';
const ADMIN_APPROVE_FMT= __ENV.ADMIN_APPROVE_FMT|| '/admin/verifikasi-pembeli/{id}/approve';

const ADMIN_EMAIL    = __ENV.ADMIN_EMAIL || 'admin@lelang.com';
const ADMIN_PASSWORD = __ENV.ADMIN_PASSWORD || 'admin123';

const USER_PREFIX   = __ENV.USER_PREFIX || 'k6buyer';
const USER_DOMAIN   = __ENV.USER_DOMAIN || 'example.com';
const USER_PASSWORD = __ENV.USER_PASSWORD || 'Password123!';
const USER_EMAIL_SUFFIX = __ENV.USER_EMAIL_SUFFIX ? `-${__ENV.USER_EMAIL_SUFFIX}` : '';
// Always include required fields to satisfy DB not-null constraints
const INCLUDE_NOREK = __ENV.INCLUDE_NOREK === '1';
const START_INDEX   = Number(__ENV.START_INDEX || 1);
const COUNT         = Number(__ENV.COUNT || 100);

const DEBUG = __ENV.DEBUG === '1';

export const options = {
  scenarios: {
    register_and_approve: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: COUNT,
      maxDuration: '30m',
    },
  },
  thresholds: { http_req_failed: ['rate<0.05'] },
};

// ========== helpers (token-based) ==========
function extractToken(res) {
  // Try multiple common token shapes
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
  });
  const token = extractToken(res);
  check(res, { 'login 200 & token ada': (r) => r.status === 200 && !!token });
  return token;
}

function getWithToken(path, token) {
  return http.get(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
}
function postWithToken(path, body, token) {
  return http.post(`${BASE_URL}${path}`, JSON.stringify(body ?? {}), {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });
}
function putWithToken(path, body, token) {
  return http.put(`${BASE_URL}${path}`, JSON.stringify(body ?? {}), {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });
}

function arrFromJson(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.data?.data)) return json.data.data; // paginated shape
  if (Array.isArray(json?.items)) return json.items;
  return [];
}
function findPembeliIdInArrayByEmail(arr, email) {
  const target = (email || '').toLowerCase();
  const found = arr.find(
    (x) =>
      x?.user?.email?.toLowerCase() === target ||
      x?.email?.toLowerCase?.() === target
  );
  return found?.id;
}

// ========== flows ==========
let adminToken;

function ensureAdminLogin() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error('ENV ADMIN_EMAIL/ADMIN_PASSWORD belum diset. Set dulu env sebelum menjalankan.');
    return null;
  }
  const res = http.post(`${BASE_URL}${ADMIN_LOGIN_PATH}`, JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }), {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  });
  const token = extractToken(res);
  if (!token || res.status !== 200) {
    console.error(`Gagal login admin: status=${res.status} body=${String(res.body).slice(0,400)}`);
    return null;
  }
  if (DEBUG) console.log('Login admin OK');
  return token;
}

function registerPembeliAndGetId(i) {
  const email = `${USER_PREFIX}${String(i).padStart(3, '0')}${USER_EMAIL_SUFFIX}@${USER_DOMAIN}`;
  // Use snake_case fields to match controller expectations; nomor_rekening optional
  const payload = {
    name: `Buyer ${i}`,
    email,
    password: USER_PASSWORD,
    password_confirmation: USER_PASSWORD,
    alamat_pembeli: `Jalan K6 No.${i}`,
    telepon_pembeli: `0812${String(1000000 + i).slice(-7)}`,
    ...(INCLUDE_NOREK ? { nomor_rekening: `7777${String(i).padStart(6, '0')}` } : {}),
  };

  let res = http.post(`${BASE_URL}${REGISTER_PATH}`, JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  });

  check(res, {
    'register 201/200': (r) => r.status === 201 || r.status === 200,
    // Relax success criteria to accommodate various API shapes
    'register response ok': (r) =>
      r.status < 400 && (r.json('success') === true || !!r.json('data') || r.json('status') === 'success'),
  });

  let pembeliId = null;
  try {
    pembeliId =
      res.json('data.id') ||
      res.json('data.pembeli.id') ||
      res.json('pembeli.id') ||
      res.json('data.pembeliId') ||
      res.json('data.user.pembeli.id');
  } catch (e) { pembeliId = null; }

  if (DEBUG) {
    if (!pembeliId) {
      console.log(`Reg email=${email} status=${res.status} body=${res.body?.slice(0,400)}`);
    } else {
      console.log(`Reg email=${email} status=${res.status} pembeliId=${pembeliId}`);
    }
  }

  return { email, pembeliId };
}

function approvePembeliById(pembeliId) {
  const path = ADMIN_APPROVE_FMT.replace('{id}', String(pembeliId));
  let apr = postWithToken(path, {}, adminToken);
  if ([404, 405].includes(apr.status)) {
    // try alternate route/method
    const altPath = `/admin/pembeli/${pembeliId}/verifikasi/approve`;
    apr = putWithToken(altPath, {}, adminToken);
  }
  check(apr, { 'approve 2xx': (r) => r.status >= 200 && r.status < 300 });
  if (DEBUG) console.log(`Approve id=${pembeliId} status=${apr.status} body=${apr.body?.slice(0,200)}`);
}

function fallbackFindIdByEmail(email) {
  const tryPaths = [
    ADMIN_LIST_ALL,
    '/admin/pembeli/verifikasi/daftar',
    '/admin/verifikasi-pembeli',
  ];
  for (const p of tryPaths) {
    const res = getWithToken(p, adminToken);
    if (DEBUG) console.log(`List ${p} status=${res.status}`);
    if (res.status !== 200) continue;
    try {
      const arr = arrFromJson(res.json());
      const id = findPembeliIdInArrayByEmail(arr, email);
      if (id) return id;
    } catch (e) {
      // ignore
    }
  }
  return null;
}

function userProfileGetPembeliId(email) {
  // login as the user and get profile, extract pembeli id
  try {
    const token = apiLogin(ADMIN_LOGIN_PATH, email, USER_PASSWORD); // same login endpoint for users
    const prof = getWithToken(USER_PROFILE_PATH, token);
    if (prof.status !== 200) return null;
    const id =
      prof.json('data.pembeli.id') ||
      prof.json('pembeli.id') ||
      prof.json('data.user.pembeli.id') ||
      prof.json('data.pembeliId') ||
      null;
    if (DEBUG) console.log(`Profile lookup for ${email} status=${prof.status} id=${id}`);
    return id;
  } catch (e) {
    return null;
  }
}

export default function () {
  const i = START_INDEX + __ITER;

  // 1) register dan ambil pembeliId dari respons
  const { email, pembeliId: idFromRegister } = registerPembeliAndGetId(i);

  // 2) login admin sekali
  if (!adminToken) {
    adminToken = ensureAdminLogin();
    if (!adminToken) {
      // gagal login admin -> stop iterasi ini agar tidak 401 saat approve
      return;
    }
  }

  // 3) pilih id yang akan di-approve
  let pembeliId = idFromRegister;

  // 4) fallback kalau id tidak ada (atau respons register berbeda)
  if (!pembeliId) {
    sleep(0.25);
    pembeliId = fallbackFindIdByEmail(email);
  }
  if (!pembeliId) {
    sleep(0.5);
    pembeliId = fallbackFindIdByEmail(email);
  }
  if (!pembeliId) {
    // as a last resort, login as the new user and read profile
    sleep(0.25);
    pembeliId = userProfileGetPembeliId(email);
  }
  if (!pembeliId) {
    console.warn(`Tidak ketemu pembeli utk ${email}`);
    return;
  }

  // 5) approve
  approvePembeliById(pembeliId);
  sleep(0.05);
}
