// =========================================================
// AI TIMER - STUDENT ENGINE (COMPLETE FIXED VERSION)
// =========================================================

const firebaseConfig = {
    apiKey: "AIzaSyC5X_133pN6wO6YvdbsB01OdokD1l9qpB4",
    authDomain: "ai-timer-project.firebaseapp.com",
    databaseURL: "https://ai-timer-project-default-rtdb.firebaseio.com",
    projectId: "ai-timer-project",
    storageBucket: "ai-timer-project.firebasestorage.app",
    messagingSenderId: "134965203763",
    appId: "1:134965203763:web:bd128c0ca23454666c2446"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const db = firebase.database();

let timerInterval = null;
let isRunning = false;
let webcamStream = null;
let trackerTask = null;
let studyChart = null;

// --- HEAD TILT BUFFER VARIABLES ---
let gracePeriodCounter = 0; 
const MAX_GRACE_TICKS = 4; 

let studentData = {
    studentName: localStorage.getItem("studentName") || "Student",
    todayStudySeconds: Number(localStorage.getItem("todayStudySeconds")) || 0,
    focusSessions: Number(localStorage.getItem("focusSessions")) || 0,
    dailyGoal: Number(localStorage.getItem("dailyGoal")) || 120,
    tasks: JSON.parse(localStorage.getItem("tasks")) || [],
    notifications: JSON.parse(localStorage.getItem("notifications")) || [],
    chartLabels: JSON.parse(localStorage.getItem("chartLabels")) || [],
    chartData: JSON.parse(localStorage.getItem("chartData")) || [],
    deviceStatus: "Online",
    cameraActive: false,
    faceDetected: false,
    aiStatus: "Initializing...",
    lastSnapshot: "",
    lastSnapshotTime: ""
};

// --- GRAPH SETUP (STUDENT DASHBOARD) ---
function initStudentChart() {
    const ctx = document.getElementById('studentStudyChart');
    if (!ctx) return;

    if (studyChart) {
        studyChart.destroy();
    }

    studyChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: studentData.chartLabels.length > 0 ? studentData.chartLabels : ['Start'],
            datasets: [{
                label: 'Study Time (Minutes)',
                data: studentData.chartData.length > 0 ? studentData.chartData : [0],
                borderColor: '#2563eb',
                backgroundColor: 'rgba(37, 99, 235, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { beginAtZero: true } }
        }
    });
}

function updateGraphPoints() {
    const timeLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const currentMins = Math.round((studentData.todayStudySeconds / 60) * 10) / 10;

    studentData.chartLabels.push(timeLabel);
    studentData.chartData.push(currentMins);

    if (studentData.chartLabels.length > 10) {
        studentData.chartLabels.shift();
        studentData.chartData.shift();
    }

    if (studyChart) {
        studyChart.data.labels = studentData.chartLabels;
        studyChart.data.datasets[0].data = studentData.chartData;
        studyChart.update();
    }
}

// --- WEBCAM & CONTINUOUS TRACKING ---
async function startWebcam() {
    const videoEl = document.getElementById("webcamVideo");

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: 320, height: 240, facingMode: "user" }, 
            audio: false 
        });
        
        webcamStream = stream;
        if (videoEl) {
            videoEl.srcObject = stream;
            videoEl.play();
        }
        
        studentData.cameraActive = true;
        studentData.aiStatus = "Present / Focused";
        initContinuousFaceTracker();
        
        setTimeout(() => {
            captureAndUploadSnapshot();
        }, 2000);

    } catch (err) {
        console.error("Webcam Permission Error:", err);
        studentData.cameraActive = false;
        studentData.faceDetected = false;
        studentData.aiStatus = "⚠️ Camera Off";
        syncToCloud();
    }
}

