import { useState, useEffect } from 'react'

export default function App() {
  const [installPrompt, setInstallPrompt] = useState(null)

  useEffect(() => {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault()
      setInstallPrompt(e)
    })
  }, [])

  const handleInstall = () => {
    if (!installPrompt) return
    installPrompt.prompt()
    installPrompt.userChoice.then((choice) => {
      if (choice.outcome === 'accepted') console.log('PWA installed')
      setInstallPrompt(null)
    })
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
      <h1>ThreadMyMail</h1>
      <p>AI-powered email harness. PWA Phase 1.</p>
      <ul>
        <li>OpenRouter AI (key configured)</li>
        <li>Multi-account email (Gmail, Outlook)</li>
        <li>PWA: installable, offline-capable</li>
        <li>APK: coming after PWA</li>
      </ul>
      {installPrompt && (
        <button onClick={handleInstall} style={{ padding: '0.75rem 1.5rem', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
          Install App
        </button>
      )}
    </div>
  )
}
