import { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';

type OpsContext = 'command-centre' | 'customer-care' | 'maintenance-lead';

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [context, setContext] = useState<OpsContext>('command-centre');
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!email || !token) {
      setError('Work email and secure token are required.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const res = await api.login({ email, token, context });
      if (remember) {
        localStorage.setItem('reguarSession', JSON.stringify(res.session));
      } else {
        sessionStorage.setItem('reguarSession', JSON.stringify(res.session));
      }
      navigate('/dashboard');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <motion.div className="login-panel" initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }}>
        <div className="brand compact">
          <img src="/reguar-logo.svg" alt="Reguar" className="brand-logo" />
          <div>
            <h1>Reguar</h1>
            <p>Predictive Intelligence</p>
          </div>
        </div>
        <h2>System Access</h2>
        <p className="muted-text">Enter your credentials to manage critical infrastructure assets.</p>
        <div className="context-tabs">
          <button className={`context-tab ${context === 'command-centre' ? 'active' : ''}`} onClick={() => setContext('command-centre')}>Command Centre</button>
          <button className={`context-tab ${context === 'customer-care' ? 'active' : ''}`} onClick={() => setContext('customer-care')}>Customer Care</button>
          <button className={`context-tab ${context === 'maintenance-lead' ? 'active' : ''}`} onClick={() => setContext('maintenance-lead')}>Maintenance Lead</button>
        </div>
        <div className="field">
          <label>Work Email</label>
          <input placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label>Secure Token</label>
          <input type="password" placeholder="••••••••••" value={token} onChange={(e) => setToken(e.target.value)} />
        </div>
        <div className="login-meta-row">
          <label className="remember-label"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember station</label>
          <span className="muted-text">Recovery Key?</span>
        </div>
        {error && <p className="login-error">{error}</p>}
        <button className="primary-btn" disabled={submitting} onClick={submit}>{submitting ? 'Initializing...' : 'Initialize Session'}</button>
      </motion.div>
      <div className="login-visual">
        <div className="glass-card">
          <p className="tiny-tag">SYSTEM HEALTH: NOMINAL</p>
          <h3>The Intelligence Layer for Energy Resilience.</h3>
          <p>Reguar provides sentinel pulse for mission-critical power systems through predictive monitoring.</p>
        </div>
      </div>
    </div>
  );
}