function initContinuousFaceTracker() {
    if (typeof tracking !== "undefined") {
        try {
            const tracker = new tracking.ObjectTracker('face');
            tracker.setInitialScale(2.5);
            tracker.setStepSize(1.5);
            tracker.setEdgesDensity(0.08);

            if (trackerTask) trackerTask.stop();
            trackerTask = tracking.track('#webcamVideo', tracker);

            tracker.on('track', function(event) {
                let previousStatus = studentData.faceDetected;

                if (event.data && event.data.length > 0) {
                    studentData.faceDetected = true;
                    studentData.aiStatus = "Present / Focused";
                    gracePeriodCounter = 0;
                } else {
                    checkHeadTiltOrPresence();
                }

                // Fast Realtime Status Push if changed
                if (previousStatus !== studentData.faceDetected) {
                    db.ref("studentData").update({
                        faceDetected: studentData.faceDetected,
                        aiStatus: studentData.aiStatus,
                        cameraActive: studentData.cameraActive
                    });
                }
            });
            return;
        } catch(e) {
            console.log("Tracking library issue, using video stream frame analyzer fallback.");
        }
    }

    setInterval(() => {
        analyzeVideoStreamLive();
    }, 300);
}

function checkHeadTiltOrPresence() {
    const videoEl = document.getElementById("webcamVideo");
    const canvasEl = document.getElementById("snapshotCanvas");
    
    if (!videoEl || videoEl.paused || !studentData.cameraActive) {
        studentData.faceDetected = false;
        studentData.aiStatus = "Away / Distracted";
        return;
    }

    try {
        const ctx = canvasEl.getContext("2d");
        canvasEl.width = 160;
        canvasEl.height = 120;
        ctx.drawImage(videoEl, 0, 0, 160, 120);

        const imgData = ctx.getImageData(30, 20, 100, 80).data;
        let pixelActivity = 0;

        for (let i = 0; i < imgData.length; i += 4) {
            let avg = (imgData[i] + imgData[i+1] + imgData[i+2]) / 3;
            if (avg > 20) pixelActivity++;
        }

        if (pixelActivity > 1500) {
            gracePeriodCounter++;
            if (gracePeriodCounter <= MAX_GRACE_TICKS) {
                studentData.faceDetected = true;
                studentData.aiStatus = "Present / Focused";
                return;
            }
        }
    } catch (e) {
        console.error("Head tilt calculation error:", e);
    }

    studentData.faceDetected = false;
    studentData.aiStatus = "Away / Distracted";
}

function analyzeVideoStreamLive() {
    const videoEl = document.getElementById("webcamVideo");
    if (!videoEl || videoEl.paused || videoEl.ended || !studentData.cameraActive) {
        studentData.faceDetected = false;
        studentData.aiStatus = "Away / Distracted";
        db.ref("studentData").update({
            faceDetected: false,
            aiStatus: "Away / Distracted"
        });
        return;
    }

    const tracks = webcamStream ? webcamStream.getVideoTracks() : [];
    if (tracks.length === 0 || !tracks[0].enabled || tracks[0].readyState !== "live") {
        studentData.faceDetected = false;
        studentData.aiStatus = "⚠️ Camera Off";
        db.ref("studentData").update({
            faceDetected: false,
            aiStatus: "⚠️ Camera Off",
            cameraActive: false
        });
        return;
    }

    db.ref("studentData").update({
        faceDetected: studentData.faceDetected,
        aiStatus: studentData.aiStatus
    });
}

// --- SNAPSHOT & CLOUD SYNC ---
function captureAndUploadSnapshot() {
    const videoEl = document.getElementById("webcamVideo");
    const canvasEl = document.getElementById("snapshotCanvas");
    if (!videoEl || !canvasEl) return;

    const ctx = canvasEl.getContext("2d");
    canvasEl.width = 320;
    canvasEl.height = 240;

    ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
    
    const photoBase64 = canvasEl.toDataURL("image/jpeg", 0.3);

    studentData.lastSnapshot = photoBase64;
    studentData.lastSnapshotTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    syncToCloud();
}

function syncToCloud() {
    localStorage.setItem("studentName", studentData.studentName);
    localStorage.setItem("todayStudySeconds", studentData.todayStudySeconds);
    localStorage.setItem("focusSessions", studentData.focusSessions);
    localStorage.setItem("dailyGoal", studentData.dailyGoal);
    localStorage.setItem("tasks", JSON.stringify(studentData.tasks));
    localStorage.setItem("notifications", JSON.stringify(studentData.notifications));
    localStorage.setItem("chartLabels", JSON.stringify(studentData.chartLabels));
    localStorage.setItem("chartData", JSON.stringify(studentData.chartData));

    db.ref("studentData").set(studentData);
}

