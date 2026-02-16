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

    socket.emit('create_room', { username });
}

function joinRoom() {
    username = document.getElementById('username').value;
    const roomInput = document.getElementById('room-input').value.toUpperCase(); // Normalize
    if (!username || !roomInput) return alert("Please enter username and room ID");

    socket.emit('join_room', { username, roomId: roomInput });
}

// Socket Event Listeners

socket.on('room_joined', (data) => {
    roomId = data.roomId;
    username = data.username;

    // Switch view
    if (!views.lobby.classList.contains('hidden')) {
        views.lobby.classList.add('hidden');
        views.game.classList.remove('hidden');

        // Add Copy Button
        const roomDisplay = document.getElementById('display-room-id');
        roomDisplay.innerText = roomId;
        roomDisplay.style.cursor = 'pointer';
        roomDisplay.title = "Click to Copy";
        roomDisplay.onclick = () => {
            navigator.clipboard.writeText(roomId).then(() => alert("Room ID copied!"));
        };
    }
});

socket.on('game_state', (state) => {
    // If we joined via room_joined, view is already switched.
    // Ensure we have correct state.
    if (!views.lobby.classList.contains('hidden') && roomId) {
        views.lobby.classList.add('hidden');
        views.game.classList.remove('hidden');
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

socket.on('word_select_options', (options) => {
    showWordSelectionModal(options);
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
}

const startBtn = document.createElement('button');
startBtn.id = 'start-game-btn';
startBtn.innerText = "START GAME";
startBtn.style.marginTop = "20px";
startBtn.style.backgroundColor = "#22c55e"; // Green
startBtn.onclick = () => socket.emit('start_game', { roomId });
// We can append this to header if not started.
if (!document.getElementById('start-game-btn')) {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) sidebar.appendChild(startBtn);
}


function updateControls() {
    const toolbar = document.getElementById('toolbar');
    const wordDisplay = document.getElementById('word-display');

    // Only show controls if drawer AND state is DRAWING (not WORD_SELECT)
    // For simplicity, backend state handles logic, but UI needs to hide until drawing starts
    // We can rely on separate event or just check if secret-word is populated / timer running
    // But basic "isDrawer" check is fine, toolbar can be visible.

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
        [lastX, lastY] = [x, y];
    } else {
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
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
        submitChat();
    }
}

function submitChat() {
    const input = document.getElementById('chat-input');
    const msg = input.value;
    if (!msg) return;

    socket.emit('chat_message', { roomId, message: msg });
    input.value = '';
}


function addChatMessage(msg, className = 'message') {
    const div = document.createElement('div');
    if (className === 'system-msg') {
        div.style.color = '#64748b';
        div.style.fontStyle = 'italic';
    }
    div.className = className;
    div.innerText = msg;
    const container = document.getElementById('chat-messages');
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

// Word Selection Modal Logic
function showWordSelectionModal(options) {
    // Create modal DOM dynamically
    const modal = document.createElement('div');
    modal.id = 'word-select-modal';
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100%';
    modal.style.height = '100%';
    modal.style.background = 'rgba(0,0,0,0.8)';
    modal.style.display = 'flex';
    modal.style.flexDirection = 'column';
    modal.style.justifyContent = 'center';
    modal.style.alignItems = 'center';
    modal.style.zIndex = '1000';

    const title = document.createElement('h2');
    title.innerText = "Choose a Word to Draw!";
    title.style.color = 'white';
    title.style.marginBottom = '20px';
    modal.appendChild(title);

    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.gap = '15px';

    options.forEach(word => {
        const btn = document.createElement('button');
        btn.innerText = word;
        btn.style.padding = '15px 30px';
        btn.style.fontSize = '1.2rem';
        btn.style.background = '#6366f1';
        btn.style.color = 'white';
        btn.style.border = 'none';
        btn.style.borderRadius = '8px';
        btn.style.cursor = 'pointer';

        btn.onclick = () => {
            socket.emit('word_selected', { roomId, word });
            document.body.removeChild(modal);
        };

        container.appendChild(btn);
    });

    modal.appendChild(container);
    document.body.appendChild(modal);
}
