import { useState, useEffect } from 'react'
import './App.css'

interface User {
  displayName: string
}

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const response = await fetch('/api/me')
        if (response.ok) {
          const userData = await response.json()
          setUser(userData)
        }
      } catch (error) {
        console.error('Failed to fetch user', error)
      } finally {
        setLoading(false)
      }
    }

    fetchUser()
  }, [])

  const handleLogin = () => {
    window.location.href = '/auth/login'
  }

  const handleLogout = async () => {
    try {
      await fetch('/auth/logout')
    } catch (error) {
      console.error('Failed to logout', error)
    } finally {
      setUser(null)
    }
  }

  if (loading) {
    return <div>Loading...</div>
  }

  return (
    <div className="container">
      <h1>Chckmte</h1>
      {user ? (
        <div>
          <p>Welcome, {user.displayName}!</p>
          <button onClick={handleLogout}>Logout</button>
        </div>
      ) : (
        <div>
          <p>Please log in to continue.</p>
          <button onClick={handleLogin}>Login with Microsoft</button>
        </div>
      )}
    </div>
  )
}

export default App
