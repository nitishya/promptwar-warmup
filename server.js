const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Correctly resolve static path
const KEY_PATH = path.join(__dirname, 'frontend/static');
console.log("Serving static files from:", KEY_PATH);

app.use('/static', express.static(KEY_PATH));

// Serve index.html on root
app.get('/', (req, res) => {
    res.sendFile(path.join(KEY_PATH, 'index.html'));
});

// REST API Requirement
app.get('/api/rooms', (req, res) => {
    // Return list of active rooms
    const roomList = Object.values(rooms).map(r => ({
        id: r.id,
        players: r.players.length,
        state: r.state
    }));
    res.json(roomList);
});

// Constants
const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 5;
const ROUND_TIME = 60; // seconds
const WORDS = ["cat", "dog", "house", "tree", "car", "sun", "book", "computer", "phone", "pizza", "robot", "alien", "future", "space", "galaxy"];

// Game State Storage
const rooms = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Join Room
    socket.on('join_room', ({ username, roomId }) => {
        if (!roomId) roomId = "default"; // Fallback

        if (!rooms[roomId]) {
            rooms[roomId] = {
                id: roomId,
                players: [],
                state: 'LOBBY',
                currentRound: 0,
                maxRounds: 3,
                drawerIndex: 0,
                secretWord: "",
                timer: 0,
                timerInterval: null
            };
        }

        const room = rooms[roomId];

        if (room.players.length >= MAX_PLAYERS) {
            socket.emit('error', 'Room is full');
            return;
        }

        const player = {
            id: socket.id,
            username: username || `Player ${socket.id.substr(0, 4)}`,
            score: 0,
            isDrawer: false,
            hasGuessed: false
        };
        room.players.push(player);
        socket.join(roomId);

        // Notify
        io.to(roomId).emit('system_message', `${player.username} joined.`);
        io.to(roomId).emit('game_state', getPublicState(room));
    });

    // Start Game
    socket.on('start_game', ({ roomId }) => {
        const room = rooms[roomId];
        if (room && room.state === 'LOBBY') {
            startGame(room);
        }
    });

    // Draw
    socket.on('draw', (data) => {
        // Broadcast to others in room
        socket.to(data.roomId).emit('draw', data);
    });

    // Chat
    socket.on('chat_message', ({ roomId, message }) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        // Guess Logic
        if (room.state === 'DRAWING' && !player.isDrawer && !player.hasGuessed) {
            if (message.toLowerCase().trim() === room.secretWord.toLowerCase().trim()) {
                player.hasGuessed = true;
                player.score += 10;
                const drawer = room.players[room.drawerIndex];
                if (drawer) drawer.score += 5;

                io.to(roomId).emit('system_message', `${player.username} guessed the word!`);
                io.to(roomId).emit('game_state', getPublicState(room));

                // Check if all guessed
                const guessers = room.players.filter(p => !p.isDrawer);
                if (guessers.every(p => p.hasGuessed)) {
                    endRound(room);
                }
                return;
            }
        }

        io.to(roomId).emit('chat_message', { username: player.username, message });
    });

    socket.on('disconnect', () => {
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const idx = room.players.findIndex(p => p.id === socket.id);
            if (idx !== -1) {
                const p = room.players[idx];
                room.players.splice(idx, 1);
                io.to(roomId).emit('system_message', `${p.username} left.`);
                io.to(roomId).emit('game_state', getPublicState(room));

                if (room.players.length === 0) {
                    clearInterval(room.timerInterval);
                    delete rooms[roomId];
                } else if (room.state === 'DRAWING' && p.isDrawer) {
                    endRound(room);
                }
                break;
            }
        }
    });
});

function startGame(room) {
    room.state = 'ROUND_START';
    room.currentRound = 1;
    room.drawerIndex = 0;
    startRound(room);
}

function startRound(room) {
    if (room.state === 'GAME_OVER') return;

    room.state = 'DRAWING';
    room.players.forEach(p => { p.isDrawer = false; p.hasGuessed = false; });

    if (room.drawerIndex >= room.players.length) room.drawerIndex = 0;
    const drawer = room.players[room.drawerIndex];
    drawer.isDrawer = true;

    room.secretWord = WORDS[Math.floor(Math.random() * WORDS.length)];

    io.to(room.id).emit('system_message', `Round ${room.currentRound} started. Drawer: ${drawer.username}`);
    io.to(room.id).emit('game_state', getPublicState(room));
    io.to(drawer.id).emit('secret_word', room.secretWord);

    clearInterval(room.timerInterval);
    room.timer = ROUND_TIME;
    room.timerInterval = setInterval(() => {
        room.timer--;
        io.to(room.id).emit('timer_update', room.timer);
        if (room.timer <= 0) endRound(room);
    }, 1000);
}

function endRound(room) {
    clearInterval(room.timerInterval);
    room.state = 'ROUND_END';
    io.to(room.id).emit('system_message', `Round over! Word: ${room.secretWord}`);
    io.to(room.id).emit('round_end', { word: room.secretWord });

    setTimeout(() => {
        room.drawerIndex++;
        if (room.drawerIndex >= room.players.length) {
            room.drawerIndex = 0;
            room.currentRound++;
        }
        if (room.currentRound > room.maxRounds) {
            room.state = 'GAME_OVER';
            io.to(room.id).emit('system_message', "Game Over!");
            io.to(room.id).emit('game_state', getPublicState(room));
        } else {
            startRound(room);
        }
    }, 5000);
}

function getPublicState(room) {
    return {
        state: room.state,
        currentRound: room.currentRound,
        players: room.players.map(p => ({
            username: p.username,
            score: p.score,
            isDrawer: p.isDrawer,
            hasGuessed: p.hasGuessed
        }))
    };
}

server.listen(PORT, () => {
    console.log(`\n>>> Game Server running at http://localhost:${PORT} <<<\n`);
});
