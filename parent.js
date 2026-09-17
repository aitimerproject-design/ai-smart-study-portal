// =========================================================
// AI TIMER - PARENT ENGINE (OPTIMIZED & LIVE SYNC)
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

let parentChart = null;

// --- CHART INITIALIZATION ---
function initParentChart() {
    const ctx = document.getElementById('parentStudyChart');
    if (!ctx) return;

    if (parentChart) {
        parentChart.destroy();
    }

    parentChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Live Study Time (Minutes)',
                borderColor: '#16a34a',
                backgroundColor: 'rgba(22, 163, 74, 0.1)',
                data: [],
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

// --- CAMERA SNAPSHOT HELPER ---
function updateCameraSnapshot(snapshotVal) {
    const imgEl = document.getElementById("parentSnapshotImg");
    const txtEl = document.getElementById("noSnapshotText");

    if (snapshotVal && typeof snapshotVal === "string" && snapshotVal.trim().length > 20) {
        let formattedSrc = snapshotVal.trim();
        if (!formattedSrc.startsWith("data:image")) {
            formattedSrc = "data:image/jpeg;base64," + formattedSrc;
        }

        if (imgEl) {
            imgEl.src = formattedSrc;
            imgEl.style.display = "block";
        }
        if (txtEl) {
            txtEl.style.display = "none";
        }
    } else {
        if (imgEl) imgEl.style.display = "none";
        if (txtEl) txtEl.style.display = "block";
    }
}

// --- PHOTO GALLERY RENDERER ---
function renderPhotoGallery(photos) {
    const container = document.getElementById("parentPhotoGallery");
    if (!container) return;

    if (!photos || (Array.isArray(photos) && photos.length === 0) || Object.keys(photos).length === 0) {
        container.innerHTML = "<p style='color:#64748b; font-size:13px;'>No captured photos yet.</p>";
        return;
    }

    container.innerHTML = "";
    const photoArray = Array.isArray(photos) ? photos : Object.values(photos);

    // Render in reverse chronological order
    photoArray.slice().reverse().forEach(item => {
        if (!item || !item.image) return;
        const card = document.createElement("div");
        card.style.cssText = "display:inline-block; margin:6px; text-align:center; background:#1e293b; padding:6px; border-radius:8px; border:1px solid #334155;";
        
        card.innerHTML = `
            <img src="${item.image}" style="width:110px; height:80px; object-fit:cover; border-radius:6px; display:block;" alt="Snapshot" />
            <div style="font-size:11px; color:#cbd5e1; margin-top:4px; font-weight:bold;">${item.timestamp || ''}</div>
            <div style="font-size:10px; color:#f87171;">${item.reason || ''}</div>
        `;
        container.appendChild(card);
    });
}

// --- AWAY ALERT BANNER ---
function renderParentAlertBanner(data) {
    const alertBox = document.getElementById("parentAlertBanner");
    if (!alertBox) return;

    if (data.parentAlert === true) {
        alertBox.style.display = "block";
        alertBox.style.backgroundColor = "#ef4444";
        alertBox.style.color = "#ffffff";
        alertBox.style.padding = "10px 15px";
        alertBox.style.borderRadius = "8px";
        alertBox.style.marginBottom = "15px";
        alertBox.style.fontWeight = "bold";
        alertBox.innerText = `${data.parentAlertMessage || "🚨 PARENT ALERT: Student is away!"} (${data.parentAlertTime || ""})`;
    } else {
        alertBox.style.display = "none";
    }
}

// --- FOCUS SESSION HISTORY RENDERER ---
function renderParentFocusSessions(history) {
    const container = document.getElementById("parentFocusSessionsList");
    if (!container) return;

    if (!history || (Array.isArray(history) && history.length === 0) || Object.keys(history).length === 0) {
        container.innerHTML = "<p style='color:#64748b; font-size:12px;'>No focus sessions logged today.</p>";
        return;
    }

    container.innerHTML = "";
    const historyArray = Array.isArray(history) ? history : Object.values(history);

    historyArray.slice().reverse().forEach((item, index) => {
        if (!item) return;
        const div = document.createElement("div");
        div.style.cssText = "padding: 6px 0; border-bottom: 1px solid #334155; color: #cbd5e1; font-size: 12px;";
        
        const sessionNum = historyArray.length - index;
        const timeText = item.timeRange || (item.startTime && item.endTime ? `${item.startTime} to ${item.endTime}` : "Completed");
        const durationText = item.duration ? ` (${item.duration})` : '';

        div.innerHTML = `⏱ <b>Session ${sessionNum}:</b> ${timeText} <span style="color:#16a34a; font-weight:bold;">${durationText}</span>`;
        container.appendChild(div);
    });
}

// --- REALTIME FIREBASE DASHBOARD LISTENER ---
function listenToStudentDashboard() {
    // 1. Direct Listener for Camera Snapshots
    db.ref("studentData/lastSnapshot").on("value", (snap) => {
        updateCameraSnapshot(snap.val());
    });

    // 2. Main Realtime Sync
    db.ref("studentData").on("value", (snapshot) => {
        const data = snapshot.val();
        if (!data) return;

        // Backup Snapshot Update
        if (data.lastSnapshot) {
            updateCameraSnapshot(data.lastSnapshot);
        }

        // Student Name
        if (document.getElementById("parentStudentName")) {
            document.getElementById("parentStudentName").innerText = data.studentName || "Student";
        }

        // Study Time Calculation
        const studySeconds = Number(data.todayStudySeconds) || Number(data.studyTimeSeconds) || 0;
        let hrs = Math.floor(studySeconds / 3600);
        let mins = Math.floor((studySeconds % 3600) / 60);
        let secs = studySeconds % 60;
        
        if (document.getElementById("parentStudyTime")) {
            document.getElementById("parentStudyTime").innerText = 
                String(hrs).padStart(2, "0") + ":" +
                String(mins).padStart(2, "0") + ":" +
                String(secs).padStart(2, "0");
        }

        // Focus Sessions Count
        if (document.getElementById("parentFocusSessions")) {
            document.getElementById("parentFocusSessions").innerText = (data.focusSessions || 0) + " Sessions";
        }

        // AI Status Badge & Indicators
        const aiStatusEl = document.getElementById("parentAIFaceStatusText");
        if (aiStatusEl) {
            let statusText = String(data.aiStatus || "");
            
            if (data.cameraActive === false) {
                aiStatusEl.innerText = "⚠️ Camera Off";
                aiStatusEl.style.color = "#f59e0b";
            } else if (data.faceDetected === true || statusText.toLowerCase().includes("present") || statusText.toLowerCase().includes("focused")) {
                aiStatusEl.innerText = "🟢 Active / Present";
                aiStatusEl.style.color = "#16a34a";
            } else if (data.faceDetected === false || statusText.toLowerCase().includes("away") || statusText.toLowerCase().includes("distracted")) {
                aiStatusEl.innerText = "🔴 Away / Face Missing";
                aiStatusEl.style.color = "#ef4444";
            } else {
                aiStatusEl.innerText = statusText || "🟡 Monitoring...";
                aiStatusEl.style.color = "#64748b";
            }
        }

        // Timestamp
        const timeEl = document.getElementById("parentSnapshotTime");
        if (timeEl && data.lastSnapshotTime) {
            timeEl.innerText = data.lastSnapshotTime;
        }

        // Daily Goal Progress Bar
        const dailyGoalMins = Number(data.dailyGoal) || 120;
        const goalSeconds = dailyGoalMins * 60;
        let percent = goalSeconds > 0 ? Math.min(100, Math.floor((studySeconds / goalSeconds) * 100)) : 0;

        if (document.getElementById("parentProgressFill")) {
            document.getElementById("parentProgressFill").style.width = percent + "%";
        }
        if (document.getElementById("parentProgressText")) {
            document.getElementById("parentProgressText").innerText = percent + "% Completed";
        }

        // Graph Update
        if (parentChart && data.chartLabels && data.chartData) {
            parentChart.data.labels = Array.isArray(data.chartLabels) ? data.chartLabels : Object.values(data.chartLabels);
            parentChart.data.datasets[0].data = Array.isArray(data.chartData) ? data.chartData : Object.values(data.chartData);
            parentChart.update('none');
        }

        // Sub-component Renderers
        renderParentAlertBanner(data);
        renderPhotoGallery(data.capturedPhotos || []);
        renderParentFocusSessions(data.focusSessionHistory || []);
        renderParentTasks(data.tasks || []);
        renderParentNotifications(data.notifications || []);
    });
}

// --- TASK LIST RENDERER ---
function renderParentTasks(tasks) {
    const container = document.getElementById("parentTaskList");
    if (!container) return;

    if (!tasks || (Array.isArray(tasks) && tasks.length === 0) || Object.keys(tasks).length === 0) {
        container.innerHTML = "<p style='color:#64748b;'>No Tasks Assigned</p>";
        return;
    }

    container.innerHTML = "";
    const taskArray = Array.isArray(tasks) ? tasks : Object.values(tasks);

    taskArray.forEach((task) => {
        if (!task) return;
        const div = document.createElement("div");
        const status = String(task.status || "upcoming").toLowerCase();
        div.className = "task-item " + status;

        div.innerHTML = `
            <strong>📚 ${task.name || "Untitled Task"}</strong><br>
            <small>📅 Date: <b>${task.date || 'Today'}</b> | ⏰ Time: ${task.startTime || "--:--"} - ${task.endTime || "--:--"}</small><br>
            📌 Status: <strong style="text-transform: uppercase;">${status}</strong>
        `;
        container.appendChild(div);
    });
}

// --- NOTIFICATION / LOG RENDERER ---
function renderParentNotifications(notifications) {
    const box = document.getElementById("parentNotificationList");
    if (!box) return;

    if (!notifications || (Array.isArray(notifications) && notifications.length === 0) || Object.keys(notifications).length === 0) {
        box.innerHTML = "<p style='color:#64748b;'>No recent alerts</p>";
        return;
    }

    box.innerHTML = "";
    const notifArray = Array.isArray(notifications) ? notifications : Object.values(notifications);

    notifArray.slice().reverse().forEach((notif) => {
        if (!notif) return;
        const item = document.createElement("p");
        item.style.fontSize = "13px";
        item.style.margin = "4px 0";

        const msg = typeof notif === "string" ? notif : (notif.message || notif.text || "");
        const time = typeof notif === "object" && notif.time ? notif.time : "Just now";

        item.style.color = (msg.includes("Alert") || msg.includes("MISSED") || msg.includes("Away") || msg.includes("🚨")) ? "#ef4444" : "#94a3b8";
        item.innerHTML = `<small style='color:#64748b;'>[${time}]</small> ${msg}`;
        box.appendChild(item);
    });
}

// --- INITIALIZE ON DOM LOAD ---
document.addEventListener("DOMContentLoaded", () => {
    initParentChart();
    listenToStudentDashboard();
});
