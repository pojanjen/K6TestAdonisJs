import registerAndApprove from './register-and-approve.js';
import bidMain from './bid.js';

export const options = {
  scenarios: {
    phase1_register_and_approve: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: Number(__ENV.COUNT || 100),
      startTime: '0s',
      maxDuration: '30m',
      exec: 'phase1_register_and_approve',
    },
    phase2_bidding: {
      executor: 'shared-iterations',
      vus: Math.min(50, Number(__ENV.TOTAL_BIDS || 1000)),
      iterations: Number(__ENV.TOTAL_BIDS || 1000),
      // Start shortly after phase 1 by default (overridable via env)
      startTime: __ENV.START_TIME_PHASE2 || '1m',
      maxDuration: '40m',
      exec: 'phase2_bidding',
    },
  },
  thresholds: { http_req_failed: ['rate<0.05'] },
};

export function phase1_register_and_approve() { return registerAndApprove(); }
export function phase2_bidding() { return bidMain(); }
