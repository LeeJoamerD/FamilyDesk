// Socket.io connection
const socket = io();

// DOM Elements
const codeInputContainer = document.getElementById('code-input-container');
const waitingApprovalContainer = document.getElementById('waiting-approval');
const remoteScreenContainer = document.getElementById('remote-screen-container');
const codeInputs = document.querySelectorAll('.code-input');
const connectButton = document.getElementById('connect-button');
const cancelConnectionButton = document.getElementById('cancel-connection');
const disconnectButton = document.getElementById('disconnect-btn');
const toggleFullscreenButton = document.getElementById('toggle-fullscreen');
const fileTransferButton = document.getElementById('file-transfer-btn');
const fileTransferPanel = document.getElementById('file-transfer-panel');
const closeFilePanelButton = document.getElementById('close-file-panel');
const fileDropArea = document.getElementById('file-drop-area');
const fileInput = document.getElementById('file-input');
const fileTransferList = document.getElementById('file-transfer-list');
const remoteScreen = document.getElementById('remote-screen');
const remoteDeviceInfo = document.getElementById('remote-device-info');
const connectionError = document.getElementById('connection-error');

// Canvas context
const ctx = remoteScreen.getContext('2d');

// Variables
let sessionId = null;
let isFullscreen = false;
let mouseIsDown = false;
let transferredFiles = [];
let activeTransfers = new Map();

// Event Listeners
connectButton.addEventListener('click', connectToScreen);
cancelConnectionButton.addEventListener('click', cancelConnection);
disconnectButton.addEventListener('click', disconnect);
toggleFullscreenButton.addEventListener('click', toggleFullscreen);
fileTransferButton.addEventListener('click', toggleFileTransferPanel);
closeFilePanelButton.addEventListener('click', toggleFileTransferPanel);
fileInput.addEventListener('change', handleFileSelect);

// Setup code input fields
codeInputs.forEach((input, index) => {
    input.addEventListener('input', (e) => {
        const value = e.target.value;
        
        // Only allow numbers
        if (!/^\d*$/.test(value)) {
            e.target.value = '';
            return;
        }
        
        // Auto-focus next input
        if (value && index < codeInputs.length - 1) {
            codeInputs[index + 1].focus();
        }
        
        // Enable connect button if all fields are filled
        checkInputsComplete();
    });
    
    input.addEventListener('keydown', (e) => {
        // Handle backspace to go to previous input
        if (e.key === 'Backspace' && !e.target.value && index > 0) {
            codeInputs[index - 1].focus();
        }
    });
    
    input.addEventListener('focus', (e) => {
        e.target.select();
    });
});

// Functions
function checkInputsComplete() {
    let isComplete = true;
    let code = '';
    
    codeInputs.forEach(input => {
        if (!input.value) {
            isComplete = false;
        }
        code += input.value;
    });
    
    connectButton.disabled = !isComplete;
    return code;
}

function connectToScreen() {
    const accessCode = checkInputsComplete();
    if (!accessCode || accessCode.length !== 6) return;
    
    connectionError.classList.add('hidden');
    socket.emit('connect-to-screen', accessCode);
    
    codeInputContainer.classList.add('hidden');
    waitingApprovalContainer.classList.remove('hidden');
}

function cancelConnection() {
    waitingApprovalContainer.classList.add('hidden');
    codeInputContainer.classList.remove('hidden');
    
    // Reset input fields
    codeInputs.forEach(input => {
        input.value = '';
    });
    connectButton.disabled = true;
}

function disconnect() {
    socket.emit('end-session');
    resetUI();
}

function resetUI() {
    sessionId = null;
    
    remoteScreenContainer.classList.add('hidden');
    fileTransferPanel.classList.add('hidden');
    codeInputContainer.classList.remove('hidden');
    
    // Reset canvas
    ctx.clearRect(0, 0, remoteScreen.width, remoteScreen.height);
    
    // Reset input fields
    codeInputs.forEach(input => {
        input.value = '';
    });
    connectButton.disabled = true;
    
    // Reset file transfer
    fileTransferList.innerHTML = '<p>Aucun fichier transféré pendant cette session</p>';
    transferredFiles = [];
    activeTransfers.clear();
}

