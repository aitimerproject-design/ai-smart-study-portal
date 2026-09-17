// =========================================================
// GURU AI TIMER - STUDENT ENGINE (WITH FACE-API.JS RECOGNITION)
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

// --- GLOBAL STATE ---
let timerInterval = null;
let aiLoopInterval = null;
let isRunning = false;
let currentSessionSeconds = 0;
let currentSessionStartTime = null;
let webcamStream = null;
let studyChart = null;

// --- FACE-API.JS STATE ---
let isModelsLoaded = false;
let registeredDescriptor = JSON.parse(localStorage.getItem("registeredFaceDescriptor")) || null;
const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';

// --- HEAD TILT & READING BUFFER (FIXED FOR HEAD DOWN / WRITING) ---
let gracePeriodCounter = 0; 
const MAX_GRACE_TICKS = 35; // Badha kar ~20-25 seconds kar diya hai padhne/likhne ke liye

// --- DYNAMIC PARENT AWAY ALERT TRACKER ---
let awayStartTime = null;
let lastAlertMinute = 0; 

function getTodayDateString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function normalizeTaskStatus(status) {
    return String(status || "upcoming").toLowerCase().trim();
}

function getCleanHistoryArray(historyData) {
    if (!historyData) return [];
    if (Array.isArray(historyData)) return historyData;
    if (typeof historyData === "object") return Object.values(historyData);
    return [];
}

let studentData = {
    studentName: localStorage.getItem("studentName") || "Student",
    todayStudySeconds: Number(localStorage.getItem("todayStudySeconds")) || 0,
    lastActiveDate: localStorage.getItem("lastStudyDate") || getTodayDateString(),
    focusSessions: Number(localStorage.getItem("focusSessions")) || 0,
    focusSessionHistory: JSON.parse(localStorage.getItem("focusSessionHistory")) || [],
    dailyGoal: Number(localStorage.getItem("dailyGoal")) || 120,
    tasks: JSON.parse(localStorage.getItem("tasks")) || [],
    notifications: JSON.parse(localStorage.getItem("notifications")) || [],
    capturedPhotos: JSON.parse(localStorage.getItem("capturedPhotos")) || [],
    chartLabels: JSON.parse(localStorage.getItem("chartLabels")) || [],
    chartData: JSON.parse(localStorage.getItem("chartData")) || [],
    deviceStatus: "Online",
    cameraActive: false,
    faceDetected: false,
    aiStatus: "Loading AI Models...",
    lastSnapshot: "",
    lastSnapshotTime: "",
    parentAlert: false,
    parentAlertMessage: "",
    parentAlertTime: ""
};

// --- LOAD FACE-API.JS MODELS ---
async function loadFaceApiModels() {
    try {
        studentData.aiStatus = "Loading AI Models...";
        updateUI();

        await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
        await faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL);
        await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);

        isModelsLoaded = true;
        studentData.aiStatus = registeredDescriptor ? "AI Ready (Face Locked)" : "AI Ready (Face Not Locked)";
        updateUI();
        console.log("Face-API Models Loaded Successfully.");
    } catch (err) {
        console.error("Error loading face-api models:", err);
        studentData.aiStatus = "⚠️ AI Model Load Error";
        updateUI();
    }
}

// --- REGISTER / LOCK STUDENT FACE ---
async function resetRegisteredStudent() {
    const videoEl = document.getElementById("webcamVideo");
    
    if (!videoEl || !isModelsLoaded || !studentData.cameraActive) {
        alert("Camera active nahi hai ya AI Models load ho rahe hain. Kripya wait karein!");
        return;
    }

    studentData.aiStatus = "Scanning Face Signature...";
    updateUI();

    try {
        const detection = await faceapi.detectSingleFace(videoEl, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.3 }))
                                        .withFaceLandmarks(true)
                                        .withFaceDescriptor();

        if (detection) {
            registeredDescriptor = Array.from(detection.descriptor);
            localStorage.setItem("registeredFaceDescriptor", JSON.stringify(registeredDescriptor));
            
            studentData.aiStatus = "✅ Face Registered Successfully!";
            pushCustomNotification("🔒 Registered Baseline Face Locked.");
            captureAndUploadSnapshot("Face Registered");
            syncToCloud();
            updateUI();
            alert("Aapka Face Baseline Successfully Save/Lock ho gaya hai!");
        } else {
            studentData.aiStatus = "⚠️ Face Not Detected";
            updateUI();
            alert("Face detect nahi ho paya. Camera ke samne seedhe dekhein aur dobara try karein!");
        }
    } catch (err) {
        console.error("Face registration error:", err);
        alert("Face signature capture karne me error aayi!");
    }
}

