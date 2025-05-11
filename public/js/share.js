// Socket.io connection
const socket = io();

// DOM Elements
const preShareContainer = document.getElementById('pre-share');
const codeDisplayContainer = document.getElementById('code-display');
const connectionRequestContainer = document.getElementById('connection-request');
const activeSharingContainer = document.getElementById('active-sharing');
const generateCodeBtn = document.getElementById('generate-code');
const cancelSharingBtn = document.getElementById('cancel-sharing');
const acceptConnectionBtn = document.getElementById('accept-connection');
const rejectConnectionBtn = document.getElementById('reject-connection');
const endSessionBtn = document.getElementById('end-session');
const pauseSharingBtn = document.getElementById('pause-sharing');
const resumeSharingBtn = document.getElementById('resume-sharing');
const toggleRemoteControlBtn = document.getElementById('toggle-remote-control');
const accessCodeDisplay = document.getElementById('access-code-display');
const accessCodeDisplay2 = document.getElementById('access-code-display-2');
const connectionStatus = document.getElementById('connection-status');
const connectionRequestText = document.getElementById('connection-request-text');
const remoteUserInfo = document.getElementById('remote-user-info');
const fileTransferHistory = document.getElementById('file-transfer-history');

// Variables
let accessCode = null;
let currentClientId = null;
let sessionId = null;
let screenStream = null;
let mediaRecorder = null;
let remoteControlEnabled = true;
let isPaused = false;
let transferredFiles = [];

// Event Listeners
generateCodeBtn.addEventListener('click', generateAccessCode);
cancelSharingBtn.addEventListener('click', cancelSharing);
acceptConnectionBtn.addEventListener('click', acceptConnection);
rejectConnectionBtn.addEventListener('click', rejectConnection);
endSessionBtn.addEventListener('click', endSession);
pauseSharingBtn.addEventListener('click', pauseSharing);
resumeSharingBtn.addEventListener('click', resumeSharing);
toggleRemoteControlBtn.addEventListener('click', toggleRemoteControl);

// Functions
function generateAccessCode() {
    socket.emit('generate-code');
    preShareContainer.classList.add('hidden');
    codeDisplayContainer.classList.remove('hidden');
}

function displayAccessCode(code) {
    accessCode = code;
    const digits = code.toString().split('');
    
    // Update both code displays
    [accessCodeDisplay, accessCodeDisplay2].forEach(display => {
        const digitElements = display.querySelectorAll('.code-digit');
        digitElements.forEach((element, index) => {
            element.textContent = digits[index];
        });
    });
}

function cancelSharing() {
    if (accessCode) {
        socket.emit('cancel-code', accessCode);
    }
    resetUI();
}

function acceptConnection() {
    if (currentClientId) {
        socket.emit('accept-connection', currentClientId);
        connectionRequestContainer.classList.add('hidden');
        startScreenSharing();
    }
}

function rejectConnection() {
    if (currentClientId) {
        socket.emit('reject-connection', currentClientId);
        currentClientId = null;
        connectionRequestContainer.classList.add('hidden');
        codeDisplayContainer.classList.remove('hidden');
    }
}

async function startScreenSharing() {
    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                cursor: 'always',
                displaySurface: 'monitor'
            },
            audio: false
        });
        
        // When user stops sharing via browser UI
        screenStream.getVideoTracks()[0].addEventListener('ended', () => {
            endSession();
        });
        
        setupMediaRecorder();
        activeSharingContainer.classList.remove('hidden');
    } catch (error) {
        console.error('Error starting screen share:', error);
        endSession();
    }
}

function setupMediaRecorder() {
    const options = { mimeType: 'video/webm;codecs=vp9' };
    mediaRecorder = new MediaRecorder(screenStream, options);
    
    mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && !isPaused) {
            socket.emit('screen-data', {
                sessionId,
                chunk: event.data
            });
        }
    };
    
    // Start recording with 100ms intervals
    mediaRecorder.start(100);
}

function pauseSharing() {
    isPaused = true;
    pauseSharingBtn.classList.add('hidden');
    resumeSharingBtn.classList.remove('hidden');
    socket.emit('pause-sharing', sessionId);
}

function resumeSharing() {
    isPaused = false;
    resumeSharingBtn.classList.add('hidden');
    pauseSharingBtn.classList.remove('hidden');
    socket.emit('resume-sharing', sessionId);
}

function toggleRemoteControl() {
    remoteControlEnabled = !remoteControlEnabled;
    toggleRemoteControlBtn.classList.toggle('active');
    socket.emit('toggle-remote-control', {
        sessionId,
        enabled: remoteControlEnabled
    });
}

