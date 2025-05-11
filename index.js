const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const fs = require('fs');

// Configuration
const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Temporary storage for active sessions
const activeSessions = new Map();
const pendingConnections = new Map();
const accessCodes = new Map();
const failedAttempts = new Map();

// Temporary file storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 } // 2GB limit
});

// Routes
app.get('/', (req, res) => {
  res.render('index');
});

app.get('/share', (req, res) => {
  res.render('share');
});

app.get('/connect', (req, res) => {
  res.render('connect');
});

// Generate a 6-digit access code
function generateAccessCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  
  // Generate access code for screen sharing
  socket.on('generate-code', () => {
    const accessCode = generateAccessCode();
    const expiryTime = Date.now() + 10 * 60 * 1000; // 10 minutes
    
    accessCodes.set(accessCode, {
      hostId: socket.id,
      expiryTime,
      deviceInfo: socket.handshake.headers['user-agent']
    });
    
    // Set timeout to remove the code after 10 minutes
    setTimeout(() => {
      if (accessCodes.has(accessCode)) {
        accessCodes.delete(accessCode);
        socket.emit('code-expired');
      }
    }, 10 * 60 * 1000);
    
    socket.emit('access-code', accessCode);
  });
  
  // Connect to a remote screen
  socket.on('connect-to-screen', (accessCode) => {
    if (!accessCode) {
      socket.emit('connection-error', 'Code d\'accès invalide');
      return;
    }
    
    // Check if the code exists and is valid
    if (!accessCodes.has(accessCode)) {
      socket.emit('connection-error', 'Code d\'accès invalide ou expiré');
      
      // Track failed attempts
      const ipAddress = socket.handshake.address;
      if (!failedAttempts.has(ipAddress)) {
        failedAttempts.set(ipAddress, { count: 1, timestamp: Date.now() });
      } else {
        const attempts = failedAttempts.get(ipAddress);
        attempts.count++;
        attempts.timestamp = Date.now();
        
        if (attempts.count >= 3) {
          socket.emit('connection-blocked', 'Trop de tentatives échouées. Veuillez réessayer plus tard.');
          
          // Reset after 30 minutes
          setTimeout(() => {
            failedAttempts.delete(ipAddress);
          }, 30 * 60 * 1000);
          
          return;
        }
      }
      
      return;
    }
    
    const sessionInfo = accessCodes.get(accessCode);
    
    // Check if the code has expired
    if (sessionInfo.expiryTime < Date.now()) {
      accessCodes.delete(accessCode);
      socket.emit('connection-error', 'Code d\'accès expiré');
      return;
    }
    
    // Request permission from the host
    const hostSocket = io.sockets.sockets.get(sessionInfo.hostId);
    if (!hostSocket) {
      socket.emit('connection-error', 'L\'hôte n\'est plus connecté');
      accessCodes.delete(accessCode);
      return;
    }
    
    // Store connection request
    pendingConnections.set(socket.id, {
      accessCode,
      clientInfo: {
        id: socket.id,
        ip: socket.handshake.address,
        userAgent: socket.handshake.headers['user-agent']
      }
    });
    
    // Send connection request to host
    hostSocket.emit('connection-request', {
      clientId: socket.id,
      clientInfo: {
        ip: socket.handshake.address,
        userAgent: socket.handshake.headers['user-agent']
      }
    });
  });
  
  // Host accepts connection request
  socket.on('accept-connection', (clientId) => {
    const clientSocket = io.sockets.sockets.get(clientId);
    if (!clientSocket) return;
    
    const pendingInfo = pendingConnections.get(clientId);
    if (!pendingInfo) return;
    
    const sessionId = uuidv4();
    
    // Create a new session
    activeSessions.set(sessionId, {
      hostId: socket.id,
      clientId: clientId,
      startTime: Date.now(),
      accessCode: pendingInfo.accessCode,
      transferredFiles: []
    });
    
    // Remove the access code as it's now used
    accessCodes.delete(pendingInfo.accessCode);
    pendingConnections.delete(clientId);
    
    // Notify both parties
    socket.emit('connection-established', { sessionId, role: 'host' });
    clientSocket.emit('connection-established', { sessionId, role: 'client' });
    
    // Set inactivity timeout (1 hour)
    const inactivityTimeout = setTimeout(() => {
      if (activeSessions.has(sessionId)) {
        endSession(sessionId);
      }
    }, 60 * 60 * 1000);
    
    activeSessions.get(sessionId).timeout = inactivityTimeout;
  });
  
  // Host rejects connection request
  socket.on('reject-connection', (clientId) => {
    const clientSocket = io.sockets.sockets.get(clientId);
    if (clientSocket) {
      clientSocket.emit('connection-rejected');
    }
    pendingConnections.delete(clientId);
  });
  
  // Screen sharing data
  socket.on('screen-data', (data) => {
    const session = findSessionByParticipant(socket.id);
    if (!session) return;
    
    const recipientId = session.hostId === socket.id ? session.clientId : session.hostId;
    const recipientSocket = io.sockets.sockets.get(recipientId);
    
    if (recipientSocket) {
      recipientSocket.emit('screen-data', data);
      
      // Reset inactivity timeout
      clearTimeout(session.timeout);
      session.timeout = setTimeout(() => {
        if (activeSessions.has(session.id)) {
          endSession(session.id);
        }
      }, 60 * 60 * 1000);
    }
  });
  
  // Mouse and keyboard events
  socket.on('control-event', (data) => {
    const session = findSessionByParticipant(socket.id);
    if (!session || session.clientId !== socket.id) return; // Only client can send control events
    
    const hostSocket = io.sockets.sockets.get(session.hostId);
    if (hostSocket) {
      hostSocket.emit('control-event', data);
    }
  });
  
  // File transfer
  socket.on('file-transfer-init', (data) => {
    const session = findSessionByParticipant(socket.id);
    if (!session) return;
    
    const recipientId = session.hostId === socket.id ? session.clientId : session.hostId;
    const recipientSocket = io.sockets.sockets.get(recipientId);
    
    if (recipientSocket) {
      recipientSocket.emit('file-transfer-init', {
        fileName: data.fileName,
        fileSize: data.fileSize,
        fileId: data.fileId
      });
    }
  });
  
  socket.on('file-chunk', (data) => {
    const session = findSessionByParticipant(socket.id);
    if (!session) return;
    
    const recipientId = session.hostId === socket.id ? session.clientId : session.hostId;
    const recipientSocket = io.sockets.sockets.get(recipientId);
    
    if (recipientSocket) {
      recipientSocket.emit('file-chunk', {
        fileId: data.fileId,
        chunk: data.chunk,
        chunkIndex: data.chunkIndex,
        isLast: data.isLast
      });
    }
  });
  
  socket.on('file-transfer-complete', (data) => {
    const session = findSessionByParticipant(socket.id);
    if (!session) return;
    
    // Add to session history
    session.transferredFiles.push({
      name: data.fileName,
      size: data.fileSize,
      timestamp: Date.now(),
      sender: socket.id
    });
    
    const recipientId = session.hostId === socket.id ? session.clientId : session.hostId;
    const recipientSocket = io.sockets.sockets.get(recipientId);
    
    if (recipientSocket) {
      recipientSocket.emit('file-transfer-complete', {
        fileName: data.fileName,
        fileSize: data.fileSize
      });
    }
  });
  
  // End session
  socket.on('end-session', () => {
    const session = findSessionByParticipant(socket.id);
    if (session) {
      endSession(session.id);
    }
  });
  
  // Disconnect handling
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    // Check if this was a host with an active code
    for (const [code, info] of accessCodes.entries()) {
      if (info.hostId === socket.id) {
        accessCodes.delete(code);
      }
    }
    
    // Check if this was a pending connection
    pendingConnections.delete(socket.id);
    
    // Check if this was part of an active session
    const session = findSessionByParticipant(socket.id);
    if (session) {
      endSession(session.id);
    }
  });
  
  // Helper function to find session by participant
  function findSessionByParticipant(socketId) {
    for (const [sessionId, session] of activeSessions.entries()) {
      if (session.hostId === socketId || session.clientId === socketId) {
        return { ...session, id: sessionId };
      }
    }
    return null;
  }
  
  // Helper function to end a session
  function endSession(sessionId) {
    const session = activeSessions.get(sessionId);
    if (!session) return;
    
    clearTimeout(session.timeout);
    
    // Notify both parties if they're still connected
    const hostSocket = io.sockets.sockets.get(session.hostId);
    const clientSocket = io.sockets.sockets.get(session.clientId);
    
    if (hostSocket) {
      hostSocket.emit('session-ended');
    }
    
    if (clientSocket) {
      clientSocket.emit('session-ended');
    }
    
    // Clean up any temporary files
    // (In a production app, you'd want to clean up any stored files)
    
    activeSessions.delete(sessionId);
  }
});

// Start server
server.listen(PORT, () => {
  console.log(`FamilyDesk server running on port ${PORT}`);
});