// --- RECORD FOCUS SESSION DURATION ---
function recordFocusSession(durationSecs) {
    if (durationSecs < 5) {
        currentSessionStartTime = null;
        return;
    }

    const endTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    const startTimeStr = currentSessionStartTime || endTimeStr;
    const timeRangeStr = `${startTimeStr} to ${endTimeStr}`;
    
    let mins = Math.max(1, Math.round(durationSecs / 60));
    let durationStr = `${mins} min${mins > 1 ? 's' : ''}`;

    const sessionEntry = {
        id: Date.now(),
        timeRange: timeRangeStr,
        startTime: startTimeStr,
        endTime: endTimeStr,
        duration: durationStr,
        date: getTodayDateString()
    };

    let historyArr = getCleanHistoryArray(studentData.focusSessionHistory);
    historyArr.push(sessionEntry);
    studentData.focusSessionHistory = historyArr;

    localStorage.setItem("focusSessionHistory", JSON.stringify(studentData.focusSessionHistory));
    db.ref("studentData/focusSessionHistory").set(studentData.focusSessionHistory);

    currentSessionStartTime = null;
}

// --- DAILY MIDNIGHT AUTO-RESET LOGIC ---
function checkDailyReset() {
    const today = getTodayDateString();
    const savedDate = localStorage.getItem("lastStudyDate");

    if (!savedDate) {
        localStorage.setItem("lastStudyDate", today);
        studentData.lastActiveDate = today;
        return;
    }

    if (savedDate !== today) {
        studentData.todayStudySeconds = 0;
        currentSessionSeconds = 0;
        studentData.focusSessions = 0;
        studentData.focusSessionHistory = [];
        studentData.chartLabels = [];
        studentData.chartData = [];

        studentData.notifications = [];
        studentData.parentAlert = false;
        studentData.parentAlertMessage = "";
        studentData.parentAlertTime = "";
        lastAlertMinute = 0;

        studentData.capturedPhotos = [];
        studentData.lastSnapshot = "";
        studentData.lastSnapshotTime = "";

        if (studentData.tasks && studentData.tasks.length > 0) {
            studentData.tasks.forEach(task => {
                task.isCompleted = false;
                task.wasWarned = false;
                task.status = "upcoming";
                task.date = today;
            });
        }

        studentData.lastActiveDate = today;

        if (studyChart) {
            studyChart.data.labels = ['Start'];
            studyChart.data.datasets[0].data = [0];
            studyChart.update();
        }

        localStorage.setItem("lastStudyDate", today);
        localStorage.setItem("todayStudySeconds", "0");
        localStorage.setItem("focusSessions", "0");
        localStorage.setItem("focusSessionHistory", "[]");
        localStorage.setItem("notifications", "[]");
        localStorage.setItem("capturedPhotos", "[]");
        localStorage.setItem("tasks", JSON.stringify(studentData.tasks));

        updateUI();
        syncToCloud();
    }
}

// --- GRAPH SETUP ---
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

    if (studentData.chartLabels.length > 20) {
        studentData.chartLabels.shift();
        studentData.chartData.shift();
    }

    if (studyChart) {
        studyChart.data.labels = studentData.chartLabels;
        studyChart.data.datasets[0].data = studentData.chartData;
        studyChart.update();
    }
}

