const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();

io.on('connection', (socket) => {
  socket.on('join', (roomId) => {
    let room = rooms.get(roomId) ?? [];
    if (room.length >= 2) { socket.emit('room-full'); return; }

    room.push(socket.id);
    rooms.set(roomId, room);
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.isHost = room.length === 1;

    socket.emit('joined', { isHost: socket.data.isHost });
    if (room.length === 2) io.to(roomId).emit('peer-ready');
  });

  socket.on('signal', (data) => socket.to(socket.data.roomId).emit('signal', data));

  socket.on('disconnect', () => {
    const { roomId } = socket.data;
    if (!roomId) return;
    const room = (rooms.get(roomId) ?? []).filter(id => id !== socket.id);
    if (room.length) rooms.set(roomId, room);
    else rooms.delete(roomId);
    socket.to(roomId).emit('peer-left');
  });
});

server.listen(3000, () => console.log('→ http://localhost:3000'));
