/**
 * Apollo Python Service
 * LAD Architecture Compliant - Python script execution
 * 
 * Handles calling Python Apollo service scripts with proper path resolution.
 * Uses LAD_SCRIPTS_PATH environment variable (LAD architecture compliant).
 */

const path = require('path');
const { spawn, execSync } = require('child_process');
const logger = require('../../../core/utils/logger');

class ApolloPythonService {
  /**
   * Call Python Apollo service script
   * Uses LAD_SCRIPTS_PATH environment variable (LAD architecture compliant)
   * Falls back to API endpoint if Python script is not available
   * 
   * @param {string} method - Method name to call
   * @param {Object} params - Parameters to pass
   * @returns {Promise<any>} Result from Python script
   */
  async callApolloService(method, params = {}) {
    return new Promise((resolve, reject) => {
      // LAD RULE: Use environment variable, NEVER guess paths
      // Path guessing is FORBIDDEN in LAD architecture
      let scriptPath = this._findScriptPath();
      
      if (!scriptPath) {
        logger.warn('[Apollo Python] Python script not found. Set LAD_SCRIPTS_PATH or APOLLO_SERVICE_SCRIPT_PATH env var.');
        logger.debug('[Apollo Python] For local dev: cd LAD/backend && ln -s ./core/scripts ./scripts && export LAD_SCRIPTS_PATH=$(pwd)/scripts');
        reject(new Error('Python script not found - will use API endpoint'));
        return;
      }
      
      const pythonExec = this._findPythonExecutable();
      if (!pythonExec) {
        reject(new Error('Python not found - will use API endpoint'));
        return;
      }
      
      logger.debug('[Apollo Python] Using Python executable', { executable: pythonExec, script: scriptPath });
      const pythonProcess = spawn(pythonExec, [scriptPath, method, JSON.stringify(params)]);
      
      let output = '';
      let error = '';
      
      // Handle spawn errors
      pythonProcess.on('error', (spawnError) => {
        reject(new Error(`Python process error: ${spawnError.message}`));
      });
      
      pythonProcess.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      pythonProcess.stderr.on('data', (data) => {
        const errorText = data.toString();
        error += errorText;
        logger.debug('[Apollo Python] [Python]', { output: errorText.trim() });
      });
      
      pythonProcess.on('close', (code) => {
        if (code === 0) {
          try {
            const result = this._parsePythonOutput(output);
            resolve(result);
          } catch (e) {
            logger.error('[Apollo Python] JSON Parse Error', { error: e.message, output: output.substring(0, 500) });
            reject(new Error('Failed to parse Python output: ' + e.message));
          }
        } else {
          reject(new Error('Python process failed: ' + error));
        }
      });
    });
  }

  /**
   * Find Python script path using LAD architecture rules
   * @private
   * @returns {string|null} Script path or null
   */
  _findScriptPath() {
    const fs = require('fs');
    
    // Priority 1: LAD_SCRIPTS_PATH (for local development with symlink)
    if (process.env.LAD_SCRIPTS_PATH) {
      const candidatePath = path.join(process.env.LAD_SCRIPTS_PATH, 'apollo_service.py');
      if (fs.existsSync(candidatePath)) {
        logger.debug('[Apollo Python] Using script from LAD_SCRIPTS_PATH', { path: candidatePath });
        return candidatePath;
      }
    }
    
    // Priority 2: APOLLO_SERVICE_SCRIPT_PATH (direct path override)
    if (process.env.APOLLO_SERVICE_SCRIPT_PATH) {
      if (fs.existsSync(process.env.APOLLO_SERVICE_SCRIPT_PATH)) {
        logger.debug('[Apollo Python] Using script from APOLLO_SERVICE_SCRIPT_PATH', { path: process.env.APOLLO_SERVICE_SCRIPT_PATH });
        return process.env.APOLLO_SERVICE_SCRIPT_PATH;
      }
    }
    
    // Priority 3: Standard LAD location (when merged to LAD)
    const standardPath = path.join(process.cwd(), 'backend', 'shared', 'services', 'apollo_service.py');
    if (fs.existsSync(standardPath)) {
      logger.debug('[Apollo Python] Using script from standard LAD location', { path: standardPath });
      return standardPath;
    }
    
    return null;
  }

  /**
   * Find Python executable
   * @private
   * @returns {string|null} Python executable name or null
   */
  _findPythonExecutable() {
    const pythonExecs = ['python3', 'python', 'py'];
    
    for (const exec of pythonExecs) {
      try {
        execSync(`${exec} --version`, { stdio: 'ignore' });
        return exec;
      } catch (e) {
        // Try next executable
      }
    }
    
    return null;
  }

  /**
   * Parse Python script output to extract JSON
   * @private
   * @param {string} output - Raw output from Python script
   * @returns {any} Parsed JSON result
   */
  _parsePythonOutput(output) {
    let jsonString = output.trim();
    
    // Find the first '{' or '[' to identify where JSON starts
    const firstBrace = jsonString.indexOf('{');
    const firstBracket = jsonString.indexOf('[');
    let jsonStart = -1;
    let startChar = '';
    
    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
      jsonStart = firstBrace;
      startChar = '{';
    } else if (firstBracket !== -1) {
      jsonStart = firstBracket;
      startChar = '[';
    }
    
    if (jsonStart > 0) {
      jsonString = jsonString.substring(jsonStart);
    }
    
    // Find matching closing bracket/brace
    let depth = 0;
    let jsonEnd = -1;
    const endChar = startChar === '{' ? '}' : ']';
    
    for (let i = 0; i < jsonString.length; i++) {
      if (jsonString[i] === startChar) {
        depth++;
      } else if (jsonString[i] === endChar) {
        depth--;
        if (depth === 0) {
          jsonEnd = i;
          break;
        }
      }
    }
    
    if (jsonEnd !== -1) {
      jsonString = jsonString.substring(0, jsonEnd + 1);
    }
    
    const result = JSON.parse(jsonString);
    
    // Handle different response formats
    if (result.success !== undefined && result.employees) {
      return result;
    } else if (result.companies) {
      return result.companies;
    } else if (result.leads) {
      return result.leads;
    } else if (result.employees && !result.success) {
      return result.employees;
    } else if (Array.isArray(result)) {
      return result;
    } else {
      return result;
    }
  }
}

module.exports = new ApolloPythonService();

