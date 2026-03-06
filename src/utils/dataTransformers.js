/**
 * Data transformation utilities for height-based data selection
 * 
 * API Response Structure:
 * - Regular fields: aqi, pm2_5, pm10, co, no2, so2, o3 (for 3 meter above)
 * - _0to3m fields: aqi_0to3m, pm2_5_0to3m, pm10_0to3m, etc. (for 0-3 meter)
 */

/**
 * Extract data based on selected height
 * @param {Object} data - Raw API response data
 * @param {string} selectedHeight - '0-3meter' or '3meter-above'
 * @returns {Object} - Transformed data with standard field names
 */
export const extractDataByHeight = (data, selectedHeight) => {
  if (!data || typeof data !== 'object') return data
  
  // If no height is selected or it's '3meter-above', use regular fields (no transformation)
  if (!selectedHeight || selectedHeight === '3meter-above') {
    return data
  }
  
  // If '0-3meter' is selected, extract _0to3m fields and map them to regular field names
  if (selectedHeight === '0-3meter') {
    const result = { ...data }
    
    // First, check if _0to3m fields exist
    const has0to3mFields = Object.keys(data).some(key => key.endsWith('_0to3m'))
    console.log(`[Height Transform] selectedHeight: ${selectedHeight}, has _0to3m fields: ${has0to3mFields}`)
    console.log(`[Height Transform] Available keys:`, Object.keys(data))
    
    // Map all _0to3m fields to regular field names (this will overwrite regular fields)
    Object.keys(data).forEach(key => {
      if (key.endsWith('_0to3m')) {
        const baseKey = key.replace('_0to3m', '')
        const originalValue = result[baseKey]
        const newValue = data[key]
        result[baseKey] = newValue
        // Debug log to verify transformation
        console.log(`[Height Transform] Mapping ${key} (${newValue}) → ${baseKey} (was: ${originalValue})`)
      }
    })
    
    // Debug log to show transformation result
    console.log(`[Height Transform] Original AQI: ${data.aqi}, aqi_0to3m: ${data.aqi_0to3m}, Transformed AQI: ${result.aqi}`)
    
    return result
  }
  
  return data
}

/**
 * Transform array of records based on selected height
 * @param {Array} records - Array of record objects
 * @param {string} selectedHeight - '0-3meter' or '3meter-above'
 * @returns {Array} - Array of transformed records
 */
export const transformRecordsByHeight = (records, selectedHeight) => {
  if (!Array.isArray(records)) return records
  
  return records.map(record => extractDataByHeight(record, selectedHeight))
}

