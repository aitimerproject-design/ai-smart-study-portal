import cv2
import time
import requests
from flask import Flask, Response
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# --- Firebase Realtime Database URL ---
FIREBASE_URL = "https://ai-timer-project-default-rtdb.firebaseio.com/studentData.json"

# --- OpenCV Face Detectors Initialize ---
face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
profile_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_profileface.xml')

# --- Timer & Sync Variables ---
absent_start_time = None
notification_sent = False
last_pushed_status = None 

def update_firebase_status(camera_active, face_detected, ai_status):
    """Direct Realtime Sync with Firebase Database"""
    global last_pushed_status
    current_status = (camera_active, face_detected, ai_status)
    
    # Send update only if status changes to prevent database overload
    if current_status != last_pushed_status:
        try:
            payload = {
                "cameraActive": camera_active,
                "faceDetected": face_detected,
                "aiStatus": ai_status
            }
            requests.patch(FIREBASE_URL, json=payload, timeout=1)
            last_pushed_status = current_status
            print(f"🔥 Firebase Updated -> Status: {ai_status} | Face Detected: {face_detected}")
        except Exception as e:
            print("⚠️ Firebase Sync Error:", e)

def send_alert_to_parents():
    """Trigger alert on Firebase for Parent Dashboard"""
    print("\n🚨 ALERT: Student is not at the table for more than 1 minute!\n")
    try:
        alert_payload = {
            "parentAlert": True,
            "parentAlertMessage": "🚨 PARENT ALERT: Student is away from table (> 1 min)!"
        }
        requests.patch(FIREBASE_URL, json=alert_payload, timeout=1)
    except Exception as e:
        print("⚠️ Alert Push Error:", e)

def detect_face(frame):
    """Face Detection Logic supporting both Frontal & Profile (Side) angles"""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    
    # 1. Frontal Face Check
    faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4, minSize=(30, 30))
    faces_list = list(faces) if len(faces) > 0 else []

    # 2. Profile / Side Face Check (Tolerance for Head Turns)
    if len(faces_list) == 0:
        profiles = profile_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=3, minSize=(30, 30))
        if len(profiles) > 0:
            faces_list.extend(profiles)
        else:
            flipped_gray = cv2.flip(gray, 1)
            profiles_flipped = profile_cascade.detectMultiScale(flipped_gray, scaleFactor=1.1, minNeighbors=3, minSize=(30, 30))
            if len(profiles_flipped) > 0:
                _, w_frame = gray.shape
                for (x, y, w, h) in profiles_flipped:
                    faces_list.append((w_frame - x - w, y, w, h))

    has_face = len(faces_list) > 0
    return has_face, faces_list

def generate_frames():
    global absent_start_time, notification_sent
    cap = cv2.VideoCapture(0)

    while True:
        success, frame = cap.read()
        if not success:
            update_firebase_status(camera_active=False, face_detected=False, ai_status="⚠️ Camera Off")
            break

        # 1. Detect Face
        has_face, faces = detect_face(frame)

        # 2. Logic & Live Firebase Update
        if has_face:
            absent_start_time = None
            notification_sent = False

            update_firebase_status(camera_active=True, face_detected=True, ai_status="Active / Present")

            for (x, y, w, h) in faces:
                cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 2)
                cv2.putText(frame, "Student Present", (x, y - 10), 
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
        else:
            if absent_start_time is None:
                absent_start_time = time.time()

            elapsed_time = int(time.time() - absent_start_time)

            update_firebase_status(camera_active=True, face_detected=False, ai_status="Away / Distracted")

            cv2.putText(frame, f"Away: {elapsed_time}s / 60s", (20, 40), 
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)

            if elapsed_time >= 60 and not notification_sent:
                send_alert_to_parents()
                notification_sent = True

        # Video stream encode
        ret, buffer = cv2.imencode('.jpg', frame)
        frame_bytes = buffer.tobytes()

        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')

    cap.release()

@app.route('/video_feed')
def video_feed():
    return Response(generate_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/status', methods=['GET'])
def get_status():
    global last_pushed_status
    if last_pushed_status:
        return {"camera_active": last_pushed_status[0], "is_present": last_pushed_status[1], "ai_status": last_pushed_status[2]}
    return {"camera_active": False, "is_present": False, "ai_status": "Offline"}

if __name__ == '__main__':
    print("🚀 Starting AI Study Tracker Python Server on http://localhost:5000 ...")
    app.run(host='0.0.0.0', port=5000, debug=True)