// --- TIMER CONTROLS ---
function startTimer() {
    if (isRunning) return;
    isRunning = true;

    captureAndUploadSnapshot();

    timerInterval = setInterval(() => {
        studentData.todayStudySeconds++;

        if (studentData.todayStudySeconds % 10 === 0) {
            captureAndUploadSnapshot();

            if (!studentData.faceDetected || !studentData.cameraActive) {
                pushAwayNotification();
            }

            updateGraphPoints();
        }

        updateUI();

        if (studentData.todayStudySeconds % 2 === 0) {
            syncToCloud();
        }
    }, 1000);
}

function pushAwayNotification() {
    const notifMsg = "⚠️ Alert: Student away from desk during study session!";
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const newNotif = {
        id: Date.now(),
        message: notifMsg,
        time: timeStr
    };

    if (!studentData.notifications) studentData.notifications = [];
    studentData.notifications.push(newNotif);

    if (studentData.notifications.length > 10) studentData.notifications.shift();

    db.ref("studentData/notifications").set(studentData.notifications);
}

function pauseTimer() {
    if (!isRunning) return;
    isRunning = false;
    clearInterval(timerInterval);

    studentData.focusSessions++;
    pushCustomNotification(`Session Paused. Focus Sessions: ${studentData.focusSessions}`);
    updateUI();
    syncToCloud();
}

function resetTimer() {
    if (isRunning) {
        isRunning = false;
        clearInterval(timerInterval);
    }
    studentData.todayStudySeconds = 0;
    studentData.chartLabels = [];
    studentData.chartData = [];
    if (studyChart) {
        studyChart.data.labels = ['Start'];
        studyChart.data.datasets[0].data = [0];
        studyChart.update();
    }
    updateUI();
    syncToCloud();
}

