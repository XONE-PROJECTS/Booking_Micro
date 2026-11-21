import http from 'k6/http';
import { check, sleep } from 'k6';

const API = __ENV.API_URL || 'http://localhost:6767';

export const options = {
  vus: 5,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<500'],
  },
};

export default function () {
  const health = http.get(`${API}/health`);
  check(health, { 'health ok': (r) => r.status === 200 || r.status === 503 });
  sleep(1);
}