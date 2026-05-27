import fs from 'fs';
import path from 'path';

const configPath = path.join(process.cwd(), 'config.json');
const envPath = path.join(process.cwd(), '_old_app/.env');

function parseEnv(envContent) {
  const result = {};
  const lines = envContent.split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*['"]?([^'"]*)['"]?/);
    if (match) {
      result[match[1]] = match[2];
    }
  }
  return result;
}

export function getConfig() {
  let config = {};
  
  // Try to load from config.json
  if (fs.existsSync(configPath)) {
    try {
      const data = fs.readFileSync(configPath, 'utf8');
      config = JSON.parse(data);
    } catch (e) {
      console.error('Failed to parse config.json:', e);
    }
  } else if (fs.existsSync(envPath)) {
    // Fallback to old .env if config.json doesn't exist yet
    try {
      const envData = fs.readFileSync(envPath, 'utf8');
      config = parseEnv(envData);
      // Migrate to config.json
      saveConfig(config);
    } catch (e) {
      console.error('Failed to parse .env fallback:', e);
    }
  }
  
  return {
    emailAddress: config.EMAIL_ADDRESS || '',
    emailPassword: config.EMAIL_PASSWORD || '',
    quikchexEmail: config.QUIKCHEX_EMAIL || '',
    quikchexPassword: config.QUIKCHEX_PASSWORD || '',
    companyId: config.COMPANY_ID || '',
    employeeId: config.EMPLOYEE_ID || ''
  };
}

export function saveConfig(newConfig) {
  const currentConfig = getConfig();
  
  // Map JS camelCase back to uppercase for storage (or just store it directly)
  const dataToSave = {
    EMAIL_ADDRESS: newConfig.emailAddress ?? currentConfig.emailAddress,
    EMAIL_PASSWORD: newConfig.emailPassword ?? currentConfig.emailPassword,
    QUIKCHEX_EMAIL: newConfig.quikchexEmail ?? currentConfig.quikchexEmail,
    QUIKCHEX_PASSWORD: newConfig.quikchexPassword ?? currentConfig.quikchexPassword,
    COMPANY_ID: newConfig.companyId ?? currentConfig.companyId,
    EMPLOYEE_ID: newConfig.employeeId ?? currentConfig.employeeId,
  };
  
  fs.writeFileSync(configPath, JSON.stringify(dataToSave, null, 2), 'utf8');
  return getConfig(); // Return normalized config
}