// --- WEBCAM & CONTINUOUS AI FACE MATCHING ---
async function startWebcam() {
    const videoEl = document.getElementById("webcamVideo");
    const errDiv = document.getElementById("camErrorMsg");

    if (!videoEl) return;

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: 320, height: 240, facingMode: "user" }, 
            audio: false 
        });
        
        webcamStream = stream;
        videoEl.srcObject = stream;
        await videoEl.play();
        
        if (errDiv) errDiv.style.display = "none";
        videoEl.style.display = "block";
        
        studentData.cameraActive = true;
        
        startContinuousFaceVerification();

        setTimeout(() => {
            captureAndUploadSnapshot("Session Started");
        }, 2000);

    } catch (err) {
        console.error("Webcam Permission Error:", err);
        studentData.cameraActive = false;
        studentData.faceDetected = false;
        studentData.aiStatus = "⚠️ Camera Off";
        if (errDiv) errDiv.style.display = "block";
        syncToCloud();
    }
}

function startContinuousFaceVerification() {
    if (aiLoopInterval) clearInterval(aiLoopInterval);

    aiLoopInterval = setInterval(async () => {
        await processFaceFrame();
    }, 600);
}

// --- PROCESS FACE FRAME (FIXED FALSE AWAY WHEN READING/WRITING) ---
async function processFaceFrame() {
    const videoEl = document.getElementById("webcamVideo");

    if (!videoEl || videoEl.paused || videoEl.ended || !studentData.cameraActive || !isModelsLoaded) {
        studentData.faceDetected = false;
        return;
    }

    try {
        // Reduced scoreThreshold to 0.3 to better catch tilted/downward faces
        const detection = await faceapi.detectSingleFace(videoEl, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.3 }))
                                        .withFaceLandmarks(true)
                                        .withFaceDescriptor();

        if (detection) {
            gracePeriodCounter = 0;

            if (registeredDescriptor) {
                const distance = faceapi.euclideanDistance(detection.descriptor, registeredDescriptor);
                
                if (distance < 0.60) {
                    studentData.faceDetected = true;
                    studentData.aiStatus = "Present / Verified";
                } else {
                    studentData.faceDetected = false;
                    studentData.aiStatus = "⚠️ Mismatch / Unknown Person";
                }
            } else {
                studentData.faceDetected = true;
                studentData.aiStatus = "Present (Lock Face Suggested)";
            }
        } else {
            // Sir neeche hone par ya camera se thoda hatne par Buffer Period chalega
            gracePeriodCounter++;

            if (gracePeriodCounter < MAX_GRACE_TICKS) {
                // Buffer Period me false Away nahi dikhaega aur timer chalta rahega
                studentData.faceDetected = true;
                studentData.aiStatus = "📖 Reading / Writing (Head Down)";
            } else {
                // Agar sach me continuous ~20 seconds tak koi chehra nahi mila
                studentData.faceDetected = false;
                studentData.aiStatus = "Away / Distracted";
            }
        }

        db.ref("studentData").update({
            faceDetected: studentData.faceDetected,
            aiStatus: studentData.aiStatus,
            cameraActive: studentData.cameraActive
        });

    } catch (err) {
        console.error("AI Face processing error:", err);
    }
}

// --- DYNAMIC PRESENCE MONITOR ---
function monitorStudentPresence1Min() {
    if (!isRunning) {
        awayStartTime = null;
        lastAlertMinute = 0;
        return;
    }

    const isAway = !studentData.faceDetected || !studentData.cameraActive;

    if (isAway) {
        if (!awayStartTime) awayStartTime = Date.now();

        const elapsedSeconds = Math.floor((Date.now() - awayStartTime) / 1000);
        const elapsedMinutes = Math.floor(elapsedSeconds / 60);

        if (elapsedMinutes >= 1 && elapsedMinutes > lastAlertMinute) {
            lastAlertMinute = elapsedMinutes;
            studentData.parentAlert = true;

            const alertText = `🚨 PARENT ALERT: Student desk par nahi hai / Mismatch (${elapsedMinutes} min)!`;
            const alertTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            studentData.parentAlertMessage = alertText;
            studentData.parentAlertTime = alertTimeStr;

            captureAndUploadSnapshot(`🚨 Away Alert (${elapsedMinutes} min)`);
            pushCustomNotification(alertText);

            db.ref("studentData").update({
                parentAlert: true,
                parentAlertMessage: alertText,
                parentAlertTime: alertTimeStr,
                notifications: studentData.notifications
            });
        }
    } else {
        if (awayStartTime || lastAlertMinute > 0 || studentData.parentAlert) {
            awayStartTime = null;
            lastAlertMinute = 0;
            studentData.parentAlert = false;
            studentData.parentAlertMessage = "";
            studentData.parentAlertTime = "";

            pushCustomNotification("🟢 Student desk par wapas aa gaya hai.");

            db.ref("studentData").update({
                parentAlert: false,
                parentAlertMessage: "",
                parentAlertTime: "",
                notifications: studentData.notifications
            });
        }
    }
}

