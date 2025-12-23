import { useState, useEffect } from 'react'

function App() {
  const [campaigns, setCampaigns] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [apiStatus, setApiStatus] = useState('checking...')

  useEffect(() => {
    checkBackendHealth()
  }, [])

  const checkBackendHealth = async () => {
    try {
      const response = await fetch('http://localhost:3000/health')
      const data = await response.json()
      setApiStatus(`✓ Backend running: ${data.service}`)
    } catch (err) {
      setApiStatus('✗ Backend not running on port 3000')
    }
  }

  const fetchCampaigns = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/campaigns')
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      setCampaigns(data.data || data)
      setLoading(false)
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }

  return (
    <div className="container">
      <h1>🎯 Campaigns Feature Test UI</h1>
      
      <div className="card">
        <h2>Backend Status</h2>
        <p>{apiStatus}</p>
        <button onClick={checkBackendHealth}>Refresh Status</button>
      </div>

      <div className="card">
        <h2>Campaigns List</h2>
        <button onClick={fetchCampaigns}>Fetch Campaigns</button>
        
        {loading && <div className="loading">Loading...</div>}
        
        {error && (
          <div className="error">
            <strong>Error:</strong> {error}
            <p>Make sure the backend is running: <code>cd backend && npm start</code></p>
          </div>
        )}
        
        {!loading && !error && campaigns.length === 0 && (
          <div className="success">No campaigns found. This is expected if the database is not set up.</div>
        )}
        
        {campaigns.length > 0 && (
          <div>
            <h3>Found {campaigns.length} campaign(s)</h3>
            {campaigns.map((campaign, idx) => (
              <div key={idx} className="card">
                <h4>{campaign.name || 'Unnamed Campaign'}</h4>
                <p><strong>Status:</strong> {campaign.status}</p>
                <p><strong>ID:</strong> {campaign.id}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2>📚 Quick Links</h2>
        <ul>
          <li><a href="http://localhost:3000/health" target="_blank">Backend Health Check</a></li>
          <li><a href="../backend/README.md">Backend README</a></li>
          <li><a href="../sdk/README.md">SDK README</a></li>
        </ul>
      </div>

      <div className="card">
        <h2>🧪 Test Instructions</h2>
        <ol>
          <li>Start backend: <code>cd backend && npm start</code></li>
          <li>Start this UI: <code>cd web && npm run dev</code></li>
          <li>Click "Fetch Campaigns" to test the API</li>
        </ol>
        <p><em>Note: This is a minimal test UI. For full LAD integration, set up the sandbox with LAD root.</em></p>
      </div>
    </div>
  )
}

export default App
