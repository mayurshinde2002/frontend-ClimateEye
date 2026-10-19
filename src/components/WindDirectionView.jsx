import React, { useEffect, useMemo, useState } from 'react'
import { fetchHourlyWeatherData } from '../services/api'
import './WindDirectionView.css'

const CARDINALS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']

const parseRecordTime = (value) => {
  if (!value) return null
  const date = new Date(String(value).replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? null : date
}

const finiteOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const cardinalFromDegrees = (degrees) => {
  const value = finiteOrNull(degrees)
  if (value === null) return null
  const normalized = ((value % 360) + 360) % 360
  return CARDINALS[Math.floor((normalized + 11.25) / 22.5) % 16]
}

const formatHour = (value) => {
  const date = parseRecordTime(value)
  if (!date) return ''
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

const WindDirectionView = ({ latitude, longitude, date }) => {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !date) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchHourlyWeatherData(latitude, longitude, date)
      .then((data) => {
        if (!cancelled) setRecords(data?.hourly_records || [])
      })
      .catch((err) => {
        if (!cancelled) {
          setRecords([])
          setError(err.message || 'Wind data could not be loaded')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [latitude, longitude, date])

  const hours = useMemo(() => (
    records
      .map((record) => ({
        ...record,
        time: parseRecordTime(record.date),
        speed: finiteOrNull(record.wind_speed),
        direction: finiteOrNull(record.wind_direction),
        gusts: finiteOrNull(record.wind_gusts),
        predicted: record.data_source === 'Prediction'
      }))
      .filter((record) => record.time)
      .sort((a, b) => a.time - b.time)
  ), [records])

  const current = useMemo(() => {
    const now = new Date()
    const past = hours.filter((record) => record.time <= now)
    return past.length ? past[past.length - 1] : null
  }, [hours])

  const maxSpeed = Math.max(1, ...hours.map((record) => record.speed || 0))
  const currentReadable = current && current.speed !== null && current.direction !== null
  const toward = currentReadable ? (current.direction + 180) % 360 : null
  const towardCardinal = cardinalFromDegrees(toward)

  return (
    <section className="wind-view">
      <div className="wind-view-header">
        <h2>Wind</h2>
        <p>Speed and direction at 10 m for the selected location and date.</p>
      </div>

      {loading && <p className="wind-view-status">Loading wind…</p>}
      {error && <p className="wind-view-status wind-view-error">{error}</p>}

      {!loading && !error && (
        <>
          <div className="wind-current">
            {currentReadable ? (
              <>
                <div className="wind-compass" aria-hidden="true">
                  <span className="wind-compass-label north">N</span>
                  <span className="wind-compass-label east">E</span>
                  <span className="wind-compass-label south">S</span>
                  <span className="wind-compass-label west">W</span>
                  <div className="wind-arrow" style={{ transform: `rotate(${toward}deg)` }}>
                    <svg viewBox="0 0 24 80" width="24" height="80">
                      <polygon points="12,0 22,22 14,22 14,78 10,78 10,22 2,22" fill="#14b8a6" />
                    </svg>
                  </div>
                </div>
                <div className="wind-current-values">
                  <div className="wind-speed">{current.speed.toFixed(1)} <span>km/h</span></div>
                  <div className="wind-cardinal">{current.wind_direction_cardinal || cardinalFromDegrees(current.direction)}</div>
                  <div className="wind-from">From {Math.round(current.direction)}°</div>
                  <div className="wind-toward">
                    Blowing toward {towardCardinal || '—'} ({Math.round(toward)}°)
                  </div>
                  {current.gusts !== null && <div className="wind-gusts">Gusts {current.gusts.toFixed(1)} km/h</div>}
                  {current.predicted && <div className="wind-predicted">Predicted</div>}
                </div>
              </>
            ) : (
              <p className="wind-view-status">No wind reading for the current hour.</p>
            )}
          </div>

          {hours.length > 0 && (
            <div className="wind-chart" aria-hidden="true">
              {hours.map((record) => (
                <div key={record.date} className={`wind-bar-slot${record.predicted ? ' predicted' : ''}`}>
                  <div
                    className="wind-bar"
                    style={{ height: record.speed === null ? 0 : `${Math.max(4, (record.speed / maxSpeed) * 100)}%` }}
                  />
                </div>
              ))}
            </div>
          )}

          <div className="wind-hour-list">
            {hours.length === 0 && <p className="wind-view-status">No hourly wind data for this date.</p>}
            {hours.map((record) => {
              const missing = record.speed === null || record.direction === null
              return (
                <div key={record.date} className={`wind-hour${record.date === current?.date ? ' current' : ''}`}>
                  <span className="wind-hour-time">{formatHour(record.date)}</span>
                  {missing ? (
                    <span className="wind-hour-empty">No wind data</span>
                  ) : (
                    <>
                      <span>{record.speed.toFixed(1)} km/h</span>
                      <span>{record.gusts === null ? '—' : `${record.gusts.toFixed(1)} km/h gusts`}</span>
                      <span>{record.wind_direction_cardinal || cardinalFromDegrees(record.direction)} {Math.round(record.direction)}°</span>
                    </>
                  )}
                  {record.predicted && <span className="wind-predicted">Predicted</span>}
                </div>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}

export default WindDirectionView