// --- SNAPSHOT UPLOAD ---
function captureAndUploadSnapshot(reason = "Periodic Snapshot") {
    const videoEl = document.getElementById("webcamVideo");
    let canvasEl = document.getElementById("snapshotCanvas");

    if (!canvasEl) {
        canvasEl = document.createElement("canvas");
        canvasEl.id = "snapshotCanvas";
        canvasEl.style.display = "none";
        document.body.appendChild(canvasEl);
    }

    if (!videoEl || videoEl.paused || videoEl.ended || videoEl.readyState < 2) return;

    try {
        const ctx = canvasEl.getContext("2d");
        canvasEl.width = 240;
        canvasEl.height = 180;

        ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
        
        const photoBase64 = canvasEl.toDataURL("image/jpeg", 0.3);
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        studentData.lastSnapshot = photoBase64;
        studentData.lastSnapshotTime = timeStr;

        if (!studentData.capturedPhotos) studentData.capturedPhotos = [];
        
        studentData.capturedPhotos.push({
            image: photoBase64,
            timestamp: timeStr,
            reason: reason
        });

        if (studentData.capturedPhotos.length > 3) {
            studentData.capturedPhotos.shift();
        }

        localStorage.setItem("capturedPhotos", JSON.stringify(studentData.capturedPhotos));

        db.ref("studentData").update({
            lastSnapshot: photoBase64,
            lastSnapshotTime: timeStr,
            capturedPhotos: studentData.capturedPhotos
        });

    } catch (err) {
        console.error("Snapshot error:", err);
    }
}

function syncToCloud() {
    try {
        localStorage.setItem("studentName", studentData.studentName);
        localStorage.setItem("todayStudySeconds", studentData.todayStudySeconds);
        localStorage.setItem("lastStudyDate", studentData.lastActiveDate);
        localStorage.setItem("focusSessions", studentData.focusSessions);
        localStorage.setItem("focusSessionHistory", JSON.stringify(studentData.focusSessionHistory || []));
        localStorage.setItem("dailyGoal", studentData.dailyGoal);
        localStorage.setItem("tasks", JSON.stringify(studentData.tasks));
        localStorage.setItem("notifications", JSON.stringify(studentData.notifications));
        localStorage.setItem("capturedPhotos", JSON.stringify(studentData.capturedPhotos));
        localStorage.setItem("chartLabels", JSON.stringify(studentData.chartLabels));
        localStorage.setItem("chartData", JSON.stringify(studentData.chartData));

        db.ref("studentData").update(studentData);
    } catch(e) {
        console.error("Sync error:", e);
    }
}

// --- TIMER CONTROLS ---
function startTimer() {
    if (isRunning) return;
    
    if (!currentSessionStartTime) {
        currentSessionStartTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    }

    isRunning = true;
    awayStartTime = null;

    checkDailyReset();
    captureAndUploadSnapshot("Timer Started");
    updateUI();

    timerInterval = setInterval(() => {
        checkDailyReset();
        currentSessionSeconds++;
        studentData.todayStudySeconds++;

        if (studentData.todayStudySeconds % 60 === 0) {
            captureAndUploadSnapshot("Study Snapshot");
            updateGraphPoints();
        }

        updateUI();

        if (studentData.todayStudySeconds % 2 === 0) {
            syncToCloud();
        }
    }, 1000);
}

