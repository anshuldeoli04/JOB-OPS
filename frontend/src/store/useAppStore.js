import { create } from 'zustand';
import { api } from '../api/client';

const gradeOrder = { A: 5, B: 4, C: 3, D: 2, F: 1 };

const parseError = (error, fallback) =>
  error?.response?.data?.error || error?.message || fallback;

const appendTaskLog = (task, message, nextStatus) => (state) => ({
  [task]: {
    ...state[task],
    status: nextStatus || state[task].status,
    logs: message ? [...(state[task].logs || []), message] : state[task].logs || []
  }
});

function createLogBatcher(flushCallback, intervalMs = 150) {
  let buffer = [];
  let timer = null;

  const flush = () => {
    if (buffer.length > 0) {
      const items = [...buffer];
      buffer = [];
      flushCallback(items);
    }
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const push = (line) => {
    buffer.push(line);
    if (!timer) {
      timer = setTimeout(flush, intervalMs);
    }
  };

  return { push, flush };
}

export const useAppStore = create((set, get) => ({
  hydrated: false,
  shortcutFocus: null,
  backgroundTask: null,
  session: null,
  applications: [],
  scanResults: [],
  config: null,
  setupStatus: null,
  usage: null,
  ops: null,
  autoApplyPreview: null,
  activity: [],
  notifications: [],
  activeScan: { status: 'idle', logs: [] },
  activeEvaluation: { status: 'idle', result: null, logs: [] },
  activeResume: { status: 'idle', result: null, logs: [] },

  bootstrap: async () => {
    try {
      const token = localStorage.getItem('job_ops_token');
      if (!token) {
        set({ session: null, hydrated: true });
        return;
      }
      const [sessionRes, applications, scanResults, config, activity] = await api.bootstrap();
      const [setupStatus, usage] = sessionRes?.user
        ? await Promise.all([
            api.getSetupStatus().catch(() => null),
            api.getUsage().catch(() => null)
          ])
        : [null, null];
      set({
        session: sessionRes?.user || null,
        applications: applications || [],
        scanResults: scanResults || [],
        config: config || null,
        setupStatus,
        usage,
        activity: activity || [],
        hydrated: true
      });
    } catch (error) {
      set({ hydrated: true });
      get().pushToast({
        type: 'error',
        title: 'Bootstrap failed',
        message: parseError(error, 'Server se initial data load nahi hua.')
      });
    }
  },

  pushToast: (toast) =>
    set((state) => ({
      notifications: [
        ...state.notifications,
        { id: crypto.randomUUID(), duration: 4000, ...toast }
      ]
    })),

  dismissToast: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((toast) => toast.id !== id)
    })),

  startTask: (label) => set({ backgroundTask: { label, startedAt: Date.now() } }),
  endTask: () => set({ backgroundTask: null }),

  login: async (payload) => {
    get().startTask('Signing you in...');
    try {
      const data = await api.login(payload);
      set({ session: data.user });
      await get().bootstrap();
      get().pushToast({ type: 'success', title: 'Welcome back', message: `${data.user.name} signed in.` });
      return data;
    } finally {
      get().endTask();
    }
  },

  signup: async (payload) => {
    get().startTask('Creating your workspace...');
    try {
      const data = await api.signup(payload);
      set({
        session: data.user,
        config: {
          ...get().config,
          name: data.user.name,
          experience_level: data.user.experienceLevel,
          experience_years: data.user.experienceYears,
          cv_content: payload.cvContent || ''
        }
      });
      await get().bootstrap();
      get().pushToast({ type: 'success', title: 'Account created', message: 'Profile setup ready hai.' });
      return data;
    } finally {
      get().endTask();
    }
  },

  logout: async () => {
    await api.logout();
    set({
      session: null,
      setupStatus: null,
      usage: null,
      config: null,
      ops: null,
      autoApplyPreview: null,
      applications: [],
      scanResults: [],
      activity: [],
      notifications: [],
      activeScan: { status: 'idle', logs: [] },
      activeEvaluation: { status: 'idle', result: null, logs: [] },
      activeResume: { status: 'idle', result: null, logs: [] }
    });
  },

  setShortcutFocus: (value) => set({ shortcutFocus: value }),
  clearShortcutFocus: () => set({ shortcutFocus: null }),

  updateStatus: async (id, status) => {
    const previous = get().applications;
    set({
      applications: previous.map((item) => (item.id === id ? { ...item, status } : item))
    });

    try {
      await api.updateApplicationStatus(id, { status });
      get().pushToast({ type: 'success', title: 'Status updated', message: `Application ${status} mark ho gayi.` });
    } catch (error) {
      set({ applications: previous });
      get().pushToast({ type: 'error', title: 'Status failed', message: parseError(error, 'Update rollback kar diya.') });
    }
  },

  bulkUpdateStatus: async (ids, status) => {
    const previous = get().applications;
    set({
      applications: previous.map((item) => (ids.includes(item.id) ? { ...item, status } : item))
    });
    try {
      const data = await api.updateApplicationsBulk({ ids, status });
      set({ applications: data.applications });
      get().pushToast({ type: 'success', title: 'Bulk update done', message: `${ids.length} rows sync ho gayi.` });
    } catch (error) {
      set({ applications: previous });
      get().pushToast({ type: 'error', title: 'Bulk update failed', message: parseError(error, 'Rows restore kar di gayi.') });
    }
  },

  saveConfig: async (payload) => {
    get().startTask('Saving settings...');
    try {
      const data = await api.saveConfig(payload);
      const [setupStatus, usage] = await Promise.all([
        api.getSetupStatus().catch(() => get().setupStatus),
        api.getUsage().catch(() => get().usage)
      ]);
      set({ config: data.config, setupStatus, usage });
      get().pushToast({ type: 'success', title: 'Settings saved', message: 'Profile, Gemini key, aur CV text save ho gaye.' });
      return data;
    } finally {
      get().endTask();
    }
  },

  testApiKey: async (payload) => {
    get().startTask('Testing Gemini key...');
    try {
      return await api.testApiKey(payload);
    } finally {
      get().endTask();
    }
  },

  updateApiKey: async (payload) => {
    get().startTask('Updating Gemini key...');
    try {
      const data = await api.updateApiKey(payload);
      const [setupStatus, usage] = await Promise.all([
        api.getSetupStatus().catch(() => get().setupStatus),
        api.getUsage().catch(() => get().usage)
      ]);
      set({ config: data.config, setupStatus, usage });
      get().pushToast({ type: 'success', title: 'API key updated', message: 'Gemini key verify karke safely save ho gayi.' });
      return data;
    } finally {
      get().endTask();
    }
  },

  uploadCvPdf: async (file) => {
    get().startTask('Parsing resume PDF...');
    try {
      const data = await api.uploadCvPdf(file);
      set((state) => ({
        config: {
          ...state.config,
          cv_content: data.cv_content
        }
      }));
      get().pushToast({ type: 'success', title: 'PDF parsed', message: 'CV text extract ho gaya. Save kar do to DB me persist ho jayega.' });
      return data;
    } finally {
      get().endTask();
    }
  },

  runScan: async (payload) => {
    get().startTask('Scanning job sources...');
    const streamUrl = await api.getStreamUrl('/scan/stream');
    let eventSource = null;
    const logBatcher = createLogBatcher((newLines) => {
      set((state) => ({
        activeScan: {
          ...state.activeScan,
          logs: [...state.activeScan.logs, ...newLines]
        }
      }));
    });

    set({
      activeScan: {
        status: 'running',
        logs: ['Preparing scan workspace...', 'Connecting to bridge server...', 'Dispatching scan sources...']
      }
    });
    try {
      eventSource = new EventSource(streamUrl);
      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'log' && payload.message) {
            logBatcher.push(payload.message);
          }
          if (payload.type === 'error') {
            logBatcher.flush();
            set((state) => ({
              activeScan: {
                ...state.activeScan,
                status: 'error',
                logs: [...state.activeScan.logs, payload.message || 'Scan stream failed.']
              }
            }));
          }
        } catch {}
      };

      const data = await api.runScan(payload);
      logBatcher.flush();
      set((state) => ({
        scanResults: data.scanResults || state.scanResults,
        activeScan: {
          status: 'success',
          logs: data.logs?.length
            ? data.logs
            : [
                ...state.activeScan.logs,
                'Scan request accepted.',
                data.message || 'Scanner completed.'
              ]
        }
      }));
      const activity = await api.bootstrap().then((result) => result[4]).catch(() => null);
      set((state) => ({
        activity: activity || state.activity,
        activeScan: {
          ...state.activeScan
        }
      }));
      get().pushToast({ type: 'success', title: 'Scanner complete', message: data.message || 'Matching jobs sync ho gaye.' });
    } catch (error) {
      logBatcher.flush();
      set({
        activeScan: { status: 'error', logs: ['Scan request failed.', parseError(error, 'Scanner run nahi hua.')] }
      });
      get().pushToast({ type: 'error', title: 'Scanner error', message: parseError(error, 'Scan run nahi hua.') });
    } finally {
      logBatcher.flush();
      eventSource?.close();
      get().endTask();
    }
  },

  runEvaluate: async (payload) => {
    get().startTask('Evaluating job with Gemini...');
    const streamUrl = await api.getStreamUrl('/evaluate/stream');
    let eventSource = null;
    const logBatcher = createLogBatcher((newLines) => {
      set((state) => ({
        activeEvaluation: {
          ...state.activeEvaluation,
          logs: [...state.activeEvaluation.logs, ...newLines]
        }
      }));
    });

    set({
      activeEvaluation: {
        status: 'running',
        result: null,
        logs: ['Preparing evaluate request...', 'Connecting to evaluation stream...']
      }
    });
    try {
      eventSource = new EventSource(streamUrl);
      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'log' && payload.message) {
            logBatcher.push(payload.message);
          }
          if (payload.type === 'status' && payload.status) {
            logBatcher.flush();
            set((state) => ({
              activeEvaluation: {
                ...state.activeEvaluation,
                status: payload.status
              }
            }));
          }
          if (payload.type === 'complete' && payload.result) {
            logBatcher.flush();
            set((state) => ({
              activeEvaluation: {
                ...state.activeEvaluation,
                status: 'success',
                result: payload.result
              }
            }));
          }
          if (payload.type === 'error') {
            logBatcher.flush();
            set(appendTaskLog('activeEvaluation', payload.message || 'Evaluation stream failed.', 'error'));
          }
        } catch {}
      };

      const data = await api.runEvaluate(payload);
      logBatcher.flush();
      const usage = await api.getUsage().catch(() => get().usage);
      set((state) => ({
        activeEvaluation: {
          status: 'success',
          result: data.result,
          logs: data.result
            ? [...state.activeEvaluation.logs, 'Evaluation result received.']
            : state.activeEvaluation.logs
        },
        usage,
        applications: data.result
          ? [data.result, ...state.applications.filter((item) => item.id !== data.result.id)].sort(
              (a, b) => (gradeOrder[b.grade] || 0) - (gradeOrder[a.grade] || 0)
            )
          : state.applications
      }));
      get().pushToast({ type: 'success', title: 'Evaluation ready', message: 'Result panel update ho gaya.' });
    } catch (error) {
      logBatcher.flush();
      set((state) => ({
        activeEvaluation: {
          status: 'error',
          result: null,
          logs: [...state.activeEvaluation.logs, parseError(error, 'Evaluate endpoint respond nahi kar paaya.')]
        }
      }));
      get().pushToast({ type: 'error', title: 'Evaluation failed', message: parseError(error, 'Evaluate endpoint respond nahi kar paaya.') });
    } finally {
      logBatcher.flush();
      eventSource?.close();
      get().endTask();
    }
  },

  runResume: async (payload) => {
    get().startTask('Generating tailored resume...');
    const streamUrl = await api.getStreamUrl('/resume/stream');
    let eventSource = null;
    const logBatcher = createLogBatcher((newLines) => {
      set((state) => ({
        activeResume: {
          ...state.activeResume,
          logs: [...state.activeResume.logs, ...newLines]
        }
      }));
    });

    set({
      activeResume: {
        status: 'running',
        result: null,
        logs: ['Preparing resume generation...', 'Connecting to resume stream...']
      }
    });
    try {
      eventSource = new EventSource(streamUrl);
      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'log' && payload.message) {
            logBatcher.push(payload.message);
          }
          if (payload.type === 'status' && payload.status) {
            logBatcher.flush();
            set((state) => ({
              activeResume: {
                ...state.activeResume,
                status: payload.status
              }
            }));
          }
          if (payload.type === 'complete' && payload.result) {
            logBatcher.flush();
            set((state) => ({
              activeResume: {
                ...state.activeResume,
                status: 'success',
                result: payload.result
              }
            }));
          }
          if (payload.type === 'error') {
            logBatcher.flush();
            set(appendTaskLog('activeResume', payload.message || 'Resume stream failed.', 'error'));
          }
        } catch {}
      };

      const data = await api.runResume(payload);
      logBatcher.flush();
      const applications = await api.getApplications();
      const usage = await api.getUsage().catch(() => get().usage);
      set({
        activeResume: { status: 'success', result: data, logs: data.logs || [] },
        applications,
        usage
      });
      get().pushToast({ type: 'success', title: 'Resume ready', message: data.message || 'Resume output linked ho gaya.' });
    } catch (error) {
      logBatcher.flush();
      set((state) => ({
        activeResume: {
          status: 'error',
          result: null,
          logs: [...state.activeResume.logs, parseError(error, 'Resume builder call fail ho gayi.')]
        }
      }));
      get().pushToast({ type: 'error', title: 'Resume failed', message: parseError(error, 'Resume builder call fail ho gayi.') });
    } finally {
      logBatcher.flush();
      eventSource?.close();
      get().endTask();
    }
  },

  loadOps: async () => {
    const data = await api.getOps();
    set({ ops: data });
    return data;
  },

  saveOpsSettings: async (payload) => {
    get().startTask('Saving operations settings...');
    try {
      const data = await api.saveOpsSettings(payload);
      set((state) => ({ ops: { ...(state.ops || {}), settings: data.settings } }));
      get().pushToast({ type: 'success', title: 'Operations saved', message: 'Roadmap controls sync ho gaye.' });
      return data;
    } finally {
      get().endTask();
    }
  },

  refreshOpsHealth: async () => {
    const data = await api.getOpsHealth();
    set((state) => ({ ops: { ...(state.ops || {}), ...data } }));
    return data;
  },

  previewAutoApply: async (payload) => {
    get().startTask('Preparing safe auto-apply preview...');
    try {
      const data = await api.previewAutoApply(payload);
      set({ autoApplyPreview: data });
      get().pushToast({ type: 'success', title: 'Preview ready', message: `${data.candidates?.length || 0} applications checked.` });
      return data;
    } finally {
      get().endTask();
    }
  }
}));
