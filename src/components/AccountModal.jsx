import React, { useState, useRef, useEffect } from 'react';
import { requestDeviceCode, pollDeviceToken } from '../api/innertube.js';

export default function AccountModal({
  isOpen,
  onClose,
  currentSession,
  onSaveSession,
  onClearSession,
  watchedCount = 0,
  onClearWatched = null
}) {
  const [deviceFlow, setDeviceFlow] = useState(null);
  const [isRequestingCode, setIsRequestingCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const abortRef = useRef(null);

  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, []);

  if (!isOpen) return null;

  const handleStartDeviceSignIn = async () => {
    setIsRequestingCode(true);
    setErrorMsg('');
    setStatusMsg('');

    if (abortRef.current) {
      abortRef.current.abort();
    }
    abortRef.current = new AbortController();

    try {
      const codeData = await requestDeviceCode();
      setDeviceFlow(codeData);
      setIsRequestingCode(false);

      // Do NOT automatically open in new tab — let user copy the code first
      try {
        const tokenData = await pollDeviceToken(codeData.deviceCode, codeData.interval, abortRef.current.signal);
        onSaveSession({
          ...currentSession,
          ...tokenData,
          savedAt: new Date().toISOString()
        });
        setDeviceFlow(null);
        setStatusMsg('Signed in successfully.');
      } catch (pollErr) {
        if (!abortRef.current?.signal?.aborted) {
          setErrorMsg(pollErr.message || 'Authorization failed.');
          setDeviceFlow(null);
        }
      }
    } catch (err) {
      setIsRequestingCode(false);
      setErrorMsg(err.message || 'Failed to request sign-in code.');
    }
  };

  const handleCancelDeviceSignIn = () => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    setDeviceFlow(null);
    setErrorMsg('');
  };

  const handleCopyCode = async () => {
    if (!deviceFlow?.userCode) return;
    try {
      await navigator.clipboard.writeText(deviceFlow.userCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const hasActiveSession = Boolean(currentSession?.accessToken || currentSession?.cookie || currentSession?.sapisid);

  return (
    <div className="modal-overlay active" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h3 className="sheet-title">Account</h3>
          <button type="button" className="sheet-close" onClick={onClose} title="Close">✕</button>
        </div>

        <div className="sheet-body" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {statusMsg && (
            <div style={{ padding: '10px 14px', background: 'rgba(52, 199, 89, 0.15)', color: 'var(--accent-green)', borderRadius: 8, fontSize: 13 }}>
              {statusMsg}
            </div>
          )}

          {errorMsg && (
            <div style={{ padding: '10px 14px', background: 'rgba(255, 59, 48, 0.15)', color: 'var(--accent-red)', borderRadius: 8, fontSize: 13 }}>
              {errorMsg}
            </div>
          )}

          {hasActiveSession ? (
            <div style={{ background: 'var(--bg-secondary)', padding: '16px', borderRadius: 12, border: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent-green)', display: 'inline-block' }} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Connected</span>
                </div>
                <button
                  type="button"
                  className="nav-btn"
                  style={{ color: 'var(--accent-red)', fontSize: 12, padding: '6px 14px' }}
                  onClick={() => {
                    onClearSession();
                    setStatusMsg('');
                  }}
                >
                  Sign Out
                </button>
              </div>
            </div>
          ) : (
            <div style={{ background: 'var(--bg-secondary)', padding: '20px', borderRadius: 14, border: '1px solid var(--border-subtle)' }}>
              {deviceFlow ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    Device Code
                  </div>
                  <div style={{
                    fontFamily: 'monospace',
                    fontSize: 28,
                    fontWeight: 700,
                    letterSpacing: '0.15em',
                    padding: '12px 24px',
                    background: 'rgba(255, 255, 255, 0.06)',
                    borderRadius: 10,
                    border: '1px solid var(--border-card)',
                    color: '#ffffff'
                  }}>
                    {deviceFlow.userCode}
                  </div>

                  <div style={{ display: 'flex', gap: 10, width: '100%', justifyContent: 'center' }}>
                    <button
                      type="button"
                      className="nav-btn"
                      onClick={handleCopyCode}
                      style={{ minWidth: 110, justifyContent: 'center' }}
                    >
                      {copied ? '✓ Copied' : 'Copy Code'}
                    </button>
                    <a
                      href={deviceFlow.verificationUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="nav-btn primary"
                      style={{ textDecoration: 'none', minWidth: 140, justifyContent: 'center' }}
                    >
                      Open google.com/device ↗
                    </a>
                  </div>

                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <span className="btn-spinner" style={{ width: 11, height: 11 }} />
                    <span>Waiting for approval on Google...</span>
                  </div>

                  <button
                    type="button"
                    className="nav-btn"
                    style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}
                    onClick={handleCancelDeviceSignIn}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="nav-btn primary"
                  style={{ width: '100%', justifyContent: 'center', padding: '12px 20px', fontSize: 14, fontWeight: 600 }}
                  disabled={isRequestingCode}
                  onClick={handleStartDeviceSignIn}
                >
                  {isRequestingCode ? (
                    <>
                      <span className="btn-spinner" />
                      <span>Generating Code...</span>
                    </>
                  ) : (
                    'Sign In with YouTube'
                  )}
                </button>
              )}
            </div>
          )}

          <div style={{ background: 'var(--bg-secondary)', padding: '14px 16px', borderRadius: 12, border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Watched History</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {watchedCount} {watchedCount === 1 ? 'video' : 'videos'} hidden
              </div>
            </div>
            {watchedCount > 0 && onClearWatched && (
              <button
                type="button"
                className="nav-btn"
                style={{ fontSize: 12, padding: '5px 12px' }}
                onClick={onClearWatched}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
