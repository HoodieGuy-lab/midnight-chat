const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// --- Data storage ---
const DATA_FILE = 'data.json';
let data = { users: [], messages: [], rooms: ['Main', 'Tech', 'Gaming'] };
if (fs.existsSync(DATA_FILE)) {
  try {
    data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch (error) {
    console.error('Error reading data file:', error);
  }
}
function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error saving data:', error);
  }
}

// --- Middleware ---
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- File upload ---
const upload = multer({
  dest: 'public/uploads/',
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images allowed'));
  }
});

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ filePath: `/uploads/${req.file.filename}` });
});

// --- Routes ---
app.get('/rooms', (req, res) => res.json(data.rooms));

app.post('/messages', (req, res) => {
  const { username, message, room } = req.body;
  if (!username || !message || !room) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const msg = { username, message, room, timestamp: new Date() };
  data.messages.push(msg);
  saveData();
  io.to(room).emit('message', msg);
  res.json({ success: true });
});

// --- Socket.IO ---
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'midnight2025'; // Better to use environment variable

io.on('connection', socket => {
  let currentRoom = 'Main';
  socket.join(currentRoom);
  socket.emit('init', data.messages.filter(m => m.room === currentRoom));

  let isAdmin = false;

  socket.on('getRooms', () => {
    socket.emit('roomList', data.rooms);
  });

  socket.on('authenticateAdmin', (password, callback) => {
    if (password === ADMIN_PASSWORD) {
      isAdmin = true;
      callback({ success: true });
    } else {
      callback({ success: false });
    }
  });

  socket.on('joinRoom', room => {
    socket.leave(currentRoom);
    currentRoom = room;
    socket.join(room);
    const roomMessages = data.messages.filter(m => m.room === room);
    socket.emit('init', roomMessages);
    console.log(`${socket.id} joined room: ${room}`);
  });

  socket.on('createRoom', room => {
    if (!isAdmin) return;
    if (room && !data.rooms.includes(room)) {
      data.rooms.push(room);
      saveData();
      io.emit('roomList', data.rooms);
      console.log(`Room created: ${room}`);
    }
  });

  socket.on('chatMessage', msg => {
    if (!msg.username || !msg.message || !msg.room) return;
    
    const messageData = {
        ...msg,
        timestamp: Date.now()
    };
    
    data.messages.push(messageData);
    saveData();
    io.to(msg.room).emit('message', messageData);
});

  socket.on('typing', info => socket.to(info.room).emit('typing', { username: info.username }));
  socket.on('stopTyping', info => socket.to(info.room).emit('stopTyping', { username: info.username }));

  // Add these socket event handlers in your io.on('connection') block

  socket.on('editRoom', ({ oldName, newName }, callback) => {
    if (!isAdmin) {
        callback(false);
        return;
    }

    const index = data.rooms.indexOf(oldName);
    if (index !== -1 && !data.rooms.includes(newName)) {
        data.rooms[index] = newName;
        saveData();
        io.emit('roomEdited', { oldName, newName });
        callback(true);
    } else {
        callback(false);
    }
});

  socket.on('deleteRoom', (roomName, callback) => {
    if (!isAdmin || roomName === 'Main') {
        callback(false);
        return;
    }

    const index = data.rooms.indexOf(roomName);
    if (index !== -1) {
        data.rooms.splice(index, 1);
        saveData();
        io.emit('roomDeleted', roomName);
        callback(true);
    } else {
        callback(false);
    }
});
});

// --- Start server ---
const PORT = process.env.PORT || 3000;

if (!fs.existsSync('public/uploads')) {
  fs.mkdirSync('public/uploads', { recursive: true });
}

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});