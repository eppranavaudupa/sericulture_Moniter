// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Middlewares
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public')); // frontend

let lastReading = null;

// ------------------- API ROUTES -------------------

app.post('/api/data', (req, res) => {

  // FIX: Validate JSON body
  if (!req.body || typeof req.body !== "object") {
    return res.status(400).json({ error: "Invalid JSON received" });
  }

  const data = req.body;
  data.receivedAt = new Date().toISOString();
  data.status = computeStatus(data);

  lastReading = data;

  // Broadcast real-time data to all frontend clients
  io.emit('sensor-data', data);

  res.json({ ok: true });
});

app.get('/api/last', (req, res) => {
  res.json(lastReading || {});
});

// ------------------ STATUS LOGIC ------------------

function computeStatus(d) {
  const status = { tempCritical: false, tempMessage: 'normal', dayOrNight: 'unknown' };

  if (typeof d.temperature === 'number') {
    if (d.temperature >= 60) {
      status.tempCritical = true;
      status.tempMessage = 'HIGH_CRITICAL';
    } else if (d.temperature <= 15) {
      status.tempCritical = true;
      status.tempMessage = 'LOW_CRITICAL';
    }
  }

  if (typeof d.ldr_percent === 'number') {
    status.dayOrNight = d.ldr_percent > 40 ? 'day' : 'night';
  }

  return status;
}

// ------------------ SOCKET CONNECTION ------------------

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  if (lastReading) socket.emit('sensor-data', lastReading);
});

// ------------------ START SERVER ------------------

const PORT = 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));