// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

let lastReading = null;

app.post('/api/data', (req, res) => {
  const data = req.body;
  data.receivedAt = new Date().toISOString();

  // Compute simple status fields for frontend convenience
  data.status = computeStatus(data);

  lastReading = data;
  io.emit('sensor-data', data);
  res.json({ ok: true });
});

app.get('/api/last', (req, res) => {
  res.json(lastReading || {});
});

function computeStatus(d) {
  const s = { tempLevel: 'normal', dayOrNight: 'unknown' };
  const t = parseFloat(d.ds18b20_temp);
  if (!isNaN(t)) {
    if (t > 26.0) s.tempLevel = 'hot';
    else if (t < 19.0) s.tempLevel = 'cold';
  }
  if (typeof d.ldr_percent !== 'undefined') {
    s.dayOrNight = (d.ldr_percent > 40) ? 'day' : 'night';
  }
  return s;
}

io.on('connection', (socket) => {
  console.log('Client connected', socket.id);
  if (lastReading) socket.emit('sensor-data', lastReading);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server up on ${PORT}`));
