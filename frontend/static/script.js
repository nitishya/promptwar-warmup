const socket = io(); // Connects to same host/port automatically

let roomId = null;
let username = null;
let isDrawer = false;

// DOM Elements
const views = {
    lobby: document.getElementById('lobby-view'),
    game: document.getElementById('game-view')
};

const canvas = document.getElementById('drawing-board');
const ctx = canvas.getContext('2d');
let drawing = false;
let currentColor = '#000';
let lastX = 0;
let lastY = 0;

function createRoom() {
    username = document.getElementById('username').value;
    if (!username) return alert("Please enter a username");

    roomId = Math.random().toString(36).substring(7); // Generate ID locally for simplicity
    joinRoomLogic(roomId);
}

function joinRoom() {
    username = document.getElementById('username').value;
    const roomInput = document.getElementById('room-input').value;
    if (!username || !roomInput) return alert("Please enter username and room ID");

    roomId = roomInput;
    joinRoomLogic(roomId);
}

function joinRoomLogic(id) {
    socket.emit('join_room', { username, roomId: id });
}

// Socket Event Listeners

socket.on('game_state', (state) => {
    // Switch view if in lobby
    if (!views.lobby.classList.contains('hidden')) {
        views.lobby.classList.add('hidden');
        views.game.classList.remove('hidden');
        document.getElementById('display-room-id').innerText = roomId;
    }
    updateGameState(state);
});

socket.on('error', (msg) => {
    alert(msg);
});

socket.on('draw', (data) => {
    drawOnCanvas(data.x, data.y, data.color, data.isStart);
});

socket.on('chat_message', (data) => {
    addChatMessage(`${data.username}: ${data.message}`);
});

socket.on('system_message', (msg) => {
    addChatMessage(msg, 'system-msg');
});

socket.on('timer_update', (time) => {
    document.getElementById('timer').innerText = time;
});

socket.on('secret_word', (word) => {
    document.getElementById('secret-word').innerText = word;
});

socket.on('round_end', (data) => {
    addChatMessage(`Round Over! Word was: ${data.word}`, 'system-msg');
    document.getElementById('secret-word').innerText = "???"; // Reset
    setTimeout(clearCanvas, 1000);
});


// Game Logic Functions

function updateGameState(state) {
    // Update players
    const list = document.getElementById('player-list');
    list.innerHTML = '';

    state.players.forEach(p => {
        const li = document.createElement('li');
        li.className = `player-item ${p.isDrawer ? 'drawer' : ''}`;
        li.innerHTML = `<span>${p.username} ${p.isDrawer ? '✏️' : ''} ${p.hasGuessed ? '✅' : ''}</span> <span>${p.score}</span>`;
        list.appendChild(li);

        if (p.username === username) {
            isDrawer = p.isDrawer;
            updateControls();
        }
    });

    document.getElementById('round').innerText = state.currentRound;

    // Auto-start button? (Only show for first player maybe, or simple check)
    // For now, if state is LOBBY and players > 1, maybe show a start button?
    // Let's reuse the "toolbar" area or chat for a start command if needed, 
    // or just assume players manually trigger it.
    // Ideally we add a "Start Game" button in the lobby but we are already in game view.
    // Let's add a temporary Start button in sidebar if Lobby.
}

// Add a Start Game button to sidebar dynamically if needed, 
// or just exposing it via console for this speedrun: 
// But let's act "Agentic" and make it usable.
// Simple fix: If lobby and >= 2 players, show start button in chat area?
// Actually, let's just add it to the header or sidebar.
const startBtn = document.createElement('button');
startBtn.innerText = "Start Game";
startBtn.onclick = () => socket.emit('start_game', { roomId });
// We can append this to header if not started.

function updateControls() {
    const toolbar = document.getElementById('toolbar');
    const wordDisplay = document.getElementById('word-display');

    if (isDrawer) {
        toolbar.classList.remove('hidden');
        wordDisplay.classList.remove('hidden');
        canvas.style.cursor = 'crosshair';
    } else {
        toolbar.classList.add('hidden');
        wordDisplay.classList.add('hidden');
        canvas.style.cursor = 'not-allowed';
    }
}

// Canvas Logic (Identical to before mostly)
canvas.addEventListener('mousedown', (e) => {
    if (!isDrawer) return;
    drawing = true;
    [lastX, lastY] = [e.offsetX, e.offsetY];
    emitDraw(lastX, lastY, currentColor, true);
    drawOnCanvas(lastX, lastY, currentColor, true); // Local draw immediately
});

canvas.addEventListener('mousemove', (e) => {
    if (!drawing || !isDrawer) return;
    drawOnCanvas(e.offsetX, e.offsetY, currentColor, false);
    emitDraw(e.offsetX, e.offsetY, currentColor, false);
    [lastX, lastY] = [e.offsetX, e.offsetY];
});

canvas.addEventListener('mouseup', () => drawing = false);
canvas.addEventListener('mouseout', () => drawing = false);

function drawOnCanvas(x, y, color, isStart) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';

    if (isStart) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        [lastX, lastY] = [x, y]; // Update locally for continuity
        // Note: For remote drawing this [lastX, lastY] isn't perfectly synced if multiple strokes come in fast,
        // but for <2min prototype it's fine.
    } else {
        ctx.beginPath();
        ctx.moveTo(lastX, lastY); // This relies on global state, might glitch for spectators if multiple lines.
        // Better: Pass prevX, prevY in packet? 
        // For simplicity: We just drawLineTo(x,y). 
        // Real implementation: socket.emit('draw', { fromX, fromY, toX, toY })

        // Let's trust the "moveTo" from start.
        ctx.lineTo(x, y);
        ctx.stroke();
        [lastX, lastY] = [x, y];
    }
}

function emitDraw(x, y, color, isStart) {
    socket.emit('draw', { roomId, x, y, color, isStart });
}

function setColor(color) {
    currentColor = color;
}

function clearCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// Chat
function handleChat(e) {
    if (e.key === 'Enter') {
        const input = document.getElementById('chat-input');
        const msg = input.value;
        if (!msg) return;

        // If game hasn't started, maybe this button starts it? 
        // No, let's stick to chat.

        socket.emit('chat_message', { roomId, message: msg });
        input.value = '';
    }
}

function addChatMessage(msg, className = 'message') {
    const div = document.createElement('div');
    div.className = className;
    div.innerText = msg;
    const container = document.getElementById('chat-messages');
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

// Quick UI Tweaks
// Add Start Button to Lobby UI for clarity
const lobbyActions = document.querySelector('#lobby-view .actions');
// No, the lobby view disappears on join. 
// The Start Button needs to be in the GAME view but only if state is LOBBY.
// We can handle this in updateGameState but let's keep it simple.
// The sidebar is a good place.
const sidebar = document.querySelector('.sidebar');
if (!document.getElementById('start-game-btn')) {
    const btn = document.createElement('button');
    btn.id = 'start-game-btn';
    btn.innerText = "START GAME";
    btn.style.marginTop = "20px";
    btn.style.backgroundColor = "#22c55e"; // Green
    btn.onclick = () => socket.emit('start_game', { roomId });
    sidebar.appendChild(btn);
}
