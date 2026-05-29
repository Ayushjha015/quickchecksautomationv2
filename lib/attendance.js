import imaps from 'imap-simple';
import { simpleParser } from 'mailparser';
import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import * as cheerio from 'cheerio';
import { getConfig } from './config';
import fs from 'fs';
import path from 'path';

const MAX_WAIT_TIME = 300; // 5 minutes
const BASE_URL = 'https://secure.quikchex.in';

const commonHeaders = {
  'Accept-Language': 'en-US,en;q=0.9',
  'Connection': 'keep-alive',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-GPC': '1',
  'User-Agent': 'Mozilla/5.0 (Linux; Android 5.0; SM-G900P Build/LRX21T) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36',
  'sec-ch-ua': '"Brave";v="135", "Not-A.Brand";v="8", "Chromium";v="135"',
  'sec-ch-ua-mobile': '?1',
  'sec-ch-ua-platform': '"Android"'
};

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function detectImapServer(emailAddress) {
  const domain = emailAddress.split('@')[1]?.toLowerCase() || '';
  const imapServers = {
    'gmail.com': 'imap.gmail.com',
    'outlook.com': 'imap-mail.outlook.com',
    'hotmail.com': 'imap-mail.outlook.com',
    'yahoo.com': 'imap.mail.yahoo.com',
    'yahoo.co.in': 'imap.mail.yahoo.com',
    'rediffmail.com': 'imap.rediffmail.com',
    'zoho.com': 'imap.zoho.com',
  };
  return imapServers[domain] || 'imap.gmail.com';
}

