import React from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import Login from './components/Login'
import Dashboard from './components/Dashboard'
import AQIDetailPage from './components/AQIDetailPage'
import WeatherDetailPage from './components/WeatherDetailPage'
import AqiCalendarPage from './pages/AqiCalendarPage'
import { AuthProvider, useAuth } from './context/AuthContext'
import './App.css'

const ProtectedRoute = ({ children }) => {
  const { isAuthenticated } = useAuth()
  return isAuthenticated ? children : <Navigate to="/login" replace />
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/aqi-detail"
            element={
              <ProtectedRoute>
                <AQIDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/weather-detail"
            element={
              <ProtectedRoute>
                <WeatherDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/aqi-calendar"
            element={
              <ProtectedRoute>
                <AqiCalendarPage />
              </ProtectedRoute>
            }
          />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  )
}

export default App
