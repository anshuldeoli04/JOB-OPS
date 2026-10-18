import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Panel from '../components/ui/Panel';
import { useAppStore } from '../store/useAppStore';

export default function Setup() {
  const navigate = useNavigate();
  const config = useAppStore((state) => state.config);
  const setupStatus = useAppStore((state) => state.setupStatus);
  const saveConfig = useAppStore((state) => state.saveConfig);
  const testApiKey = useAppStore((state) => state.testApiKey);
  const uploadCvPdf = useAppStore((state) => state.uploadCvPdf);
  const [local, setLocal] = useState(config || {});
  const [apiKey, setApiKey] = useState('');
  const [keyState, setKeyState] = useState({ status: 'idle', message: '' });
  const [pdfLoading, setPdfLoading] = useState(false);

  useEffect(() => {
    setLocal(config || {});
  }, [config]);

  useEffect(() => {
    if (setupStatus?.configured) {
      navigate('/', { replace: true });
    }
  }, [navigate, setupStatus]);

  const completeSetup = async () => {
    const payload = { ...local, gemini_api_key: apiKey.trim() };
    await saveConfig(payload);
  };

  return (
    <div className="page-grid">
      <section className="hero-panel">
        <div>
          <div className="eyebrow">Setup</div>
          <h1>Finish your JOB-OPS onboarding.</h1>
          <p>Gemini key, profile, aur CV complete hote hi scanner/evaluator/resume flow ready ho jayega.</p>
        </div>
      </section>

      <Panel title="Step 1 - Gemini API key" subtitle="Key browser me plaintext readback nahi hoti">
        <div className="stack-gap">
          <label>
            Gemini API Key
            <input type="password" value={apiKey} placeholder="AIza..." onChange={(e) => setApiKey(e.target.value)} />
          </label>
          <div className="toolbar-inline">
            <button
              className="secondary-button"
              type="button"
              onClick={async () => {
                try {
                  setKeyState({ status: 'running', message: 'Testing key...' });
                  await testApiKey({ api_key: apiKey, gemini_model: local.gemini_model || 'gemini-2.5-flash' });
                  setKeyState({ status: 'success', message: 'API key is valid.' });
                } catch (error) {
                  setKeyState({
                    status: 'error',
                    message: error?.response?.data?.error || error?.message || 'Key validation failed.'
                  });
                }
              }}
            >
              Test connection
            </button>
            <a className="primary-link" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
              Get free key
            </a>
          </div>
          {keyState.message ? (
            <p className={`inline-note ${keyState.status === 'error' ? 'note-error' : keyState.status === 'success' ? 'note-success' : ''}`}>
              {keyState.message}
            </p>
          ) : null}
        </div>
      </Panel>

      <Panel title="Step 2 - Profile" subtitle="Targeting and experience preferences">
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
            Expected CTC
            <input value={local.expected_ctc_lpa || ''} onChange={(e) => setLocal({ ...local, expected_ctc_lpa: e.target.value })} />
          </label>
          <label>
            Model
            <input value={local.gemini_model || 'gemini-2.5-flash'} onChange={(e) => setLocal({ ...local, gemini_model: e.target.value })} />
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
      </Panel>

      <Panel title="Step 3 - CV" subtitle="Upload PDF or paste text">
        <div className="stack-gap">
          <label>
            Resume PDF
            <input
              type="file"
              accept=".pdf,application/pdf"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                try {
                  setPdfLoading(true);
                  const data = await uploadCvPdf(file);
                  setLocal((prev) => ({ ...prev, cv_content: data.cv_content }));
                } finally {
                  setPdfLoading(false);
                }
              }}
            />
          </label>
          {pdfLoading ? <p className="muted-copy">Parsing PDF resume...</p> : null}
          <label>
            CV content
            <textarea className="text-area" rows="12" value={local.cv_content || ''} onChange={(e) => setLocal({ ...local, cv_content: e.target.value })} />
          </label>
          <button className="primary-button" type="button" onClick={completeSetup}>
            Finish setup
          </button>
        </div>
      </Panel>
    </div>
  );
}
