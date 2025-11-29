// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const twilio = require('twilio');
const cors = require('cors');
const dotenv = require("dotenv");
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Twilio config (use environment variables or fallbacks) ---
const TWILIO_SID = process.env.TWILIO_SID || "";
const TWILIO_TOKEN = process.env.TWILIO_TOKEN || "";
const TWILIO_FROM = process.env.TWILIO_FROM || "";
const ALERT_TO = process.env.ALERT_TO || "";

let twilioClient = null;
if (TWILIO_SID && TWILIO_TOKEN) {
  twilioClient = twilio(TWILIO_SID, TWILIO_TOKEN);
  console.log("Twilio configured");
} else {
  console.warn("Twilio not configured - SMS won't be sent.");
}

// --- runtime state ---
let lastReading = null;

// --- Alert control variables ---
// alertSent: true if we've already sent an alert while temp was in the alert range.
// lastAlertTime: timestamp of last sent alert (useful if you add cooldown)
let alertSent = false;
let lastAlertTime = 0;

// Optional cooldown in milliseconds (set to 0 to disable cooldown behavior)
const ALERT_COOLDOWN_MS = 0; // e.g., 6 * 60 * 60 * 1000 for 6 hours

// Utility: send SMS if Twilio is configured (returns a Promise or null)
function trySendSms(msg) {
  if (twilioClient && TWILIO_FROM && ALERT_TO) {
    return twilioClient.messages
      .create({ body: msg, from: TWILIO_FROM, to: ALERT_TO })
      .then(m => {
        console.log('SMS sent, SID:', m.sid);
        lastAlertTime = Date.now();
        return m;
      })
      .catch(err => {
        console.error('Twilio send error:', err);
        throw err;
      });
  } else {
    console.warn('Twilio not configured, skipping SMS.');
    return null;
  }
}

// Compute status for frontend convenience (pure function)
function computeStatus(d) {
  const s = { tempLevel: 'normal', dayOrNight: 'unknown' };

  const rawTemp = (typeof d.ds18b20_temp !== 'undefined') ? d.ds18b20_temp : d.temperature;
  const t = parseFloat(rawTemp);

  if (!isNaN(t)) {
    if (t > 26.0) s.tempLevel = 'hot';
    else if (t < 19.0) s.tempLevel = 'cold';
  }

  if (typeof d.ldr_percent !== 'undefined') {
    s.dayOrNight = (Number(d.ldr_percent) > 40) ? 'day' : 'night';
  }

  return s;
}

// Decide whether to send the alert SMS (ensures single-send behavior)
function sendAlertIfNeeded(temp) {
  if (isNaN(temp)) return;

  // Define alert window inclusive: 30 <= temp <= 35
  const lower = 30.0;
  const upper = 35.0;
  const inWindow = (temp >= lower && temp <= upper);

  // If in alert window and we haven't sent an alert (or cooldown passed), send one
  if (inWindow) {
    const now = Date.now();
    const cooldownPassed = (ALERT_COOLDOWN_MS === 0) || (now - lastAlertTime > ALERT_COOLDOWN_MS);

    if (!alertSent && cooldownPassed) {
      const msg = `ALERT!!! The Temperature Is Not Good For The WORMS (temp=${temp}°C)`;
      // fire-and-forget: call trySendSms but don't block response
      trySendSms(msg)
        .then(() => {
          alertSent = true;
        })
        .catch(() => {
          // If SMS failed, we keep alertSent false so it may retry later.
          console.warn('Failed to send SMS; will attempt again on next trigger if conditions hold.');
        });
    } else {
      // either already sent, or cooldown hasn't passed - do nothing
      // keep alertSent true after successful send
    }
  } else {
    // Temperature outside the alert window — reset alertSent so a new entry into the window will trigger a new SMS.
    if (alertSent) {
      console.log('Temperature left alert window; resetting alert flag so future alerts are possible.');
    }
    alertSent = false;
  }
}

// --- API endpoints ---
app.post('/api/data', (req, res) => {
  try {
    const data = req.body || {};
    data.receivedAt = new Date().toISOString();

    // Compute convenience fields and attach to the object we store/emit
    data.status = computeStatus(data);

    // store latest reading
    lastReading = data;

    // If temperature value exists, check and maybe send alert (non-blocking)
    const rawTemp = (typeof data.ds18b20_temp !== 'undefined') ? data.ds18b20_temp : data.temperature;
    const t = parseFloat(rawTemp);
    if (!isNaN(t)) {
      sendAlertIfNeeded(t);
    }

    // Emit to socket.io clients
    io.emit('sensor-data', data);

    return res.json({ ok: true });
  } catch (err) {
    console.error('Error processing /api/data:', err);
    return res.status(500).json({ ok: false, error: 'server error' });
  }
});

app.get('/api/last', (req, res) => {
  return res.json(lastReading || {});
});

// --- socket.io connection handler ---
io.on('connection', (socket) => {
  console.log('Client connected', socket.id);
  if (lastReading) {
    socket.emit('sensor-data', lastReading);
  }
  socket.on('disconnect', () => {
    console.log('Client disconnected', socket.id);
  });
});

// --- start server ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server up on ${PORT}`));
