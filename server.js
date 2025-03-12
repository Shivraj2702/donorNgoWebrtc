import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import { dirname, join } from "path";


const app = express();
const server = createServer(app);
const io = new Server(server);
const allusers = {};
const socketToUser = {};

const __dirname = dirname(fileURLToPath(import.meta.url));

// Middleware
app.use(express.static(join(__dirname, 'public')));
app.use(express.json()); // Parse JSON request bodies

// Routes
app.get('/', (req, res) => {
    res.sendFile(join(__dirname, "/app/index.html"));
});

// Socket.io event handling
io.on('connection', (socket) => {
    socket.emit("update-users", allusers);
    console.log(`a user connected ${socket.id}`);

    socket.on("join-user", username => {
        console.log(`${username} socket joined connection`);
        allusers[username] = { username, id: socket.id };
        socketToUser[socket.id] = username;
        io.emit("joined", allusers);
    });

    socket.on("call-request", ({ from, to }) => {
        console.log(`${from} is calling ${to}`);
        if (allusers[to]) {
            io.to(allusers[to].id).emit("call-request", { from });

            // Set a timeout for missed call notification
            const missedCallTimeout = setTimeout(() => {
                // If the call is not answered within 30 seconds, send a missed call notification
                if (allusers[to]) {
                    io.to(allusers[to].id).emit("missed-call", { caller: from });
                }
            }, 10000); 
            // Store the timeout in the socket object
            socket.missedCallTimeout = missedCallTimeout;
    
            // Send a push notification if the target user has registered for notifications
        } else {
            // If user is offline, send a missed call notification
            sendMissedCallNotification(to, from);
        }
    });

    socket.on("offer", ({ from, to, offer }) => {
        console.log(`Received offer from ${from} to ${to}`);
        if (allusers[to]) {
            io.to(allusers[to].id).emit("offer", { from, to, offer });
        }
    });

    socket.on("call-canceled", ({ from, to }) => {
        console.log(`Call from ${from} to ${to} was canceled`);
    
        // Notify User B that the call was canceled (if they haven't answered yet)
        if (allusers[to]) {
            io.to(allusers[to].id).emit("call-canceled", { from });
        }
    
        // Prevent the missed call notification from triggering
        const socketId = allusers[to]?.id;
        if (socketId) {
            const targetSocket = io.sockets.sockets.get(socketId);
            if (targetSocket && targetSocket.missedCallTimeout) {
                clearTimeout(targetSocket.missedCallTimeout);
                delete targetSocket.missedCallTimeout;
            }
        }
    });
    
    socket.on("answer", ({ from, to, answer }) => {
        console.log(`Received answer from ${to} to ${from}`);
        if (allusers[from]) {
            io.to(allusers[from].id).emit("answer", { from, to, answer });
    
            // Clear the missed call timeout
            const socketId = allusers[from].id;
            const socket = io.sockets.sockets.get(socketId);
            if (socket && socket.missedCallTimeout) {
                clearTimeout(socket.missedCallTimeout);
                delete socket.missedCallTimeout;
            }

            const toSocket = io.sockets.sockets.get(allusers[to]?.id);
            if (toSocket && toSocket.missedCallTimeout) {
                clearTimeout(toSocket.missedCallTimeout);
                delete toSocket.missedCallTimeout;
            }
        }
    });

    socket.on("end-call", ({ from, to }) => {
        console.log(`Call ending notification from ${from} to ${to}`);
        if (allusers[to]) {
            io.to(allusers[to].id).emit("end-call", { from, to });
        }
    });

    socket.on("call-ended", caller => {
        const [from, to] = caller;
        console.log(`Call ended between ${from} and ${to}`);
        if (allusers[from]) {

            io.to(allusers[from].id).emit("call-ended", caller);
            // Clear the missed call timeout
        const socketId = allusers[from].id;
        const socket = io.sockets.sockets.get(socketId);
        if (socket && socket.missedCallTimeout) {
            clearTimeout(socket.missedCallTimeout);
            delete socket.missedCallTimeout; // Optional: Clean up the timeout reference
        }
        }
        if (allusers[to]) {
            io.to(allusers[to].id).emit("call-ended", caller);
        }
    });

    socket.on("icecandidate", ({ candidate, to }) => {
        console.log(`ICE candidate for ${to}`);
        if (allusers[to]) {
            io.to(allusers[to].id).emit("icecandidate", { candidate, to });
        }
    });

    socket.on("call-rejected", ({ from, to }) => {
        console.log(`Call from ${from} to ${to} was rejected`);
        if (allusers[from]) {
            io.to(allusers[from].id).emit("call-rejected", { from, to });
        }
        const socketId = allusers[from].id;
        const socket = io.sockets.sockets.get(socketId);
        if (socket && socket.missedCallTimeout) {
            clearTimeout(socket.missedCallTimeout);
            delete socket.missedCallTimeout; // Optional: Clean up the timeout reference
        }
        // Send missed call notification to the caller
        sendMissedCallNotification(to, from);
    });

    socket.on("disconnect", () => {
        console.log(`user disconnected ${socket.id}`);
        const username = socketToUser[socket.id];
        if (username) {

            if (socket.missedCallTimeout) {
                clearTimeout(socket.missedCallTimeout);
                delete socket.missedCallTimeout; // Optional: Clean up the timeout reference
            }
    
            // Only remove from active users list, keep notification ID
            delete allusers[username];
            delete socketToUser[socket.id];
            
        }
        io.emit("joined", allusers);
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start the server
server.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(`Visit http://localhost:${port} to access the application`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('Server shutting down');
    server.close(() => {
        console.log('Server stopped');
        process.exit(0);
    });
});