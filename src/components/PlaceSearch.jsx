import React, { useEffect, useState } from 'react'
import { searchPlaces } from '../services/geocoding'
import './PlaceSearch.css'

const MIN_QUERY_LENGTH = 2
const DEBOUNCE_MS = 350

// Rendered outside MapContainer so Leaflet's keyboard/drag handlers never see the input's events
const PlaceSearch = ({ map, selectedPlace, onSelect, onClear }) => {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [resultsQuery, setResultsQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < MIN_QUERY_LENGTH || trimmed === selectedPlace?.name) {
      setResults([])
      setLoading(false)
      setError(null)
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(() => {
      setLoading(true)
      setError(null)
      searchPlaces(trimmed, controller.signal)
        .then((places) => {
          setResults(places)
          setResultsQuery(trimmed)
          setActiveIndex(places.length ? 0 : -1)
        })
        .catch((err) => {
          if (err.name === 'AbortError') return
          setResults([])
          setResultsQuery(trimmed)
          setError('Search failed, please try again')
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, selectedPlace])

  const selectPlace = (place) => {
    setQuery(place.name)
    setResults([])
    setOpen(false)
    onSelect(place)
    if (!map) return
    if (place.bounds) {
      map.flyToBounds(place.bounds, { maxZoom: place.zoom, padding: [40, 40], duration: 1.2 })
    } else {
      map.flyTo([place.lat, place.lng], place.zoom, { duration: 1.2 })
    }
  }

  const clearSearch = () => {
    setQuery('')
    setResults([])
    setError(null)
    setOpen(false)
    onClear()
  }

  const handleKeyDown = (event) => {
    if (event.key === 'ArrowDown' && results.length) {
      event.preventDefault()
      setOpen(true)
      setActiveIndex(index => (index + 1) % results.length)
    } else if (event.key === 'ArrowUp' && results.length) {
      event.preventDefault()
      setActiveIndex(index => (index - 1 + results.length) % results.length)
    } else if (event.key === 'Enter' && results[activeIndex]) {
      event.preventDefault()
      selectPlace(results[activeIndex])
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  const trimmedQuery = query.trim()
  const searchable = trimmedQuery.length >= MIN_QUERY_LENGTH && trimmedQuery !== selectedPlace?.name
  const resultsAreCurrent = resultsQuery === trimmedQuery && !loading
  const showDropdown = open && searchable && (results.length > 0 || resultsAreCurrent)

  return (
    <div className="place-search">
      <div className="place-search-box">
        <svg className="place-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7"></circle>
          <line x1="20" y1="20" x2="16.65" y2="16.65"></line>
        </svg>
        <input
          type="text"
          value={query}
          placeholder="Search city, town or village"
          aria-label="Search places"
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={handleKeyDown}
        />
        {loading && <span className="place-search-spinner" aria-hidden="true" />}
        {query && !loading && (
          <button type="button" className="place-search-clear" onClick={clearSearch} aria-label="Clear search">
            ×
          </button>
        )}
      </div>

      {showDropdown && (
        <ul className="place-search-results" role="listbox">
          {error && <li className="place-search-message">{error}</li>}
          {!error && results.length === 0 && resultsAreCurrent && (
            <li className="place-search-message">No places found</li>
          )}
          {results.map((place, index) => (
            <li
              key={place.id}
              role="option"
              aria-selected={index === activeIndex}
              className={`place-search-result${index === activeIndex ? ' active' : ''}`}
              // mousedown fires before the input's blur closes the list
              onMouseDown={(e) => {
                e.preventDefault()
                selectPlace(place)
              }}
              onMouseEnter={() => setActiveIndex(index)}
            >
              <span className="place-search-name">{place.name}</span>
              <span className="place-search-meta">
                <span className="place-search-type">{place.type}</span>
                {place.context && ` · ${place.context}`}
              </span>
            </li>
          ))}
          {results.length > 0 && <li className="place-search-attribution">Search © OpenStreetMap contributors</li>}
        </ul>
      )}
    </div>
  )
}

export default PlaceSearch
