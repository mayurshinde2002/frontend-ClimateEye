import React, { useState, useEffect } from 'react'
import { fetchAQIAnalysis } from '../services/api'
import './AQIAnalysisReport.css'

const AQIAnalysisReport = ({ latitude, longitude, date, analysisData = null }) => {
  const [analysisText, setAnalysisText] = useState(analysisData)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    // If analysisData is provided directly, use it
    if (analysisData) {
      setAnalysisText(analysisData)
      return
    }

    // Otherwise, fetch from API if we have coordinates and date
    if (latitude && longitude && date) {
      fetchAnalysisData()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latitude, longitude, date, analysisData])

  const fetchAnalysisData = async () => {
    setLoading(true)
    setError(null)
    
    try {
      const response = await fetchAQIAnalysis(latitude, longitude, date)
      
      // Handle different possible response formats
      if (response.analysis) {
        setAnalysisText(response.analysis)
      } else if (response.data && response.data.analysis) {
        setAnalysisText(response.data.analysis)
      } else if (typeof response === 'string') {
        setAnalysisText(response)
      } else if (response.message) {
        setAnalysisText(response.message)
      } else {
        // If response is an object, try to stringify it or use a default message
        setAnalysisText(JSON.stringify(response, null, 2))
      }
    } catch (err) {
      console.error('Error fetching analysis:', err)
      setError(err.message || 'Failed to fetch analysis data')
    } finally {
      setLoading(false)
    }
  }
  // Parse the analysis text into structured sections
  const parseAnalysis = (text) => {
    if (!text) return null
    
    const sections = []
    const lines = text.split('\n')
    
    let currentSection = null
    let currentSubsection = null
    let currentParagraph = []
    
    const flushParagraph = () => {
      if (currentParagraph.length > 0 && currentSection) {
        const paragraphText = currentParagraph.join(' ').trim()
        if (paragraphText) {
          currentSection.content.push({ 
            type: 'paragraph', 
            text: paragraphText 
          })
        }
        currentParagraph = []
      }
    }
    
    lines.forEach((line, index) => {
      const trimmed = line.trim()
      if (!trimmed) {
        // Empty line - flush paragraph if we have one
        flushParagraph()
        return
      }
      
      // Check for main section (1. Why AQI is elevated, etc.)
      const mainSectionMatch = trimmed.match(/^(\d+)\.\s+(.+)$/)
      if (mainSectionMatch) {
        flushParagraph()
        if (currentSection) {
          sections.push(currentSection)
        }
        currentSection = {
          number: mainSectionMatch[1],
          title: mainSectionMatch[2],
          content: [],
          subsections: []
        }
        currentSubsection = null
        return
      }
      
      // Check for subsections (Individual actions:, City / policy actions:)
      const subsectionMatch = trimmed.match(/^-\s*(.+?):\s*$/)
      if (subsectionMatch) {
        flushParagraph()
        currentSubsection = {
          title: subsectionMatch[1],
          bullets: []
        }
        if (currentSection) {
          currentSection.subsections.push(currentSubsection)
        }
        return
      }
      
      // Check for bullet points (• or - at start, possibly indented)
      if (trimmed.startsWith('•') || (trimmed.startsWith('-') && !trimmed.startsWith('--'))) {
        flushParagraph()
        const bulletText = trimmed.replace(/^[•\-]\s*/, '').trim()
        if (bulletText && currentSection) {
          if (currentSubsection) {
            currentSubsection.bullets.push(bulletText)
          } else {
            currentSection.content.push({ type: 'bullet', text: bulletText })
          }
        }
        return
      }
      
      // Regular paragraph text
      if (trimmed && currentSection) {
        // Check if this looks like it should be a new paragraph
        const nextLine = index < lines.length - 1 ? lines[index + 1]?.trim() : ''
        const isNextBullet = nextLine.startsWith('•') || (nextLine.startsWith('-') && !nextLine.startsWith('--'))
        const isNextSection = /^\d+\.\s+/.test(nextLine)
        const isNextSubsection = /^-\s*(.+?):\s*$/.test(nextLine)
        const isNextEmpty = !nextLine
        
        // If next line is empty or starts a new section/bullet, flush current paragraph
        if (isNextEmpty || isNextBullet || isNextSection || isNextSubsection) {
          currentParagraph.push(trimmed)
          flushParagraph()
        } else {
          currentParagraph.push(trimmed)
        }
      }
    })
    
    // Flush any remaining paragraph and add the last section
    flushParagraph()
    if (currentSection) {
      sections.push(currentSection)
    }
    
    return sections
  }
  
  const sections = parseAnalysis(analysisText)
  
  if (loading) {
    return (
      <div className="aqi-analysis-report">
        <div className="analysis-header">
          <h2 className="analysis-title">AQI Analysis Report</h2>
        </div>
        <div className="loading-state">
          <div className="loading-spinner"></div>
          <p>Generating analysis report...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="aqi-analysis-report">
        <div className="analysis-header">
          <h2 className="analysis-title">AQI Analysis Report</h2>
        </div>
        <div className="error-state">
          <p className="error-message">Error: {error}</p>
          <button className="retry-button" onClick={fetchAnalysisData}>
            Retry
          </button>
        </div>
      </div>
    )
  }
  
  if (!sections || sections.length === 0) {
    return (
      <div className="aqi-analysis-report">
        <div className="analysis-header">
          <h2 className="analysis-title">AQI Analysis Report</h2>
        </div>
        <div className="no-analysis">
          <p>No analysis data available</p>
          {latitude && longitude && date && (
            <button className="retry-button" onClick={fetchAnalysisData}>
              Generate Analysis
            </button>
          )}
        </div>
      </div>
    )
  }
  
  return (
    <div className="aqi-analysis-report">
      <div className="analysis-header">
        <h2 className="analysis-title">AQI Analysis Report</h2>
        <div className="analysis-badge">AI-Powered Analysis</div>
      </div>
      
      <div className="analysis-sections">
        {sections.map((section, index) => (
          <div key={index} className="analysis-section">
            <div className="section-header">
              <div className="section-number">{section.number}</div>
              <h3 className="section-title">{section.title}</h3>
            </div>
            
            <div className="section-content">
              {section.content.map((item, itemIndex) => (
                <div key={itemIndex} className="content-item">
                  {item.type === 'bullet' ? (
                    <div className="bullet-point">
                      <span className="bullet-icon">•</span>
                      <span className="bullet-text">{item.text}</span>
                    </div>
                  ) : (
                    <p className="paragraph-text">{item.text}</p>
                  )}
                </div>
              ))}
              
              {section.subsections && section.subsections.length > 0 && (
                <div className="subsections">
                  {section.subsections.map((subsection, subIndex) => (
                    <div key={subIndex} className="subsection">
                      <h4 className="subsection-title">{subsection.title}</h4>
                      <div className="subsection-bullets">
                        {subsection.bullets.map((bullet, bulletIndex) => (
                          <div key={bulletIndex} className="bullet-point">
                            <span className="bullet-icon">•</span>
                            <span className="bullet-text">{bullet}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default AQIAnalysisReport