function pauseTimer() {
    if (!isRunning) return;
    isRunning = false;
    awayStartTime = null;
    clearInterval(timerInterval);

    pushCustomNotification(`Session Paused`);
    updateUI();
    syncToCloud();
}

function resetTimer() {
    if (isRunning) {
        isRunning = false;
        clearInterval(timerInterval);
    }
    
    awayStartTime = null;

    if (currentSessionSeconds >= 5) {
        studentData.focusSessions++;
        recordFocusSession(currentSessionSeconds);
        updateGraphPoints();
        pushCustomNotification(`Session Completed! Total Focus Sessions: ${studentData.focusSessions}`);
    } else {
        currentSessionStartTime = null;
    }

    currentSessionSeconds = 0;
    
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
    localStorage.setItem("notifications", JSON.stringify(studentData.notifications));
    db.ref("studentData/notifications").set(studentData.notifications);
}

// --- TASK MANAGERS ---
function createNewTask() {
    const nameEl = document.getElementById("taskNameInput");
    const dateEl = document.getElementById("taskDateInput");
    const startEl = document.getElementById("taskStartTimeInput");
    const endEl = document.getElementById("taskEndTimeInput");

    const name = nameEl ? nameEl.value : "";
    const dateInput = dateEl ? dateEl.value : "";
    const start = startEl ? startEl.value : "";
    const end = endEl ? endEl.value : "";

    if (!name || name.trim() === "") {
        alert("Please enter a task name!");
        return;
    }

    const newTask = {
        id: Date.now(),
        name: name.trim(),
        date: dateInput || getTodayDateString(),
        startTime: start || "00:00",
        endTime: end || "23:59",
        isCompleted: false,
        wasWarned: false,
        status: "upcoming"
    };

    studentData.tasks.push(newTask);
    pushCustomNotification(`New Task Added: "${name}"`);

    if (nameEl) nameEl.value = "";
    if (dateEl) dateEl.value = "";
    if (startEl) startEl.value = "";
    if (endEl) endEl.value = "";
    
    updateTaskDynamicStatuses();
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

        const taskDateStr = task.date || getTodayDateString();
        const [year, month, day] = taskDateStr.split('-').map(Number);

        const taskStart = new Date(year, month - 1, day, startH, startM, 0, 0);
        const taskEnd = new Date(year, month - 1, day, endH, endM, 0, 0);

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
        updateTaskDynamicStatuses();
        const status = normalizeTaskStatus(task.status);
        pushCustomNotification(`Task "${task.name}" status updated to ${status.toUpperCase()}`);
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
    const nameInput = document.getElementById("inputStudentName") ? document.getElementById("inputStudentName").value : "";
    const goalInput = document.getElementById("inputDailyGoal") ? document.getElementById("inputDailyGoal").value : "";

    if (nameInput && nameInput.trim() !== "") studentData.studentName = nameInput.trim();
    if (goalInput && Number(goalInput) > 0) studentData.dailyGoal = Number(goalInput);

    if (document.getElementById("inputStudentName")) document.getElementById("inputStudentName").value = "";
    if (document.getElementById("inputDailyGoal")) document.getElementById("inputDailyGoal").value = "";
    
    updateUI();
    syncToCloud();
}

