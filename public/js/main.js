const createUserBtn = document.getElementById("create-user");
const username = document.getElementById("username");
const allusersHtml = document.getElementById("allusers");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const endCallBtn = document.getElementById("end-call-btn");
const notificationContainer = document.getElementById("notification-container");
const screenShareBtn = document.getElementById("screen-share-btn");
const cameraToggle = document.getElementById("camera-toggle");
const audioToggle = document.getElementById("audio-toggle");
let isAudioOn = true
let isCameraOn = true;
const socket = io();
let screenStream = null;
let localStream;
let caller = [];
let remoteUser = null;
let callingNotificationTimeout; 
const pendingCalls = new Map();

// Check URL parameters for notification actions
window.addEventListener('load', function() {
    const urlParams = new URLSearchParams(window.location.search);
    const action = urlParams.get('action');
    const callerParam = urlParams.get('caller');
    
    if (action === 'answer' && callerParam) {
        console.log('Auto-answering call from:', callerParam);
        // Will be handled once the user is logged in
        window.pendingAutoAnswer = callerParam;
    }
});

const peerConnection = (function () {
    let peerConnection = null;

    const createPeerConnection = () => {
        const config = {
            iceServers: [
                {
                    urls: 'stun:stun.l.google.com:19302'
                }
            ]
        };
        peerConnection = new RTCPeerConnection(config);

        localStream.getTracks().forEach(tracks => {
            peerConnection.addTrack(tracks, localStream);
        });

        peerConnection.ontrack = function (event) {
            remoteVideo.srcObject = event.streams[0];
        };

        peerConnection.onicecandidate = function (event) {
            if (event.candidate) {
                socket.emit("icecandidate", { candidate: event.candidate, to: remoteUser });
            }
        };

        return peerConnection;
    };

    return {
        getInstance: () => {
            if (!peerConnection) {
                peerConnection = createPeerConnection();
            }
            return peerConnection;
        },
        reset: () => {
            if (peerConnection) {
                peerConnection.close();
                peerConnection = null;
            }
        }
    };
})();

createUserBtn.addEventListener("click", (e) => {
    if (username.value !== "") {
        const usernameContainer = document.querySelector(".username-input");
        socket.emit("join-user", username.value);
        usernameContainer.style.display = 'none';

        // Check if we need to auto-answer a call
        if (window.pendingAutoAnswer) {
            setTimeout(() => {
                remoteUser = window.pendingAutoAnswer;
                proceedWithCall(window.pendingAutoAnswer);
                delete window.pendingAutoAnswer;
            }, 1000);
        }
    }
});

audioToggle.addEventListener("click", () => {
    if (isAudioOn) {
        // Mute the audio
        localStream.getAudioTracks().forEach(track => (track.enabled = false));
        audioToggle.src = "/js/images/mic-off.png"; // Change to "mic off" image
        isAudioOn = false;
    } else {
        // Unmute the audio
        localStream.getAudioTracks().forEach(track => (track.enabled = true));
        audioToggle.src = "/js/images/mic-on.png"; // Change to "mic on" image
        isAudioOn = true;
    }
});

cameraToggle.addEventListener("click", async () => {
    if (isCameraOn) {
        // Turn off the camera
        localStream.getVideoTracks().forEach(track => track.stop());
        localVideo.srcObject = null;
        cameraToggle.src = "/js/images/camera-off.png"; // Change image to "camera off" state
        isCameraOn = false;
    } else {
        // Turn on the camera
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            localStream = stream;
            localVideo.srcObject = stream;
            cameraToggle.src = "/js/images/camera-on.png"; // Change image to "camera on" state
            isCameraOn = true;
        } catch (error) {
            console.error("Error accessing camera:", error);
        }
    }
});


screenShareBtn.addEventListener("click", async () => {
    if (!screenStream) {
        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            const pc = peerConnection.getInstance();

            const screenTrack = screenStream.getVideoTracks()[0];
            const sender = pc.getSenders().find(sender => sender.track.kind === "video");
            if (sender) {
                sender.replaceTrack(screenTrack);
            }

            screenShareBtn.textContent = "Stop Sharing";
            screenShareBtn.style.backgroundColor = "#f44336";
        } catch (error) {
            console.error("Error sharing screen:", error);
        }
    } else {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;

        const pc = peerConnection.getInstance();
        const cameraTrack = localStream.getVideoTracks()[0];
        const sender = pc.getSenders().find(sender => sender.track.kind === "video");
        if (sender) {
            sender.replaceTrack(cameraTrack);
        }

        screenShareBtn.textContent = "Share Screen";
        screenShareBtn.style.backgroundColor = "#4CAF50";
    }
});

endCallBtn.addEventListener("click", (e) => {
    socket.emit("call-ended", caller);
    hideNotification();
});

