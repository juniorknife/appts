import { useEffect, useState } from 'react'
import { ServerList } from './components/ServerList'
import { ServerView } from './components/ServerView'
import { StreamPlayer } from './components/StreamPlayer'
import { useApp } from './lib/client'

export function App() {
  const { phase, toast } = useApp()
  return (
    <>
      {phase === 'idle' ? <ServerList /> : <ServerView />}
      <StreamPlayer />
      <Toast toast={toast} />
    </>
  )
}

function Toast({ toast }: { toast?: { text: string; at: number } }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!toast) return
    setVisible(true)
    const t = setTimeout(() => setVisible(false), 3500)
    return () => clearTimeout(t)
  }, [toast])
  if (!toast || !visible) return null
  return (
    <div className="toast" role="status" onClick={() => setVisible(false)}>
      {toast.text}
    </div>
  )
}
