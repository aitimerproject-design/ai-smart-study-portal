// =========================================================
// AI TIMER - PARENT ENGINE (FIXED REALTIME SNAPSHOT & FOCUS)
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

function initParentChart() {
    const ctx = document.getElementById('parentStudyChart');
    if (!ctx) return;

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

// Live Firebase Realtime Listener
function listenToStudentDashboard() {
    // 🟢 Continuous Listener on studentData
    db.ref("studentData").on("value", (snapshot) => {
        const data = snapshot.val();
        if (!data) return;

        // 1. Student Name Sync
        if (document.getElementById("parentStudentName")) {
            document.getElementById("parentStudentName").innerText = data.studentName || "Student";
        }

        // 2. Study Time Sync
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

        // 3. Focus Sessions Sync (Direct Sync Fix)
        if (document.getElementById("parentFocusSessions")) {
            document.getElementById("parentFocusSessions").innerText = (data.focusSessions || 0) + " Sessions";
        }

        // 4. AI Face Status Indicator (Smart Sync for Boolean & Text)
        const aiStatusEl = document.getElementById("parentAIFaceStatusText");
        if (aiStatusEl) {
            let statusText = data.aiStatus || "";
            
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

        // 5. Live Photo Snapshot Update
        const imgEl = document.getElementById("parentSnapshotImg");
        const txtEl = document.getElementById("noSnapshotText");
        const timeEl = document.getElementById("parentSnapshotTime");

        if (data.lastSnapshot && data.lastSnapshot.length > 50) {
            if (imgEl) {
                imgEl.src = data.lastSnapshot;
                imgEl.style.display = "block";
            }
            if (txtEl) txtEl.style.display = "none";
            if (timeEl) timeEl.innerText = data.lastSnapshotTime || "Just now";
        } else {
            if (imgEl) imgEl.style.display = "none";
            if (txtEl) txtEl.style.display = "block";
        }

        // 6. Goal Progress
        const dailyGoalMins = Number(data.dailyGoal) || 120;
        const goalSeconds = dailyGoalMins * 60;
        let percent = goalSeconds > 0 ? Math.min(100, Math.floor((studySeconds / goalSeconds) * 100)) : 0;

        if (document.getElementById("parentProgressFill")) {
            document.getElementById("parentProgressFill").style.width = percent + "%";
        }
        if (document.getElementById("parentProgressText")) {
            document.getElementById("parentProgressText").innerText = percent + "% Completed";
        }

        // 7. Graph Sync
        if (parentChart && data.chartLabels && data.chartData) {
            parentChart.data.labels = data.chartLabels;
            parentChart.data.datasets[0].data = data.chartData;
            parentChart.update('none'); // Safe smooth update without lag
        }

        // 8. Task & Log Sync
        renderParentTasks(data.tasks || []);
        renderParentNotifications(data.notifications || []);
    });
}

function renderParentTasks(tasks) {
    const container = document.getElementById("parentTaskList");
    if (!container) return;

    if (!tasks || tasks.length === 0) {
        container.innerHTML = "<p style='color:#64748b;'>No Tasks Assigned</p>";
        return;
    }

    container.innerHTML = "";
    
    // Support array or object tasks
    const taskArray = Array.isArray(tasks) ? tasks : Object.values(tasks);

    taskArray.forEach((task) => {
        if (!task) return;
        let div = document.createElement("div");
        let status = (task.status || "upcoming").toLowerCase();
        div.className = "task-item " + status;

        div.innerHTML = `
            <strong>📚 ${task.name || "Untitled Task"}</strong><br>
            ⏰ Time: ${task.startTime || "--:--"} - ${task.endTime || "--:--"}<br>
            📌 Status: <strong style="text-transform: uppercase;">${status}</strong>
        `;
        container.appendChild(div);
    });
}

function renderParentNotifications(notifications) {
    const box = document.getElementById("parentNotificationList");
    if (!box) return;

    if (!notifications || notifications.length === 0) {
        box.innerHTML = "<p style='color:#64748b;'>No recent alerts</p>";
        return;
    }

    box.innerHTML = "";
    
    const notifArray = Array.isArray(notifications) ? notifications : Object.values(notifications);

    notifArray.slice().reverse().forEach((notif) => {
        if (!notif) return;
        let item = document.createElement("p");
        item.style.fontSize = "13px";
        item.style.margin = "4px 0";

        let msg = typeof notif === "string" ? notif : (notif.message || notif.text || "");
        let time = typeof notif === "object" && notif.time ? notif.time : "Just now";

        item.style.color = (msg.includes("Alert") || msg.includes("MISSED") || msg.includes("Away")) ? "#ef4444" : "#94a3b8";
        item.innerHTML = `<small style='color:#64748b;'>[${time}]</small> ${msg}`;
        box.appendChild(item);
    });
}

document.addEventListener("DOMContentLoaded", () => {
    initParentChart();
    listenToStudentDashboard();
});