socket.on("joined", (allusers) => {
    console.log({ allusers });

    const createUserhtml = () => {
        allusersHtml.innerHTML = "";
        for (const user in allusers) {
            const li = document.createElement("li");
            li.textContent = `${user} ${user === username.value ? "(You)" : ""}`;

            if (user !== username.value) {
                const button = document.createElement("button");
                button.classList.add("call-btn");
                button.addEventListener("click", (e) => {
                    startCall(user);
                });

                const img = document.createElement("img");
                img.setAttribute("src", "/js/images/phone.png");
                img.setAttribute("width", 20);

                button.appendChild(img);
                li.appendChild(button);
            }
            allusersHtml.appendChild(li);
        }
    };
    createUserhtml();
});

socket.on("call-request", ({ from }) => {
    showNotification(from);
});

socket.on("offer", async ({ from, to, offer }) => {
    remoteUser = from;
    const pc = peerConnection.getInstance();
    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("answer", { from, to, answer: pc.localDescription });
});

socket.on("answer", async ({ from, to, answer }) => {
    hideCallingNotification()
    clearMissedCallNotification(from);
    clearMissedCallNotification(to)

    const pc = peerConnection.getInstance();
    await pc.setRemoteDescription(answer);


    endCallBtn.classList.remove("d-none");
    socket.emit("end-call", { from, to });
    caller = [from, to];
    hideNotification();
    // removeNotification()
    clearMissedCallNotification(from);
    
    // Also clear any missed call notifications for the remote user
    if (remoteUser) {
        clearMissedCallNotification(remoteUser);
    }
});

socket.on("icecandidate", async ({ candidate }) => {
    console.log({ candidate });
    const pc = peerConnection.getInstance();
    try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
        console.error("Error adding ICE candidate:", error);
    }
});

socket.on("end-call", ({ from, to }) => {
    endCallBtn.classList.remove("d-none");
});

socket.on("call-ended", (caller) => {
    endCall();
    hideNotification();
});

socket.on("call-canceled", ({ from }) => {
    console.log(`Call from ${from} was canceled before you could answer.`);
    
    // Remove any incoming call notifications
    removeNotification(from);

    // Ensure the notification container is hidden if there are no active notifications
    if (notificationContainer.children.length === 0) {
        notificationContainer.style.display = "none";
    }
});

socket.on("missed-call", ({ caller }) => {
    console.log(`Missed call from ${caller}`);
    
    // Play a missed call sound (optional)
    // const missedCallSound = new Audio('/js/sounds/missed-call.mp3');
    // missedCallSound.play().catch(e => console.log("Missed call sound play failed:", e));

    removeNotification(caller);
    
    // Show missed call notification
    showMissedCallNotification(caller);
});

socket.on("call-rejected", ({ from, to }) => {
    hideCallingNotification();
    alert(`Your call to ${to} was rejected`);
    endCall();
   
    removeNotification()
});

const proceedWithCall = async (from) => {
    if (!localStream) {
        console.error("Local stream is not initialized yet.");
        return;
    }

    remoteUser = from;
    const pc = peerConnection.getInstance();
    const offer = await pc.createOffer();
    console.log({ offer });
    await pc.setLocalDescription(offer);
    socket.emit("offer", { from: username.value, to: remoteUser, offer: pc.localDescription });

    clearMissedCallNotification(from)
};

const showMissedCallNotification = (caller) => {
    const notificationElement = document.createElement('div');
    notificationElement.className = 'notification-box missed-call';
    notificationElement.innerHTML = `
        <div style="margin-bottom: 10px;"><strong>${caller}</strong> tried to call you</div>
        <div class="call-btn-container">
            <button class="close-btn">Close</button>
        </div>
    `;

    const closeButton = notificationElement.querySelector('.close-btn');
    closeButton.addEventListener('click', () => {
        notificationContainer.removeChild(notificationElement);
        if (notificationContainer.children.length === 0) {
            notificationContainer.style.display = "none";
        }
    });

    notificationContainer.appendChild(notificationElement);
    notificationContainer.style.display = "block";
};

const rejectCall = (from) => {
    socket.emit("call-rejected", { from: from, to: username.value });
    removeNotification(from);
    clearMissedCallNotification(from)
};

const endCall = () => {
    const pc = peerConnection.getInstance();
    if (pc) {
        pc.close();
        peerConnection.reset();
        endCallBtn.classList.add("d-none");
    }

    if (remoteUser) {
        socket.emit("call-canceled", { from: username.value, to: remoteUser });
    }

    // Reset UI elements
    endCallBtn.classList.add("d-none");
    hideNotification();
    remoteVideo.srcObject = null;

    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }
    screenShareBtn.textContent = "Share Screen";
    screenShareBtn.style.backgroundColor = "#4CAF50";

    clearMissedCallNotification(remoteUser)

    if(remoteUser){
        clearMissedCallNotification(remoteUser)
    }
};