// --- RENDER UI ---
function updateUI() {
    let sHrs = Math.floor(currentSessionSeconds / 3600);
    let sMins = Math.floor((currentSessionSeconds % 3600) / 60);
    let sSecs = currentSessionSeconds % 60;
    let sessionDisplay = String(sHrs).padStart(2, "0") + ":" + String(sMins).padStart(2, "0") + ":" + String(sSecs).padStart(2, "0");

    let tHrs = Math.floor(studentData.todayStudySeconds / 3600);
    let tMins = Math.floor((studentData.todayStudySeconds % 3600) / 60);
    let tSecs = studentData.todayStudySeconds % 60;
    let todayDisplay = String(tHrs).padStart(2, "0") + ":" + String(tMins).padStart(2, "0") + ":" + String(tSecs).padStart(2, "0");

    if (document.getElementById("timer")) document.getElementById("timer").innerText = sessionDisplay;
    if (document.getElementById("todayStudyTime")) document.getElementById("todayStudyTime").innerText = todayDisplay;
    
    if (document.getElementById("focusSessions")) document.getElementById("focusSessions").innerText = studentData.focusSessions + " Sessions";
    if (document.getElementById("displayName")) document.getElementById("displayName").innerText = studentData.studentName;
    if (document.getElementById("studentCardName")) document.getElementById("studentCardName").innerText = studentData.studentName;
    if (document.getElementById("displayGoal")) document.getElementById("displayGoal").innerText = studentData.dailyGoal;

    let goalSecs = studentData.dailyGoal * 60;
    let pct = goalSecs > 0 ? Math.min(100, Math.floor((studentData.todayStudySeconds / goalSecs) * 100)) : 0;
    
    if (document.getElementById("progressFill")) document.getElementById("progressFill").style.width = pct + "%";
    if (document.getElementById("progressText")) document.getElementById("progressText").innerText = pct + "% Completed";

    // --- RENDER FOCUS SESSION TIMESTAMPS ---
    const studentFocusList = document.getElementById("studentFocusSessionsList");
    if (studentFocusList) {
        let historyArray = getCleanHistoryArray(studentData.focusSessionHistory);

        let html = "";

        if (isRunning && currentSessionStartTime) {
            let nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
            let activeMins = Math.max(1, Math.round(currentSessionSeconds / 60));
            html += `
                <div style="padding: 6px; margin-bottom: 4px; background: rgba(37, 99, 235, 0.15); border-left: 3px solid #2563eb; border-radius: 4px; color: #60a5fa; font-size: 12px;">
                    ▶ <b>Ongoing Session:</b> ${currentSessionStartTime} to ${nowTime} <span style="font-weight:bold;">(${activeMins} min)</span>
                </div>
            `;
        }

        if (historyArray.length === 0 && !isRunning) {
            html = "<p style='color:#64748b; font-size: 12px;'>No focus sessions logged today.</p>";
        } else {
            html += historyArray.slice().reverse().map((item, index) => {
                const sessionNum = historyArray.length - index;
                const timeText = item.timeRange || (item.startTime && item.endTime ? `${item.startTime} to ${item.endTime}` : "Completed");
                const durationText = item.duration ? ` (${item.duration})` : '';
                return `
                    <div style="padding: 4px 0; border-bottom: 1px solid #1e293b; color: #cbd5e1; font-size: 12px;">
                        ⏱ <b>Session ${sessionNum}:</b> ${timeText} <span style="color:#16a34a; font-weight:bold;">${durationText}</span>
                    </div>
                `;
            }).join('');
        }

        studentFocusList.innerHTML = html;
    }

    // --- RENDER TASKS ---
    const list = document.getElementById("taskList");
    if (list) {
        if (!studentData.tasks || studentData.tasks.length === 0) {
            list.innerHTML = "<p style='color:#64748b;'>No tasks added yet.</p>";
        } else {
            list.innerHTML = "";
            studentData.tasks.forEach(task => {
                let item = document.createElement("div");
                const status = normalizeTaskStatus(task.status);
                item.className = "task-item " + status;
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

// --- EXPOSE FUNCTIONS TO GLOBAL WINDOW OBJECT ---
window.startTimer = startTimer;
window.pauseTimer = pauseTimer;
window.resetTimer = resetTimer;
window.startWebcam = startWebcam;
window.resetRegisteredStudent = resetRegisteredStudent;
window.createNewTask = createNewTask;
window.toggleTaskComplete = toggleTaskComplete;
window.deleteTask = deleteTask;
window.saveProfile = saveProfile;
window.closeModal = closeModal;

// --- INITIALIZATION ---
document.addEventListener("DOMContentLoaded", async () => {
    checkDailyReset();
    initStudentChart();
    updateTaskDynamicStatuses();
    updateUI();
    syncToCloud();

    await loadFaceApiModels();
    await startWebcam();

    setInterval(() => {
        checkDailyReset();
        updateTaskDynamicStatuses();
        monitorStudentPresence1Min();
        updateUI();
    }, 1000);
});
