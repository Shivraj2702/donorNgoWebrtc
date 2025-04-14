import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import cors from 'cors';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';

dotenv.config();

const port = process.env.PORT || 8080;

const app = express();
const server = createServer(app);
const allusers = {};
const socketToUser = {};
let connectedUsers = {};
const waitingDonors = {}; // { ngoId: [donorSocketId1, donorSocketId2, ...] }

const lastEmailSent = {};
const EMAIL_RATE_LIMIT = 5 * 60 * 1000;



// const transporter = nodemailer.createTransport({
//     host: "smtp.office365.com",
//     port: 587,
//     secure: false, // use TLS (STARTTLS)
//     auth: {
//       user: process.env.EMAIL_USER,
//       pass: process.env.EMAIL_PASS,
//     },
//     tls: {
//       rejectUnauthorized: true,
//       minVersion: "TLSv1.2"
//     }
//   });

const __dirname = dirname(fileURLToPath(import.meta.url));

app.use(cors({
    origin: ["http://localhost:5173", "http://localhost:5174"], // Allow requests from these origins
    credentials: true, // Allow credentials (cookies, authorization headers, etc.)
}));

// Configure CORS for Socket.IO
const io = new Server(server, {
    cors: {
        origin: ["http://localhost:5173", "http://localhost:5174"], // Allow Socket.IO connections from these origins
        methods: ["GET", "POST"], // Allowed HTTP methods
        credentials: true, // Allow credentials
    },
});

// Middleware
app.use(express.static(join(__dirname, 'public')));
app.use(express.json()); // Parse JSON request bodies

// Routes
app.get('/', (req, res) => {
    res.sendFile(join(__dirname, "/app/index.html"));
});

app.get('/api/turn-token', async (req, res) => {
    try {
        const token = await client.tokens.create();

        const iceServers = token.iceServers.filter(server => !!server.urls); // Ensure 'urls' exists

        res.json({ iceServers });
    } catch (error) {
        console.error('Error fetching TURN token:', error);
        res.status(500).json({ error: 'Failed to get TURN servers' });
    }
});