function extractOtp(content) {
  const patterns = [
    /(\d{6})\s+is your One-Time Password/i,
    /Your OTP is\s+(\d{6})/i,
    /verification code is\s+(\d{6})/i,
    /\b(\d{6})\b/
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return null;
}

// IMAP helper logic removed in favor of persistent connection

export async function runAttendanceAutomation(onProgress = () => {}) {
  const config = getConfig();
  
  if (!config.emailAddress || !config.emailPassword || !config.quikchexEmail || !config.quikchexPassword || !config.companyId || !config.employeeId) {
    throw new Error('Configuration is incomplete. Please fill in all settings.');
  }

  const jar = new CookieJar();
  const client = wrapper(axios.create({ jar }));
  
  let imapConnection;

  try {
    onProgress("Getting login page and tokens...");
    console.log("Step 1: Getting login page and tokens...");
    const loginPageRes = await client.get(`${BASE_URL}/users/sign_in`, { headers: commonHeaders });
    
    const $login = cheerio.load(loginPageRes.data);
    const authToken = $login('input[name="authenticity_token"]').val();
    
    if (!authToken) {
      throw new Error('Failed to get authenticity token');
    }

    const imapConfig = {
      imap: {
        user: config.emailAddress,
        password: config.emailPassword,
        host: detectImapServer(config.emailAddress),
        port: 993,
        tls: true,
        tlsOptions: { rejectUnauthorized: false },
        authTimeout: 10000
      }
    };

    // ─── PARALLEL: Start IMAP connection while doing QuikChex login ───────────
    const imapPromise = (async () => {
      const conn = await imaps.connect(imapConfig);
      await conn.openBox('INBOX');
      // Fetch HEADERS only (much faster than full bodies) just to get UIDs
      const initial = await conn.search(
        [['FROM', 'support@quikchex.in']],
        { bodies: ['HEADER'], markSeen: false }
      );
      let maxUid = 0;
      for (const msg of initial) {
        if (msg.attributes.uid > maxUid) maxUid = msg.attributes.uid;
      }
      return { conn, maxUid };
    })();

    onProgress("Logging in...");
    console.log("Step 2: Logging in...");
    const loginData = new URLSearchParams();
    loginData.append('utf8', '✓');
    loginData.append('authenticity_token', authToken);
    loginData.append('user[email]', config.quikchexEmail);
    loginData.append('user[password]', config.quikchexPassword);
    loginData.append('user[remember_me]', '0');

    await client.post(`${BASE_URL}/users/sign_in`, loginData.toString(), {
      headers: {
        ...commonHeaders,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': BASE_URL,
        'Referer': `${BASE_URL}/users/sign_in`,
      },
      maxRedirects: 5
    });

    onProgress("Loading dashboard to get CSRF token...");
    console.log("Step 3: Loading dashboard to get CSRF token...");
    const dashboardRes = await client.get(`${BASE_URL}/`, { headers: commonHeaders });
    const $dashboard = cheerio.load(dashboardRes.data);
    let csrfToken = $dashboard('meta[name="csrf-token"]').attr('content');
    
    if (!csrfToken) {
      const scriptMatch = dashboardRes.data.match(/X-CSRF-Token["\']:\s*["\']([^"\']+)["\']/i);
      if (scriptMatch) csrfToken = scriptMatch[1];
    }
    if (!csrfToken) {
      csrfToken = authToken;
    }

    // ─── Wait for IMAP (should already be done by now) ────────────────────────
    onProgress("Securing inbox context...");
    let maxUid;
    try {
      const result = await imapPromise;
      imapConnection = result.conn;
      maxUid = result.maxUid;
    } catch (e) {
      throw new Error("Failed to connect to email server: " + e.message);
    }

    onProgress("Requesting OTP email...");
    console.log("Step 4: Requesting OTP email...");
    await client.post(`${BASE_URL}/send_opt_email`, '', {
      headers: {
        ...commonHeaders,
        'X-CSRF-Token': csrfToken,
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': `${BASE_URL}/`,
        'Origin': BASE_URL,
      }
    });

    onProgress("Waiting for OTP email...");
    console.log("Waiting for OTP email...");
    const startTime = Date.now();
    let otp = null;
    // Search only for messages with UID strictly greater than maxUid
    const newMailCriteria = [['FROM', 'support@quikchex.in'], ['UID', `${maxUid + 1}:*`]];

    while (Date.now() - startTime < MAX_WAIT_TIME * 1000) {
      const messages = await imapConnection.search(newMailCriteria, { bodies: [''], markSeen: false });
      messages.sort((a, b) => b.attributes.uid - a.attributes.uid);
      
      for (const msg of messages) {
        if (msg.attributes.uid > maxUid) {
          const part = msg.parts.find(p => p.which === '');
          if (part) {
            const parsed = await simpleParser(part.body);
            const extracted = extractOtp(parsed.text || parsed.html || '');
            if (extracted) {
              await imapConnection.addFlags(msg.attributes.uid, '\\Seen');
              otp = extracted;
              break;
            }
          }
        }
      }
      
      if (otp) break;
      await delay(2000);
    }

    imapConnection.end();

    if (!otp) {
      throw new Error('Timed out waiting for OTP email');
    }

    onProgress(`Submitting OTP: ${otp}`);
    console.log(`Step 5: Submitting OTP: ${otp}`);
    const otpData = new URLSearchParams();
    otpData.append('utf8', '✓');
    otpData.append('authenticity_token', csrfToken);
    otpData.append('otp_data', otp);

    const otpRes = await client.post(`${BASE_URL}/get_otp`, otpData.toString(), {
      headers: {
        ...commonHeaders,
        'X-CSRF-Token': csrfToken,
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Origin': BASE_URL,
        'Referer': `${BASE_URL}/`,
      }
    });
    
    if (!otpRes.data.includes('window.location') && !otpRes.data.toLowerCase().includes('success')) {
        // Try simplified submission
        const otpData2 = new URLSearchParams();
        otpData2.append('otp_data', otp);
        const otpRes2 = await client.post(`${BASE_URL}/get_otp`, otpData2.toString(), {
            headers: {
                ...commonHeaders,
                'X-CSRF-Token': csrfToken,
                'X-Requested-With': 'XMLHttpRequest',
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Origin': BASE_URL,
                'Referer': `${BASE_URL}/`,
            }
        });
        if (!otpRes2.data.includes('window.location') && !otpRes2.data.toLowerCase().includes('success')) {
           throw new Error('OTP verification failed');
        }
    }

    onProgress("Marking attendance...");
    console.log("Step 6: Marking attendance...");
    // Refresh dashboard for new token
    const dashboardRes2 = await client.get(`${BASE_URL}/`, { headers: commonHeaders });
    const $dash2 = cheerio.load(dashboardRes2.data);
    let csrfToken2 = $dash2('meta[name="csrf-token"]').attr('content') || csrfToken;

    const attendanceUrl = `${BASE_URL}/companies/${config.companyId}/employees/${config.employeeId}/employee_daily_attendances/create_attendance_record.js?from_dashboard=true`;
    
    const attendanceRes = await client.get(attendanceUrl, {
      headers: {
        ...commonHeaders,
        'X-CSRF-Token': csrfToken2,
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': `${BASE_URL}/`,
      }
    });

    const checkInMatch = attendanceRes.data.match(/Check In:\s*([\d:]+\s*[AP]M)/);
    const checkOutMatch = attendanceRes.data.match(/Check Out:\s*([\d:]+\s*[AP]M)/);
    
    if (!checkInMatch && !checkOutMatch) {
        // Did not match the expected pattern, but might still have worked if we didn't get an explicit error
        if (attendanceRes.status !== 200) {
            throw new Error(`Attendance marking failed with status ${attendanceRes.status}`);
        }
    }

    const cookies = await jar.getCookies(BASE_URL);
    const cookieArray = cookies.map(c => ({
      name: c.key,
      value: c.value,
      domain: c.domain || 'secure.quikchex.in',
      path: c.path || '/',
      secure: c.secure ?? true,
      httpOnly: c.httpOnly ?? true
    }));

    try {
      const sessionPath = path.join(process.cwd(), 'session.json');
      fs.writeFileSync(sessionPath, JSON.stringify(cookieArray, null, 2), 'utf8');
    } catch (err) {
      console.error('Failed to save session cookies:', err);
    }

    return {
      success: true,
      check_in: checkInMatch ? checkInMatch[1].trim() : null,
      check_out: checkOutMatch ? checkOutMatch[1].trim() : null,
      cookies: cookieArray
    };

  } catch (error) {
    if (imapConnection) {
      try { imapConnection.end(); } catch (e) {}
    }
    console.error('Automation Error:', error.message);
    throw new Error(error.message);
  }
}