const clearMissedCallNotification = (caller) => {
    // Find and remove any missed call notifications for this caller
    const missedCallNotifications = Array.from(notificationContainer.querySelectorAll('.notification-box.missed-call'));
    
    missedCallNotifications.forEach(notification => {
        const callerName = notification.querySelector('strong')?.textContent;
        if (callerName === caller) {
            notificationContainer.removeChild(notification);
        }
    });
    
    // Hide container if empty
    if (notificationContainer.children.length === 0) {
        notificationContainer.style.display = "none";
    }
};

const showNotification = (caller) => {
    if (pendingCalls.has(caller)) {
        return;
    }
    clearMissedCallNotification(caller);

    const notificationElement = document.createElement('div');
    notificationElement.className = 'notification-box';
    notificationElement.innerHTML = `
        <div style="margin-bottom: 10px;"><strong>${caller}</strong> is calling you</div>
        <div class="call-btn-container">
            <button class="accept-btn">Accept</button>
            <button class="reject-btn">Reject</button>
        </div>
    `;

    const audio = new Audio('/js/sounds/ringtone.mp3');
    audio.loop = true;
    audio.play().catch(e => console.log("Audio play failed:", e));
    notificationElement.audio = audio;

    const acceptButton = notificationElement.querySelector('.accept-btn');
    const rejectButton = notificationElement.querySelector('.reject-btn');

    acceptButton.addEventListener('click', () => {
        if (notificationElement.audio) {
            notificationElement.audio.pause();
        }

        pendingCalls.forEach((element, otherCaller) => {
            if (otherCaller !== caller) {
                socket.emit("call-rejected", { from: otherCaller, to: username.value });
                if (element.audio) {
                    element.audio.pause();
                }
                notificationContainer.removeChild(element);
            }
        });

        pendingCalls.forEach((element, key) => {
            if (key !== caller) {
                pendingCalls.delete(key);
            }
        });

        proceedWithCall(caller);
        pendingCalls.delete(caller);
        notificationContainer.removeChild(notificationElement);

        if (notificationContainer.children.length === 0) {
            notificationContainer.style.display = "none";
        }
    });

    rejectButton.addEventListener('click', () => {
        rejectCall(caller);
    });

    pendingCalls.set(caller, notificationElement);

    notificationContainer.appendChild(notificationElement);
    notificationContainer.style.display = "block";
};

const showCallingNotification = (callee) => {
    notificationContainer.innerHTML = `
        <div class="notification-box">
            <div class="calling-info">Calling <strong>${callee}</strong>...</div>
            <div class="call-btn-container">
                <button id="cancel-call" class="reject-btn">Cancel</button>
            </div>
        </div>
    `;

    notificationContainer.style.display = "block";

    document.getElementById("cancel-call").addEventListener("click", () => {
        socket.emit("call-rejected", { from: username.value, to: callee });
        hideCallingNotification();
        endCall();
    });

    document.getElementById("cancel-call").addEventListener("click", () => {
        socket.emit("call-canceled", { from: username.value, to: callee });
        hideCallingNotification();
        endCall();
    });
    
    callingNotificationTimeout = setTimeout(() => {
        hideCallingNotification();
    }, 10000);
};

const hideCallingNotification = () => {
    clearTimeout(callingNotificationTimeout);
    notificationContainer.innerHTML = '';
    notificationContainer.style.display = "none";
};

const removeNotification = (caller) => {
    if (pendingCalls.has(caller)) {
        const element = pendingCalls.get(caller);
        if (element.audio) {
            element.audio.pause();
        }
        notificationContainer.removeChild(element);
        pendingCalls.delete(caller);

        if (notificationContainer.children.length === 0) {
            notificationContainer.style.display = "none";
        }
    }
};

const hideNotification = () => {
    pendingCalls.forEach((element, caller) => {
        if (element.audio) {
            element.audio.pause();
        }
    });
    pendingCalls.clear();

    notificationContainer.innerHTML = '';
    notificationContainer.style.display = "none";
};

const startMyVideo = async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        console.log({ stream });
        localStream = stream;
        localVideo.srcObject = stream;
        cameraToggle.src = "/js/images/camera-on.png"; // Set initial image to "camera on"
        isCameraOn = true;
        audioToggle.src = "/js/images/mic-on.png"; // Set initial image to "mic on"
        isAudioOn = true;
    } catch (error) {
        console.log("error in startMyVideo", error);
    }
};


const startCall = async (user) => {
    console.log(`Calling ${user}...`);
    remoteUser = user;

    // Send call request to the server
    socket.emit("call-request", { from: username.value, to: user });

    // Show the calling notification UI
    showCallingNotification(user);

    // Get WhatsApp number from localStorage
    const receiverNumber = localStorage.getItem("whatsappNumber"); // Corrected: Use getItem to retrieve the value
    const callerName = localStorage.getItem("username") || "Unknown User";

    if (receiverNumber) {
        console.log(`Sending WhatsApp notification to ${receiverNumber}...`);
        socket.emit("startCall", { callerName, receiverNumber });
    } else {
        console.error("WhatsApp number not found in localStorage.");
    }
};

// Start video
startMyVideo();