async function sendNotificationEmail(ngoId, email, donorName) {
    const now = Date.now();
    
    // Check if we've sent an email to this NGO recently
    if (lastEmailSent[ngoId] && now - lastEmailSent[ngoId] < EMAIL_RATE_LIMIT) {
        console.log(`📧 Email to NGO ${ngoId} skipped - rate limited (last sent ${Math.round((now - lastEmailSent[ngoId])/1000)} seconds ago)`);
        return false;
    }
    
    try {
        await transporter.sendMail({
            from: `"NGO Connect" <${process.env.EMAIL_USER}>`,
            subject: "Donor Trying to Connect With You",
            to: email,
            text: `${donorName} is waiting to speak with you right now! Please log in to respond to this call request.`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
                    <div style="text-align: center; padding: 10px; background-color: #4CAF50; color: white; border-radius: 5px 5px 0 0;">
                        <h2 style="margin: 0;">📞 Incoming Call Request</h2>
                    </div>
                    
                    <div style="padding: 20px; background-color: #f9f9f9;">
                        <p style="font-size: 16px; line-height: 1.5;">A donor  is waiting to connect with you <strong>right now</strong>!</p>
                        <p style="font-size: 16px; line-height: 1.5;">They're trying to reach your organization  and are currently waiting online.</p>
                        
                        <div style="background-color: #fff4e5; border-left: 4px solid #ff9800; padding: 12px; margin: 15px 0;">
                            <p style="margin: 0; font-size: 14px;"><strong>Note:</strong> If you don't respond soon, the donor may leave and the opportunity to connect could be lost.</p>
                        </div>
                    </div>
                    
                    <div style="text-align: center; padding: 20px;">
                        <a href="http://localhost:5173/web-call" style="background-color: #4CAF50; color: white; padding: 12px 30px; text-decoration: none; font-size: 16px; border-radius: 4px; display: inline-block;">Go Online Now</a>
                    </div>
                    
                    <div style="padding: 15px; background-color: #f0f0f0; border-radius: 0 0 5px 5px; font-size: 14px; color: #666;">
                        <p style="margin: 0;">This is an automated message the nobleGiving website. Please do not reply to this email.</p>
                    </div>
                </div>
            `
        });
        console.log(`📧 Email sent to ${email} for NGO ${ngoId}`);
        
        // Update the timestamp
        lastEmailSent[ngoId] = now;
        return true;
    } catch (err) {
        console.error("❌ Error sending email:", err);
        return false;
    }
}

// Socket.io event handling
io.on('connection', (socket) => {
    // Add this new event handler
    socket.on('check-ngo-and-notify', async ({ ngoId, email, donorName }, callback) => {
        // Check if NGO is online
        const isOnline = connectedUsers[ngoId] !== undefined;
        console.log(`Check NGO ${ngoId} online status: ${isOnline}`);
        
        // If NGO is offline and email is provided, send a notification
        if (!isOnline && email) {
            console.log(`Attempting to notify NGO ${ngoId} via email: ${email}`);
            await sendNotificationEmail(ngoId, email, donorName);
        }
        
        // Return the online status
        callback({ isOnline });
    });
    socket.on('register-waiting-donor', ({ donorId, ngoId }) => {
        console.log(`Donor ${donorId} is waiting for NGO ${ngoId}`);
    
        if (!waitingDonors[ngoId]) {
            waitingDonors[ngoId] = [];
        }
    
        if (!waitingDonors[ngoId].includes(socket.id)) {
            waitingDonors[ngoId].push(socket.id);
        }
    });
    
    socket.on('check-ngo-online',async ({ ngoId, email }, callback) => {
        const checkDuration = 30000; // 30 seconds
        const checkInterval = 2000; // Check every 2 seconds
        let timeElapsed = 0;

        if (connectedUsers[ngoId]) {
            callback({ isOnline: true });
            return;
        }

    
        const interval = setInterval(() => {
            const isOnline = connectedUsers[ngoId] !== undefined;
            timeElapsed += checkInterval;
    
            if (isOnline) {
                cleanup();
                callback({ isOnline: true });
            } else if (timeElapsed >= checkDuration) {
                cleanup();
                callback({ isOnline: false });
            }
        }, checkInterval);
          // Cleanup function
        const cleanup = () => {
            clearInterval(interval);
            socket.removeListener('disconnect', handleDisconnect);
        };
    
        const handleDisconnect = () => {
            cleanup();
        };
    
        // Add disconnect listener
        socket.once('disconnect', handleDisconnect);
    });
    socket.on('join', ({ userId }) => {
        console.log(`${userId} joined with socket ID: ${socket.id}`);
        connectedUsers[userId] = socket.id; // Map userId to socket ID
        if (waitingDonors[userId]) {
            waitingDonors[userId].forEach(donorSocketId => {
                io.to(donorSocketId).emit('ngo-now-online', { ngoId: userId });
            });
    
            // Clear the waiting list for this NGO
            delete waitingDonors[userId];
        }
        io.emit('update-contacts', connectedUsers); // Notify all users of the updated contact list
    });

    socket.on("call-request", ({ name, from, to, ngoId, email }) => {
        console.log(`${from} is calling ${to} for NGO ${ngoId}`);
        
        if (!name) console.error('Missing name in call-request from', from);
        if (connectedUsers[to]) {
            io.to(connectedUsers[to]).emit("call-request", { name, from, to, ngoId });
        }       
    });

    socket.on("call-accepted", ({ name , from, to, ngoId }) => {
        console.log(`${to} accepted call from ${from} for NGO ${ngoId}`);

        if (connectedUsers[from]) {
            io.to(connectedUsers[from]).emit("call-accepted", {name , from, to, ngoId });
        }
    });

    socket.on("offer", ({ from, to, offer, ngoId,name  }) => {
        console.log(`Offer from ${from} to ${to} for NGO ${ngoId}`);
        if (connectedUsers[to]) {
            io.to(connectedUsers[to]).emit("offer", { from, to, offer, ngoId, name });
        }
    });

    socket.on("answer", ({ from, to, answer, ngoId, name  }) => {
        // 1. Log the incoming answer
        console.log(`[Answer] NGO ${ngoId}: ${from} → ${to}`);
        
        // 2. Validate payload
        if ( !from || !to || !answer || !answer.sdp) {
          console.error("Invalid answer payload:", { from, to, answer, ngoId });
          return;
        }
      
        // 3. Verify recipient exists
        const recipientSocketId = connectedUsers[to];
        if (!recipientSocketId) {
          console.error(`Recipient ${to} not found. Connected users:`, Object.keys(connectedUsers));
          return;
        }
      
        // 4. Forward the answer
        console.log(`Forwarding to ${to} (socket ID: ${recipientSocketId})`);
        io.to(recipientSocketId).emit("answer", { 
          from, 
          to, 
          answer, 
          ngoId,
          name 
        });
      });

    socket.on("icecandidate", ({ candidate, from, to, ngoId, name }) => {
        console.log(`ICE Candidate from ${to} for NGO ${ngoId}`);
        if (connectedUsers[to]) {
            io.to(connectedUsers[to]).emit("icecandidate", { candidate,from, to, ngoId,  name });
        }
    });

    socket.on("call-ended", ({ from, to, ngoId , name}) => {
        console.log(`Call ended between ${from} and ${to} for NGO ${ngoId}`);
        if (connectedUsers[from]) {
            io.to(connectedUsers[from]).emit("call-ended", { from, to, ngoId , name });
        }
        if (connectedUsers[to]) {
            io.to(connectedUsers[to]).emit("call-ended", { from, to, ngoId, name });
        }
    });

    socket.on("call-rejected", ({ from, to}) => {
        console.log(`Call from ${from} to ${to} rejected`);
        // if (connectedUsers[from]) {
        //     io.to(connectedUsers[from]).emit("call-rejected", { from, to, ngoId , name});
        // }
        // if (connectedUsers[to]) {
        //     io.to(connectedUsers[to]).emit("call-rejected", { from, to, ngoId , name});
        // }
        if (connectedUsers[to]) {
            io.to(connectedUsers[to]).emit("call-rejected", {
             from,
             to
            });
          }

    });

    socket.on("call-canceled", ({ from, to, ngoId , name}) => {
        console.log(`Call from ${from} to ${to} for NGO ${ngoId} was canceled`);
        if (connectedUsers[to]) {
            io.to(connectedUsers[to]).emit("call-canceled", { from, ngoId , name});
        }
    });

    socket.on("disconnect", () => {
        console.log(`user disconnected ${socket.id}`);
        for (const userId in connectedUsers) {
            if (connectedUsers[userId] === socket.id) {
                console.log(`Removing user ${userId} from connectedUsers`);
                delete connectedUsers[userId];
                break;
            }
        }
        
        for (const ngoId in waitingDonors) {
            waitingDonors[ngoId] = waitingDonors[ngoId].filter(id => id !== socket.id);
            if (waitingDonors[ngoId].length === 0) {
                delete waitingDonors[ngoId];
            }
        }

        const username = socketToUser[socket.id];
        if (username) {
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