function toggleFullscreen() {
    if (!isFullscreen) {
        if (remoteScreenContainer.requestFullscreen) {
            remoteScreenContainer.requestFullscreen();
        } else if (remoteScreenContainer.webkitRequestFullscreen) {
            remoteScreenContainer.webkitRequestFullscreen();
        } else if (remoteScreenContainer.msRequestFullscreen) {
            remoteScreenContainer.msRequestFullscreen();
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        }
    }
    
    isFullscreen = !isFullscreen;
}

function toggleFileTransferPanel() {
    fileTransferPanel.classList.toggle('hidden');
}

function handleFileSelect(e) {
    const files = e.target.files;
    if (files.length === 0) return;
    
    Array.from(files).forEach(file => {
        if (file.size > 2 * 1024 * 1024 * 1024) { // 2GB limit
            alert(`Le fichier ${file.name} dépasse la limite de 2 Go.`);
            return;
        }
        
        initiateFileTransfer(file);
    });
    
    // Reset file input
    fileInput.value = '';
}

function initiateFileTransfer(file) {
    const fileId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    const fileReader = new FileReader();
    const chunkSize = 1024 * 1024; // 1MB chunks
    let offset = 0;
    
    // Add to active transfers
    activeTransfers.set(fileId, {
        file,
        progress: 0
    });
    
    // Add to UI
    addFileToTransferList(fileId, file);
    
    // Notify remote end
    socket.emit('file-transfer-init', {
        sessionId,
        fileId,
        fileName: file.name,
        fileSize: file.size
    });
    
    // Read and send file in chunks
    fileReader.onload = function(e) {
        const chunk = e.target.result;
        const isLastChunk = offset + chunkSize >= file.size;
        
        socket.emit('file-chunk', {
            sessionId,
            fileId,
            chunk,
            chunkIndex: offset / chunkSize,
            isLast: isLastChunk
        });
        
        offset += chunkSize;
        const progress = Math.min(100, Math.round((offset / file.size) * 100));
        updateFileProgress(fileId, progress);
        
        if (offset < file.size) {
            readNextChunk();
        } else {
            // Transfer complete
            socket.emit('file-transfer-complete', {
                sessionId,
                fileId,
                fileName: file.name,
                fileSize: file.size
            });
            
            // Add to transferred files
            transferredFiles.push({
                id: fileId,
                name: file.name,
                size: file.size,
                timestamp: Date.now(),
                sender: socket.id
            });
            
            // Remove from active transfers
            setTimeout(() => {
                activeTransfers.delete(fileId);
                updateFileTransferList();
            }, 2000);
        }
    };
    
    function readNextChunk() {
        const blob = file.slice(offset, offset + chunkSize);
        fileReader.readAsArrayBuffer(blob);
    }
    
    // Start reading
    readNextChunk();
}

function addFileToTransferList(fileId, file) {
    // Check if list is empty
    if (fileTransferList.querySelector('p')) {
        fileTransferList.innerHTML = '';
    }
    
    const fileSize = formatFileSize(file.size);
    const fileItem = document.createElement('div');
    fileItem.className = 'file-item';
    fileItem.id = `file-${fileId}`;
    fileItem.innerHTML = `
        <div class="file-info">
            <img src="/img/file-icon.svg" class="file-icon" alt="Fichier">
                        <div>
                <div>${file.name}</div>
                <div class="file-meta">${fileSize} - Envoi en cours...</div>
            </div>
        </div>
        <div class="file-progress">
            <div class="progress-bar" style="width: 0%"></div>
        </div>
    `;
    
    fileTransferList.appendChild(fileItem);
}

function updateFileProgress(fileId, progress) {
    const fileItem = document.getElementById(`file-${fileId}`);
    if (!fileItem) return;
    
    const progressBar = fileItem.querySelector('.progress-bar');
    progressBar.style.width = `${progress}%`;
    
    if (progress === 100) {
        const fileMeta = fileItem.querySelector('.file-meta');
        fileMeta.textContent = fileMeta.textContent.replace('Envoi en cours...', 'Terminé');
    }
}

