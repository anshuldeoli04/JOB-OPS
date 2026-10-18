import { useEffect, useState } from 'react';
import Panel from '../components/ui/Panel';
import { useAppStore } from '../store/useAppStore';

export default function Settings() {
  const config = useAppStore((state) => state.config);
  const setupStatus = useAppStore((state) => state.setupStatus);
  const usage = useAppStore((state) => state.usage);
  const saveConfig = useAppStore((state) => state.saveConfig);
  const testApiKey = useAppStore((state) => state.testApiKey);
  const updateApiKey = useAppStore((state) => state.updateApiKey);
  const uploadCvPdf = useAppStore((state) => state.uploadCvPdf);
  const [local, setLocal] = useState(config || {});
  const [pdfLoading, setPdfLoading] = useState(false);
  const [newApiKey, setNewApiKey] = useState('');
  const [keyTestState, setKeyTestState] = useState({ status: 'idle', message: '' });

  useEffect(() => {
    setLocal(config || {});
  }, [config]);

  const saveProfile = async () => {
    const payload = { ...local };
    if (newApiKey.trim()) {
      payload.gemini_api_key = newApiKey.trim();
    }
    const response = await saveConfig(payload);
    setLocal(response?.config || payload);
    setNewApiKey('');
    setKeyTestState({ status: 'idle', message: '' });
  };

  const runKeyTest = async () => {
    if (!newApiKey.trim()) {
      setKeyTestState({ status: 'error', message: 'Please enter a Gemini API key first.' });
      return;
    }

    setKeyTestState({ status: 'running', message: 'Verifying Gemini connection...' });
    try {
      await testApiKey({
        api_key: newApiKey.trim(),
        gemini_model: local.gemini_model || 'gemini-2.5-flash'
      });
      setKeyTestState({ status: 'success', message: 'Key is valid and ready to save.' });
    } catch (error) {
      const message = error?.response?.data?.error || error?.message || 'Key validation failed.';
      setKeyTestState({ status: 'error', message });
    }
  };

  const saveKeyOnly = async () => {
    if (!newApiKey.trim()) {
      setKeyTestState({ status: 'error', message: 'Gemini API key is required.' });
      return;
    }

    const response = await updateApiKey({
      api_key: newApiKey.trim(),
      gemini_model: local.gemini_model || 'gemini-2.5-flash'
    });
    setLocal((prev) => ({ ...prev, ...(response?.config || {}) }));
    setNewApiKey('');
    setKeyTestState({ status: 'success', message: 'Key verified and saved successfully.' });
  };

  return (
    <div className="page-grid">
      <Panel title="API configuration" subtitle="Gemini bridge preferences">
        <div className="stack-gap">
          <div className="status-card">
            <div>
              <strong>Current Gemini key</strong>
              <p>{config?.has_key ? config?.key_masked : 'No key saved yet'}</p>
            </div>
            <span className={`chip ${config?.has_key ? 'success' : 'danger'}`}>
              {config?.has_key ? 'Saved' : 'Missing'}
            </span>
          </div>
          <div className="status-card">
            <div>
              <strong>Setup status</strong>
              <p>{setupStatus?.configured ? 'Workspace is configured for evaluations.' : 'Key or CV still missing.'}</p>
            </div>
            <span className={`chip ${setupStatus?.configured ? 'success' : 'neutral'}`}>
              {setupStatus?.configured ? 'Configured' : 'Needs setup'}
            </span>
          </div>
          <div className="status-card">
            <div>
              <strong>Gemini usage today</strong>
              <p>{usage?.today || 0} / ~{usage?.limit_estimate || 1500} calls tracked for this workspace.</p>
            </div>
            <span className="chip neutral">Usage</span>
          </div>
        </div>

        <div className="form-grid" style={{ marginTop: 16 }}>
          <label>
            New Gemini API Key
            <input
              type="password"
              value={newApiKey}
              placeholder="AIza..."
              onChange={(e) => setNewApiKey(e.target.value)}
            />
          </label>
          <label>
            Model
            <input value={local.gemini_model || 'gemini-2.5-flash'} onChange={(e) => setLocal({ ...local, gemini_model: e.target.value })} />
          </label>
        </div>
        <div className="toolbar-inline" style={{ marginTop: 16 }}>
          <button className="secondary-button" type="button" onClick={runKeyTest}>
            Test connection
          </button>
          <button className="primary-button" type="button" onClick={saveKeyOnly}>
            Save key only
          </button>
          <a className="primary-link" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
            Get free key
          </a>
        </div>
        {keyTestState.message ? (
          <p className={`inline-note ${keyTestState.status === 'error' ? 'note-error' : keyTestState.status === 'success' ? 'note-success' : ''}`}>
            {keyTestState.message}
          </p>
        ) : null}
      </Panel>

      <Panel title="Resume source" subtitle="This CV text will be used for scanner evaluation and tailored resume generation">
        <div className="stack-gap">
          <label>
            Load CV from `.txt`, `.md`, or `.pdf`
            <input
              type="file"
              accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
                  try {
                    setPdfLoading(true);
                    const data = await uploadCvPdf(file);
                    setLocal((prev) => ({ ...prev, cv_content: data.cv_content }));
                  } finally {
                    setPdfLoading(false);
                  }
                  return;
                }
                const text = await file.text();
                setLocal((prev) => ({ ...prev, cv_content: text }));
              }}
            />
          </label>
          {pdfLoading ? <p className="muted-copy">Parsing PDF, please wait...</p> : null}
          <label>
            CV / Resume content preview
            <textarea
              className="text-area"
              rows="14"
              value={local.cv_content || ''}
              onChange={(e) => setLocal({ ...local, cv_content: e.target.value })}
            />
          </label>
          <button className="primary-button" type="button" onClick={saveProfile}>
            Save CV + Settings
          </button>
        </div>
      </Panel>

      <Panel title="Personal info" subtitle="Experience field explicitly added here">
        <div className="form-grid">
          <label>
            Full name
            <input value={local.name || ''} onChange={(e) => setLocal({ ...local, name: e.target.value })} />
          </label>
          <label>
            Experience level
            <select value={local.experience_level || 'fresher'} onChange={(e) => setLocal({ ...local, experience_level: e.target.value })}>
              <option value="fresher">fresher</option>
              <option value="0-1yr">0-1yr</option>
              <option value="1-3yr">1-3yr</option>
              <option value="3+yr">3+yr</option>
            </select>
          </label>
          <label>
            Experience years
            <input type="number" min="0" step="0.5" value={local.experience_years || 0} onChange={(e) => setLocal({ ...local, experience_years: Number(e.target.value) })} />
          </label>
          <label>
            Expected CTC
            <input value={local.expected_ctc_lpa || ''} onChange={(e) => setLocal({ ...local, expected_ctc_lpa: e.target.value })} />
          </label>
          <label>
            Target roles
            <textarea className="text-area" rows="4" value={(local.target_roles || []).join(', ')} onChange={(e) => setLocal({ ...local, target_roles: e.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} />
          </label>
          <label>
            Target locations
            <textarea className="text-area" rows="4" value={(local.target_locations || []).join(', ')} onChange={(e) => setLocal({ ...local, target_locations: e.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} />
          </label>
        </div>
        <button className="primary-button" type="button" onClick={saveProfile}>
          Save settings
        </button>
      </Panel>

      <Panel title="Companies" subtitle="Current companies.json driven roster">
        <p className="muted-copy">Bridge route scaffold is ready; company CRUD can be wired to database or JSON routes later.</p>
      </Panel>

      <Panel title="Danger zone" subtitle="Destructive controls intentionally not wired yet">
        <p className="muted-copy">Destructive reset actions will require backend confirmation once the database layer is active.</p>
      </Panel>
    </div>
  );
}