function pushCustomNotification(msg) {
    const notif = {
        id: Date.now(),
        message: msg,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    if (!studentData.notifications) studentData.notifications = [];
    studentData.notifications.push(notif);
    db.ref("studentData/notifications").set(studentData.notifications);
}

// --- TASK MANAGERS (WITH DATE SUPPORT) ---
function createNewTask() {
    const name = document.getElementById("taskNameInput").value;
    const dateInput = document.getElementById("taskDateInput") ? document.getElementById("taskDateInput").value : "";
    const start = document.getElementById("taskStartTimeInput").value;
    const end = document.getElementById("taskEndTimeInput").value;

    if (!name || name.trim() === "") {
        alert("Please enter a task name!");
        return;
    }

    const newTask = {
        id: Date.now(),
        name: name.trim(),
        date: dateInput || new Date().toISOString().split('T')[0], // Exact Calendar Date
        startTime: start || "00:00",
        endTime: end || "23:59",
        isCompleted: false,
        wasWarned: false,
        status: "upcoming"
    };

    studentData.tasks.push(newTask);
    pushCustomNotification(`New Task Added: "${name}"`);

    document.getElementById("taskNameInput").value = "";
    if (document.getElementById("taskDateInput")) document.getElementById("taskDateInput").value = "";
    document.getElementById("taskStartTimeInput").value = "";
    document.getElementById("taskEndTimeInput").value = "";
    updateUI();
    syncToCloud();
}

function updateTaskDynamicStatuses() {
    const now = new Date();

    studentData.tasks.forEach(task => {
        if (task.isCompleted) {
            task.status = "completed";
            return;
        }

        const [startH, startM] = task.startTime.split(':').map(Number);
        const [endH, endM] = task.endTime.split(':').map(Number);

        const taskStart = new Date(task.date || Date.now());
        taskStart.setHours(startH, startM, 0, 0);

        const taskEnd = new Date(task.date || Date.now());
        taskEnd.setHours(endH, endM, 0, 0);

        if (now < taskStart) {
            task.status = "upcoming";
        } else if (now >= taskStart && now <= taskEnd) {
            task.status = "ongoing";
        } else {
            task.status = "missed";
            if (!task.wasWarned) {
                showWarningModal(task.name);
                task.wasWarned = true;
                pushCustomNotification(`⚠️ MISSED TASK: "${task.name}"`);
            }
        }
    });
}

function toggleTaskComplete(id) {
    const task = studentData.tasks.find(t => t.id === id);
    if (task) {
        task.isCompleted = !task.isCompleted;
        task.status = task.isCompleted ? "completed" : "upcoming";
        pushCustomNotification(`Task "${task.name}" status updated to ${task.status.toUpperCase()}`);
        updateUI();
        syncToCloud();
    }
}

function deleteTask(id) {
    studentData.tasks = studentData.tasks.filter(t => t.id !== id);
    updateUI();
    syncToCloud();
}

function showWarningModal(taskTitle) {
    const modal = document.getElementById("warningModal");
    const msg = document.getElementById("modalMsg");
    if (modal && msg) {
        msg.innerText = `Warning: Scheduled time finished for "${taskTitle}"!`;
        modal.style.display = "flex";
    }
}

function closeModal() {
    const modal = document.getElementById("warningModal");
    if (modal) modal.style.display = "none";
}

function saveProfile() {
    const nameInput = document.getElementById("inputStudentName").value;
    const goalInput = document.getElementById("inputDailyGoal").value;

    if (nameInput && nameInput.trim() !== "") studentData.studentName = nameInput.trim();
    if (goalInput && Number(goalInput) > 0) studentData.dailyGoal = Number(goalInput);

    document.getElementById("inputStudentName").value = "";
    document.getElementById("inputDailyGoal").value = "";
    updateUI();
    syncToCloud();
}

// --- RENDER UI (WITH CALENDAR DATE RENDER) ---
function updateUI() {
    updateTaskDynamicStatuses();

    let hrs = Math.floor(studentData.todayStudySeconds / 3600);
    let mins = Math.floor((studentData.todayStudySeconds % 3600) / 60);
    let secs = studentData.todayStudySeconds % 60;

    let display = String(hrs).padStart(2, "0") + ":" + String(mins).padStart(2, "0") + ":" + String(secs).padStart(2, "0");

    if (document.getElementById("timer")) document.getElementById("timer").innerText = display;
    if (document.getElementById("todayStudyTime")) document.getElementById("todayStudyTime").innerText = display;
    if (document.getElementById("focusSessions")) document.getElementById("focusSessions").innerText = studentData.focusSessions + " Sessions";
    if (document.getElementById("displayName")) document.getElementById("displayName").innerText = studentData.studentName;
    if (document.getElementById("studentCardName")) document.getElementById("studentCardName").innerText = studentData.studentName;
    if (document.getElementById("displayGoal")) document.getElementById("displayGoal").innerText = studentData.dailyGoal;

    let goalSecs = studentData.dailyGoal * 60;
    let pct = goalSecs > 0 ? Math.min(100, Math.floor((studentData.todayStudySeconds / goalSecs) * 100)) : 0;
    
    if (document.getElementById("progressFill")) document.getElementById("progressFill").style.width = pct + "%";
    if (document.getElementById("progressText")) document.getElementById("progressText").innerText = pct + "% Completed";

    const list = document.getElementById("taskList");
    if (list) {
        if (!studentData.tasks || studentData.tasks.length === 0) {
            list.innerHTML = "<p style='color:#64748b;'>No tasks added yet.</p>";
        } else {
            list.innerHTML = "";
            studentData.tasks.forEach(task => {
                let item = document.createElement("div");
                item.className = "task-item " + task.status;
                item.innerHTML = `
                    <div style="flex: 1;">
                        <strong>📚 ${task.name}</strong><br>
                        <small>📅 Date: <b>${task.date || 'Today'}</b> | ⏰ ${task.startTime} - ${task.endTime} | Status: <span style="text-transform:uppercase; font-weight:bold;">${task.status}</span></small>
                    </div>
                    <div style="display: flex; gap: 8px; margin-top: 5px;">
                        <button class="start" style="padding: 6px 12px; font-size: 12px; border-radius: 6px;" 
                                onclick="toggleTaskComplete(${task.id})" ${task.status === 'missed' ? 'disabled' : ''}>
                            ${task.isCompleted ? '↩ Undo' : '✔ Complete'}
                        </button>
                        <button class="reset" style="padding: 6px 12px; font-size: 12px; border-radius: 6px;" onclick="deleteTask(${task.id})">❌ Delete</button>
                    </div>
                `;
                list.appendChild(item);
            });
        }
    }
}

document.addEventListener("DOMContentLoaded", () => {
    initStudentChart();
    updateUI();
    syncToCloud();
    startWebcam();
});