function endSession() {
    socket.emit('end-session');
    
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }
    
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    
    resetUI();
}

function resetUI() {
    accessCode = null;
    currentClientId = null;
    sessionId = null;
    
    preShareContainer.classList.remove('hidden');
    codeDisplayContainer.classList.add('hidden');
    connectionRequestContainer.classList.add('hidden');
    activeSharingContainer.classList.add('hidden');
    
    connectionStatus.innerHTML = '<p>En attente d\'une connexion...</p>';
    fileTransferHistory.innerHTML = '<p>Aucun fichier transféré pendant cette session</p>';
    transferredFiles = [];
}

function updateFileTransferHistory() {
    if (transferredFiles.length === 0) {
        fileTransferHistory.innerHTML = '<p>Aucun fichier transféré pendant cette session</p>';
        return;
    }
    
    let html = '<ul class="file-list">';
    transferredFiles.forEach(file => {
        const fileSize = formatFileSize(file.size);
        const direction = file.sender === socket.id ? 'Envoyé' : 'Reçu';
        const time = new Date(file.timestamp).toLocaleTimeString();
        
        html += `
            <li class="file-item">
                <div class="file-info">
                    <img src="/img/file-icon.svg" class="file-icon" alt="Fichier">
                    <div>
                        <div>${file.name}</div>
                        <div class="file-meta">${fileSize} - ${direction} à ${time}</div>
                    </div>
                </div>
            </li>
        `;
    });
    html += '</ul>';
    
    fileTransferHistory.innerHTML = html;
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    else if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    else return (bytes / 1073741824).toFixed(1) + ' GB';
}

// Socket Event Handlers
socket.on('access-code', (code) => {
    displayAccessCode(code);
});

socket.on('code-expired', () => {
    connectionStatus.innerHTML = '<p class="error">Le code a expiré. Veuillez en générer un nouveau.</p>';
    setTimeout(() => {
        resetUI();
    }, 3000);
});

socket.on('connection-request', (data) => {
    currentClientId = data.clientId;
    
    // Extract device name from user agent if possible
    let deviceName = 'Ordinateur distant';
    const userAgent = data.clientInfo.userAgent;
    if (userAgent.includes('Windows')) deviceName = 'Windows PC';
    else if (userAgent.includes('Mac')) deviceName = 'Mac';
    else if (userAgent.includes('Linux')) deviceName = 'Linux PC';
    else if (userAgent.includes('Android')) deviceName = 'Android';
    else if (userAgent.includes('iPhone') || userAgent.includes('iPad')) deviceName = 'iOS Device';
    
    connectionRequestText.textContent = `${deviceName} (${data.clientInfo.ip}) souhaite se connecter à votre écran.`;
    
    codeDisplayContainer.classList.add('hidden');
    connectionRequestContainer.classList.remove('hidden');
});

socket.on('connection-established', (data) => {
    sessionId = data.sessionId;
    remoteUserInfo.textContent = 'Utilisateur distant';
});

socket.on('file-transfer-init', (data) => {
    const fileId = data.fileId;
    const fileName = data.fileName;
    const fileSize = data.fileSize;
    
    // Add to transferred files
    transferredFiles.push({
        id: fileId,
        name: fileName,
        size: fileSize,
        timestamp: Date.now(),
        sender: 'remote'
    });
    
    updateFileTransferHistory();
});

socket.on('file-transfer-complete', (data) => {
    updateFileTransferHistory();
});

socket.on('session-ended', () => {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
    }
    
    alert('La session a été terminée.');
    resetUI();
});

// Handle remote control events
document.addEventListener('keydown', (e) => {
    if (!sessionId || !remoteControlEnabled) return;
    
    // Prevent certain key combinations from affecting the local browser
    if (
        (e.ctrlKey && ['w', 'r', 't', 'n'].includes(e.key.toLowerCase())) ||
        (e.altKey && ['f4'].includes(e.key.toLowerCase()))
    ) {
        e.preventDefault();
    }
    
    socket.emit('keyboard-event', {
        sessionId,
        type: 'keydown',
        key: e.key,
        keyCode: e.keyCode,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey
    });
});

document.addEventListener('keyup', (e) => {
    if (!sessionId || !remoteControlEnabled) return;
    
    socket.emit('keyboard-event', {
        sessionId,
        type: 'keyup',
        key: e.key,
        keyCode: e.keyCode,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey
    });
});

// Handle window unload/close
window.addEventListener('beforeunload', () => {
    if (sessionId) {
        socket.emit('end-session');
    }
});