// Example usage of AQIAnalysisReport component

import React from 'react'
import AQIAnalysisReport from './AQIAnalysisReport'

const ExampleUsage = () => {
  // Option 1: Fetch dynamically from API (recommended)
  const latitude = 19.0760
  const longitude = 72.8777
  const date = '2025-12-13'

  return (
    <div>
      {/* Dynamic fetch from API */}
      <AQIAnalysisReport 
        latitude={latitude}
        longitude={longitude}
        date={date}
      />
    </div>
  )
}

// Option 2: Use static analysis data
const ExampleWithStaticData = () => {
  const analysisText = `1. Why AQI is elevated
   - The AQI is elevated at 115, indicating poor air quality. 
   - Referring to the CURRENT HOUR data, the AQI is elevated due to high concentrations of multiple pollutants. 
   - The daily trend shows that pollution levels have been increasing throughout the day, with a significant spike in the morning hours and a gradual decrease in the evening hours.

2. Main contributing pollutants
   - The prime pollutant for the CURRENT HOUR is PM2.5, with a concentration of 41.3 µg/m³.
   - This is supported by the daily trend, which shows that PM2.5 concentrations have been consistently high throughout the day, with a peak of 54.1 µg/m³ at 06:00.

3. Why those pollutants increase
   - The high PM2.5 concentrations are likely due to a combination of factors, including:
     • Traffic: Diesel vehicles are a significant contributor to PM2.5 emissions, and the daily trend suggests that traffic congestion may have been higher in the morning hours.
     • Industry: Industrial activities, such as construction and manufacturing, can also release PM2.5 into the air.
     • Weather conditions: Wind direction and speed can affect the dispersion of pollutants, and the daily trend suggests that wind speeds may have been lower in the morning hours, contributing to higher PM2.5 concentrations.

4. How they raise AQI
   - The AQI is calculated based on the concentration of pollutants, with different thresholds for each category:
     • Good: 0-50 µg/m³
     • Moderate: 51-100 µg/m³
     • Poor: 101-150 µg/m³
     • Unhealthy: 151-200 µg/m³
   - The CURRENT HOUR data shows that the AQI is at 115, which is above the threshold for poor air quality.

5. Mitigation (individual + city level)
   - Individual actions:
     • Reducing the number of vehicles on the road by 10,000 vehicles/day may lower PM2.5 concentrations by 5-10 µg/m³.
     • Encouraging the use of public transportation or carpooling may reduce PM2.5 emissions by 10-20%.
   - City / policy actions:
     • Implementing a 30-40% reduction in diesel traffic through policies such as congestion pricing or low-emission zones may shift the AQI down by one category.
     • Eliminating open burning and implementing stricter regulations on industrial activities may reduce PM2.5 concentrations by 15-25%.

6. Short outlook for next hour (PREDICTION)
   - **Prediction:** The AQI is predicted to remain at a poor level, with a possible increase in PM2.5 concentrations due to the ongoing traffic congestion and industrial activities.`

  return (
    <div>
      {/* Static data */}
      <AQIAnalysisReport analysisData={analysisText} />
    </div>
  )
}

export default ExampleUsage

