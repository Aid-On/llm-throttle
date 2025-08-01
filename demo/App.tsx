import React, { useState, useEffect, useRef } from 'react'
import { LLMThrottle, RateLimitMetrics, ConsumptionRecord } from '@aid-on/llm-throttle'
import './App.css'

interface RequestAttempt {
  id: string
  timestamp: number
  tokens: number
  success: boolean
  reason?: string
}

function App() {
  const [rpm, setRpm] = useState(60)
  const [tpm, setTpm] = useState(1000)
  const [burstRpm, setBurstRpm] = useState(120)
  const [burstTpm, setBurstTpm] = useState(2000)
  const [tokenAmount, setTokenAmount] = useState(100)
  
  const [limiter, setLimiter] = useState<LLMThrottle | null>(null)
  const [metrics, setMetrics] = useState<RateLimitMetrics | null>(null)
  const [requestHistory, setRequestHistory] = useState<RequestAttempt[]>([])
  const [isAutoRequesting, setIsAutoRequesting] = useState(false)
  const [autoRequestInterval, setAutoRequestInterval] = useState(1000)
  const [autoRequestTokens, setAutoRequestTokens] = useState(150)
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const requestCounter = useRef(0)

  // Ensure burst limits are always >= base limits
  useEffect(() => {
    if (burstRpm < rpm) {
      setBurstRpm(rpm)
    }
  }, [rpm, burstRpm])

  useEffect(() => {
    if (burstTpm < tpm) {
      setBurstTpm(tpm)
    }
  }, [tpm, burstTpm])

  // Initialize limiter when config changes
  useEffect(() => {
    const newLimiter = new LLMThrottle({
      rpm,
      tpm,
      burstRPM: burstRpm,
      burstTPM: burstTpm
    })
    setLimiter(newLimiter)
    setRequestHistory([])
    setMetrics(newLimiter.getMetrics())
  }, [rpm, tpm, burstRpm, burstTpm])

  // Update metrics regularly
  useEffect(() => {
    if (!limiter) return

    const metricsInterval = setInterval(() => {
      setMetrics(limiter.getMetrics())
    }, 100)

    return () => clearInterval(metricsInterval)
  }, [limiter])

  // Handle auto requesting
  useEffect(() => {
    if (isAutoRequesting && limiter) {
      intervalRef.current = setInterval(() => {
        makeRequest(autoRequestTokens)
      }, autoRequestInterval)
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [isAutoRequesting, autoRequestInterval, autoRequestTokens, limiter])

  const makeRequest = (tokens: number) => {
    if (!limiter) return

    requestCounter.current += 1
    const requestId = `req-${requestCounter.current}`
    
    const canProcess = limiter.canProcess(tokens)
    const success = canProcess.allowed

    if (success) {
      limiter.consume(requestId, tokens)
    }

    const attempt: RequestAttempt = {
      id: requestId,
      timestamp: Date.now(),
      tokens,
      success,
      reason: canProcess.reason
    }

    setRequestHistory(prev => [attempt, ...prev.slice(0, 49)]) // Keep last 50
  }

  const handleSingleRequest = () => {
    makeRequest(tokenAmount)
  }

  const handleReset = () => {
    if (limiter) {
      limiter.reset()
      setRequestHistory([])
      setMetrics(limiter.getMetrics())
    }
  }

  const toggleAutoRequest = () => {
    setIsAutoRequesting(!isAutoRequesting)
  }

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('ja-JP', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3
    })
  }

  const getStatusColor = (success: boolean) => {
    return success ? '#28a745' : '#dc3545'
  }

  return (
    <div className="app">
      <header className="header">
        <h1>🚦 LLM Throttle Demo</h1>
        <p>@aid-on/llm-throttle のインタラクティブデモ</p>
      </header>

      <div className="demo-container">
        {/* Configuration Panel */}
        <div className="card">
          <h2>⚙️ 設定</h2>
          
          <div className="controls">
            <div className="control-group">
              <label>RPM (Requests Per Minute)</label>
              <div className="input-row">
                <input
                  type="number"
                  min="10"
                  max="100000"
                  value={rpm}
                  onChange={(e) => {
                    const newRpm = Math.max(10, Math.min(100000, Number(e.target.value) || 10))
                    setRpm(newRpm)
                    // Ensure burst RPM is always >= RPM
                    if (burstRpm < newRpm) {
                      setBurstRpm(newRpm)
                    }
                  }}
                  className="number-input"
                />
              </div>
            </div>

            <div className="control-group">
              <label>TPM (Tokens Per Minute)</label>
              <div className="input-row">
                <input
                  type="number"
                  min="100"
                  max="1000000"
                  step="100"
                  value={tpm}
                  onChange={(e) => {
                    const newTpm = Math.max(100, Math.min(1000000, Number(e.target.value) || 100))
                    setTpm(newTpm)
                    // Ensure burst TPM is always >= TPM
                    if (burstTpm < newTpm) {
                      setBurstTpm(newTpm)
                    }
                  }}
                  className="number-input"
                />
              </div>
            </div>

            <div className="control-group">
              <label>バーストRPM</label>
              <div className="input-row">
                <input
                  type="number"
                  min={rpm}
                  max="200000"
                  value={burstRpm}
                  onChange={(e) => {
                    const newBurstRpm = Math.max(rpm, Math.min(200000, Number(e.target.value) || rpm))
                    setBurstRpm(newBurstRpm)
                  }}
                  className="number-input"
                />
              </div>
            </div>

            <div className="control-group">
              <label>バーストTPM</label>
              <div className="input-row">
                <input
                  type="number"
                  min={tpm}
                  max="2000000"
                  step="100"
                  value={burstTpm}
                  onChange={(e) => {
                    const newBurstTpm = Math.max(tpm, Math.min(2000000, Number(e.target.value) || tpm))
                    setBurstTpm(newBurstTpm)
                  }}
                  className="number-input"
                />
              </div>
            </div>
          </div>

          <div className="controls">
            <div className="control-group">
              <label>リクエストトークン数</label>
              <div className="input-row">
                <input
                  type="number"
                  min="10"
                  max="50000"
                  step="10"
                  value={tokenAmount}
                  onChange={(e) => setTokenAmount(Math.max(10, Math.min(50000, Number(e.target.value) || 10)))}
                  className="number-input"
                />
              </div>
            </div>

            <div className="button-group">
              <button 
                className="btn btn-primary"
                onClick={handleSingleRequest}
                disabled={!limiter}
              >
                📤 リクエスト送信
              </button>
              <button 
                className="btn btn-danger"
                onClick={handleReset}
                disabled={!limiter}
              >
                🔄 リセット
              </button>
            </div>
          </div>

          <div className="auto-request-controls">
            <h3>自動リクエスト</h3>
            <div className="controls">
              <div className="control-group">
                <label>間隔 (ms)</label>
                <div className="input-row">
                  <input
                    type="number"
                    min="100"
                    max="60000"
                    step="100"
                    value={autoRequestInterval}
                    onChange={(e) => setAutoRequestInterval(Math.max(100, Math.min(60000, Number(e.target.value) || 100)))}
                    className="number-input"
                  />
                </div>
              </div>

              <div className="control-group">
                <label>トークン数</label>
                <div className="input-row">
                  <input
                    type="number"
                    min="50"
                    max="100000"
                    step="50"
                    value={autoRequestTokens}
                    onChange={(e) => setAutoRequestTokens(Math.max(50, Math.min(100000, Number(e.target.value) || 50)))}
                    className="number-input"
                  />
                </div>
              </div>

              <button 
                className={`btn ${isAutoRequesting ? 'btn-danger' : 'btn-primary'}`}
                onClick={toggleAutoRequest}
                disabled={!limiter}
              >
                {isAutoRequesting ? '⏹️ 停止' : '▶️ 開始'}
              </button>
            </div>
          </div>
        </div>

        {/* Metrics and History Panel */}
        <div className="card">
          <h2>📊 メトリクス & 履歴</h2>
          
          {metrics && (
            <div className="metrics">
              <div className="metrics-grid">
                <div className="metric-card">
                  <span className="metric-value">{Math.round(metrics.rpm.percentage)}%</span>
                  <div className="metric-label">RPM使用率</div>
                  <div className="progress-bar">
                    <div 
                      className="progress-fill" 
                      style={{ width: `${metrics.rpm.percentage}%` }}
                    />
                  </div>
                  <small>{metrics.rpm.used} / {metrics.rpm.limit}</small>
                </div>

                <div className="metric-card">
                  <span className="metric-value">{Math.round(metrics.tpm.percentage)}%</span>
                  <div className="metric-label">TPM使用率</div>
                  <div className="progress-bar">
                    <div 
                      className="progress-fill" 
                      style={{ width: `${metrics.tpm.percentage}%` }}
                    />
                  </div>
                  <small>{Math.round(metrics.tpm.used)} / {metrics.tpm.limit}</small>
                </div>
              </div>

              <div className="metrics-grid">
                <div className="metric-card">
                  <span className="metric-value">{metrics.consumptionHistory.count}</span>
                  <div className="metric-label">総リクエスト数</div>
                </div>

                <div className="metric-card">
                  <span className="metric-value">
                    {Math.round(metrics.consumptionHistory.averageTokensPerRequest)}
                  </span>
                  <div className="metric-label">平均トークン数</div>
                </div>
              </div>
            </div>
          )}

          <div className="history">
            <h3>📝 リクエスト履歴</h3>
            {requestHistory.length === 0 && (
              <p style={{ textAlign: 'center', color: '#666', margin: '2rem 0' }}>
                リクエストがまだありません
              </p>
            )}
            {requestHistory.map((attempt) => (
              <div key={attempt.id} className="history-item">
                <span className="history-time">
                  {formatTime(attempt.timestamp)}
                </span>
                <span className="history-tokens">
                  {attempt.tokens} tokens
                </span>
                <span 
                  className={`history-status ${attempt.success ? 'success' : 'failed'}`}
                >
                  {attempt.success ? '✅ 成功' : `❌ ${attempt.reason === 'rpm_limit' ? 'RPM制限' : 'TPM制限'}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <footer className="footer">
        <p>
          Built with <a href="https://github.com/Aid-On/llm-throttle" target="_blank" rel="noopener noreferrer">
            @aid-on/llm-throttle
          </a>
        </p>
      </footer>
    </div>
  )
}

export default App