function updateFileTransferList() {
    if (transferredFiles.length === 0 && activeTransfers.size === 0) {
        fileTransferList.innerHTML = '<p>Aucun fichier transféré pendant cette session</p>';
        return;
    }
    
    // Keep the active transfers in the list
    if (activeTransfers.size === 0 && fileTransferList.querySelectorAll('.file-item').length > 0) {
        return;
    }
    
    // Clear and rebuild the list
    fileTransferList.innerHTML = '';
    
    // Add active transfers
    activeTransfers.forEach((transfer, fileId) => {
        addFileToTransferList(fileId, transfer.file);
        updateFileProgress(fileId, transfer.progress);
    });
    
    // Add completed transfers
    transferredFiles.forEach(file => {
        if (!document.getElementById(`file-${file.id}`)) {
            const fileSize = formatFileSize(file.size);
            const direction = file.sender === socket.id ? 'Envoyé' : 'Reçu';
            const time = new Date(file.timestamp).toLocaleTimeString();
            
            const fileItem = document.createElement('div');
            fileItem.className = 'file-item';
            fileItem.id = `file-${file.id}`;
            fileItem.innerHTML = `
                <div class="file-info">
                    <img src="/img/file-icon.svg" class="file-icon" alt="Fichier">
                    <div>
                        <div>${file.name}</div>
                        <div class="file-meta">${fileSize} - ${direction} à ${time}</div>
                    </div>
                </div>
            `;
            
            fileTransferList.appendChild(fileItem);
        }
    });
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    else if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    else return (bytes / 1073741824).toFixed(1) + ' GB';
}

// Setup remote screen
function setupRemoteScreen() {
    // Set initial canvas size
    remoteScreen.width = remoteScreenContainer.clientWidth;
    remoteScreen.height = remoteScreenContainer.clientHeight;
    
    // Handle window resize
    window.addEventListener('resize', () => {
        if (remoteScreenContainer.classList.contains('hidden')) return;
        
        remoteScreen.width = remoteScreenContainer.clientWidth;
        remoteScreen.height = remoteScreenContainer.clientHeight;
    });
    
    // Mouse events for remote control
    remoteScreen.addEventListener('mousedown', (e) => {
        if (!sessionId) return;
        
        mouseIsDown = true;
        const rect = remoteScreen.getBoundingClientRect();
        const scaleX = remoteScreen.width / rect.width;
        const scaleY = remoteScreen.height / rect.height;
        
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;
        
        socket.emit('mouse-event', {
            sessionId,
            type: 'mousedown',
            button: e.button,
            x,
            y
        });
    });
    
    remoteScreen.addEventListener('mouseup', (e) => {
        if (!sessionId) return;
        
        mouseIsDown = false;
        const rect = remoteScreen.getBoundingClientRect();
        const scaleX = remoteScreen.width / rect.width;
        const scaleY = remoteScreen.height / rect.height;
        
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;
        
        socket.emit('mouse-event', {
            sessionId,
            type: 'mouseup',
            button: e.button,
            x,
            y
        });
    });
    
    remoteScreen.addEventListener('mousemove', (e) => {
        if (!sessionId) return;
        
        const rect = remoteScreen.getBoundingClientRect();
        const scaleX = remoteScreen.width / rect.width;
        const scaleY = remoteScreen.height / rect.height;
        
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;
        
        socket.emit('mouse-event', {
            sessionId,
            type: 'mousemove',
            x,
            y,
            isDown: mouseIsDown
        });
    });
    
    remoteScreen.addEventListener('wheel', (e) => {
        if (!sessionId) return;
        
        socket.emit('mouse-event', {
            sessionId,
            type: 'wheel',
            deltaX: e.deltaX,
            deltaY: e.deltaY
        });
        
        // Prevent default scrolling of the page
        e.preventDefault();
    });
    
    // Keyboard events
    document.addEventListener('keydown', (e) => {
        if (!sessionId || !remoteScreenContainer.contains(document.activeElement)) return;
        
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
        if (!sessionId || !remoteScreenContainer.contains(document.activeElement)) return;
        
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
    
    // File drop handling
    fileDropArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        fileDropArea.classList.add('active');
    });
    
    fileDropArea.addEventListener('dragleave', () => {
        fileDropArea.classList.remove('active');
    });
    
    fileDropArea.addEventListener('drop', (e) => {
        e.preventDefault();
        fileDropArea.classList.remove('active');
        
        if (!e.dataTransfer.files.length) return;
        
        Array.from(e.dataTransfer.files).forEach(file => {
            if (file.size > 2 * 1024 * 1024 * 1024) { // 2GB limit
                alert(`Le fichier ${file.name} dépasse la limite de 2 Go.`);
                return;
            }
            
            initiateFileTransfer(file);
        });
    });
}

