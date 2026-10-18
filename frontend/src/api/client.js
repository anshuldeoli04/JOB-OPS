import axios from 'axios';

const rawBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';
const apiBaseUrl = rawBase.endsWith('/api')
  ? rawBase.replace(/\/+$/, '')
  : `${rawBase.replace(/\/+$/, '')}/api`;

const http = axios.create({
  baseURL: apiBaseUrl
});

http.interceptors.request.use((config) => {
  const token = localStorage.getItem('job_ops_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

http.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      error.response?.status === 401 &&
      !error.config?.url?.includes('/auth/login') &&
      !error.config?.url?.includes('/auth/signup')
    ) {
      localStorage.removeItem('job_ops_token');
      if (typeof window !== 'undefined' && window.location && !window.location.pathname.startsWith('/auth/')) {
        window.location.href = '/auth/login';
      }
    }
    return Promise.reject(error);
  }
);

export const api = {
  apiBaseUrl,
  getStreamUrl: async (path) => {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    try {
      const res = await http.post('/auth/ticket');
      const ticket = res.data?.ticket;
      if (ticket) {
        const separator = cleanPath.includes('?') ? '&' : '?';
        return `${apiBaseUrl}${cleanPath}${separator}ticket=${encodeURIComponent(ticket)}`;
      }
    } catch {}
    return `${apiBaseUrl}${cleanPath}`;
  },
  openProtectedFile: async (filePath) => {
    if (!filePath) return;
    let target = filePath;
    if (target.startsWith('/')) {
      const origin = apiBaseUrl.replace(/\/api\/?$/, '');
      target = `${origin}${target}`;
    }
    try {
      const res = await http.post('/auth/ticket');
      const ticket = res.data?.ticket;
      if (ticket) {
        const separator = target.includes('?') ? '&' : '?';
        target = `${target}${separator}ticket=${encodeURIComponent(ticket)}`;
      }
    } catch {}
    window.open(target, '_blank', 'noopener,noreferrer');
  },
  bootstrap: () => Promise.all([
    http.get('/auth/session').then((res) => res.data),
    http.get('/applications').then((res) => res.data),
    http.get('/scan-results').then((res) => res.data),
    http.get('/config').then((res) => res.data),
    http.get('/activity').then((res) => res.data)
  ]),
  login: async (payload) => {
    const res = await http.post('/auth/login', payload);
    if (res.data?.token) {
      localStorage.setItem('job_ops_token', res.data.token);
    }
    return res.data;
  },
  signup: async (payload) => {
    const res = await http.post('/auth/signup', payload);
    if (res.data?.token) {
      localStorage.setItem('job_ops_token', res.data.token);
    }
    return res.data;
  },
  logout: async () => {
    try {
      await http.post('/auth/logout');
    } finally {
      localStorage.removeItem('job_ops_token');
    }
    return { ok: true };
  },
  getApplications: () => http.get('/applications').then((res) => res.data),
  getConfig: () => http.get('/config').then((res) => res.data),
  getSetupStatus: () => http.get('/config/status').then((res) => res.data),
  getUsage: () => http.get('/usage').then((res) => res.data),
  testApiKey: (payload) => http.post('/config/test-key', payload).then((res) => res.data),
  updateApiKey: (payload) => http.post('/config/update-key', payload).then((res) => res.data),
  uploadCvPdf: (file) =>
    http.post('/config/cv-pdf', file, {
      headers: {
        'Content-Type': 'application/pdf'
      }
    }).then((res) => res.data),
  updateApplicationStatus: (id, payload) => http.patch(`/applications/${id}`, payload).then((res) => res.data),
  updateApplicationsBulk: (payload) => http.patch('/applications', payload).then((res) => res.data),
  saveConfig: (payload) => http.post('/config', payload).then((res) => res.data),
  runScan: (payload) => http.post('/scan', payload).then((res) => res.data),
  runEvaluate: (payload) => http.post('/evaluate', payload).then((res) => res.data),
  runResume: (payload) => http.post('/resume', payload).then((res) => res.data),
  getOps: () => http.get('/ops').then((res) => res.data),
  saveOpsSettings: (payload) => http.patch('/ops/settings', payload).then((res) => res.data),
  getOpsHealth: () => http.get('/ops/health').then((res) => res.data),
  previewAutoApply: (payload) => http.post('/ops/auto-apply/preview', payload).then((res) => res.data),
  getScoreReport: (id) => http.get(`/ops/score-report/${id}`).then((res) => res.data)
};