// Initialize remote screen setup
setupRemoteScreen();

// Socket Event Handlers
socket.on('connection-error', (message) => {
    waitingApprovalContainer.classList.add('hidden');
    codeInputContainer.classList.remove('hidden');
    
    connectionError.textContent = message;
    connectionError.classList.remove('hidden');
});

socket.on('connection-blocked', (message) => {
    waitingApprovalContainer.classList.add('hidden');
    codeInputContainer.classList.remove('hidden');
    
    connectionError.textContent = message;
    connectionError.classList.remove('hidden');
    
    // Disable connect button for 30 minutes
    connectButton.disabled = true;
    setTimeout(() => {
        connectButton.disabled = false;
    }, 30 * 60 * 1000);
});

socket.on('connection-rejected', () => {
    waitingApprovalContainer.classList.add('hidden');
    codeInputContainer.classList.remove('hidden');
    
    connectionError.textContent = 'Votre demande de connexion a été refusée.';
    connectionError.classList.remove('hidden');
});

socket.on('connection-established', (data) => {
    sessionId = data.sessionId;
    
    waitingApprovalContainer.classList.add('hidden');
    remoteScreenContainer.classList.remove('hidden');
    
    // Focus the remote screen for keyboard events
    remoteScreen.focus();
});

socket.on('screen-data', (data) => {
    if (!sessionId) return;
    
    const blob = new Blob([data.chunk], { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    
    const img = new Image();
    img.onload = () => {
        // Clear canvas
        ctx.clearRect(0, 0, remoteScreen.width, remoteScreen.height);
        
        // Calculate aspect ratio to fit the screen
        const aspectRatio = img.width / img.height;
        let drawWidth = remoteScreen.width;
        let drawHeight = remoteScreen.width / aspectRatio;
        
        if (drawHeight > remoteScreen.height) {
            drawHeight = remoteScreen.height;
            drawWidth = remoteScreen.height * aspectRatio;
        }
        
        // Center the image
        const x = (remoteScreen.width - drawWidth) / 2;
        const y = (remoteScreen.height - drawHeight) / 2;
        
        // Draw the image
        ctx.drawImage(img, x, y, drawWidth, drawHeight);
        
        // Revoke the object URL to free memory
        URL.revokeObjectURL(url);
    };
    
    img.src = url;
});

socket.on('file-transfer-init', (data) => {
    // Add to transferred files
    transferredFiles.push({
        id: data.fileId,
        name: data.fileName,
        size: data.fileSize,
        timestamp: Date.now(),
        sender: 'remote'
    });
    
    updateFileTransferList();
});

socket.on('file-transfer-complete', (data) => {
    updateFileTransferList();
});

socket.on('session-ended', () => {
    alert('La session a été terminée.');
    resetUI();
});

// Handle window unload/close
window.addEventListener('beforeunload', () => {
    if (sessionId) {
        socket.emit('end-session');
    }
});

// Handle fullscreen change
document.addEventListener('fullscreenchange', handleFullscreenChange);
document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
document.addEventListener('mozfullscreenchange', handleFullscreenChange);
document.addEventListener('MSFullscreenChange', handleFullscreenChange);

function handleFullscreenChange() {
    isFullscreen = !!document.fullscreenElement || 
                  !!document.webkitFullscreenElement || 
                  !!document.mozFullScreenElement ||
                  !!document.msFullscreenElement;
}